//! 파일을 클립보드에 「파일」로 올린다(탐색기·메일·메신저에서 Ctrl+V 하면 파일이 붙는다).
//! Windows 는 PowerShell 의 `Set-Clipboard -LiteralPath` 가 파일 목록(CF_HDROP)을 만든다 — 새 의존성 없이 쓴다.

use std::path::Path;

/// 붙여 넣을 수 있는 파일인가: 실제 파일이고 PDF(또는 Markdown) 다
fn validate(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err(tr!("파일을 찾을 수 없습니다: {}", "File not found: {}", path.display()));
    }
    let is_pdf = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ["pdf", "md", "markdown"].iter().any(|allowed| ext.eq_ignore_ascii_case(allowed)));
    if !is_pdf {
        return Err(tr!("PDF·Markdown 파일만 복사할 수 있습니다.", "Only PDF and Markdown files can be copied."));
    }
    Ok(())
}

/// PowerShell 작은따옴표 문자열: 안의 ' 는 '' 로
#[cfg_attr(not(windows), allow(dead_code))]
fn ps_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

#[tauri::command]
pub fn copy_file_to_clipboard(path: String) -> Result<(), String> {
    let file = Path::new(&path);
    validate(file)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let script = format!("Set-Clipboard -LiteralPath {}", ps_quote(&path));
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|err| tr!("클립보드에 넣지 못했습니다: {err}", "Could not copy to the clipboard: {err}"))?;
        if !output.status.success() {
            return Err(tr!(
                "클립보드에 넣지 못했습니다: {}",
                "Could not copy to the clipboard: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        // JavaScript for Automation 으로 NSPasteboard 에 파일 URL 을 올린다(Finder·메일에서 ⌘V 하면 파일이 붙는다)
        let script = format!(
            "ObjC.import('AppKit'); var pb = $.NSPasteboard.generalPasteboard; pb.clearContents; \
             if (!pb.writeObjects($([$.NSURL.fileURLWithPath({})]))) {{ throw new Error('pasteboard') }}",
            js_quote(&path)
        );
        let output = std::process::Command::new("osascript")
            .args(["-l", "JavaScript", "-e", &script])
            .output()
            .map_err(|err| tr!("클립보드에 넣지 못했습니다: {err}", "Could not copy to the clipboard: {err}"))?;
        if !output.status.success() {
            return Err(tr!(
                "클립보드에 넣지 못했습니다: {}",
                "Could not copy to the clipboard: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Err(tr!("이 기능은 Windows·macOS 에서만 됩니다.", "This feature is only available on Windows and macOS."))
    }
}

/// JavaScript 큰따옴표 문자열(osascript -l JavaScript 에 넘긴다). 역슬래시·따옴표·줄바꿈을 막는다
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn js_quote(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for ch in text.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_paths_for_javascript() {
        assert_eq!(js_quote(r#"/Users/me/"a"\b.pdf"#), r#""/Users/me/\"a\"\\b.pdf""#);
        assert_eq!(js_quote("a\nb"), r#""a\nb""#);
    }

    #[test]
    fn quotes_single_quotes_for_powershell() {
        assert_eq!(ps_quote(r"C:\a\it's.pdf"), r"'C:\a\it''s.pdf'");
    }

    #[test]
    fn rejects_missing_and_non_pdf_files() {
        let dir = std::env::temp_dir().join(format!("iwae-clip-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let text = dir.join("a.txt");
        std::fs::write(&text, "x").unwrap();
        assert!(validate(&dir.join("none.pdf")).is_err());
        assert!(validate(&text).is_err());
        let pdf = dir.join("b.PDF");
        std::fs::write(&pdf, "%PDF").unwrap();
        assert!(validate(&pdf).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }
}
