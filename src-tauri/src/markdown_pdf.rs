//! Markdown 을 PDF 로 바꿔 PDF 리더로 연다(메모·형광펜·박스 메모·편집·화면 나누기·검색·목차·인쇄·버전 관리가
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

/// 인쇄 화면이 읽을 수 있는 것: 이 PC 의 파일·data 그림뿐. 원격 주소(추적 그림·원격 CSS)는 불러오지 않는다.
/// 웹 쪽이 이미 같은 CSP 를 넣어 보내지만, 이 커맨드가 받은 HTML 은 그대로 믿지 않는다
const PRINT_CSP: &str = "default-src 'none'; img-src file: data:; style-src 'unsafe-inline'; font-src file: data:";

/// HTML 의 <head> 맨 앞에 CSP <meta> 를 넣는다(없으면 문서 맨 앞에). 상대 그림은 <base> + file: 로 읽는다 —
/// 예전에는 `--allow-file-access-from-files` 가 필요하다고 여겼지만 <img> 는 그것 없이도 file: 주소를 읽는다
fn with_print_csp(html: &str) -> String {
    let meta = format!("<meta http-equiv=\"Content-Security-Policy\" content=\"{PRINT_CSP}\">");
    match html.to_ascii_lowercase().find("<head>") {
        Some(at) => {
            let end = at + "<head>".len();
            format!("{}{meta}{}", &html[..end], &html[end..])
        }
        None => format!("{meta}{html}"),
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
    std::fs::write(&page, with_print_csp(html)).map_err(|err| tr!("HTML 을 쓰지 못했습니다: {err}", "Could not write the HTML: {err}"))?;
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
pub async fn markdown_to_pdf(app: tauri::AppHandle, vault_root: String, key: String, html: String) -> Result<String, String> {
    crate::fs_scope::ensure_allowed(&app, &vault_root)?;
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
    fn the_print_csp_goes_first_in_the_head_and_blocks_remote_loads() {
        let html = with_print_csp("<!doctype html><HTML><HEAD><title>t</title></HEAD><body></body></HTML>");
        assert!(html.contains("<HEAD><meta http-equiv=\"Content-Security-Policy\""), "{html}");
        assert!(with_print_csp("<p>no head</p>").starts_with("<meta http-equiv"));
        assert!(!PRINT_CSP.contains("http"), "no remote source may be allowed");
        assert!(PRINT_CSP.starts_with("default-src 'none'"));
    }

    /// 실제 브라우저로: 상대 그림은 <base> 로 읽히고(--allow-file-access-from-files 없이), 원격 그림은 요청조차 나가지 않는다.
    /// 브라우저가 없는 PC 에서는 건너뛴다
    #[test]
    fn printing_loads_relative_images_but_never_touches_the_network() {
        if edge_path().is_none() {
            eprintln!("skipped: no Chromium-based browser");
            return;
        }
        use std::io::Read;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let root = std::env::temp_dir().join(format!("iwae-mdpdf-live-{}", std::process::id()));
        let images = root.join("docs/images");
        std::fs::create_dir_all(&images).unwrap();
        // 1x1 PNG
        let png: &[u8] = &[
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0, 5, 0, 1, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0, 0, 0, 0, 0x49, 0x45, 0x4e,
        ];
        std::fs::write(images.join("a.png"), png).unwrap();
        let base = file_url(&root.join("docs/x.md"));
        let base = &base[..base.rfind('/').unwrap() + 1];
        let html = format!(
            "<!doctype html><html><head><meta charset=\"utf-8\"><base href=\"{base}\"></head><body><h1>t</h1><img src=\"images/a.png\"><img src=\"http://127.0.0.1:{port}/pixel.png\"></body></html>"
        );
        // 새 프로필로 처음 띄울 때 Edge 가 PDF 없이 끝나는 일이 가끔 있다(앱은 다음 열기에서 다시 만든다) — 몇 번 더 해 본다
        let pdf = (0..4)
            .find_map(|_| render(&root, "live-test", &html).ok().or_else(|| { std::thread::sleep(std::time::Duration::from_millis(800)); None }))
            .expect("render");
        assert!(pdf.is_file() && std::fs::metadata(&pdf).unwrap().len() > 1000);
        let mut contacted = false;
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buffer = [0u8; 64];
            let _ = stream.read(&mut buffer);
            contacted = true;
        }
        assert!(!contacted, "the remote image must not be requested while printing");
        std::fs::remove_dir_all(&root).ok();
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
