use std::fs;

fn main() {
    // The setup app shares the main app's version.
    let manifest = fs::read_to_string("../../package.json").expect("read ../../package.json");
    let json: serde_json::Value = serde_json::from_str(&manifest).expect("parse package.json");
    let version = json["version"].as_str().expect("package.json version");
    println!("cargo:rustc-env=IWAE_APP_VERSION={version}");
    println!("cargo:rerun-if-changed=../../package.json");

    tauri_build::build()
}
