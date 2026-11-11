//! 바깥 AI 가 한꺼번에 너무 많이 쓰거나 읽지 못하게 하는 한도. 웹뷰로 넘기기 전에 Rust 에서 막는다.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

pub const MAX_MEMOS_PER_CALL: usize = 50;
pub const MAX_STEPS_PER_BUILD: usize = 100;
pub const MAX_IDS: usize = 200;
pub const MAX_TEXT_CHARS: usize = 20_000;
pub const MAX_TRANSLATE_CHARS: usize = 4_000;
pub const MAX_READ_PAGES: usize = 10;
pub const MAX_RESPONSE_BYTES: usize = 200_000;
pub const WRITES_PER_MINUTE: usize = 60;
pub const CHANGES_PER_SESSION: usize = 2_000;

/// 쓰기 호출 속도 제한(최근 1분 안에 WRITES_PER_MINUTE 번까지)과 세션 변경 총량.
pub struct Limits {
    window: Mutex<VecDeque<Instant>>,
    changes: Mutex<usize>,
}

impl Default for Limits {
    fn default() -> Self {
        Self::new()
    }
}

impl Limits {
    pub const fn new() -> Self {
        Self { window: Mutex::new(VecDeque::new()), changes: Mutex::new(0) }
    }

    /// `initialize` 마다 새 세션: 변경 총량을 비운다.
    pub fn new_session(&self) {
        if let Ok(mut changes) = self.changes.lock() {
            *changes = 0;
        }
    }

    /// 쓰기 한 번을 받아 줄 수 있으면 Ok. 아니면 몇 초 뒤에 다시 하라는 JSON 오류 글.
    pub fn take_write(&self, now: Instant, changes: usize) -> Result<(), String> {
        let mut window = self.window.lock().map_err(|_| "limiter poisoned".to_string())?;
        while window.front().is_some_and(|at| now.saturating_duration_since(*at) >= Duration::from_secs(60)) {
            window.pop_front();
        }
        if window.len() >= WRITES_PER_MINUTE {
            let oldest = *window.front().expect("non-empty");
            let wait = Duration::from_secs(60).saturating_sub(now.saturating_duration_since(oldest));
            let retry = wait.as_secs() + u64::from(wait.subsec_nanos() > 0);
            return Err(json!({
                "error": "rate_limited",
                "message": format!("More than {WRITES_PER_MINUTE} write calls in a minute. Batch your edits (note_build, memo_add arrays) and retry."),
                "retry_after_s": retry.max(1),
            })
            .to_string());
        }
        let mut total = self.changes.lock().map_err(|_| "limiter poisoned".to_string())?;
        if *total + changes > CHANGES_PER_SESSION {
            return Err(json!({
                "error": "session_change_limit",
                "message": format!("This MCP session already made {} changes (limit {CHANGES_PER_SESSION}). Ask the user to review with ai_changes and reconnect.", *total),
                "limit": CHANGES_PER_SESSION,
            })
            .to_string());
        }
        *total += changes;
        window.push_back(now);
        Ok(())
    }
}

pub fn global() -> &'static Limits {
    static GLOBAL: Limits = Limits::new();
    &GLOBAL
}

fn array_len(args: &Value, key: &str) -> usize {
    args.get(key).and_then(Value::as_array).map_or(0, Vec::len)
}

/// 호출 하나가 만들 변경 수의 어림(세션 총량에 센다).
pub fn estimate_changes(tool: &str, args: &Value) -> usize {
    match tool {
        "memo_add" => array_len(args, "memos").max(1),
        "memo_update" => array_len(args, "updates").max(1),
        "note_build" => array_len(args, "steps").max(1),
        "note_append" => array_len(args, "blocks").max(1),
        "memo_delete" | "note_delete_blocks" | "note_move_blocks" | "memo_move_to_note" => array_len(args, "ids").max(1),
        _ => 1,
    }
}

fn too_long(value: &Value, limit: usize, path: &str) -> Option<String> {
    match value {
        Value::String(text) if text.chars().count() > limit => Some(path.to_string()),
        Value::Array(items) => items.iter().enumerate().find_map(|(i, item)| too_long(item, limit, &format!("{path}[{i}]"))),
        Value::Object(map) => map.iter().find_map(|(key, item)| {
            if matches!(key.as_str(), "markdown" | "html" | "text" | "note" | "quote") || item.is_array() || item.is_object() {
                too_long(item, limit, &format!("{path}.{key}"))
            } else {
                None
            }
        }),
        _ => None,
    }
}

