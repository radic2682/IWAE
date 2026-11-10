//! 여러 창: PDF 를 떼어 낸 창(`detached-…`)과 새 창(`window-…`).
//!
//! 창마다 웹뷰가 따로지만 PDFium 스레드(`PdfThread`)와 열린 문서 캐시는 프로세스에 하나라서, 새 창이
//! `pdf_open` 을 다시 불러도 같은 문서를 재사용한다(캐시는 문서를 닫지 않으므로 창이 닫혀도 다른 창이 쓰는 문서가
//! 밀려나지 않는다). 새 창은 메인 창의 설정(`tauri.conf.json` 의 첫 창: 장식 없음·웹뷰 인자 등)을 그대로 따라 만든다 —
//! WebView2 는 같은 사용자 데이터 폴더를 쓰는 창끼리 브라우저 인자가 같아야 하기 때문이다.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// 메인 창 label. 세션(탭·패널 배치)을 저장하고 닫을 때 다른 창을 정리하는 창이다
pub const MAIN_LABEL: &str = "main";
/// 창을 닫으라는 알림(메인 창이 닫힐 때 다른 창에 보낸다)
pub const CLOSE_NOW_EVENT: &str = "iwae:close-now";

#[derive(Serialize)]
pub struct OpenedWindow {
    pub label: String,
    /// 이미 열려 있던 창을 앞으로 가져왔다(새로 만들지 않았다)
    pub existing: bool,
}

/// label 에 쓸 수 있는 글자(영문·숫자·-·_)만 남긴다
fn label_part(raw: &str) -> String {
    raw.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

/// 떼어 낸 문서의 창 label. 같은 문서는 늘 같은 label 이라 두 번 떼면 있던 창을 가리킨다
pub fn detached_label(doc_id: &str) -> String {
    format!("detached-{}", label_part(doc_id))
}

fn focus(window: &tauri::WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// 창을 연다.
/// - `kind` = "detached": `doc_id` 의 PDF 하나만 보는 창(같은 문서면 있는 창을 앞으로)
/// - `kind` = "extra": 같은 Vault 의 전체 화면 새 창
/// `query` 는 화면이 읽는 매개변수(`role=…&doc=…` 등)다
#[tauri::command]
pub async fn open_app_window(
    app: AppHandle,
    kind: String,
    doc_id: Option<String>,
    query: String,
) -> Result<OpenedWindow, String> {
    let label = match kind.as_str() {
        "detached" => {
            let doc = doc_id.ok_or_else(|| "doc_id is required for a detached window".to_string())?;
            detached_label(&doc)
        }
        "extra" => format!(
            "window-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_millis())
                .unwrap_or_default()
        ),
        other => return Err(format!("unknown window kind: {other}")),
    };

    if let Some(existing) = app.get_webview_window(&label) {
        focus(&existing);
        return Ok(OpenedWindow { label, existing: true });
    }

    // 메인 창의 설정을 바탕으로 한다(웹뷰 인자·장식·배경색을 같게)
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| "no window config".to_string())?;
    config.label = label.clone();
    config.url = WebviewUrl::App(format!("index.html?{query}").into());
    if kind == "detached" {
        config.width = 1100.0;
        config.height = 900.0;
        config.min_width = Some(640.0);
        config.min_height = Some(480.0);
    }
    let window = WebviewWindowBuilder::from_config(&app, &config)
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;
    focus(&window);
    Ok(OpenedWindow { label, existing: false })
}

/// 메인 창이 닫히기 전에 다른 창을 모두 닫게 한다. 각 창은 저장을 마치고(떼어 낸 창은 탭을 메인에 돌려주고) 스스로 닫히며,
/// 제때 닫히지 않은 창은 마지막에 강제로 닫는다. 닫으라고 한 창의 수를 돌려준다
#[tauri::command]
pub async fn close_secondary_windows(app: AppHandle) -> Result<usize, String> {
    let labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|label| label.as_str() != MAIN_LABEL)
        .cloned()
        .collect();
    if labels.is_empty() {
        return Ok(0);
    }
    let count = labels.len();
    for label in &labels {
        let _ = app.emit_to(label.as_str(), CLOSE_NOW_EVENT, ());
    }
    let waiting = app.clone();
    let remaining = labels.clone();
    let all_closed = tauri::async_runtime::spawn_blocking(move || {
        for _ in 0..60 {
            if remaining.iter().all(|label| waiting.get_webview_window(label).is_none()) {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        false
    })
    .await
    .map_err(|error| error.to_string())?;
    if !all_closed {
        for label in labels {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.destroy();
            }
        }
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_document_gets_the_same_label() {
        assert_eq!(detached_label("0123abcd"), detached_label("0123abcd"));
        assert_ne!(detached_label("0123abcd"), detached_label("0123abce"));
    }

    #[test]
    fn labels_keep_only_safe_characters() {
        assert_eq!(detached_label("a/b c:d"), "detached-a_b_c_d");
        assert!(detached_label("문서").chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }
}
