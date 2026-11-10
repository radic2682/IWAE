//! 웹뷰가 넘긴 경로를 앱의 fs 범위로 거르는 공통 검사(`fs_scope::ensure_allowed`)를, fs 플러그인이 실제로
//! 쓰는 범위 위에서 시험한다. 창 코드가 딸려 와서 별도 시험 파일로 둔다(build.rs 가 comctl32 매니페스트를 붙인다).

use app_lib::fs_scope::{ensure_all_allowed, ensure_allowed};
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri_plugin_fs::FsExt;

fn unique(label: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("iwae-scope-{label}-{}", std::process::id()))
}

#[test]
fn only_paths_inside_the_granted_scope_pass() {
    let app = mock_builder()
        .plugin(tauri_plugin_fs::init())
        .build(mock_context(noop_assets()))
        .expect("mock app");
    let handle = app.handle();
    let vault = unique("vault");
    let outside = unique("outside");
    std::fs::create_dir_all(&vault).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("secret.txt"), "x").unwrap();

    // 아직 아무것도 열지 않았다: 다 막힌다
    assert!(ensure_allowed(handle, vault.join("a.pdf")).is_err());

    // 사용자가 Vault 폴더를 골랐다(대화상자·저장된 범위)
    handle.fs_scope().allow_directory(&vault, true).unwrap();
    assert!(
        ensure_allowed(handle, vault.join("a.pdf")).is_ok(),
        "a new file inside the vault"
    );
    assert!(ensure_allowed(handle, vault.join("deep").join("er").join("b.md")).is_ok());
    assert!(ensure_allowed(handle, outside.join("secret.txt")).is_err());

    // 글자만 Vault 안인 경로(..)는 막힌다
    let sneaky = vault
        .join("..")
        .join(outside.file_name().unwrap())
        .join("secret.txt");
    assert!(ensure_allowed(handle, &sneaky).is_err());
    // 상대 경로·빈 경로
    assert!(ensure_allowed(handle, "relative.pdf").is_err());
    assert!(ensure_allowed(handle, "").is_err());

    // 탐색기에서 PDF 하나를 연 경우: 그 파일만
    handle
        .fs_scope()
        .allow_file(outside.join("secret.txt"))
        .unwrap();
    assert!(ensure_allowed(handle, outside.join("secret.txt")).is_ok());
    assert!(ensure_allowed(handle, outside.join("other.txt")).is_err());

    // 여럿 중 하나라도 밖이면 거절
    assert!(ensure_all_allowed(handle, [vault.join("a"), outside.join("other.txt")]).is_err());
    assert!(ensure_all_allowed(handle, [vault.join("a"), vault.join("b")]).is_ok());

    std::fs::remove_dir_all(&vault).ok();
    std::fs::remove_dir_all(&outside).ok();
}
