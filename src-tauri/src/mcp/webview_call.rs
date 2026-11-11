//! MCP 도구가 웹뷰에 일을 맡기고 답을 기다리는 통로.
//!
//! 캔버스처럼 상태가 웹뷰에 있는 것은 Rust 가 직접 고치면 열린 화면과 어긋난다. 그래서
//! `mcp-webview-request` 이벤트로 웹뷰에 요청을 보내고, 웹뷰가 `mcp_webview_reply` 로 답할 때까지
//! (MCP 서버 스레드에서) 기다린다. 웹뷰가 답하지 않으면 시간 제한으로 끝낸다.
//!
//! - 쓰기(class 가 read 가 아닌 것)는 뮤텍스로 한 번에 하나씩 웹뷰에 간다. 읽기는 나란히.
//! - 웹뷰가 시작할 때 `mcp_webview_ops` 로 처리할 수 있는 op 를 알린다. 모르는 op 는 시간 제한을
//!   기다리지 않고 바로 "unsupported op" 오류가 된다(옛 웹뷰는 접두사 memo_/note_/source_ 만 받는다).

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::Emitter;

type Reply = Result<Value, String>;

fn pending() -> &'static Mutex<HashMap<u64, Sender<Reply>>> {
    static PENDING: OnceLock<Mutex<HashMap<u64, Sender<Reply>>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WebviewRequest<'a> {
    request_id: u64,
    op: &'a str,
    args: &'a Value,
    /// "read" | "write" | "destructive" | "ui" — 웹뷰가 undo 묶음과 AI 활동 표시를 정하는 데 쓴다
    class: &'a str,
}

/// 웹뷰가 `mcp_webview_ops` 로 알려 준 처리 가능한 op. None 이면 아직 알리지 않은 것(옛 웹뷰·시작 중).
fn supported() -> &'static Mutex<Option<HashSet<String>>> {
    static SUPPORTED: OnceLock<Mutex<Option<HashSet<String>>>> = OnceLock::new();
    SUPPORTED.get_or_init(|| Mutex::new(None))
}

/// 웹뷰의 쓰기는 한 번에 하나씩(읽기는 나란히).
fn write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// 옛 웹뷰는 이 접두사의 op 만 받는다(나머지는 답 없이 버린다).
const LEGACY_PREFIXES: [&str; 3] = ["memo_", "note_", "source_"];

/// 이 op 를 웹뷰가 받을 수 있는지. 받지 못하면 시간 제한을 기다리지 않고 바로 알린다.
pub fn op_supported(ops: Option<&HashSet<String>>, op: &str) -> bool {
    match ops {
        Some(set) => set.contains(op),
        None => LEGACY_PREFIXES.iter().any(|prefix| op.starts_with(prefix)),
    }
}

fn unsupported_message(op: &str) -> String {
    format!(
        "unsupported op: this running IWAE window does not implement '{op}' yet (or is still starting). Update/restart IWAE, or use another tool."
    )
}

/// 웹뷰가 처리할 수 있는 op 목록을 알린다(창이 뜰 때마다, 요청 리스너를 단 뒤에 한 번).
#[tauri::command]
pub fn mcp_webview_ops(ops: Vec<String>) {
    if let Ok(mut guard) = supported().lock() {
        *guard = Some(ops.into_iter().collect());
    }
}

/// 웹뷰에 `op` 를 맡기고 답을 기다린다(쓰기로 취급: 한 번에 하나).
pub fn call(app: &tauri::AppHandle, op: &str, args: &Value, timeout: Duration) -> Reply {
    call_class(app, op, args, "write", timeout)
}

/// `class`("read" 는 나란히, 그 밖에는 한 번에 하나)와 함께 웹뷰에 `op` 를 맡긴다.
pub fn call_class(app: &tauri::AppHandle, op: &str, args: &Value, class: &str, timeout: Duration) -> Reply {
    let known = supported().lock().ok().and_then(|guard| guard.clone());
    if !op_supported(known.as_ref(), op) {
        return Err(unsupported_message(op));
    }
    // 쓰기는 하나씩: 앞 쓰기가 끝나야 다음이 웹뷰에 간다
    let _guard = if class == "read" {
        None
    } else {
        Some(write_lock().lock().unwrap_or_else(|poisoned| poisoned.into_inner()))
    };
    let request_id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = mpsc::channel();
    pending()
        .lock()
        .map_err(|_| "요청 목록을 잠그지 못했습니다.".to_string())?
        .insert(request_id, sender);
    // 바깥 AI 의 요청은 메인 창이 받는다(창마다 메모리 상태가 달라 여럿이 답하면 어느 답이 쓰일지 알 수 없다)
    let sent = app.emit_to(
        crate::windows::MAIN_LABEL,
        "mcp-webview-request",
        WebviewRequest { request_id, op, args, class },
    );
    if let Err(err) = sent {
        forget(request_id);
        return Err(format!("IWAE 화면에 요청을 보내지 못했습니다: {err}"));
    }
    let reply = receiver.recv_timeout(timeout);
    forget(request_id);
    reply.unwrap_or_else(|_| {
        Err("IWAE 화면이 제때 답하지 않았습니다. 앱이 켜져 있고 Vault 가 열려 있는지 확인하세요.".into())
    })
}

fn forget(request_id: u64) {
    if let Ok(mut map) = pending().lock() {
        map.remove(&request_id);
    }
}

/// 웹뷰의 답. 기다리던 요청이 없으면(시간이 지났으면) 버린다.
#[tauri::command]
pub fn mcp_webview_reply(request_id: u64, ok: bool, result: Option<Value>, error: Option<String>) {
    let sender = pending().lock().ok().and_then(|mut map| map.remove(&request_id));
    if let Some(sender) = sender {
        let reply = if ok {
            Ok(result.unwrap_or(Value::Null))
        } else {
            Err(error.unwrap_or_else(|| "IWAE 화면에서 실패했습니다.".into()))
        };
        let _ = sender.send(reply);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unregistered_webviews_only_get_legacy_ops_and_registered_ones_get_their_list() {
        assert!(op_supported(None, "memo_add"));
        assert!(op_supported(None, "note_create"));
        assert!(!op_supported(None, "app_state"));
        let set: HashSet<String> = ["app_state".to_string()].into_iter().collect();
        assert!(op_supported(Some(&set), "app_state"));
        assert!(!op_supported(Some(&set), "memo_add"));
        assert!(unsupported_message("goto").starts_with("unsupported op"));
    }

    #[test]
    fn reply_reaches_waiting_request() {
        let (sender, receiver) = mpsc::channel();
        pending().lock().unwrap().insert(9_999_001, sender);
        mcp_webview_reply(9_999_001, true, Some(serde_json::json!({"a": 1})), None);
        assert_eq!(receiver.recv().unwrap().unwrap()["a"], 1);
        assert!(!pending().lock().unwrap().contains_key(&9_999_001));
    }

    #[test]
    fn failure_carries_message_and_unknown_ids_are_ignored() {
        let (sender, receiver) = mpsc::channel();
        pending().lock().unwrap().insert(9_999_002, sender);
        mcp_webview_reply(9_999_002, false, None, Some("없음".into()));
        assert_eq!(receiver.recv().unwrap().unwrap_err(), "없음");
        mcp_webview_reply(9_999_003, true, None, None);
    }
}
