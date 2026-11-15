//! Tauri commands, events and the shared state behind them (spec 5-6).
//!
//! Commands the UI calls (camelCase JSON both ways):
//!   get_context() -> Context        set_lang(lang)            pick_dir() -> string | null
//!   app_running() -> bool           close_app(force) -> "closed" | "stillRunning"
//!   start_install(dir | null)       start_uninstall()         open_app()
//!   show_log()                      quit()                    ready()
//!   quit_relaunch_previous()
//! Events (all emitted to the whole app):
//!   setup://progress {percent}      setup://uninstall-progress {}
//!   setup://done {}                 setup://failed {reason, log}
//!
//! Update mode has no separate start command: the UI calls `start_install(null)` right after
//! `ready`, and Rust waits for the old app to exit before running the pipeline.

use crate::apprun::{
    close_and_wait, wait_for_exit, CloseOutcome, ProcessControl, CLOSE_TIMEOUT, POLL,
    UPDATE_EXIT_TIMEOUT,
};
use crate::install::{
    self, pick_target, Env, FailReason, InstallEvent, InstallRequest,
};
use crate::lang::{default_lang, read_installer_language, windows_ui_language, Lang};
use crate::nsis::NsisRunner;
use crate::payload::ManifestEntry;
use crate::registry::{
    existing_install, previous_install_location, Hive, RegStore,
};
use crate::uninstall::{run_uninstall, UninstallEvent};
use crate::version::{install_kind, InstallKind};
use serde::Serialize;
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

// ---------- backend: everything that touches the machine ----------

/// `RegStore` is not `Sync` (MemReg holds a RefCell), so state keeps a factory and every
/// operation builds its own store. `WinReg` is a unit struct, so this costs nothing there.
pub type RegFactory = Box<dyn Fn() -> Box<dyn RegStore> + Send + Sync>;

pub struct Backend {
    pub reg: RegFactory,
    pub nsis: Arc<dyn NsisRunner>,
    pub procs: Arc<dyn ProcessControl>,
    pub temp: PathBuf,
    pub desktop: PathBuf,
    pub default_dir: PathBuf,
    pub manifest: Vec<ManifestEntry>,
    pub nsis_exe: &'static [u8],
    pub uninstall_ui: &'static [u8],
}

impl Backend {
    #[cfg(windows)]
    pub fn real() -> Backend {
        use crate::apprun::WinProcess;
        use crate::nsis::RealNsis;
        use crate::registry::WinReg;

        let local = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("AppData").join("Local")))
            .unwrap_or_else(std::env::temp_dir);

        // Shell Folders holds the expanded path, which follows OneDrive redirection.
        let desktop = WinReg
            .get_str(
                Hive::Hkcu,
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders",
                "Desktop",
            )
            .filter(|p| !p.trim().is_empty())
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("Desktop")))
            .unwrap_or_else(|| std::env::temp_dir().join("Desktop"));

        Backend {
            reg: Box::new(|| Box::new(WinReg) as Box<dyn RegStore>),
            nsis: Arc::new(RealNsis),
            procs: Arc::new(WinProcess),
            temp: std::env::temp_dir(),
            desktop,
            default_dir: local.join("IWAE"),
            manifest: crate::payload::manifest(),
            nsis_exe: crate::payload::nsis_bytes(),
            uninstall_ui: crate::payload::uninstall_ui_bytes(),
        }
    }

    #[cfg(not(windows))]
    pub fn real() -> Backend {
        unimplemented!("the setup window only runs on Windows")
    }

    /// Builds a fresh registry handle and an `Env` around it for one operation.
    pub fn with_env<T>(&self, f: impl FnOnce(&Env<'_>) -> T) -> T {
        let reg = (self.reg)();
        let env = Env {
            reg: &*reg,
            nsis: &*self.nsis,
            temp: self.temp.clone(),
            desktop: self.desktop.clone(),
            default_dir: self.default_dir.clone(),
            manifest: self.manifest.clone(),
            uninstall_ui: self.uninstall_ui,
            nsis_exe: self.nsis_exe,
        };
        f(&env)
    }

    pub fn run_install(&self, req: &InstallRequest, on: &mut dyn FnMut(InstallEvent)) {
        self.with_env(|env| install::run_install(env, req, on));
    }

    pub fn run_uninstall(&self, dir: &Path, on: &mut dyn FnMut(UninstallEvent)) {
        let reg = (self.reg)();
        run_uninstall(&*reg, &*self.nsis, dir, &self.temp, on);
    }

    /// Where the app lives (or will live): existing install, remembered location, default.
    pub fn target_dir(&self, dir_override: Option<&Path>) -> PathBuf {
        self.with_env(|env| pick_target(env, dir_override))
    }

    /// Language shown first: the saved installer-language file next to an existing install (or
    /// the folder NSIS remembers), otherwise the Windows UI language.
    pub fn startup_lang(&self) -> Lang {
        let reg = (self.reg)();
        let dir = existing_install(&*reg)
            .map(|e| e.dir)
            .or_else(|| previous_install_location(&*reg));
        let saved = dir.and_then(|d| read_installer_language(&d));
        default_lang(saved.as_deref(), windows_ui_language())
    }
}

