//! Vault 안 폴더 옮기기. 예전에는 웹 쪽에서 파일마다 이름 바꾸기를 불러(파일 하나에 IPC 한 번) 파일이 많은 폴더
//! (그림·git 작업 폴더)를 옮기면 아주 느렸다. 여기서 한 번에 한다: 먼저 디렉터리째 이름 바꾸기, 안 되면
//! (다른 드라이브, 누가 잡고 있는 폴더) 안쪽부터 파일을 옮기고 빈 폴더를 지운다. 실패하면 옮긴 것을 되돌린다.

use std::path::{Component, Path, PathBuf};

/// 있는 가장 가까운 윗 폴더까지만 실제 경로로 바꾸고 나머지는 이어 붙인다(아직 없는 대상도 비교할 수 있게)
fn resolve_existing_prefix(path: &Path) -> PathBuf {
    let mut rest = Vec::new();
    let mut probe = path.to_path_buf();
    loop {
        if let Ok(real) = probe.canonicalize() {
            return rest.iter().rev().fold(real, |acc, part: &std::ffi::OsString| acc.join(part));
        }
        match (probe.file_name().map(|name| name.to_owned()), probe.parent().map(Path::to_path_buf)) {
            (Some(name), Some(parent)) => {
                rest.push(name);
                probe = parent;
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// 둘 다 Vault 안이고, 원본이 있고, 대상이 없어야 한다
fn validate(vault_root: &Path, from: &Path, to: &Path) -> Result<(), String> {
    // 글자 비교만 하면 `Vault/../다른폴더` 가 Vault 안으로 보인다 — `..` 가 든 경로는 받지 않는다
    if [vault_root, from, to].iter().any(|path| path.components().any(|part| matches!(part, Component::ParentDir))) {
        return Err(tr!("Vault 밖의 폴더는 옮길 수 없습니다.", "Folders outside the vault cannot be moved."));
    }
    // 바로가기·정션으로 Vault 밖을 가리키는 경로도 실제 위치로 풀어 다시 본다
    let real_root = resolve_existing_prefix(vault_root);
    let inside = |path: &Path| {
        let real = resolve_existing_prefix(path);
        path.starts_with(vault_root) && path != vault_root && real.starts_with(&real_root) && real != real_root
    };
    if !inside(from) || !inside(to) {
        return Err(tr!("Vault 밖의 폴더는 옮길 수 없습니다.", "Folders outside the vault cannot be moved."));
    }
    if !from.is_dir() {
        return Err(tr!("옮길 폴더를 찾지 못했습니다.", "The folder to move was not found."));
    }
    // 대소문자만 바꾸는 경우(같은 폴더)는 허용
    let same = from.to_string_lossy().to_lowercase() == to.to_string_lossy().to_lowercase();
    if to.exists() && !same {
        return Err(tr!("대상 위치에 같은 이름이 이미 있습니다.", "An item with the same name already exists at the destination."));
    }
    if to.starts_with(from) && !same {
        return Err(tr!("폴더를 자기 안으로 옮길 수 없습니다.", "A folder cannot be moved into itself."));
    }
    Ok(())
}

fn move_files(from: &Path, to: &Path, moved: &mut Vec<(PathBuf, PathBuf)>, created: &mut Vec<PathBuf>) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    created.push(to.to_path_buf());
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            move_files(&source, &target, moved, created)?;
        } else {
            if std::fs::rename(&source, &target).is_err() {
                // 다른 드라이브면 복사 후 지운다
                std::fs::copy(&source, &target)?;
                std::fs::remove_file(&source)?;
            }
            moved.push((source, target));
        }
    }
    Ok(())
}

fn remove_empty_dirs(dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                remove_empty_dirs(&entry.path());
            }
        }
    }
    let _ = std::fs::remove_dir(dir);
}

pub fn move_dir(vault_root: &Path, from: &Path, to: &Path) -> Result<(), String> {
    validate(vault_root, from, to)?;
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|err| tr!("대상 폴더를 만들지 못했습니다: {err}", "Could not create the destination folder: {err}"))?;
    }
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    let mut moved = Vec::new();
    let mut created = Vec::new();
    if let Err(err) = move_files(from, to, &mut moved, &mut created) {
        for (source, target) in moved.iter().rev() {
            let _ = std::fs::rename(target, source);
        }
        for dir in created.iter().rev() {
            let _ = std::fs::remove_dir(dir);
        }
        return Err(tr!("폴더를 옮기지 못했습니다: {err}", "Could not move the folder: {err}"));
    }
    remove_empty_dirs(from);
    Ok(())
}

#[tauri::command]
pub async fn vault_move_dir(app: tauri::AppHandle, vault_root: String, from: String, to: String) -> Result<(), String> {
    crate::fs_scope::ensure_all_allowed(&app, [&vault_root, &from, &to])?;
    tauri::async_runtime::spawn_blocking(move || move_dir(Path::new(&vault_root), Path::new(&from), Path::new(&to)))
        .await
        .map_err(|err| err.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves_folder_with_nested_files_and_refuses_bad_targets() {
        let root = std::env::temp_dir().join(format!("iwae-move-{}", std::process::id()));
        let from = root.join("A/Docs");
        std::fs::create_dir_all(from.join("images/deep")).unwrap();
        std::fs::write(from.join("a.md"), "a").unwrap();
        std::fs::write(from.join("images/deep/x.png"), "x").unwrap();
        let to = root.join("B/Docs");
        move_dir(&root, &from, &to).unwrap();
        assert!(to.join("images/deep/x.png").exists());
        assert!(!from.exists());
        // 자기 안으로, Vault 밖으로는 안 된다
        assert!(move_dir(&root, &to, &to.join("inner")).is_err());
        assert!(move_dir(&root, &to, Path::new("C:/outside-iwae-test")).is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn refuses_parent_dir_components_that_escape_the_vault() {
        let base = std::env::temp_dir().join(format!("iwae-move-dotdot-{}", std::process::id()));
        let root = base.join("Vault");
        let outside = base.join("Other");
        std::fs::create_dir_all(root.join("Docs")).unwrap();
        std::fs::create_dir_all(outside.join("Secret")).unwrap();
        // 글자로는 Vault 아래지만 실제로는 Vault 밖
        let sneaky_from = root.join("..").join("Other").join("Secret");
        assert!(move_dir(&root, &sneaky_from, &root.join("Stolen")).is_err());
        assert!(outside.join("Secret").exists(), "outside folder must stay put");
        let sneaky_to = root.join("..").join("Other").join("Moved");
        assert!(move_dir(&root, &root.join("Docs"), &sneaky_to).is_err());
        assert!(root.join("Docs").exists() && !outside.join("Moved").exists());
        // `..` 없는 정상 이동은 그대로 된다
        move_dir(&root, &root.join("Docs"), &root.join("Moved")).unwrap();
        assert!(root.join("Moved").exists());
        std::fs::remove_dir_all(&base).ok();
    }
}
