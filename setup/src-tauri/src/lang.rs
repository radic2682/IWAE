#![allow(dead_code)]
//! Setup language: default choice and the installer-language file the NSIS installer also uses.

use std::fs;
use std::io;
use std::path::Path;

const FILE_NAME: &str = "installer-language";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Ko,
    En,
}

impl Lang {
    pub fn lcid(self) -> u16 {
        match self {
            Lang::Ko => 1042,
            Lang::En => 1033,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Lang::Ko => "ko",
            Lang::En => "en",
        }
    }
}

/// Saved file content wins when it is a known LCID; otherwise the Windows UI language decides.
pub fn default_lang(installer_language_file: Option<&str>, windows_ui_lang: u16) -> Lang {
    if let Some(text) = installer_language_file {
        let cleaned = text.trim().trim_start_matches('\u{feff}').trim();
        match cleaned.parse::<u16>() {
            Ok(1042) => return Lang::Ko,
            Ok(1033) => return Lang::En,
            _ => {}
        }
    }
    if windows_ui_lang == 0x12 {
        Lang::Ko
    } else {
        Lang::En
    }
}

pub fn read_installer_language(install_dir: &Path) -> Option<String> {
    fs::read_to_string(install_dir.join(FILE_NAME)).ok()
}

/// ASCII digits only: no BOM, no trailing newline.
pub fn write_installer_language(install_dir: &Path, lang: Lang) -> io::Result<()> {
    fs::create_dir_all(install_dir)?;
    fs::write(install_dir.join(FILE_NAME), lang.lcid().to_string())
}

/// Primary language id (low 10 bits) of the user's Windows UI language.
#[cfg(windows)]
pub fn windows_ui_language() -> u16 {
    // SAFETY: no arguments, no pointers; plain kernel32 query.
    let langid = unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() };
    langid & 0x3ff
}

#[cfg(not(windows))]
pub fn windows_ui_language() -> u16 {
    0x09
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_lang_cases() {
        assert_eq!(default_lang(Some("1042"), 0x09), Lang::Ko);
        assert_eq!(default_lang(Some("\u{feff}1033"), 0x12), Lang::En);
        assert_eq!(default_lang(Some("garbage"), 0x12), Lang::Ko);
        assert_eq!(default_lang(None, 0x12), Lang::Ko);
        assert_eq!(default_lang(None, 0x09), Lang::En);
    }

    #[test]
    fn lcid_and_code() {
        assert_eq!(Lang::Ko.lcid(), 1042);
        assert_eq!(Lang::En.lcid(), 1033);
        assert_eq!(Lang::Ko.code(), "ko");
        assert_eq!(Lang::En.code(), "en");
    }

    #[test]
    fn language_file_round_trip() {
        let dir = std::env::temp_dir().join(format!("iwae-setup-lang-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        write_installer_language(&dir, Lang::Ko).unwrap();
        assert_eq!(read_installer_language(&dir).as_deref(), Some("1042"));
        let _ = fs::remove_dir_all(&dir);
    }
}
