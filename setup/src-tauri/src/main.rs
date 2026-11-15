#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Same version as the main app (set by build.rs from the root package.json).
#[allow(dead_code)]
const APP_VERSION: &str = env!("IWAE_APP_VERSION");

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("failed to run the setup window");
}
