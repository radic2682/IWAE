#![allow(dead_code)]
//! Install/update pipeline (spec 6.2 steps 2-9): extract the inner NSIS installer, remove the old
//! version when needed, run NSIS silently while reporting progress, then do the after-steps.

use crate::lang::{write_installer_language, Lang};
use crate::setup_log::SetupLog;
use crate::nsis::{nsis_args, old_uninstall_args, NsisRun, NsisRunner};
use crate::payload::ManifestEntry;
use crate::progress::{percent, snapshot};
use crate::registry::{
    existing_install, msi_install_present, point_uninstall_to_ui, previous_install_location,
    webview2_present, RegStore,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

pub struct InstallRequest {
    pub mode_update: bool,
    pub dir_override: Option<PathBuf>,
    pub lang: Lang,
    pub silent: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum InstallEvent {
    Progress(u8),
    Done { install_dir: PathBuf },
    Failed { reason: FailReason, log: PathBuf },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailReason {
    Extract,
    OldUninstall(i32),
    Nsis(i32),
    Finish,
}

pub struct Env<'a> {
    pub reg: &'a dyn RegStore,
    pub nsis: &'a dyn NsisRunner,
    pub temp: PathBuf,
    pub desktop: PathBuf,
    /// Where a fresh install goes when the user did not pick a folder.
    pub default_dir: PathBuf,
    /// Files the NSIS installer writes (for progress). Production: `payload::manifest()`.
    pub manifest: Vec<ManifestEntry>,
    /// Production: `payload::uninstall_ui_bytes()`.
    pub uninstall_ui: &'a [u8],
    /// Production: `payload::nsis_bytes()`.
    pub nsis_exe: &'a [u8],
}

/// True when the window cannot be used: WebView2 is missing (the window itself needs it) or an
/// old per-machine MSI install is present. Then NSIS runs Passive with no window.
pub fn plan_fallback(env: &Env) -> bool {
    !webview2_present(env.reg) || msi_install_present(env.reg)
}

const POLL: Duration = Duration::from_millis(150);

pub fn run_install(env: &Env, req: &InstallRequest, on: &mut dyn FnMut(InstallEvent)) {
    let log = SetupLog::create(&env.temp).unwrap_or_else(|_| SetupLog::fallback(&env.temp));
    let work = env.temp.join(format!("iwae-setup-{}", std::process::id()));

    let result = run_steps(env, req, on, &log, &work);

    // Best effort; the log lives in env.temp itself, so it survives.
    let _ = fs::remove_dir_all(&work);
    match result {
        Ok(install_dir) => {
            log.line(&format!("done: {}", install_dir.display()));
            on(InstallEvent::Done { install_dir });
        }
        Err(reason) => {
            log.line(&format!("failed: {:?}", reason));
            on(InstallEvent::Failed { reason, log: log.path().to_path_buf() });
        }
    }
}

fn run_steps(
    env: &Env,
    req: &InstallRequest,
    on: &mut dyn FnMut(InstallEvent),
    log: &SetupLog,
    work: &Path,
) -> Result<PathBuf, FailReason> {
    log.line(&format!(
        "start: update={} silent={} lang={}",
        req.mode_update,
        req.silent,
        req.lang.code()
    ));

    // Same folder NSIS would pick on its own: existing install, then the chosen folder, then the
    // location NSIS remembers (it survives the old uninstall), then the default. It is always
    // passed as /D= so setup's after-steps and NSIS can never disagree.
    let existing = existing_install(env.reg);
    let target = match &existing {
        Some(e) => e.dir.clone(),
        None => req
            .dir_override
            .clone()
            .or_else(|| previous_install_location(env.reg))
            .unwrap_or_else(|| env.default_dir.clone()),
    };
    log.line(&format!("target dir: {}", target.display()));

    // 1. Extract the inner installer.
    let exe = work.join("IWAE-inner-setup.exe");
    if let Err(e) = fs::create_dir_all(work).and_then(|_| fs::write(&exe, env.nsis_exe)) {
        log.line(&format!("extract failed: {e}"));
        return Err(FailReason::Extract);
    }
    log.line(&format!("extracted {} bytes to {}", env.nsis_exe.len(), exe.display()));

    // 2. Remove the old version in place. A missing uninstall.exe (folder deleted by hand)
    //    just means a fresh install into that folder.
    if existing.is_some() {
        let old = target.join("uninstall.exe");
        if old.exists() {
            let args = old_uninstall_args(&target);
            log.line(&format!("old uninstall: {} {:?}", old.display(), args));
            match env.nsis.run(&old, &args) {
                Ok(0) => log.line("old uninstall exit 0"),
                Ok(code) => {
                    log.line(&format!("old uninstall exit {code}"));
                    return Err(FailReason::OldUninstall(code));
                }
                Err(e) => {
                    log.line(&format!("old uninstall could not start: {e}"));
                    return Err(FailReason::OldUninstall(-1));
                }
            }
        } else {
            log.line("old uninstall.exe missing, skipped");
        }
    }

    // 3. Remember whether the desktop shortcut was already there.
    let lnk = env.desktop.join("IWAE.lnk");
    let lnk_existed = lnk.exists();

    // 4. Run NSIS on a worker thread and report progress from this one.
    let args = nsis_args(&NsisRun::Silent { update: req.mode_update, dir: Some(target.clone()) });
    log.line(&format!("nsis: {:?}", args));
    let before = snapshot(&env.manifest, &target);
    let runner = env.nsis;
    let exe_ref: &Path = &exe;
    let args_ref: &[std::ffi::OsString] = &args;
    let outcome = thread::scope(|s| {
        let worker = s.spawn(move || runner.run(exe_ref, args_ref));
        loop {
            on(InstallEvent::Progress(percent(&env.manifest, &target, &before, false)));
            if worker.is_finished() {
                break;
            }
            thread::sleep(POLL);
        }
        worker.join()
    });
    let code = match outcome {
        Ok(Ok(code)) => code,
        Ok(Err(e)) => {
            log.line(&format!("nsis could not start: {e}"));
            return Err(FailReason::Nsis(-1));
        }
        Err(_) => {
            log.line("nsis worker panicked");
            return Err(FailReason::Nsis(-1));
        }
    };
    log.line(&format!("nsis exit {code}"));
    if code != 0 {
        return Err(FailReason::Nsis(code));
    }
    on(InstallEvent::Progress(percent(&env.manifest, &target, &before, true)));

    // 5. After-steps.
    if !finish_steps(env, req.lang, &target, lnk_existed, log) {
        return Err(FailReason::Finish);
    }

    Ok(target)
}

/// Where NSIS puts the app: existing install, then the chosen folder, then the remembered
/// location, then the default. Shared with the no-window fallback (which passes no override).
pub fn pick_target(env: &Env, dir_override: Option<&Path>) -> PathBuf {
    match existing_install(env.reg) {
        Some(e) => e.dir,
        None => dir_override
            .map(Path::to_path_buf)
            .or_else(|| previous_install_location(env.reg))
            .unwrap_or_else(|| env.default_dir.clone()),
    }
}

/// After-steps once NSIS exited 0 (spec 6.2 step 6). Runs every step even when one fails and
/// returns false if any did. The user did not ask for a desktop icon unless it was there before.
pub fn finish_steps(env: &Env, lang: Lang, target: &Path, lnk_existed: bool, log: &SetupLog) -> bool {
    let lnk = env.desktop.join("IWAE.lnk");
    if !lnk_existed && lnk.exists() {
        match fs::remove_file(&lnk) {
            Ok(()) => log.line("removed desktop shortcut created by NSIS"),
            Err(e) => log.line(&format!("could not remove desktop shortcut: {e}")),
        }
    }

    let mut finish_ok = true;
    if let Err(e) = write_installer_language(target, lang) {
        log.line(&format!("installer-language write failed: {e}"));
        finish_ok = false;
    }

    let ui = target.join("uninstall-ui.exe");
    if let Err(e) = fs::write(&ui, env.uninstall_ui) {
        log.line(&format!("uninstall-ui write failed: {e}"));
        finish_ok = false;
    }
    // Only point Apps & features at the UI when it is really there.
    if ui.exists() {
        match point_uninstall_to_ui(env.reg, target) {
            Ok(()) => log.line("UninstallString now points at uninstall-ui.exe"),
            Err(e) => {
                log.line(&format!("registry UninstallString update failed: {e}"));
                finish_ok = false;
            }
        }
    } else {
        log.line("uninstall-ui.exe missing, UninstallString left as is");
    }
    finish_ok
}

/// No-window path (WebView2 missing or MSI install present): NSIS runs Passive and shows its own
/// progress window. Returns the process exit code: NSIS's code, or 1 when an extract or
/// after-step failed.
pub fn run_fallback(env: &Env, update: bool, lang: Lang) -> (i32, PathBuf) {
    let log = SetupLog::create(&env.temp).unwrap_or_else(|_| SetupLog::fallback(&env.temp));
    let work = env.temp.join(format!("iwae-setup-{}", std::process::id()));
    log.line(&format!("fallback passive install: update={update} lang={}", lang.code()));

    let mut target = pick_target(env, None);
    let exe = work.join("IWAE-inner-setup.exe");
    let code = if let Err(e) = fs::create_dir_all(&work).and_then(|_| fs::write(&exe, env.nsis_exe)) {
        log.line(&format!("extract failed: {e}"));
        1
    } else {
        let lnk_existed = env.desktop.join("IWAE.lnk").exists();
        let args = nsis_args(&NsisRun::Passive { update });
        log.line(&format!("nsis: {:?}", args));
        match env.nsis.run(&exe, &args) {
            Ok(0) => {
                log.line("nsis exit 0");
                // NSIS has just written its Uninstall key, so this now names the real folder.
                target = pick_target(env, None);
                if finish_steps(env, lang, &target, lnk_existed, &log) { 0 } else { 1 }
            }
            Ok(code) => {
                log.line(&format!("nsis exit {code}"));
                code
            }
            Err(e) => {
                log.line(&format!("nsis could not start: {e}"));
                1
            }
        }
    };
    let _ = fs::remove_dir_all(&work);
    (code, target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::{Hive, MemReg, UNINSTALL_KEY};
    use std::collections::VecDeque;
    use std::ffi::OsString;
    use std::io;
    use std::sync::Mutex;

    const WEBVIEW2_KEY: &str =
        r"Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

    type Call = (PathBuf, Vec<OsString>);

    /// Records every call; returns queued exit codes (default 0). A successful install call
    /// (anything that is not the `_?=` old uninstall) writes the manifest files and optionally
    /// the desktop link.
    struct FakeNsis {
        calls: Mutex<Vec<Call>>,
        codes: Mutex<VecDeque<i32>>,
        install_dir: PathBuf,
        manifest: Vec<ManifestEntry>,
        desktop: PathBuf,
        make_lnk: bool,
    }

    impl FakeNsis {
        fn new(install_dir: &Path, desktop: &Path, manifest: Vec<ManifestEntry>) -> Self {
            FakeNsis {
                calls: Mutex::new(Vec::new()),
                codes: Mutex::new(VecDeque::new()),
                install_dir: install_dir.to_path_buf(),
                manifest,
                desktop: desktop.to_path_buf(),
                make_lnk: true,
            }
        }
        fn with_codes(self, codes: &[i32]) -> Self {
            *self.codes.lock().unwrap() = codes.iter().copied().collect();
            self
        }
        fn calls(&self) -> Vec<Call> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl NsisRunner for FakeNsis {
        fn run(&self, exe: &Path, args: &[OsString]) -> io::Result<i32> {
            self.calls.lock().unwrap().push((exe.to_path_buf(), args.to_vec()));
            let code = self.codes.lock().unwrap().pop_front().unwrap_or(0);
            let is_old_uninstall = args.iter().any(|a| a.to_string_lossy().starts_with("_?="));
            if code == 0 && !is_old_uninstall {
                for e in &self.manifest {
                    let p = self.install_dir.join(&e.rel);
                    fs::create_dir_all(p.parent().unwrap()).unwrap();
                    fs::write(p, vec![1u8; e.size as usize]).unwrap();
                }
                if self.make_lnk {
                    fs::create_dir_all(&self.desktop).unwrap();
                    fs::write(self.desktop.join("IWAE.lnk"), b"lnk").unwrap();
                }
            }
            Ok(code)
        }
    }

    struct Fx {
        root: PathBuf,
        install_dir: PathBuf,
        desktop: PathBuf,
        temp: PathBuf,
    }

    fn fx(name: &str) -> Fx {
        let root = std::env::temp_dir().join(format!("iwae-setup-install-{}-{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&root);
        let f = Fx {
            install_dir: root.join("테스트 폴더").join("IWAE"),
            desktop: root.join("Desktop"),
            temp: root.join("Temp"),
            root,
        };
        fs::create_dir_all(&f.desktop).unwrap();
        fs::create_dir_all(&f.temp).unwrap();
        f
    }

    fn manifest() -> Vec<ManifestEntry> {
        vec![
            ManifestEntry { rel: "app.exe".into(), size: 10 },
            ManifestEntry { rel: "binaries/pdfium.dll".into(), size: 20 },
        ]
    }

    fn req(update: bool) -> InstallRequest {
        InstallRequest { mode_update: update, dir_override: None, lang: Lang::Ko, silent: false }
    }

    fn env<'a>(f: &Fx, reg: &'a MemReg, nsis: &'a FakeNsis) -> Env<'a> {
        Env {
            reg,
            nsis,
            temp: f.temp.clone(),
            desktop: f.desktop.clone(),
            default_dir: f.install_dir.clone(),
            manifest: manifest(),
            uninstall_ui: b"fake-uninstall-ui",
            nsis_exe: b"fake-nsis",
        }
    }

    fn installed_reg(f: &Fx) -> MemReg {
        MemReg::new()
            .with(Hive::Hkcu, UNINSTALL_KEY, "InstallLocation", &f.install_dir.display().to_string())
            .with(Hive::Hkcu, UNINSTALL_KEY, "DisplayVersion", "0.2.6")
            .with(Hive::Hkcu, UNINSTALL_KEY, "UninstallString", "orig-uninstall")
    }

    fn run(env: &Env, r: &InstallRequest) -> Vec<InstallEvent> {
        let mut events = Vec::new();
        run_install(env, r, &mut |e| events.push(e));
        events
    }

    fn d_arg(dir: &Path) -> OsString {
        let mut a = OsString::from("/D=");
        a.push(dir);
        a
    }

    #[test]
    fn fresh_install_runs_silent_with_target_and_finishes() {
        let f = fx("fresh");
        let reg = MemReg::new();
        let nsis = FakeNsis::new(&f.install_dir, &f.desktop, manifest());
        let events = run(&env(&f, &reg, &nsis), &req(false));

        let calls = nsis.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].1, vec![OsString::from("/S"), d_arg(&f.install_dir)]);
        assert_eq!(
            fs::read_to_string(f.install_dir.join("installer-language")).unwrap(),
            "1042"
        );
        assert!(f.install_dir.join("uninstall-ui.exe").exists());
        let us = reg.get_str(Hive::Hkcu, UNINSTALL_KEY, "UninstallString").unwrap();
        assert!(us.contains("uninstall-ui.exe") && us.ends_with("--uninstall"));
        assert!(!f.desktop.join("IWAE.lnk").exists());
        assert_eq!(
            events.last(),
            Some(&InstallEvent::Done { install_dir: f.install_dir.clone() })
        );
        assert!(events.iter().any(|e| matches!(e, InstallEvent::Progress(100))));
        let _ = fs::remove_dir_all(&f.root);
    }

    #[test]
    fn dir_override_on_fresh_install_goes_to_nsis_unquoted() {
        let f = fx("override");
        let chosen = f.root.join("선택 폴더").join("IWAE");
        let reg = MemReg::new();
        let nsis = FakeNsis::new(&chosen, &f.desktop, manifest());
        let mut r = req(false);
        r.dir_override = Some(chosen.clone());
        let events = run(&env(&f, &reg, &nsis), &r);

        assert_eq!(nsis.calls()[0].1, vec![OsString::from("/S"), d_arg(&chosen)]);
        assert_eq!(events.last(), Some(&InstallEvent::Done { install_dir: chosen.clone() }));
        assert!(chosen.join("uninstall-ui.exe").exists());
        let _ = fs::remove_dir_all(&f.root);
    }

    #[test]
    fn upgrade_with_uninstall_exe_removes_old_version_first() {
        let f = fx("upgrade");
        fs::create_dir_all(&f.install_dir).unwrap();
        fs::write(f.install_dir.join("uninstall.exe"), b"old").unwrap();
        let reg = installed_reg(&f);
        let nsis = FakeNsis::new(&f.install_dir, &f.desktop, manifest());
        // Even if a dir_override is passed, the existing install's folder wins.
        let mut r = req(true);
        r.dir_override = Some(f.root.join("elsewhere"));
        let events = run(&env(&f, &reg, &nsis), &r);

        let calls = nsis.calls();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].0, f.install_dir.join("uninstall.exe"));
        let mut dir_arg = OsString::from("_?=");
        dir_arg.push(&f.install_dir);
        assert_eq!(calls[0].1, vec![OsString::from("/S"), OsString::from("/UPDATE"), dir_arg]);
        assert_eq!(
            calls[1].1,
            vec![OsString::from("/S"), OsString::from("/UPDATE"), d_arg(&f.install_dir)]
        );
        assert_eq!(
            events.last(),
            Some(&InstallEvent::Done { install_dir: f.install_dir.clone() })
        );
        let _ = fs::remove_dir_all(&f.root);
    }

    #[test]
    fn upgrade_without_uninstall_exe_skips_old_uninstall() {
        let f = fx("noun");
        // The registry points at the folder but it does not exist (deleted by hand).
        let reg = installed_reg(&f);
        let nsis = FakeNsis::new(&f.install_dir, &f.desktop, manifest());
        let events = run(&env(&f, &reg, &nsis), &req(true));

        let calls = nsis.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            calls[0].1,
            vec![OsString::from("/S"), OsString::from("/UPDATE"), d_arg(&f.install_dir)]
        );
        assert!(matches!(events.last(), Some(InstallEvent::Done { .. })));
        let _ = fs::remove_dir_all(&f.root);
    }

    #[test]
    fn previous_location_is_used_when_uninstall_key_is_gone() {
        // Interrupted upgrade: the old uninstall removed the Uninstall key but NSIS still
        // remembers the folder under SoftwareiwaeIWAE.
        let f = fx("prevloc");
        let prev = f.root.join("테스트 폴더").join("IWAE");
        let reg = MemReg::new().with(
            Hive::Hkcu,
            crate::registry::PREVIOUS_LOCATION_KEY,
            "",
            &prev.display().to_string(),
        );
        // default_dir differs from the remembered folder.
        let nsis = FakeNsis::new(&prev, &f.desktop, manifest());
        let mut e = env(&f, &reg, &nsis);
        e.default_dir = f.root.join("default").join("IWAE");
        let events = run(&e, &req(true));

        assert_eq!(
            nsis.calls()[0].1,
            vec![OsString::from("/S"), OsString::from("/UPDATE"), d_arg(&prev)]
        );
        assert_eq!(fs::read_to_string(prev.join("installer-language")).unwrap(), "1042");
        assert!(prev.join("uninstall-ui.exe").exists());
        assert_eq!(events.last(), Some(&InstallEvent::Done { install_dir: prev.clone() }));
        let _ = fs::remove_dir_all(&f.root);
    }

    #[test]
    fn existing_desktop_link_is_kept() {
        let f = fx("lnk");
        fs::write(f.desktop.join("IWAE.lnk"), b"mine").unwrap();
        let reg = MemReg::new();
        let nsis = FakeNsis::new(&f.install_dir, &f.desktop, manifest());
        run(&env(&f, &reg, &nsis), &req(false));
        assert!(f.desktop.join("IWAE.lnk").exists());
        let _ = fs::remove_dir_all(&f.root);
    }

    #[test]
    fn nsis_failure_reports_code_and_keeps_uninstall_string() {
        let f = fx("nsisfail");
        let reg = installed_reg(&f);
        let nsis = FakeNsis::new(&f.install_dir, &f.desktop, manifest()).with_codes(&[2]);
        let events = run(&env(&f, &reg, &nsis), &req(false));

        match events.last() {
            Some(InstallEvent::Failed { reason, log }) => {
                assert_eq!(*reason, FailReason::Nsis(2));
                assert!(log.exists());
            }
            other => panic!("unexpected {:?}", other),
        }
        assert_eq!(
            reg.get_str(Hive::Hkcu, UNINSTALL_KEY, "UninstallString").unwrap(),
            "orig-uninstall"
        );
        assert!(!f.install_dir.join("uninstall-ui.exe").exists());
        let _ = fs::remove_dir_all(&f.root);
    }

    #[test]
    fn old_uninstall_failure_stops_before_nsis() {
        let f = fx("oldfail");
        fs::create_dir_all(&f.install_dir).unwrap();
        fs::write(f.install_dir.join("uninstall.exe"), b"old").unwrap();
        let reg = installed_reg(&f);
        let nsis = FakeNsis::new(&f.install_dir, &f.desktop, manifest()).with_codes(&[1]);
        let events = run(&env(&f, &reg, &nsis), &req(true));

        assert!(matches!(
            events.last(),
            Some(InstallEvent::Failed { reason: FailReason::OldUninstall(1), .. })
        ));
        assert_eq!(nsis.calls().len(), 1); // only the old uninstall ran
        let _ = fs::remove_dir_all(&f.root);
    }

    #[test]
    fn plan_fallback_cases() {
        let f = fx("fallback");
        let nsis = FakeNsis::new(&f.install_dir, &f.desktop, vec![]);

        let no_wv2 = MemReg::new();
        assert!(plan_fallback(&env(&f, &no_wv2, &nsis)));

        let wv2 = MemReg::new().with(Hive::Hklm32, WEBVIEW2_KEY, "pv", "131.0.2903.70");
        assert!(!plan_fallback(&env(&f, &wv2, &nsis)));

        let key = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\{ABC}";
        let msi = MemReg::new()
            .with(Hive::Hklm32, WEBVIEW2_KEY, "pv", "131.0.2903.70")
            .with(Hive::Hklm, key, "DisplayName", "IWAE")
            .with(Hive::Hklm, key, "WindowsInstaller", "1");
        assert!(plan_fallback(&env(&f, &msi, &nsis)));
        let _ = fs::remove_dir_all(&f.root);
    }
}
