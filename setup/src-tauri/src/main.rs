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

use args::{parse_mode, DemoFlags, Mode};
use commands::{Backend, SetupState, UiMode};
use install::{plan_fallback, run_fallback, InstallRequest};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
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

fn main() {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    let current_exe = std::env::current_exe().unwrap_or_default();

    match parse_mode(&args) {
        // Old NSIS wizard: no window, same args, same exit code.
        Mode::UninstallSync { args } => {
            let dir = current_exe.parent().unwrap_or_else(|| Path::new("."));
            let code = uninstall::run_sync_passthrough(&nsis::RealNsis, dir, &args);
            std::process::exit(code);
        }
        // Apps & features: copy to temp and run from there so the install folder can be emptied.
        Mode::Uninstall => {
            let dir = current_exe.parent().unwrap_or_else(|| Path::new("."));
            let ok = uninstall::relaunch_from_temp(&current_exe, dir, &std::env::temp_dir()).is_ok();
            std::process::exit(if ok { 0 } else { 1 });
        }
        Mode::UninstallTemp { install_dir } => {
            let backend = Backend::real();
            let lang = backend.startup_lang();
            run_window(backend, UiMode::Uninstall, lang, Vec::new(), Some(install_dir), current_exe);
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
                run_window(backend, UiMode::Uninstall, lang, Vec::new(), Some(dir), current_exe);
            } else {
                let mode = if demo.enabled && demo.update { UiMode::Update } else { UiMode::Install };
                start_install_mode(backend, demo.enabled, mode, Vec::new(), current_exe);
            }
        }
        Mode::Update { app_args } => {
            start_install_mode(make_backend(&DemoFlags::default()), false, UiMode::Update, app_args, current_exe)
        }
    }
}

/// Install and update: no window when WebView2 is missing or an MSI install exists.
fn start_install_mode(
    backend: Backend,
    demo: bool,
    mode: UiMode,
    app_args: Vec<OsString>,
    current_exe: PathBuf,
) {
    let lang = backend.startup_lang();
    if !demo && backend.with_env(plan_fallback) {
        let update = mode == UiMode::Update;
        let (code, target) = backend.with_env(|env| run_fallback(env, update, lang));
        if update && code == 0 {
            // The /R the updater passes is not forwarded to NSIS, so start the app ourselves.
            let _ = backend.procs.launch(&target.join("app.exe"), &app_args);
        }
        std::process::exit(code);
    }
    run_window(backend, mode, lang, app_args, None, current_exe);
}

fn run_window(
    backend: Backend,
    mode: UiMode,
    lang: lang::Lang,
    app_args: Vec<OsString>,
    fixed_dir: Option<PathBuf>,
    current_exe: PathBuf,
) {
    let webview_dir = backend
        .temp
        .join(format!("iwae-setup-webview-{}", std::process::id()));
    let demo = backend.demo_root.is_some();
    let state = SetupState::new(mode, lang, backend, app_args, fixed_dir);

    let setup_dir = webview_dir.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .on_window_event(|window, event| {
            // Closing mid-install or mid-uninstall would leave a half-done state.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<SetupState>().busy.load(std::sync::atomic::Ordering::SeqCst) {
                    api.prevent_close();
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
            WebviewWindowBuilder::new(app.handle(), "main", WebviewUrl::App("index.html".into()))
                .title(commands::window_title(lang))
                .inner_size(480.0, 320.0)
                .resizable(false)
                .center()
                .decorations(false)
                .shadow(true)
                .visible(false)
                .background_color(tauri::window::Color(0x11, 0x14, 0x1a, 0xff))
                .data_directory(setup_dir.clone())
                .build()?;

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
        .build(tauri::generate_context!())
        .expect("failed to build the setup window");

    app.run(move |_app, event| {
        if let RunEvent::Exit = event {
            remove_webview_dir(&webview_dir);
            if mode == UiMode::Uninstall && !demo {
                // Our temp copy cannot delete itself while running.
                uninstall::schedule_self_delete(&current_exe);
            }
        }
    });
}

/// WebView2 may still hold files for a moment after exit: retry, then hand over to a detached
/// `cmd` that removes the folder once we are gone.
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
        let mut line = OsString::from("/c ping -n 3 127.0.0.1 >nul & rmdir /s /q \"");
        line.push(dir);
        line.push("\"");
        let _ = std::process::Command::new("cmd.exe")
            .raw_arg(line)
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn();
    }
}
