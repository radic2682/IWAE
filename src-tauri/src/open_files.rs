//! 파일 탐색기에서 PDF 를 열었을 때(IWAE 를 기본 PDF 앱·연결 프로그램으로 쓸 때) 그 경로를 화면에 넘긴다.
//!
//! - 처음 켜질 때의 명령줄 인자는 화면이 준비된 뒤 `take_open_files` 로 가져간다.
//! - 이미 켜져 있으면 두 번째 실행은 곧바로 끝나고(single-instance), 그 인자를 이 창에 `iwae:open-files` 로 보낸다.
//! - Vault 밖 파일이라 fs 범위에 그 파일을 열어 둔다(Vault 로 가져올 때 복사해야 한다).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_fs::FsExt;

pub const EVENT: &str = "iwae:open-files";

#[derive(Default)]
pub struct PendingOpenFiles(pub Mutex<Vec<String>>);

/// 화면이 처음 경로를 가져갔는가(`take_open_files`). 그 뒤에 온 파일은 이벤트로 보낸다
#[derive(Default)]
pub struct OpenFilesTaken(pub std::sync::atomic::AtomicBool);

/// macOS: Finder 에서 연 PDF 는 명령줄 인자가 아니라 Apple Event(`RunEvent::Opened`)로 온다.
/// 화면이 아직 준비되지 않았으면 처음 경로에 쌓고, 이미 켜져 있으면 바로 보낸다
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn on_opened_paths<R: Runtime>(app: &AppHandle<R>, paths: Vec<PathBuf>) {
    let files: Vec<String> = paths
        .into_iter()
        .filter(|path| path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("pdf")))
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    if files.is_empty() {
        return;
    }
    let taken = app
        .try_state::<OpenFilesTaken>()
        .is_some_and(|state| state.0.load(std::sync::atomic::Ordering::SeqCst));
    if !taken {
        if let Some(pending) = app.try_state::<PendingOpenFiles>() {
            pending.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).extend(files);
            return;
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    allow_in_scope(app, &files);
    let _ = app.emit(EVENT, files);
}

/// 인자 가운데 실제로 있는 PDF 파일만. 첫 인자(실행 파일)는 뺀다. 상대 경로는 cwd 기준
pub fn pdf_args<I: IntoIterator<Item = String>>(args: I, cwd: Option<&Path>) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|arg| arg.to_lowercase().ends_with(".pdf"))
        .map(|arg| {
            let path = PathBuf::from(&arg);
            match (path.is_absolute(), cwd) {
                (false, Some(base)) => base.join(path),
                _ => path,
            }
        })
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

pub fn allow_in_scope<R: Runtime>(app: &AppHandle<R>, files: &[String]) {
    for file in files {
        let _ = app.fs_scope().allow_file(file);
    }
}

/// 이미 켜진 IWAE 에 두 번째 실행이 넘긴 인자
pub fn on_second_instance<R: Runtime>(app: &AppHandle<R>, argv: Vec<String>, cwd: String) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let files = pdf_args(argv, Some(Path::new(&cwd)));
    if files.is_empty() {
        return;
    }
    allow_in_scope(app, &files);
    let _ = app.emit(EVENT, files);
}

/// 처음 켜질 때 받은 PDF 경로(한 번만 준다)
#[tauri::command]
pub fn take_open_files<R: Runtime>(app: AppHandle<R>, state: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    let mut pending = state.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let files = std::mem::take(&mut *pending);
    // 잠근 채로 깃발을 세운다 — 그 사이 macOS 가 보낸 파일이 쌓이기만 하고 사라지는 일이 없게
    if let Some(taken) = app.try_state::<OpenFilesTaken>() {
        taken.0.store(true, std::sync::atomic::Ordering::SeqCst);
    }
    drop(pending);
    allow_in_scope(&app, &files);
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_existing_pdf_arguments() {
        let dir = std::env::temp_dir().join("iwae-open-files-test");
        std::fs::create_dir_all(&dir).unwrap();
        let pdf = dir.join("spec.PDF");
        std::fs::write(&pdf, b"%PDF").unwrap();
        let args = vec![
            "iwae.exe".to_string(),
            "--flag".to_string(),
            "spec.PDF".to_string(),
            "missing.pdf".to_string(),
        ];
        let files = pdf_args(args, Some(&dir));
        assert_eq!(files, vec![pdf.to_string_lossy().into_owned()]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
