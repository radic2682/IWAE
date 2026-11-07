//! Markdown 을 PDF 로 바꿔 PDF 리더로 연다(메모·형광펜·박스 메모·편집·화면 나누기·검색·목차·인쇄·판 관리가
//! 모두 PDF 와 같이 동작하게). 웹 쪽이 그린 HTML 을 PC 의 Microsoft Edge(헤드리스)로 인쇄한다 — Windows 에 늘 있다.
//! 만든 PDF 는 `.iwae/cache/md-pdf/<key>.pdf` 에 두고, 같은 key(문서 id + 원문 해시)면 다시 만들지 않는다.

use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const CACHE_DIR: &str = ".iwae/cache/md-pdf";

/// Edge 는 같은 프로필 폴더로 둘을 동시에 띄우면 뒤의 것이 앞의 것에 일을 넘기고 PDF 없이 끝난다
/// (앱을 켤 때 지난번 Markdown 탭 여럿을 한꺼번에 바꾸다 실패했다). 한 번에 하나씩 바꾼다
static EDGE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 헤드리스 인쇄에 쓸 Chromium 계열 브라우저. Windows 는 늘 있는 Edge, macOS 는 깔린 것 가운데 먼저 찾은 것
fn edge_path() -> Option<PathBuf> {
    browser_candidates().into_iter().find(|path| path.exists())
}

#[cfg(not(target_os = "macos"))]
fn browser_candidates() -> Vec<PathBuf> {
    [
        std::env::var("ProgramFiles(x86)").ok().map(|base| PathBuf::from(base).join("Microsoft/Edge/Application/msedge.exe")),
        std::env::var("ProgramFiles").ok().map(|base| PathBuf::from(base).join("Microsoft/Edge/Application/msedge.exe")),
        std::env::var("LOCALAPPDATA").ok().map(|base| PathBuf::from(base).join("Microsoft/Edge/Application/msedge.exe")),
        std::env::var("ProgramFiles").ok().map(|base| PathBuf::from(base).join("Google/Chrome/Application/chrome.exe")),
        std::env::var("LOCALAPPDATA").ok().map(|base| PathBuf::from(base).join("Google/Chrome/Application/chrome.exe")),
    ]
    .into_iter()
    .flatten()
    .collect()
}

#[cfg(target_os = "macos")]
fn browser_candidates() -> Vec<PathBuf> {
    const APPS: [&str; 4] = [
        "Google Chrome.app/Contents/MacOS/Google Chrome",
        "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "Chromium.app/Contents/MacOS/Chromium",
        "Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(home).join("Applications"));
    }
    roots.iter().flat_map(|root| APPS.iter().map(move |app| root.join(app))).collect()
}

/// 로컬 파일 경로 → file:// 주소. Windows(`C:\…`)와 macOS(`/Users/…`) 둘 다
fn file_url(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    if text.starts_with('/') {
        format!("file://{text}")
    } else {
        format!("file:///{text}")
    }
}