// ---------- context ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UiMode {
    Install,
    Update,
    Uninstall,
}

impl UiMode {
    pub fn as_str(self) -> &'static str {
        match self {
            UiMode::Install => "install",
            UiMode::Update => "update",
            UiMode::Uninstall => "uninstall",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingInfo {
    pub version: String,
    /// "upgrade" | "same" | "downgrade"
    pub kind: &'static str,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    pub mode: &'static str,
    pub lang: &'static str,
    pub version: String,
    pub existing: Option<ExistingInfo>,
    pub install_dir: String,
    pub default_dir: String,
}

/// Pure: everything `get_context` reports. `fixed_dir` is the folder uninstall mode works on.
pub fn context_for(
    mode: UiMode,
    lang: Lang,
    reg: &dyn RegStore,
    this_version: &str,
    default_dir: &Path,
    fixed_dir: Option<&Path>,
) -> Context {
    let found = existing_install(reg);
    let existing = found.as_ref().map(|e| ExistingInfo {
        version: e.version.clone(),
        kind: match install_kind(Some(&e.version), this_version) {
            InstallKind::Upgrade => "upgrade",
            InstallKind::Same => "same",
            InstallKind::Downgrade => "downgrade",
            // Not reachable with Some(..), but keeps the match total.
            InstallKind::Fresh => "upgrade",
        },
    });
    let install_dir = match (mode, fixed_dir) {
        (UiMode::Uninstall, Some(d)) => d.to_path_buf(),
        _ => found
            .map(|e| e.dir)
            .or_else(|| previous_install_location(reg))
            .unwrap_or_else(|| default_dir.to_path_buf()),
    };
    Context {
        mode: mode.as_str(),
        lang: lang.code(),
        version: this_version.to_string(),
        existing,
        install_dir: install_dir.display().to_string(),
        default_dir: default_dir.display().to_string(),
    }
}

pub fn window_title(mode: UiMode, lang: Lang) -> &'static str {
    match (mode, lang) {
        (UiMode::Uninstall, Lang::Ko) => "IWAE 지우기",
        (UiMode::Uninstall, Lang::En) => "IWAE Uninstall",
        (_, Lang::Ko) => "IWAE 설치",
        (_, Lang::En) => "IWAE Setup",
    }
}

fn parse_lang(s: &str) -> Option<Lang> {
    match s {
        "ko" => Some(Lang::Ko),
        "en" => Some(Lang::En),
        _ => None,
    }
}

/// The picked folder, or `<picked>\IWAE` when it is not already named IWAE.
pub fn with_iwae_leaf(picked: PathBuf) -> PathBuf {
    let named_iwae = picked
        .file_name()
        .map(|n| n.to_string_lossy().eq_ignore_ascii_case("IWAE"))
        .unwrap_or(false);
    if named_iwae {
        picked
    } else {
        picked.join("IWAE")
    }
}

/// Short machine string for `setup://failed`; the UI shows fixed copy, not this text.
pub fn fail_reason_str(r: FailReason) -> &'static str {
    match r {
        FailReason::Extract => "extract",
        FailReason::OldUninstall(_) => "oldUninstall",
        FailReason::Nsis(_) => "nsis",
        // Only reachable in silent mode, where nothing is shown.
        FailReason::Finish => "finish",
    }
}

/// Exit code of a headless run: NSIS's own code, 1 for everything else that went wrong.
pub fn silent_exit_code(ev: &InstallEvent) -> i32 {
    match ev {
        InstallEvent::Done { .. } => 0,
        InstallEvent::Failed { reason, .. } => match reason {
            FailReason::Nsis(c) | FailReason::OldUninstall(c) if *c != 0 => *c,
            _ => 1,
        },
        InstallEvent::Progress(_) => 1,
    }
}

