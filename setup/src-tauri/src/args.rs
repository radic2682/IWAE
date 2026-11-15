#![allow(dead_code)]
//! Command line -> setup mode. argv[0] is not part of `args`.

use std::ffi::OsString;
use std::path::PathBuf;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct DemoFlags {
    pub enabled: bool,
    pub existing: Option<String>,
    pub running: bool,
    pub fail: bool,
}

#[derive(Debug, PartialEq)]
pub enum Mode {
    Install { demo: DemoFlags },
    /// /UPDATE present (with or without /P /R); `app_args` are everything after /ARGS.
    Update { app_args: Vec<OsString> },
    /// /S present, no /UPDATE.
    Silent { install_dir: Option<PathBuf> },
    Uninstall,
    /// `_?=` present: called by an old NSIS wizard.
    UninstallSync { args: Vec<OsString> },
    /// `--uninstall-from-temp <dir>`: self-copy relaunch.
    UninstallTemp { install_dir: PathBuf },
}

fn text(a: &OsString) -> String {
    a.to_string_lossy().into_owned()
}

fn is_flag(a: &OsString, flag: &str) -> bool {
    text(a).eq_ignore_ascii_case(flag)
}

pub fn parse_mode(args: &[OsString]) -> Mode {
    // Everything after /ARGS belongs to the app, so it must not be interpreted here.
    let args_pos = args.iter().position(|a| is_flag(a, "/ARGS"));
    let own = match args_pos {
        Some(i) => &args[..i],
        None => args,
    };

    if own.iter().any(|a| text(a).starts_with("_?=")) {
        return Mode::UninstallSync { args: args.to_vec() };
    }

    if let Some(i) = own.iter().position(|a| is_flag(a, "--uninstall-from-temp")) {
        if let Some(dir) = own.get(i + 1) {
            return Mode::UninstallTemp { install_dir: PathBuf::from(dir) };
        }
    }

    if own.iter().any(|a| is_flag(a, "--uninstall")) {
        return Mode::Uninstall;
    }

    if own.iter().any(|a| is_flag(a, "/UPDATE")) {
        let app_args = match args_pos {
            Some(i) => args[i + 1..].to_vec(),
            None => Vec::new(),
        };
        return Mode::Update { app_args };
    }

    if own.iter().any(|a| is_flag(a, "/S")) {
        // NSIS: /D= is last and unquoted, so Windows argv splitting may cut the path at
        // spaces. Rejoin the remainder with every following element, single-space separated.
        let install_dir = own.iter().enumerate().find_map(|(i, a)| {
            let t = text(a);
            if t.len() >= 3 && t.is_char_boundary(3) && t[..3].eq_ignore_ascii_case("/D=") {
                let mut path = t[3..].to_string();
                for rest in &own[i + 1..] {
                    path.push(' ');
                    path.push_str(&text(rest));
                }
                Some(PathBuf::from(path))
            } else {
                None
            }
        });
        return Mode::Silent { install_dir };
    }

    Mode::Install { demo: parse_demo(own) }
}

#[cfg(debug_assertions)]
fn parse_demo(args: &[OsString]) -> DemoFlags {
    let mut d = DemoFlags::default();
    for a in args {
        let t = text(a);
        if t == "--demo" {
            d.enabled = true;
        } else if let Some(v) = t.strip_prefix("--demo-existing=") {
            d.enabled = true;
            d.existing = Some(v.to_string());
        } else if t == "--demo-running" {
            d.enabled = true;
            d.running = true;
        } else if t == "--demo-fail" {
            d.enabled = true;
            d.fail = true;
        }
    }
    d
}

// Release builds never honour --demo*.
#[cfg(not(debug_assertions))]
fn parse_demo(_args: &[OsString]) -> DemoFlags {
    DemoFlags::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<OsString> {
        items.iter().map(|s| OsString::from(*s)).collect()
    }

    #[test]
    fn empty_is_install() {
        assert_eq!(parse_mode(&[]), Mode::Install { demo: DemoFlags::default() });
    }

    #[test]
    fn update_without_app_args() {
        assert_eq!(
            parse_mode(&v(&["/P", "/R", "/UPDATE", "/ARGS"])),
            Mode::Update { app_args: vec![] }
        );
    }

    #[test]
    fn update_keeps_app_args_unchanged() {
        let m = parse_mode(&v(&[
            "/P", "/R", "/UPDATE", "/ARGS", "C:\\문서 폴더\\a b.pdf", "--flag=/x",
        ]));
        assert_eq!(
            m,
            Mode::Update { app_args: v(&["C:\\문서 폴더\\a b.pdf", "--flag=/x"]) }
        );
    }

    #[test]
    fn silent_without_dir() {
        assert_eq!(parse_mode(&v(&["/S"])), Mode::Silent { install_dir: None });
    }

    #[test]
    fn silent_with_dir_containing_space() {
        assert_eq!(
            parse_mode(&v(&["/S", "/D=D:\\테스트 폴더\\IWAE"])),
            Mode::Silent { install_dir: Some(PathBuf::from("D:\\테스트 폴더\\IWAE")) }
        );
    }

    #[test]
    fn silent_dir_split_by_argv_is_rejoined() {
        assert_eq!(
            parse_mode(&v(&["/S", "/D=C:\\Program", "Files\\IWAE"])),
            Mode::Silent { install_dir: Some(PathBuf::from("C:\\Program Files\\IWAE")) }
        );
    }

    #[test]
    fn uninstall_flag() {
        assert_eq!(parse_mode(&v(&["--uninstall"])), Mode::Uninstall);
    }

    #[test]
    fn uninstall_sync_keeps_all_args() {
        let a = v(&["/S", "/UPDATE", "_?=C:\\x y"]);
        assert_eq!(parse_mode(&a), Mode::UninstallSync { args: a.clone() });
    }

    #[test]
    fn uninstall_from_temp() {
        assert_eq!(
            parse_mode(&v(&["--uninstall-from-temp", "D:\\테스트 폴더\\IWAE"])),
            Mode::UninstallTemp { install_dir: PathBuf::from("D:\\테스트 폴더\\IWAE") }
        );
    }

    #[cfg(not(debug_assertions))]
    #[test]
    fn demo_ignored_in_release() {
        match parse_mode(&v(&["--demo"])) {
            Mode::Install { demo } => assert!(!demo.enabled),
            other => panic!("unexpected {:?}", other),
        }
    }

    #[cfg(debug_assertions)]
    #[test]
    fn demo_flags_in_debug() {
        match parse_mode(&v(&["--demo-existing=0.2.6", "--demo-running", "--demo-fail"])) {
            Mode::Install { demo } => {
                assert!(demo.enabled && demo.running && demo.fail);
                assert_eq!(demo.existing.as_deref(), Some("0.2.6"));
            }
            other => panic!("unexpected {:?}", other),
        }
    }
}