/// 호출 전 검사. 한도를 넘으면 무엇을 어떻게 줄이라는 글을 돌려준다.
pub fn check_args(tool: &str, args: &Value) -> Result<(), String> {
    let list_caps: &[(&str, usize)] = match tool {
        "memo_add" => &[("memos", MAX_MEMOS_PER_CALL)],
        "memo_update" => &[("updates", MAX_MEMOS_PER_CALL)],
        "note_build" => &[("steps", MAX_STEPS_PER_BUILD)],
        "note_append" => &[("blocks", MAX_STEPS_PER_BUILD)],
        _ => &[],
    };
    for (key, cap) in list_caps {
        let len = array_len(args, key);
        if len > *cap {
            return Err(format!("{key} has {len} entries; at most {cap} per call. Split it into several calls."));
        }
    }
    let ids = array_len(args, "ids").max(array_len(args, "block_ids"));
    if ids > MAX_IDS {
        return Err(format!("ids has {ids} entries; at most {MAX_IDS} per call."));
    }
    if tool == "translate_text" {
        let len = args.get("text").and_then(Value::as_str).map_or(0, |text| text.chars().count());
        if len > MAX_TRANSLATE_CHARS {
            return Err(format!("text is {len} characters; translate_text takes at most {MAX_TRANSLATE_CHARS}. Split it."));
        }
        return Ok(());
    }
    if let Some(path) = too_long(args, MAX_TEXT_CHARS, "args") {
        return Err(format!("{path} is longer than {MAX_TEXT_CHARS} characters. Split the text into several blocks."));
    }
    Ok(())
}

/// 응답이 상한을 넘으면 잘라 앞부분만 주고 줄이는 법을 알린다.
pub fn cap_response(value: Value) -> Value {
    let text = value.to_string();
    if text.len() <= MAX_RESPONSE_BYTES {
        return value;
    }
    let mut end = MAX_RESPONSE_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    json!({
        "truncated": true,
        "original_bytes": text.len(),
        "returned_bytes": end,
        "hint": "Response was cut at 200 KB. Narrow the request (from/limit/page filters, include_text:false) and call again.",
        "preview_json_prefix": &text[..end],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sixty_first_write_in_a_minute_is_refused_with_retry_after() {
        let limits = Limits::new();
        let start = Instant::now();
        for _ in 0..WRITES_PER_MINUTE {
            limits.take_write(start, 1).unwrap();
        }
        let refused: Value = serde_json::from_str(&limits.take_write(start + Duration::from_secs(10), 1).unwrap_err()).unwrap();
        assert_eq!(refused["error"], "rate_limited");
        assert_eq!(refused["retry_after_s"], 50);
        assert!(limits.take_write(start + Duration::from_secs(61), 1).is_ok());
    }

    #[test]
    fn session_change_total_is_capped_and_resets_on_a_new_session() {
        let limits = Limits::new();
        let now = Instant::now();
        limits.take_write(now, 1_990).unwrap();
        assert!(limits.take_write(now, 11).unwrap_err().contains("session_change_limit"));
        limits.new_session();
        assert!(limits.take_write(now, 11).is_ok());
    }

    #[test]
    fn caps_reject_big_calls_before_the_webview() {
        let memos: Vec<Value> = (0..51).map(|_| json!({})).collect();
        assert!(check_args("memo_add", &json!({"memos": memos})).unwrap_err().contains("at most 50"));
        let steps: Vec<Value> = (0..101).map(|_| json!({"section": "x"})).collect();
        assert!(check_args("note_build", &json!({"steps": steps})).is_err());
        let ids: Vec<Value> = (0..201).map(|i| json!(i.to_string())).collect();
        assert!(check_args("memo_delete", &json!({"ids": ids})).is_err());
        let long = "가".repeat(20_001);
        assert!(check_args("note_append", &json!({"blocks": [{"kind": "text", "markdown": long}]})).is_err());
        assert!(check_args("note_append", &json!({"blocks": [{"kind": "text", "markdown": "가".repeat(20_000)}]})).is_ok());
        assert!(check_args("translate_text", &json!({"text": "a".repeat(4_001)})).is_err());
        assert!(check_args("translate_text", &json!({"text": "a".repeat(4_000)})).is_ok());
    }

    #[test]
    fn oversized_responses_are_truncated_on_a_char_boundary() {
        let big = json!({"text": "가".repeat(100_000)});
        let capped = cap_response(big);
        assert_eq!(capped["truncated"], true);
        assert!(capped["preview_json_prefix"].as_str().unwrap().len() <= MAX_RESPONSE_BYTES);
        assert_eq!(cap_response(json!({"a": 1})), json!({"a": 1}));
    }

    #[test]
    fn change_estimates_follow_the_list_sizes() {
        assert_eq!(estimate_changes("memo_add", &json!({"memos": [{}, {}, {}]})), 3);
        assert_eq!(estimate_changes("note_rename", &json!({})), 1);
    }
}