/// Newest `IWAE-setup-*.log` in `temp` (the Done event carries no log path).
fn latest_log(temp: &Path) -> Option<PathBuf> {
    fs::read_dir(temp)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            n.starts_with("IWAE-setup-") && n.ends_with(".log")
        })
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .max_by_key(|(t, _)| *t)
        .map(|(_, p)| p)
}

fn append_log(path: &Path, msg: &str) {
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{msg}");
    }
}

// ---------- state ----------

pub struct SetupState {
    pub mode: UiMode,
    pub lang: Mutex<Lang>,
    pub backend: Arc<Backend>,
    /// Set while an install or uninstall runs; every start_* takes it, the worker releases it
    /// BEFORE its final event so the UI's retry can never see "busy".
    pub busy: AtomicBool,
    pub app_args: Vec<OsString>,
    /// Uninstall mode: the folder from `--uninstall-from-temp`.
    pub fixed_dir: Option<PathBuf>,
    pub current_exe: PathBuf,
    pub install_dir: Mutex<Option<PathBuf>>,
    pub last_log: Mutex<Option<PathBuf>>,
}

impl SetupState {
    pub fn new(
        mode: UiMode,
        lang: Lang,
        backend: Backend,
        app_args: Vec<OsString>,
        fixed_dir: Option<PathBuf>,
        current_exe: PathBuf,
    ) -> Self {
        SetupState {
            mode,
            lang: Mutex::new(lang),
            backend: Arc::new(backend),
            busy: AtomicBool::new(false),
            app_args,
            fixed_dir,
            current_exe,
            install_dir: Mutex::new(None),
            last_log: Mutex::new(None),
        }
    }

    fn lang(&self) -> Lang {
        *self.lang.lock().unwrap()
    }

    fn take_busy(&self) -> bool {
        self.busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    /// Folder whose `app.exe` matters: the uninstall target, else where the app is/will be.
    fn check_dir(&self) -> PathBuf {
        match (&self.mode, &self.fixed_dir) {
            (UiMode::Uninstall, Some(d)) => d.clone(),
            _ => self.backend.target_dir(None),
        }
    }

    fn app_dir(&self) -> PathBuf {
        match self.install_dir.lock().unwrap().clone() {
            Some(d) => d,
            None => self.check_dir(),
        }
    }
}

// ---------- events ----------

#[derive(Clone, Serialize)]
struct ProgressPayload {
    percent: u8,
}

#[derive(Clone, Serialize)]
struct EmptyPayload {}

#[derive(Clone, Serialize)]
struct FailedPayload {
    reason: String,
    log: String,
}

fn emit_failed(app: &AppHandle, reason: &str, log: &Path) {
    let _ = app.emit(
        "setup://failed",
        FailedPayload { reason: reason.to_string(), log: log.display().to_string() },
    );
}

// ---------- commands ----------

#[tauri::command]
pub fn get_context(state: State<'_, SetupState>) -> Context {
    let reg = (state.backend.reg)();
    context_for(
        state.mode,
        state.lang(),
        &*reg,
        crate::APP_VERSION,
        &state.backend.default_dir,
        state.fixed_dir.as_deref(),
    )
}

#[tauri::command]
pub fn set_lang(
    window: tauri::WebviewWindow,
    state: State<'_, SetupState>,
    lang: String,
) -> Result<(), String> {
    let l = parse_lang(&lang).ok_or_else(|| format!("unknown language: {lang}"))?;
    *state.lang.lock().unwrap() = l;
    window
        .set_title(window_title(state.mode, l))
        .map_err(|e| e.to_string())
}

/// Runs on the thread pool: the folder dialog blocks until the user answers.
#[tauri::command(async)]
pub fn pick_dir(app: AppHandle) -> Option<String> {
    let mut dialog = app.dialog().file();
    if let Some(w) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&w);
    }
    let picked = dialog.blocking_pick_folder()?;
    let path = picked.into_path().ok()?;
    Some(with_iwae_leaf(path).display().to_string())
}

#[tauri::command(async)]
pub fn app_running(app: AppHandle) -> bool {
    let st = app.state::<SetupState>();
    !st.backend.procs.running_app_pids(&st.check_dir()).is_empty()
}

