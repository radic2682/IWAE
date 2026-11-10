//! 여러 창: PDF 를 떼어 낸 창(`detached-…`)과 새 창(`window-…`).
//!
//! 창마다 웹뷰가 따로지만 PDFium 스레드(`PdfThread`)와 열린 문서 캐시는 프로세스에 하나라서, 새 창이
//! `pdf_open` 을 다시 불러도 같은 문서를 재사용한다(캐시는 문서를 닫지 않으므로 창이 닫혀도 다른 창이 쓰는 문서가
//! 밀려나지 않는다). 새 창은 메인 창의 설정(`tauri.conf.json` 의 첫 창: 장식 없음·웹뷰 인자 등)을 그대로 따라 만든다 —
//! WebView2 는 같은 사용자 데이터 폴더를 쓰는 창끼리 브라우저 인자가 같아야 하기 때문이다.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder};

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
    let (window, label, existing) = build_app_window(&app, &kind, doc_id, &query, true)?;
    focus(&window);
    Ok(OpenedWindow { label, existing })
}

/// 창을 만든다(이미 있으면 그 창을 돌려준다). `visible` 가 false 면 숨긴 채 만든다 — 자리를 잡은 뒤에 보이게 하려는 길(탭을 끌어 떼어 낼 때)
fn build_app_window(
    app: &AppHandle,
    kind: &str,
    doc_id: Option<String>,
    query: &str,
    visible: bool,
) -> Result<(tauri::WebviewWindow, String, bool), String> {
    let label = match kind {
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
        return Ok((existing, label, true));
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
    config.visible = visible;
    if kind == "detached" {
        config.width = 1100.0;
        config.height = 900.0;
        config.min_width = Some(640.0);
        config.min_height = Some(480.0);
    }
    let window = WebviewWindowBuilder::from_config(app, &config)
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;
    Ok((window, label, false))
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


// ── 탭을 끌어 창을 떼어 내고 붙이기 ─────────────────────────────────────────────
//
// 크롬 탭처럼: 탭을 창 밖으로 끌면 새 창이 마우스 밑에 나타나 따라오고, 놓은 자리가 다른 IWAE 창의 탭 줄이면 그 창에 붙는다.
// 마우스 위치와 버튼은 웹뷰가 아니라 여기(운영체제)에서 읽는다 — 새 창이 생기며 포커스가 옮겨 가도 끌기가 끊기지 않게.
// 웹뷰의 포인터 캡처는 창을 벗어나면 믿을 수 없다. 좌표는 모두 물리 픽셀(화면 전체 기준)이다.

/// 창 안 탭 줄 한 칸(패널 하나의 탭 줄). 창의 안쪽 왼쪽 위에서 잰 물리 픽셀
#[derive(Clone, Debug, Deserialize)]
pub struct TabZone {
    pub pane: String,
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

struct DragFeed {
    /// 웹뷰가 알려 준 화면 좌표(source = "js" 일 때: 시험, 마우스 버튼을 못 읽는 환경)
    pos: Option<(f64, f64)>,
    released: bool,
    cancelled: bool,
    js: bool,
}

#[derive(Default)]
pub struct TabDragState {
    zones: Mutex<HashMap<String, Vec<TabZone>>>,
    feed: Mutex<Option<Arc<Mutex<DragFeed>>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginTabDrag {
    /// "new": doc_id 의 PDF 를 떼어 낸 새 창을 끌고 간다 · "self": 이 창을 통째로 끌고 간다
    pub mode: String,
    pub doc_id: Option<String>,
    pub query: Option<String>,
    /// new: 새 창 안에서 마우스가 놓일 자리(왼쪽 위에서, 물리 픽셀)
    pub grab_x: Option<f64>,
    pub grab_y: Option<f64>,
    /// "js": 좌표·놓음을 웹뷰가 알려 준다
    pub source: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

#[derive(Serialize)]
pub struct BeginTabDragResult {
    pub label: String,
    /// 같은 문서의 떼어 낸 창이 이미 있어 그 창을 앞으로 가져왔다(끌기는 시작하지 않았다)
    pub existing: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TabHover {
    source: String,
    pane: String,
    /// 대상 창의 안쪽 왼쪽 위에서 잰 CSS 픽셀
    x: f64,
    y: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TabReleased {
    dragged: String,
    target: Option<String>,
    pane: Option<String>,
    x: f64,
    y: f64,
}

pub const TAB_HOVER_EVENT: &str = "iwae:tab-hover";
pub const TAB_HOVER_END_EVENT: &str = "iwae:tab-hover-end";
pub const TAB_RELEASED_EVENT: &str = "iwae:tab-drag-released";
pub const TAB_ZONES_REQUEST_EVENT: &str = "iwae:tab-zones-request";

#[cfg(windows)]
fn left_button_down() -> bool {
    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(vkey: i32) -> i16;
        fn GetSystemMetrics(index: i32) -> i32;
    }
    // 왼손잡이 설정(버튼 바꿈)이면 물리 왼쪽 버튼이 VK_RBUTTON 으로 읽힌다
    const SM_SWAPBUTTON: i32 = 23;
    const VK_LBUTTON: i32 = 0x01;
    const VK_RBUTTON: i32 = 0x02;
    unsafe {
        let key = if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON };
        (GetAsyncKeyState(key) as u16 & 0x8000) != 0
    }
}

#[cfg(not(windows))]
fn left_button_down() -> bool {
    // 다른 운영체제는 웹뷰가 놓음을 알려 준다(tab_drag_end)
    true
}

/// 창이 화면에서 얼마나 위에 있는가(0 이 맨 위). Windows 만 안다 — 겹친 창 가운데 눈에 보이는 쪽을 가리려고 쓴다
#[cfg(windows)]
fn z_rank(window: &tauri::WebviewWindow) -> usize {
    extern "system" {
        fn GetWindow(hwnd: isize, cmd: u32) -> isize;
    }
    const GW_HWNDPREV: u32 = 3;
    let Ok(hwnd) = window.hwnd() else { return usize::MAX };
    let mut current = hwnd.0 as isize;
    let mut rank = 0;
    while rank < 4096 {
        let above = unsafe { GetWindow(current, GW_HWNDPREV) };
        if above == 0 {
            break;
        }
        current = above;
        rank += 1;
    }
    rank
}

#[cfg(not(windows))]
fn z_rank(_window: &tauri::WebviewWindow) -> usize {
    0
}

/// 화면 점 (x, y) 가 dragged 가 아닌 IWAE 창의 탭 줄 위인가. (label, pane, 창 안 CSS 좌표)
/// 창들이 겹쳐 있으면 맨 위 창만 본다 — 그 창이 점을 덮고 있는데 탭 줄이 아니면 아래 창의 탭 줄은 가려진 것이다
fn tab_zone_at(app: &AppHandle, zones: &HashMap<String, Vec<TabZone>>, dragged: &str, x: f64, y: f64) -> Option<(String, String, f64, f64)> {
    let mut windows: Vec<(usize, String, tauri::WebviewWindow)> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, window)| {
            label != dragged && !window.is_minimized().unwrap_or(false) && window.is_visible().unwrap_or(true)
        })
        .map(|(label, window)| (z_rank(&window), label, window))
        .collect();
    windows.sort_by_key(|(rank, _, _)| *rank);
    for (_, label, window) in windows {
        let (Ok(origin), Ok(size)) = (window.inner_position(), window.inner_size()) else { continue };
        let (ox, oy) = (origin.x as f64, origin.y as f64);
        if x < ox || y < oy || x >= ox + size.width as f64 || y >= oy + size.height as f64 {
            continue;
        }
        let scale = window.scale_factor().unwrap_or(1.0).max(0.1);
        let list = zones.get(&label)?;
        return list
            .iter()
            .find(|zone| x >= ox + zone.left && x < ox + zone.left + zone.width && y >= oy + zone.top && y < oy + zone.top + zone.height)
            .map(|zone| (label.clone(), zone.pane.clone(), (x - ox) / scale, (y - oy) / scale));
    }
    None
}

/// 각 창이 자기 탭 줄 자리를 알려 준다(창 안쪽 왼쪽 위 기준, 물리 픽셀). 끌기가 시작될 때 모든 창에 요청한다
#[tauri::command]
pub fn report_tab_zones(window: tauri::WebviewWindow, state: State<'_, TabDragState>, zones: Vec<TabZone>) {
    if let Ok(mut all) = state.zones.lock() {
        all.insert(window.label().to_string(), zones);
    }
}

/// 탭 끌기를 시작한다: 끄는 창(새로 떼어 낸 창이거나 이 창 자신)이 마우스를 따라 움직이고,
/// 마우스를 놓으면 `iwae:tab-drag-released` 를 이 창에 보낸다
#[tauri::command]
pub async fn begin_tab_drag(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, TabDragState>,
    args: BeginTabDrag,
) -> Result<BeginTabDragResult, String> {
    let js = args.source.as_deref() == Some("js");
    let start = if js {
        args.x.zip(args.y)
    } else {
        app.cursor_position().ok().map(|p| (p.x, p.y))
    }
    .ok_or_else(|| "cursor position unavailable".to_string())?;

    // 이전 끌기가 남아 있으면 끝낸다
    if let Ok(mut slot) = state.feed.lock() {
        if let Some(old) = slot.take() {
            if let Ok(mut old) = old.lock() {
                old.cancelled = true;
            }
        }
    }

    let (dragged, grab) = match args.mode.as_str() {
        "new" => {
            let doc = args.doc_id.clone().ok_or_else(|| "doc_id is required".to_string())?;
            let query = args.query.clone().unwrap_or_default();
            let (created, label, existing) = build_app_window(&app, "detached", Some(doc), &query, false)?;
            if existing {
                focus(&created);
                return Ok(BeginTabDragResult { label, existing: true });
            }
            (created, (args.grab_x.unwrap_or(60.0), args.grab_y.unwrap_or(18.0)))
        }
        "self" => {
            let origin = window.outer_position().map_err(|error| error.to_string())?;
            (window.clone(), (start.0 - origin.x as f64, start.1 - origin.y as f64))
        }
        other => return Err(format!("unknown drag mode: {other}")),
    };
    let label = dragged.label().to_string();
    let _ = dragged.set_position(PhysicalPosition::new((start.0 - grab.0).round() as i32, (start.1 - grab.1).round() as i32));
    if args.mode == "new" {
        focus(&dragged);
    }

    // 다른 창들에게 탭 줄 자리를 물어 둔다(답은 report_tab_zones 로 온다)
    if let Ok(mut all) = state.zones.lock() {
        all.clear();
    }
    for other in app.webview_windows().keys() {
        if *other != label {
            let _ = app.emit_to(other.as_str(), TAB_ZONES_REQUEST_EVENT, ());
        }
    }

    let feed = Arc::new(Mutex::new(DragFeed { pos: Some(start), released: false, cancelled: false, js }));
    if let Ok(mut slot) = state.feed.lock() {
        *slot = Some(feed.clone());
    }
    let initiator = window.label().to_string();
    let thread_app = app.clone();
    let result_label = label.clone();
    std::thread::spawn(move || {
        let mut hovered: Option<String> = None;
        let mut last_sent: Option<(String, i64, i64)> = None;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(8));
            let (pos, released, cancelled) = match feed.lock() {
                Ok(feed) => {
                    let pos = if feed.js { feed.pos } else { thread_app.cursor_position().ok().map(|p| (p.x, p.y)) };
                    let released = feed.released || (!feed.js && !left_button_down());
                    (pos, released, feed.cancelled)
                }
                Err(_) => break,
            };
            if cancelled {
                break;
            }
            let Some((x, y)) = pos else { continue };
            let _ = dragged.set_position(PhysicalPosition::new((x - grab.0).round() as i32, (y - grab.1).round() as i32));
            let hit = thread_app
                .try_state::<TabDragState>()
                .and_then(|state| state.zones.lock().ok().map(|zones| tab_zone_at(&thread_app, &zones, &label, x, y)))
                .flatten();
            // 대상 창이 바뀌면 이전 창에는 「벗어났다」, 새 창에는 「들어왔다」(자리가 바뀔 때마다 알린다)
            let target_label = hit.as_ref().map(|(l, _, _, _)| l.clone());
            if let Some(old_label) = &hovered {
                if target_label.as_deref() != Some(old_label.as_str()) {
                    let _ = thread_app.emit_to(old_label.as_str(), TAB_HOVER_END_EVENT, ());
                    hovered = None;
                    last_sent = None;
                }
            }
            if let Some((target, pane, rel_x, rel_y)) = &hit {
                let key = (target.clone(), rel_x.round() as i64 / 4, rel_y.round() as i64 / 4);
                if last_sent.as_ref() != Some(&key) {
                    last_sent = Some(key);
                    let _ = thread_app.emit_to(
                        target.as_str(),
                        TAB_HOVER_EVENT,
                        TabHover { source: label.clone(), pane: pane.clone(), x: *rel_x, y: *rel_y },
                    );
                }
                hovered = Some(target.clone());
            }
            if released {
                if let Some(old_label) = &hovered {
                    let _ = thread_app.emit_to(old_label.as_str(), TAB_HOVER_END_EVENT, ());
                }
                let (target, pane, rel_x, rel_y) = match hit {
                    Some((target, pane, x, y)) => (Some(target), Some(pane), x, y),
                    None => (None, None, 0.0, 0.0),
                };
                let _ = thread_app.emit_to(
                    initiator.as_str(),
                    TAB_RELEASED_EVENT,
                    TabReleased { dragged: label.clone(), target, pane, x: rel_x, y: rel_y },
                );
                break;
            }
        }
        if let Some(state) = thread_app.try_state::<TabDragState>() {
            if let Ok(mut slot) = state.feed.lock() {
                if slot.as_ref().is_some_and(|current| Arc::ptr_eq(current, &feed)) {
                    *slot = None;
                }
            }
        }
    });
    Ok(BeginTabDragResult { label: result_label, existing: false })
}

/// source = "js" 일 때 마우스 자리(화면 물리 좌표)를 알린다
#[tauri::command]
pub fn tab_drag_move(state: State<'_, TabDragState>, x: f64, y: f64) {
    if let Ok(slot) = state.feed.lock() {
        if let Some(feed) = slot.as_ref() {
            if let Ok(mut feed) = feed.lock() {
                feed.pos = Some((x, y));
            }
        }
    }
}

/// 마우스를 놓았다(웹뷰가 알림) / 끌기를 취소한다
#[tauri::command]
pub fn tab_drag_end(state: State<'_, TabDragState>, cancel: Option<bool>) {
    if let Ok(slot) = state.feed.lock() {
        if let Some(feed) = slot.as_ref() {
            if let Ok(mut feed) = feed.lock() {
                if cancel.unwrap_or(false) {
                    feed.cancelled = true;
                } else {
                    feed.released = true;
                }
            }
        }
    }
}

/// 떼어 낸 창·새 창 하나를 닫는다(탭을 다른 창에 붙인 뒤). 저장은 부른 쪽이 끝낸 뒤에 부른다
#[tauri::command]
pub fn destroy_app_window(app: AppHandle, label: String) -> Result<(), String> {
    if label == MAIN_LABEL || !(label.starts_with("detached-") || label.starts_with("window-")) {
        return Err(format!("not a closable window: {label}"));
    }
    if let Some(window) = app.get_webview_window(&label) {
        window.destroy().map_err(|error| error.to_string())?;
    }
    Ok(())
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
