//! 설치기에서 고른 언어. NSIS 갈고리가 앱 폴더에 `installer-language`(LCID)를 남긴다.

/// LCID 글 → 앱 언어. 1042 = 한국어, 1033 등 나머지 = 영어
pub fn locale_from_lcid(text: &str) -> Option<&'static str> {
    match text.trim().parse::<u32>().ok()? {
        1042 => Some("ko"),
        _ => Some("en"),
    }
}

/// 설치할 때 고른 언어("ko" | "en"). 설치판이 아니거나(개발 실행) 파일이 없으면 None
#[tauri::command]
pub fn installer_language() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let text = std::fs::read_to_string(exe.parent()?.join("installer-language")).ok()?;
    locale_from_lcid(&text).map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::locale_from_lcid;

    #[test]
    fn maps_installer_lcid_to_app_locale() {
        assert_eq!(locale_from_lcid("1042"), Some("ko"));
        assert_eq!(locale_from_lcid("1033\n"), Some("en"));
        assert_eq!(locale_from_lcid("oops"), None);
    }
}