/// force=false: WM_CLOSE and wait. force=true: terminate every pid, then wait 5 s.
#[tauri::command(async)]
pub fn close_app(app: AppHandle, force: bool) -> String {
    let st = app.state::<SetupState>();
    let dir = st.check_dir();
    let procs = &*st.backend.procs;
    let outcome = if force {
        for pid in procs.running_app_pids(&dir) {
            procs.force_kill(pid);
        }
        wait_for_exit(procs, &dir, Duration::from_secs(5))
    } else {
        close_and_wait(procs, &dir, CLOSE_TIMEOUT, POLL)
    };
    match outcome {
        CloseOutcome::Closed => "closed".to_string(),
        CloseOutcome::StillRunning => "stillRunning".to_string(),
    }
}

#[tauri::command]
pub fn start_install(app: AppHandle, dir: Option<String>) -> Result<(), String> {
    let st = app.state::<SetupState>();
    if st.mode == UiMode::Uninstall {
        return Err("not an install window".to_string());
    }
    if !st.take_busy() {
        return Err("busy".to_string());
    }
    let dir_override = dir.filter(|d| !d.trim().is_empty()).map(PathBuf::from);
    let worker = app.clone();
    thread::spawn(move || install_worker(worker, dir_override));
    Ok(())
}

fn install_worker(app: AppHandle, dir_override: Option<PathBuf>) {
    let st = app.state::<SetupState>();
    let update = st.mode == UiMode::Update;

    if update {
        // IWAE quits itself before launching us; only wait, never send WM_CLOSE.
        let dir = st.backend.target_dir(dir_override.as_deref());
        wait_for_exit(&*st.backend.procs, &dir, UPDATE_EXIT_TIMEOUT);
    }

    let req = InstallRequest {
        mode_update: update,
        dir_override: dir_override.clone(),
        lang: st.lang(),
        silent: false,
    };

    let mut outcome: Option<InstallEvent> = None;
    let mut last_pct: Option<u8> = None;
    {
        let mut on = |ev: InstallEvent| match ev {
            InstallEvent::Progress(p) => {
                if last_pct != Some(p) {
                    last_pct = Some(p);
                    let _ = app.emit("setup://progress", ProgressPayload { percent: p });
                }
            }
            other => outcome = Some(other),
        };
        st.backend.run_install(&req, &mut on);
    }

    // Release the guard first so a retry right after the failed event is accepted.
    st.busy.store(false, Ordering::SeqCst);

    match outcome {
        Some(InstallEvent::Done { install_dir }) => on_install_done(&app, install_dir),
        Some(InstallEvent::Failed { reason: FailReason::Finish, log }) => {
            // R11: the app is installed, only a polish step failed. Treat it as done.
            append_log(&log, "finish steps failed; window continues as done (R11)");
            *st.last_log.lock().unwrap() = Some(log);
            let dir = st.backend.target_dir(dir_override.as_deref());
            on_install_done(&app, dir);
        }
        Some(InstallEvent::Failed { reason, log }) => {
            *st.last_log.lock().unwrap() = Some(log.clone());
            emit_failed(&app, fail_reason_str(reason), &log);
        }
        _ => {
            // run_install always ends with Done or Failed; guard anyway.
            let log = latest_log(&st.backend.temp).unwrap_or_default();
            emit_failed(&app, "extract", &log);
        }
    }
}

fn on_install_done(app: &AppHandle, install_dir: PathBuf) {
    let st = app.state::<SetupState>();
    *st.install_dir.lock().unwrap() = Some(install_dir.clone());
    if st.mode == UiMode::Update {
        // Updates end by starting the new app with the arguments the old app was given.
        let exe = install_dir.join("app.exe");
        if let Err(e) = st.backend.procs.launch(&exe, &st.app_args) {
            if let Some(log) = latest_log(&st.backend.temp) {
                append_log(&log, &format!("could not launch {}: {e}", exe.display()));
            }
        }
        app.exit(0);
    } else {
        let _ = app.emit("setup://done", EmptyPayload {});
    }
}

