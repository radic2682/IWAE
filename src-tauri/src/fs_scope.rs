//! 웹뷰가 넘긴 경로를 앱의 파일 범위(fs scope)로 거르는 공통 검사.
//!
//! Tauri 의 `fs` 플러그인 명령은 범위를 스스로 지키지만, 우리가 만든 커맨드(`atomic_write_text`·`pdf_open`·
//! `office_to_pdf` …)는 받은 경로를 그대로 썼다. 웹뷰가 뚫리면 PC 의 아무 파일이나 읽고 쓰는 통로가 된다.
//! 그래서 경로를 받는 커맨드는 진입점에서 [`ensure_allowed`] 를 부른다: 사용자가 대화상자로 고른 곳(Vault·
//! 내보낼 폴더·탐색기에서 연 PDF)과 저장돼 있던 범위(persisted-scope)만 통과한다.

use std::path::{Component, Path};

use tauri::{AppHandle, Runtime};
use tauri_plugin_fs::FsExt;

fn deny(path: &Path) -> String {
    tr!(
        "허용되지 않은 위치입니다: {}",
        "This location is not allowed: {}",
        path.display()
    )
}

/// 범위 검사 앞단의 글자 검사: 비었거나, 상대 경로이거나, `..` 가 든 경로는 거른다.
/// (범위는 글자 패턴이라 `Vault/../다른폴더` 가 `Vault/**` 에 걸려 통과하기 때문이다)
pub fn lexically_safe(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return Err(tr!(
            "경로가 올바르지 않습니다: {}",
            "Invalid path: {}",
            path.display()
        ));
    }
    if path
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(tr!(
            "'..' 가 든 경로는 쓸 수 없습니다: {}",
            "Paths containing '..' are not allowed: {}",
            path.display()
        ));
    }
    Ok(())
}

/// `path` 가 앱의 fs 범위 안인가. 아니면 사용자에게 보일 오류 문장을 돌려준다.
pub fn ensure_allowed<R: Runtime>(
    app: &AppHandle<R>,
    path: impl AsRef<Path>,
) -> Result<(), String> {
    let path = path.as_ref();
    lexically_safe(path)?;
    match app.try_fs_scope() {
        Some(scope) if scope.is_allowed(path) => Ok(()),
        _ => Err(deny(path)),
    }
}

/// 여러 경로를 한꺼번에 검사한다(하나라도 범위 밖이면 오류).
pub fn ensure_all_allowed<R: Runtime, P: AsRef<Path>>(
    app: &AppHandle<R>,
    paths: impl IntoIterator<Item = P>,
) -> Result<(), String> {
    for path in paths {
        ensure_allowed(app, path)?;
    }
    Ok(())
}

/// 개발용 설정(tauri.debug.conf.json)이 capability 의 `fs:scope` 로 열어 둔 폴더들. capability 범위는 fs 플러그인
/// 명령에만 적용되고 우리 커맨드가 보는 런타임 범위에는 없으므로, 개발 빌드에서만 그 폴더를 런타임 범위에도 넣는다.
pub fn dev_scope_paths(config_json: &str) -> Vec<String> {
    let Ok(config) = serde_json::from_str::<serde_json::Value>(config_json) else {
        return Vec::new();
    };
    let mut paths = Vec::new();
    let capabilities = config
        .pointer("/app/security/capabilities")
        .and_then(|value| value.as_array());
    for capability in capabilities.into_iter().flatten() {
        for permission in capability
            .get("permissions")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
        {
            if permission
                .get("identifier")
                .and_then(|value| value.as_str())
                != Some("fs:scope")
            {
                continue;
            }
            for entry in permission
                .get("allow")
                .and_then(|value| value.as_array())
                .into_iter()
                .flatten()
            {
                let Some(path) = entry.get("path").and_then(|value| value.as_str()) else {
                    continue;
                };
                let base = path.trim_end_matches("**").trim_end_matches(['\\', '/']);
                if !base.is_empty() && !paths.iter().any(|known: &String| known == base) {
                    paths.push(base.to_owned());
                }
            }
        }
    }
    paths
}

/// 개발 빌드: 개발용 capability 가 열어 둔 폴더를 런타임 범위에 더한다(릴리스 빌드에는 이 설정이 없다)
#[cfg(debug_assertions)]
pub fn seed_dev_scope<R: Runtime>(app: &AppHandle<R>) {
    const DEBUG_CONFIG: &str = include_str!("../tauri.debug.conf.json");
    if let Some(scope) = app.try_fs_scope() {
        for path in dev_scope_paths(DEBUG_CONFIG) {
            let _ = scope.allow_directory(path, true);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_relative_empty_and_parent_paths_before_the_scope() {
        assert!(lexically_safe(Path::new("")).is_err());
        assert!(lexically_safe(Path::new("relative/file.pdf")).is_err());
        let root = std::env::temp_dir().join("iwae-scope-lexical");
        assert!(lexically_safe(&root.join("a.pdf")).is_ok());
        assert!(lexically_safe(&root.join("..").join("x")).is_err());
    }

    #[test]
    fn dev_capability_folders_are_read_from_the_debug_config() {
        let config = r#"{"app":{"security":{"capabilities":["default",{"identifier":"x","permissions":[
          {"identifier":"fs:scope","allow":[{"path":"C:\\Workspace\\V"},{"path":"C:\\Workspace\\V\\**"},{"path":"/tmp/v/**"}]},
          {"identifier":"fs:allow-exists"}]}]}}}"#;
        assert_eq!(
            dev_scope_paths(config),
            vec!["C:\\Workspace\\V".to_owned(), "/tmp/v".to_owned()]
        );
        assert!(dev_scope_paths("not json").is_empty());
        // 실제 개발 설정 파일도 읽힌다
        assert!(!dev_scope_paths(include_str!("../tauri.debug.conf.json")).is_empty());
    }
}
