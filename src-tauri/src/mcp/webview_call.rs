//! MCP 도구가 웹뷰에 일을 맡기고 답을 기다리는 통로.
//!
//! 캔버스처럼 상태가 웹뷰에 있는 것은 Rust 가 직접 고치면 열린 화면과 어긋난다. 그래서
//! `mcp-webview-request` 이벤트로 웹뷰에 요청을 보내고, 웹뷰가 `mcp_webview_reply` 로 답할 때까지
//! (MCP 서버 스레드에서) 기다린다. 웹뷰가 답하지 않으면 시간 제한으로 끝낸다.

use std::collections::HashMap;
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
}

/// 웹뷰에 `op` 를 맡기고 답을 기다린다.
pub fn call(app: &tauri::AppHandle, op: &str, args: &Value, timeout: Duration) -> Reply {
    let request_id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = mpsc::channel();
    pending()
        .lock()
        .map_err(|_| "요청 목록을 잠그지 못했습니다.".to_string())?
        .insert(request_id, sender);
    let sent = app.emit("mcp-webview-request", WebviewRequest { request_id, op, args });
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