#[tauri::command]
pub fn start_uninstall(app: AppHandle) -> Result<(), String> {
    let st = app.state::<SetupState>();
    let Some(dir) = st.fixed_dir.clone() else {
        return Err("not an uninstall window".to_string());
    };
    if !st.take_busy() {
        return Err("busy".to_string());
    }
    let worker = app.clone();
    thread::spawn(move || {
        let st = worker.state::<SetupState>();
        let mut outcome: Option<UninstallEvent> = None;
        {
            let mut on = |ev: UninstallEvent| match ev {
                UninstallEvent::Progress => {
                    let _ = worker.emit("setup://uninstall-progress", EmptyPayload {});
                }
                other => outcome = Some(other),
            };
            st.backend.run_uninstall(&dir, &mut on);
        }
        st.busy.store(false, Ordering::SeqCst);
        match outcome {
            Some(UninstallEvent::Done) => {
                let _ = worker.emit("setup://done", EmptyPayload {});
            }
            Some(UninstallEvent::Failed { log, .. }) => {
                *st.last_log.lock().unwrap() = Some(log.clone());
                emit_failed(&worker, "uninstall", &log);
            }
            _ => {
                let log = latest_log(&st.backend.temp).unwrap_or_default();
                emit_failed(&worker, "uninstall", &log);
            }
        }
    });
    Ok(())
}

