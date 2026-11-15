//! 저장된 fs 범위(persisted-scope) 정리: 꺼진 드라이브 위 파일의 허락은 남기고, 지워진 파일의 것만 덜어 낸다.
//! 창 코드가 딸려 와서 별도 시험 파일로 둔다(build.rs 가 comctl32 매니페스트를 붙인다).

use std::path::{Path, PathBuf};

use app_lib::open_files::scope_log::{definitely_gone, prune_files, SCOPE_FILE};
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri_plugin_fs::FsExt;

fn temp(name: &str) -> PathBuf {
    let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("iwae-scope-prune-{name}-{unique}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    mock_builder().plugin(tauri_plugin_fs::init()).build(mock_context(noop_assets())).expect("mock app")
}

/// persisted-scope 가 저장된 항목마다 하는 일(allow_path)
fn restore(app: &tauri::App<tauri::test::MockRuntime>, patterns: &[String]) {
    let scope = app.fs_scope();
    for pattern in patterns {
        let path = Path::new(pattern);
        if pattern.ends_with("**") {
            let _ = scope.allow_directory(path.parent().unwrap(), true);
        } else if pattern.ends_with('*') {
            let _ = scope.allow_directory(path.parent().unwrap(), false);
        } else {
            let _ = scope.allow_file(path);
        }
    }
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()
}

fn save(app: &tauri::App<tauri::test::MockRuntime>, appdata: &Path) -> Vec<String> {
    let patterns: Vec<String> = app.fs_scope().allowed_patterns().into_iter().map(|pattern| pattern.to_string()).collect();
    let state: (Vec<String>, Vec<String>) = (patterns.clone(), vec![]);
    std::fs::write(appdata.join(SCOPE_FILE), bincode::serialize(&state).unwrap()).unwrap();
    patterns
}

#[test]
fn an_offline_drive_at_one_start_does_not_revoke_access_to_its_files() {
    let drive = temp("usb");
    let pdf = drive.join("paper.pdf");
    std::fs::write(&pdf, b"%PDF-1.4").unwrap();
    let vault = drive.join("My.Vault"); // 이름에 점이 있는 Vault 폴더
    std::fs::create_dir_all(vault.join("notes")).unwrap();

    let first = mock_app();
    first.fs_scope().allow_file(&pdf).unwrap();
    first.fs_scope().allow_directory(&vault, true).unwrap();
    let appdata = temp("appdata");
    save(&first, &appdata);

    // 다음에 켤 때 드라이브가 없다
    let away = drive.with_extension("away");
    std::fs::rename(&drive, &away).unwrap();
    let dropped = prune_files(&appdata, now(), &definitely_gone);
    std::fs::rename(&away, &drive).unwrap();
    assert_eq!(dropped, 0, "못 닿는 드라이브 위의 항목은 남긴다");

    let after: (Vec<String>, Vec<String>) = bincode::deserialize(&std::fs::read(appdata.join(SCOPE_FILE)).unwrap()).unwrap();
    let third = mock_app();
    restore(&third, &after.0);
    let handle = third.handle().clone();
    assert!(app_lib::fs_scope::ensure_allowed(&handle, &pdf).is_ok(), "드라이브가 돌아오면 PDF 가 다시 열린다");
    assert!(app_lib::fs_scope::ensure_allowed(&handle, &vault).is_ok());
    assert!(app_lib::fs_scope::ensure_allowed(&handle, vault.join("notes").join("a.md")).is_ok());
    let _ = std::fs::remove_dir_all(&drive);
}

#[test]
fn a_deleted_file_in_a_reachable_folder_is_still_pruned() {
    let folder = temp("docs");
    let kept = folder.join("kept.pdf");
    let deleted = folder.join("deleted.pdf");
    std::fs::write(&kept, b"%PDF").unwrap();
    std::fs::write(&deleted, b"%PDF").unwrap();

    let app = mock_app();
    app.fs_scope().allow_file(&kept).unwrap();
    app.fs_scope().allow_file(&deleted).unwrap();
    let appdata = temp("appdata2");
    save(&app, &appdata);
    std::fs::remove_file(&deleted).unwrap();

    assert!(prune_files(&appdata, now(), &definitely_gone) >= 1);
    let after: (Vec<String>, Vec<String>) = bincode::deserialize(&std::fs::read(appdata.join(SCOPE_FILE)).unwrap()).unwrap();
    assert!(!after.0.is_empty());
    assert!(after.0.iter().all(|pattern| pattern.to_lowercase().contains("kept.pdf")), "{:?}", after.0);
    let _ = std::fs::remove_dir_all(&folder);
}
