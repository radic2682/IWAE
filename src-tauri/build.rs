fn main() {
    // 시험 실행 파일(cargo test)에도 comctl32 v6 매니페스트를 넣는다. 앱 본체의 매니페스트는 tauri_build 가 붙이지만
    // 시험용에는 붙지 않아, 창 코드를 부르는 시험(tauri::test)이 있으면 실행 파일이 시작하지 못한다
    if std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|os| os == "windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").is_ok_and(|env| env == "msvc")
    {
        let manifest =
            std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default())
                .join("test-manifest.xml");
        println!("cargo:rerun-if-changed=test-manifest.xml");
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
    tauri_build::build()
}