/// Launches `<install dir>\app.exe` without arguments, then exits.
#[tauri::command]
pub fn open_app(app: AppHandle) -> Result<(), String> {
    let st = app.state::<SetupState>();
    let exe = st.app_dir().join("app.exe");
    st.backend.procs.launch(&exe, &[]).map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

/// Update failed: start the previous app (if it is still there) with the original arguments.
#[tauri::command]
pub fn quit_relaunch_previous(app: AppHandle) {
    let st = app.state::<SetupState>();
    let exe = st.backend.target_dir(None).join("app.exe");
    if exe.exists() {
        let _ = st.backend.procs.launch(&exe, &st.app_args);
    }
    app.exit(0);
}

/// `explorer.exe /select,"<log>"`: raw_arg keeps the comma form unquoted around `/select,`.
#[tauri::command]
pub fn show_log(state: State<'_, SetupState>) -> Result<(), String> {
    let path = state
        .last_log
        .lock()
        .unwrap()
        .clone()
        .or_else(|| latest_log(&state.backend.temp))
        .ok_or_else(|| "no log file".to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut arg = OsString::from("/select,\"");
        arg.push(&path);
        arg.push("\"");
        std::process::Command::new("explorer.exe")
            .raw_arg(arg)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("Windows only".to_string())
    }
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}

/// The window is created hidden; the UI calls this after its first paint.
#[tauri::command]
pub fn ready(app: AppHandle) {
    show_main(&app);
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::{MemReg, UNINSTALL_KEY};

    fn installed(version: &str, dir: &str) -> MemReg {
        MemReg::new()
            .with(Hive::Hkcu, UNINSTALL_KEY, "DisplayVersion", version)
            .with(Hive::Hkcu, UNINSTALL_KEY, "InstallLocation", dir)
    }

    fn ctx(mode: UiMode, reg: &MemReg, this: &str) -> Context {
        context_for(mode, Lang::Ko, reg, this, Path::new(r"D:\테스트 폴더\Default\IWAE"), None)
    }

    #[test]
    fn same_version_is_same() {
        let c = ctx(UiMode::Install, &installed("0.2.7", r"D:\테스트 폴더\IWAE"), "0.2.7");
        let e = c.existing.expect("existing");
        assert_eq!(e.kind, "same");
        assert_eq!(e.version, "0.2.7");
        assert_eq!(c.install_dir, r"D:\테스트 폴더\IWAE");
    }

    #[test]
    fn older_is_upgrade_newer_is_downgrade() {
        let up = ctx(UiMode::Install, &installed("0.2.6", r"D:\IWAE"), "0.2.7");
        assert_eq!(up.existing.unwrap().kind, "upgrade");
        let down = ctx(UiMode::Install, &installed("0.2.8", r"D:\IWAE"), "0.2.7");
        assert_eq!(down.existing.unwrap().kind, "downgrade");
    }

    #[test]
    fn fresh_has_no_existing_and_uses_default_dir() {
        let c = ctx(UiMode::Install, &MemReg::new(), "0.2.7");
        assert!(c.existing.is_none());
        assert_eq!(c.install_dir, r"D:\테스트 폴더\Default\IWAE");
        assert_eq!(c.default_dir, r"D:\테스트 폴더\Default\IWAE");
        assert_eq!(c.version, "0.2.7");
        assert_eq!(c.lang, "ko");
    }

    #[test]
    fn remembered_location_beats_default_when_not_installed() {
        let reg = MemReg::new().with(Hive::Hkcu, crate::registry::PREVIOUS_LOCATION_KEY, "", r"E:\Old\IWAE");
        let c = ctx(UiMode::Install, &reg, "0.2.7");
        assert!(c.existing.is_none());
        assert_eq!(c.install_dir, r"E:\Old\IWAE");
    }

    #[test]
    fn mode_strings() {
        let reg = MemReg::new();
        assert_eq!(ctx(UiMode::Install, &reg, "0.2.7").mode, "install");
        assert_eq!(ctx(UiMode::Update, &reg, "0.2.7").mode, "update");
        assert_eq!(ctx(UiMode::Uninstall, &reg, "0.2.7").mode, "uninstall");
    }

    #[test]
    fn uninstall_uses_fixed_dir() {
        let reg = installed("0.2.7", r"D:\IWAE");
        let c = context_for(
            UiMode::Uninstall,
            Lang::En,
            &reg,
            "0.2.7",
            Path::new(r"D:\Default\IWAE"),
            Some(Path::new(r"F:\테스트 폴더\IWAE")),
        );
        assert_eq!(c.install_dir, r"F:\테스트 폴더\IWAE");
        assert_eq!(c.lang, "en");
    }

    #[test]
    fn context_json_is_camel_case_with_null_existing() {
        let c = ctx(UiMode::Install, &MemReg::new(), "0.2.7");
        let v = serde_json::to_value(&c).unwrap();
        assert!(v["existing"].is_null());
        assert_eq!(v["installDir"], r"D:\테스트 폴더\Default\IWAE");
        assert!(v.get("defaultDir").is_some());
        let with = ctx(UiMode::Install, &installed("0.2.6", r"D:\IWAE"), "0.2.7");
        let v = serde_json::to_value(&with).unwrap();
        assert_eq!(v["existing"]["kind"], "upgrade");
    }

    #[test]
    fn picked_folder_gets_iwae_leaf_unless_already_named() {
        assert_eq!(with_iwae_leaf(PathBuf::from(r"D:\테스트 폴더")), PathBuf::from(r"D:\테스트 폴더\IWAE"));
        assert_eq!(with_iwae_leaf(PathBuf::from(r"D:\테스트 폴더\IWAE")), PathBuf::from(r"D:\테스트 폴더\IWAE"));
        assert_eq!(with_iwae_leaf(PathBuf::from(r"D:\iwae")), PathBuf::from(r"D:\iwae"));
    }

    #[test]
    fn titles_follow_language() {
        assert_eq!(window_title(UiMode::Install, Lang::Ko), "IWAE 설치");
        assert_eq!(window_title(UiMode::Update, Lang::En), "IWAE Setup");
        assert_eq!(window_title(UiMode::Uninstall, Lang::En), "IWAE Uninstall");
    }

    #[test]
    fn silent_exit_codes() {
        let log = PathBuf::from("x.log");
        let fail = |reason| InstallEvent::Failed { reason, log: log.clone() };
        assert_eq!(silent_exit_code(&InstallEvent::Done { install_dir: PathBuf::from("d") }), 0);
        assert_eq!(silent_exit_code(&fail(FailReason::Nsis(2))), 2);
        assert_eq!(silent_exit_code(&fail(FailReason::OldUninstall(5))), 5);
        assert_eq!(silent_exit_code(&fail(FailReason::Finish)), 1);
        assert_eq!(silent_exit_code(&fail(FailReason::Extract)), 1);
    }

    #[test]
    fn fail_reason_strings() {
        assert_eq!(fail_reason_str(FailReason::Extract), "extract");
        assert_eq!(fail_reason_str(FailReason::OldUninstall(1)), "oldUninstall");
        assert_eq!(fail_reason_str(FailReason::Nsis(2)), "nsis");
    }

    #[test]
    fn latest_log_picks_newest_matching_file() {
        let dir = std::env::temp_dir().join(format!("iwae-setup-cmd-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert!(latest_log(&dir).is_none());
        fs::write(dir.join("other.log"), "x").unwrap();
        fs::write(dir.join("IWAE-setup-100.log"), "x").unwrap();
        assert_eq!(latest_log(&dir), Some(dir.join("IWAE-setup-100.log")));
        let _ = fs::remove_dir_all(&dir);
    }
}
