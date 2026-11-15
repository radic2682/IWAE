#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod apprun;
mod args;
mod commands;
#[cfg(debug_assertions)]
mod demo;
mod install;
mod lang;
mod setup_log;
mod nsis;
mod payload;
mod progress;
mod registry;
mod uninstall;
mod version;

use args::{parse_mode, real_allowed, without_payload, DemoFlags, Mode};
use commands::{Backend, SetupState, UiMode};
use install::{plan_fallback, run_fallback, InstallRequest};
use setup_log::SetupLog;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Same version as the main app (set by build.rs from the root package.json).
const APP_VERSION: &str = env!("IWAE_APP_VERSION");

#[cfg(debug_assertions)]
fn make_backend(demo: &DemoFlags) -> Backend {
    if demo.enabled {
        demo::backend(demo)
    } else {
        Backend::real()
    }
}

// Release builds never reach the demo backend.
#[cfg(not(debug_assertions))]
fn make_backend(_demo: &DemoFlags) -> Backend {
    Backend::real()
}

/// What to remove once the window is gone.
#[derive(Clone)]
enum Cleanup {
    /// Install, update, demo.
    None,
    /// We are the temp copy: delete ourselves.
    TempCopy(PathBuf),
    /// Uninstalled in place (the temp copy could not start): `<dir>\uninstall-ui.exe` and the
    /// folder if empty, but only once uninstall.exe is gone (the uninstall really finished).
    InPlace(PathBuf),
}

fn finish_cleanup(cleanup: &Cleanup) {
    match cleanup {
        Cleanup::None => {}
        Cleanup::TempCopy(exe) => uninstall::schedule_self_delete(exe),
        Cleanup::InPlace(dir) => {
            if !dir.join("uninstall.exe").exists() {
                uninstall::schedule_in_place_cleanup(&dir.join("uninstall-ui.exe"), dir);
            }
        }
    }
}

/// One line on stderr and in a fresh `%TEMP%\IWAE-setup-*.log` (release builds have no console).
fn note(msg: &str) {
    eprintln!("{msg}");
    let temp = std::env::temp_dir();
    SetupLog::create(&temp)
        .unwrap_or_else(|_| SetupLog::fallback(&temp))
        .line(msg);
}

fn main() {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    let current_exe = std::env::current_exe().unwrap_or_default();

    let mode = parse_mode(&args);
    let demo_on = matches!(&mode, Mode::Install { demo } if demo.enabled);

    // R14: a build without the payload (uninstall-ui.exe, debug) can only uninstall.
    let mode = if payload::nsis_bytes().is_empty() && !demo_on {
        without_payload(mode)
    } else {
        mode
    };

    // R14: a debug build never touches the real machine by accident (release: always allowed).
    if !matches!(mode, Mode::Invalid { .. }) && !demo_on && !real_allowed(&args) {
        eprintln!(
            "iwae-setup (debug build): refusing to use the real registry, installers and app.\n\
             Pass --demo (or another --demo-* flag) for the sandboxed demo, or --real to run for \
             real (only in a disposable VM)."
        );
        std::process::exit(2);
    }

    match mode {
        Mode::Invalid { reason } => {
            note(&format!("setup: {reason}; nothing was done"));
            std::process::exit(1);
        }
        // Old NSIS wizard: no window, same args, same exit code.
        Mode::UninstallSync { args } => {
            let dir = current_exe.parent().unwrap_or_else(|| Path::new("."));
            let code = uninstall::run_sync_passthrough(&nsis::RealNsis, dir, &args);
            std::process::exit(code);
        }
        Mode::Uninstall => uninstall_mode(current_exe),
        Mode::UninstallTemp { install_dir } => {
            // Hold no handle on the install dir, or it could not be removed.
            let _ = std::env::set_current_dir(std::env::temp_dir());
            let backend = Backend::real();
            let lang = backend.startup_lang();
            run_window(
                backend,
                UiMode::Uninstall,
                lang,
                Vec::new(),
                Some(install_dir),
                Cleanup::TempCopy(current_exe),
            );
        }
        Mode::Silent { install_dir } => {
            let backend = make_backend(&DemoFlags::default());
            let req = InstallRequest {
                mode_update: false,
                dir_override: install_dir,
                lang: backend.startup_lang(),
                silent: true,
            };
            let mut result = None;
            backend.run_install(&req, &mut |ev| {
                if !matches!(ev, install::InstallEvent::Progress(_)) {
                    result = Some(ev);
                }
            });
            let code = result.as_ref().map(commands::silent_exit_code).unwrap_or(1);
            std::process::exit(code);
        }
        Mode::Install { demo } => {
            let backend = make_backend(&demo);
            // Demo-only modes; the flags are never set in release builds.
            if demo.enabled && demo.uninstall {
                let dir = backend.demo_root.clone().unwrap_or_default().join("IWAE");
                let lang = backend.startup_lang();
                run_window(backend, UiMode::Uninstall, lang, Vec::new(), Some(dir), Cleanup::None);
            } else {
                let mode = if demo.enabled && demo.update { UiMode::Update } else { UiMode::Install };
                start_install_mode(backend, demo.enabled, mode, Vec::new());
            }
        }
        Mode::Update { app_args } => {
            start_install_mode(make_backend(&DemoFlags::default()), false, UiMode::Update, app_args)
        }
    }
}