/// key 는 파일 이름에 쓴다: 영숫자·-·_ 만
fn safe_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 120 && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// 같은 문서(key 의 첫 '-' 앞)의 예전 PDF 는 지운다(원문이 바뀌면 해시가 달라 새 파일이 생긴다)
fn remove_stale(dir: &Path, key: &str) {
    let Some((doc, _)) = key.split_once('-') else { return };
    let prefix = format!("{doc}-");
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(&prefix) && name != format!("{key}.pdf") && name.ends_with(".pdf") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

pub fn render(vault_root: &Path, key: &str, html: &str) -> Result<PathBuf, String> {
    if !safe_key(key) {
        return Err(tr!("문서 키가 올바르지 않습니다.", "Invalid document key."));
    }
    let dir = vault_root.join(CACHE_DIR);
    let pdf = dir.join(format!("{key}.pdf"));
    if pdf.exists() {
        return Ok(pdf);
    }
    std::fs::create_dir_all(&dir).map_err(|err| tr!("캐시 폴더를 만들지 못했습니다: {err}", "Could not create the cache folder: {err}"))?;
    let _guard = EDGE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    // 기다리는 동안 앞의 요청이 같은 문서를 만들었으면 그것을 쓴다
    if pdf.exists() {
        return Ok(pdf);
    }
    let edge = edge_path().ok_or_else(|| {
        if cfg!(target_os = "macos") {
            tr!(
                "Chrome·Edge 같은 Chromium 브라우저를 찾지 못해 Markdown 을 PDF 로 바꿀 수 없습니다. /Applications 에 Google Chrome 을 설치해 주세요.",
                "No Chromium browser (Chrome, Edge) was found, so Markdown cannot be converted to PDF. Install Google Chrome in /Applications."
            )
        } else {
            tr!("Microsoft Edge 를 찾지 못해 Markdown 을 PDF 로 바꿀 수 없습니다.", "Microsoft Edge was not found, so Markdown cannot be converted to PDF.")
        }
    })?;
    let page = dir.join(format!("{key}.html"));
    std::fs::write(&page, html).map_err(|err| tr!("HTML 을 쓰지 못했습니다: {err}", "Could not write the HTML: {err}"))?;
    let profile = dir.join("edge-profile");
    let page_url = file_url(&page);
    let mut command = Command::new(edge);
    command.args([
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--disable-sync",
        "--disable-extensions",
        "--no-pdf-header-footer",
        "--allow-file-access-from-files",
        &format!("--user-data-dir={}", profile.to_string_lossy()),
        &format!("--print-to-pdf={}", pdf.to_string_lossy()),
        &page_url,
    ]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut output = command.output().map_err(|err| tr!("Edge 를 실행하지 못했습니다: {err}", "Could not run Edge: {err}"))?;
    if !pdf.exists() {
        // 바깥의 다른 Edge 가 프로필을 잠깐 잡고 있었을 수 있다 — 한 번 더
        std::thread::sleep(std::time::Duration::from_millis(400));
        output = command.output().map_err(|err| tr!("Edge 를 실행하지 못했습니다: {err}", "Could not run Edge: {err}"))?;
    }
    let _ = std::fs::remove_file(&page);
    if !pdf.exists() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let reason = stderr.lines().rev().map(str::trim).find(|line| !line.is_empty()).map(str::to_owned).unwrap_or_else(|| tr!("Edge 가 PDF 를 만들지 않았습니다", "Edge did not create a PDF"));
        return Err(tr!("Markdown 화면을 만들지 못했습니다({reason})", "Could not render the Markdown view ({reason})"));
    }
    remove_stale(&dir, key);
    Ok(pdf)
}

/// Markdown(웹 쪽이 그린 HTML 문서)을 PDF 로. 만든(또는 이미 있던) PDF 의 절대 경로
#[tauri::command]
pub async fn markdown_to_pdf(vault_root: String, key: String, html: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || render(Path::new(&vault_root), &key, &html).map(|path| path.to_string_lossy().into_owned()))
        .await
        .map_err(|err| err.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_urls_work_for_windows_and_macos_paths() {
        assert_eq!(file_url(Path::new(r"C:\vault\.iwae\a.html")), "file:///C:/vault/.iwae/a.html");
        assert_eq!(file_url(Path::new("/Users/me/vault/a.html")), "file:///Users/me/vault/a.html");
    }

    #[test]
    fn keys_are_file_safe_and_stale_files_go() {
        assert!(safe_key("ab12-ff00"));
        assert!(!safe_key("../x"));
        assert!(!safe_key(""));
        let dir = std::env::temp_dir().join(format!("iwae-mdpdf-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("doc1-old.pdf"), "x").unwrap();
        std::fs::write(dir.join("doc1-new.pdf"), "x").unwrap();
        std::fs::write(dir.join("doc2-old.pdf"), "x").unwrap();
        remove_stale(&dir, "doc1-new");
        assert!(!dir.join("doc1-old.pdf").exists());
        assert!(dir.join("doc1-new.pdf").exists());
        assert!(dir.join("doc2-old.pdf").exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
