//! 첫 화면 「예시로 시작하기」: 문서 폴더에 빈 예시 Vault 폴더를 만들고, 앱이 그 폴더를 읽고 쓸 수 있게 연다.
//! 예시 파일(사용 안내서·노트)은 화면 쪽이 빈 Vault 를 열 때 넣는다(seedSampleVaultInto).

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_fs::FsExt;

/// 이름에 쓸 수 없는 글자를 걸러 낸다(경로 구분자·예약 문자). 비면 기본 이름
fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|ch| !matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !ch.is_control())
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() { "IWAE".to_string() } else { trimmed.chars().take(60).collect() }
}

/// `base/name` 이 이미 있고 비어 있지 않으면 `name (2)`, `name (3)` … 가운데 처음 빈 자리
fn free_folder(base: &Path, name: &str) -> PathBuf {
    let empty = |path: &Path| std::fs::read_dir(path).map(|mut entries| entries.next().is_none()).unwrap_or(false);
    let first = base.join(name);
    if !first.exists() || empty(&first) {
        return first;
    }
    (2..1000)
        .map(|index| base.join(format!("{name} ({index})")))
        .find(|path| !path.exists() || empty(path))
        .unwrap_or_else(|| base.join(format!("{name} ({})", std::process::id())))
}

/// 예시 Vault 폴더를 만들고 그 절대 경로를 돌려준다
#[tauri::command]
pub fn create_example_vault<R: Runtime>(app: AppHandle<R>, name: String) -> Result<String, String> {
    let documents = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|err| tr!("문서 폴더를 찾지 못했습니다: {err}", "Could not find the Documents folder: {err}"))?;
    let folder = free_folder(&documents, &safe_name(&name));
    std::fs::create_dir_all(&folder).map_err(|err| tr!("예시 폴더를 만들지 못했습니다: {err}", "Could not create the example folder: {err}"))?;
    // 폴더 선택 창을 거치지 않았으므로 여기서 범위를 연다(persisted-scope 가 다음 실행에도 기억한다)
    app.fs_scope()
        .allow_directory(&folder, true)
        .map_err(|err| tr!("예시 폴더를 열 권한을 얻지 못했습니다: {err}", "Could not get access to the example folder: {err}"))?;
    Ok(folder.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_cleaned_and_never_empty() {
        assert_eq!(safe_name("IWAE 예시"), "IWAE 예시");
        assert_eq!(safe_name("a/b\\c:d"), "abcd");
        assert_eq!(safe_name("  ..  "), "IWAE");
    }

    #[test]
    fn picks_the_first_free_or_empty_folder() {
        let base = std::env::temp_dir().join(format!("iwae-example-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        // 없으면 그대로
        assert_eq!(free_folder(&base, "IWAE 예시"), base.join("IWAE 예시"));
        // 비어 있으면 그대로 쓴다
        std::fs::create_dir_all(base.join("IWAE 예시")).unwrap();
        assert_eq!(free_folder(&base, "IWAE 예시"), base.join("IWAE 예시"));
        // 무언가 들어 있으면 다음 번호
        std::fs::write(base.join("IWAE 예시").join("a.pdf"), "x").unwrap();
        assert_eq!(free_folder(&base, "IWAE 예시"), base.join("IWAE 예시 (2)"));
        std::fs::remove_dir_all(&base).ok();
    }
}