/// Apps & features, or a double-click on uninstall-ui.exe: copy to temp and run from there so
/// the install folder can be emptied. If that copy cannot start, uninstall in place.
fn uninstall_mode(current_exe: PathBuf) {
    let temp = std::env::temp_dir();
    let _ = std::env::set_current_dir(&temp);
    let backend = Backend::real();
    let target = {
        let reg = (backend.reg)();
        uninstall::uninstall_target(current_exe.parent(), &*reg)
    };
    let Some(dir) = target else {
        note("uninstall: no IWAE install found (no uninstall.exe beside this exe, no registry entry)");
        std::process::exit(1);
    };
    match uninstall::relaunch_from_temp(&current_exe, &dir, &temp) {
        Ok(()) => std::process::exit(0),
        Err(e) => {
            note(&format!(
                "uninstall: temp copy could not start ({e}); uninstalling in place from {}",
                dir.display()
            ));
            let lang = backend.startup_lang();
            run_window(
                backend,
                UiMode::Uninstall,
                lang,
                Vec::new(),
                Some(dir.clone()),
                Cleanup::InPlace(dir),
            );
        }
    }
}

/// Install and update: no window when WebView2 is missing or an MSI install exists.
fn start_install_mode(backend: Backend, demo: bool, mode: UiMode, app_args: Vec<OsString>) {
    let lang = backend.startup_lang();
    if !demo && backend.with_env(plan_fallback) {
        fallback_install(&backend, mode == UiMode::Update, lang, &app_args);
    }
    run_window(backend, mode, lang, app_args, None, Cleanup::None);
}

/// No-window install: NSIS runs /P and shows its own progress. Never returns.
fn fallback_install(backend: &Backend, update: bool, lang: lang::Lang, app_args: &[OsString]) -> ! {
    let (code, target) = backend.with_env(|env| run_fallback(env, update, lang));
    if update && code == 0 {
        // The /R the updater passes is not forwarded to NSIS, so start the app ourselves.
        let _ = backend.procs.launch(&target.join("app.exe"), app_args);
    }
    std::process::exit(code);
}

/// The window could not be created (broken WebView2 and the like). Install and update fall back
/// to NSIS's passive window; uninstall opens NSIS's own uninstaller UI. Never returns.
fn window_failed(
    backend: &Backend,
    mode: UiMode,
    lang: lang::Lang,
    app_args: &[OsString],
    fixed_dir: Option<&Path>,
    cleanup: &Cleanup,
) -> ! {
    match mode {
        UiMode::Install | UiMode::Update => {
            fallback_install(backend, mode == UiMode::Update, lang, app_args)
        }
        UiMode::Uninstall => {
            let code = match fixed_dir {
                // Without /S it is NSIS's normal wizard; it copies itself to temp and asks.
                Some(dir) if backend.demo_root.is_none() => {
                    let exe = dir.join("uninstall.exe");
                    match backend.procs.launch(&exe, &[]) {
                        Ok(()) => 0,
                        Err(e) => {
                            note(&format!("could not start {}: {e}", exe.display()));
                            1
                        }
                    }
                }
                _ => 1,
            };
            finish_cleanup(cleanup);
            std::process::exit(code);
        }
    }
}

