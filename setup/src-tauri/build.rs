use std::{env, fs, path::Path};

// Never elevate: "setup"/"uninstall" in the file name must not trigger UAC installer detection.
const MANIFEST: &str = include_str!("windows-app-manifest.xml");
const PAYLOAD_VARS: [&str; 3] = ["IWAE_SETUP_NSIS", "IWAE_SETUP_UNINSTALL_UI", "IWAE_SETUP_MANIFEST"];

fn main() {
    // The setup app shares the main app's version.
    let manifest = fs::read_to_string("../../package.json").expect("read ../../package.json");
    let json: serde_json::Value = serde_json::from_str(&manifest).expect("parse package.json");
    let version = json["version"].as_str().expect("package.json version");
    println!("cargo:rustc-env=IWAE_APP_VERSION={version}");
    println!("cargo:rerun-if-changed=../../package.json");
    println!("cargo:rerun-if-changed=windows-app-manifest.xml");

    for var in PAYLOAD_VARS {
        println!("cargo:rerun-if-env-changed={var}");
    }
    if env::var_os("CARGO_FEATURE_PAYLOAD").is_some() {
        for var in PAYLOAD_VARS {
            let path = env::var(var).unwrap_or_else(|_| {
                panic!("feature `payload` needs {var}; run `npm run setup:build` instead of building by hand")
            });
            if !Path::new(&path).is_file() {
                panic!("{var} points at a missing file: {path}");
            }
        }
    }

    let windows = tauri_build::WindowsAttributes::new().app_manifest(MANIFEST);
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("tauri build script failed");
}
