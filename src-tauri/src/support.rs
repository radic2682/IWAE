//! 문제 보고용 앱 기록. 로그 파일의 끝부분만 읽어 돌려준다(보내는 일은 하지 않는다 — 화면에서 사용자가 미리 보고 직접 낸다).

use std::io::{Read, Seek, SeekFrom};
use tauri::Manager;

/// 읽을 최대 바이트(파일 끝에서부터). 로그는 1MB 안팎에서 돌려 쓴다
const TAIL_BYTES: u64 = 192 * 1024;

pub fn tail_lines(text: &str, max_lines: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\n")
}

#[tauri::command]
pub fn support_log_tail(app: tauri::AppHandle, max_lines: Option<usize>) -> Result<String, String> {
    let dir = app.path().app_log_dir().map_err(|error| error.to_string())?;
    let path = dir.join("iwae.log");
    let Ok(mut file) = std::fs::File::open(&path) else { return Ok(String::new()) };
    let len = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    let start = len.saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    file.take(TAIL_BYTES).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    let text = String::from_utf8_lossy(&bytes);
    // 중간에서 잘린 첫 줄은 버린다
    let text = if start > 0 { text.split_once('\n').map(|(_, rest)| rest).unwrap_or("") } else { &text };
    Ok(tail_lines(text, max_lines.unwrap_or(200).min(1000)))
}

#[cfg(test)]
mod tests {
    use super::tail_lines;

    #[test]
    fn keeps_only_the_last_lines() {
        assert_eq!(tail_lines("a\nb\nc\nd", 2), "c\nd");
        assert_eq!(tail_lines("a", 5), "a");
    }
}