fn run_window(
    backend: Backend,
    mode: UiMode,
    lang: lang::Lang,
    app_args: Vec<OsString>,
    fixed_dir: Option<PathBuf>,
    cleanup: Cleanup,
) {
    let backend = Arc::new(backend);
    let webview_dir = backend
        .temp
        .join(format!("iwae-setup-webview-{}", std::process::id()));
    let state = SetupState::new(mode, lang, backend.clone(), app_args.clone(), fixed_dir.clone());

    // Everything the setup hook needs if the window cannot be built.
    let setup_dir = webview_dir.clone();
    let fb_backend = backend.clone();
    let fb_args = app_args.clone();
    let fb_dir = fixed_dir.clone();
    let fb_cleanup = cleanup.clone();

    let built = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let st = window.state::<SetupState>();
                if st.busy.load(Ordering::SeqCst) {
                    // Closing mid-install or mid-uninstall would leave a half-done state.
                    api.prevent_close();
                } else if st.mode == UiMode::Update && st.failed.load(Ordering::SeqCst) {
                    // Alt+F4 on the failed-update screen acts like 「닫기」: the old app comes back.
                    commands::relaunch_previous(window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_context,
            commands::set_lang,
            commands::pick_dir,
            commands::app_running,
            commands::close_app,
            commands::start_install,
            commands::start_uninstall,
            commands::open_app,
            commands::quit_relaunch_previous,
            commands::show_log,
            commands::quit,
            commands::ready,
        ])
        .setup(move |app| {
            // Created here (not in tauri.conf.json) so it can get its own WebView2 data folder.
            // Hidden until the UI calls `ready` after its first paint (no white flash).
            let window = WebviewWindowBuilder::new(app.handle(), "main", WebviewUrl::App("index.html".into()))
                .title(commands::window_title(lang))
                .inner_size(480.0, 320.0)
                .resizable(false)
                .center()
                .decorations(false)
                .shadow(true)
                .visible(false)
                .background_color(tauri::window::Color(0x11, 0x14, 0x1a, 0xff))
                .data_directory(setup_dir.clone())
                .build();
            if let Err(e) = window {
                // An Err from this hook panics inside tauri (abort in release), so handle it here.
                note(&format!("setup window could not be created: {e}"));
                remove_webview_dir(&setup_dir);
                window_failed(&fb_backend, mode, lang, &fb_args, fb_dir.as_deref(), &fb_cleanup);
            }

            // Updates start from Rust, not from the page script.
            if mode == UiMode::Update {
                commands::start_update(app.handle());
            }

            // Safety net: a UI that never calls `ready` must not leave an invisible process.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(8));
                if let Some(w) = handle.get_webview_window("main") {
                    if !w.is_visible().unwrap_or(true) {
                        commands::show_main(&handle);
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!());

    let app = match built {
        Ok(app) => app,
        Err(e) => {
            note(&format!("setup app could not be built: {e}"));
            remove_webview_dir(&webview_dir);
            window_failed(&backend, mode, lang, &app_args, fixed_dir.as_deref(), &cleanup);
        }
    };

    app.run(move |_app, event| {
        if let RunEvent::Exit = event {
            remove_webview_dir(&webview_dir);
            finish_cleanup(&cleanup);
        }
    });
}

/// WebView2 may still hold files for a moment after exit: retry, then hand over to a detached
/// `cmd` that keeps trying for about 5 s once we are gone. Errors are ignored there.
fn remove_webview_dir(dir: &Path) {
    for _ in 0..5 {
        if !dir.exists() || std::fs::remove_dir_all(dir).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // `ping -n 2` waits about 1 s; `%i` (not `%%i`) because this is a command line.
        let mut quoted = OsString::from("\"");
        quoted.push(dir);
        quoted.push("\"");
        let mut line = OsString::from("/c for /l %i in (1,1,5) do @(if exist ");
        line.push(&quoted);
        line.push(" (ping -n 2 127.0.0.1 >nul & rmdir /s /q ");
        line.push(&quoted);
        line.push(" 2>nul))");
        let _ = std::process::Command::new("cmd.exe")
            .raw_arg(line)
            .current_dir(std::env::temp_dir())
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn();
    }
}
