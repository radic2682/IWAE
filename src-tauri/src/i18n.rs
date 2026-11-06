//! 앱이 사용자에게 보여 주는 글(오류, 창 제목 등)의 언어. 프런트엔드가 시작할 때 `set_locale` 로 정한다.
//! 정하기 전에는 설치기에서 고른 언어를, 그것도 없으면 한국어를 쓴다.

use std::sync::atomic::{AtomicU8, Ordering};

const KO: u8 = 0;
const EN: u8 = 1;

static LOCALE: AtomicU8 = AtomicU8::new(KO);

/// "en", "en-US" … 이면 영어, 그 밖에는 한국어
fn parse_is_en(locale: &str) -> bool {
    locale.trim().to_ascii_lowercase().starts_with("en")
}

pub fn set(locale: &str) {
    LOCALE.store(if parse_is_en(locale) { EN } else { KO }, Ordering::Relaxed);
}

pub fn is_en() -> bool {
    LOCALE.load(Ordering::Relaxed) == EN
}

/// 설치기에서 고른 언어로 시작값을 정한다(프런트엔드의 `set_locale` 가 나중에 덮는다).
pub fn init_from_installer() {
    if let Some(locale) = crate::locale::installer_language() {
        set(&locale);
    }
}

/// 프런트엔드가 시작할 때와 언어를 바꿀 때 부른다. `invoke('set_locale', { locale: 'en' | 'ko' })`
#[tauri::command]
pub fn set_locale(locale: String) {
    set(&locale);
}

/// `tr!("한국어 {x}", "English {x}", 인자...)` → 현재 언어의 `String`. 인자는 `format!` 과 같다.
#[macro_export]
macro_rules! tr {
    ($($t:tt)+) => {
        $crate::tr_in!($crate::i18n::is_en(), $($t)+)
    };
}

/// `tr!` 의 속. 언어 깃발을 직접 받는다(시험용).
#[doc(hidden)]
#[macro_export]
macro_rules! tr_in {
    ($en_flag:expr, $ko:literal, $en:literal $(,)?) => {
        if $en_flag { format!($en) } else { format!($ko) }
    };
    ($en_flag:expr, $ko:literal, $en:literal, $($arg:tt)+) => {
        if $en_flag { format!($en, $($arg)+) } else { format!($ko, $($arg)+) }
    };
}

#[cfg(test)]
mod tests {
    use super::parse_is_en;

    #[test]
    fn tr_in_picks_language_by_flag() {
        let n = 3;
        let name = "a.pdf";
        assert_eq!(crate::tr_in!(false, "{n}개 {}", "{n} items {}", name), "3개 a.pdf");
        assert_eq!(crate::tr_in!(true, "{n}개 {}", "{n} items {}", name), "3 items a.pdf");
        assert_eq!(crate::tr_in!(false, "끝", "done"), "끝");
        assert_eq!(crate::tr_in!(true, "끝", "done"), "done");
    }

    #[test]
    fn tr_uses_default_korean() {
        // 시험은 기본(한국어) 언어로 돈다. 전역 값은 바꾸지 않는다.
        let n = 2;
        assert_eq!(crate::tr!("{} 개", "{} items", n), "2 개");
        assert_eq!(crate::tr!("{n}쪽", "page {n}"), "2쪽");
    }

    #[test]
    fn parses_locale_names() {
        assert!(parse_is_en("en"));
        assert!(parse_is_en("en-US"));
        assert!(!parse_is_en("ko"));
        assert!(!parse_is_en(""));
    }
}
