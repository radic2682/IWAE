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
    /// Open the uninstall window on a fake install folder.
    pub uninstall: bool,
    /// Open the update window (installing straight away).
    pub update: bool,
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
    /// Nothing sensible to do; main logs the reason and exits 1.
    Invalid { reason: &'static str },
}

fn text(a: &OsString) -> String {
    a.to_string_lossy().into_owned()
}

fn is_flag(a: &OsString, flag: &str) -> bool {
    text(a).eq_ignore_ascii_case(flag)
}

/// Our own arguments: everything after /ARGS belongs to the app and is never interpreted here.
fn own_args(args: &[OsString]) -> &[OsString] {
    match args.iter().position(|a| is_flag(a, "/ARGS")) {
        Some(i) => &args[..i],
        None => args,
    }
}

pub fn parse_mode(args: &[OsString]) -> Mode {
    let args_pos = args.iter().position(|a| is_flag(a, "/ARGS"));
    let own = own_args(args);

    // An old NSIS wizard runs `<UninstallString> [/UPDATE] [/P] _?=<dir>`, and UninstallString
    // is `"...\uninstall-ui.exe" --uninstall`, so `_?=` wins over every other flag. Our own
    // flags are dropped; uninstall.exe gets exactly the wizard's arguments.
    if own.iter().any(|a| text(a).starts_with("_?=")) {
        let forwarded = args
            .iter()
            .filter(|a| !is_flag(a, "--uninstall") && !is_flag(a, "--real"))
            .cloned()
            .collect();
        return Mode::UninstallSync { args: forwarded };
    }

    if let Some(i) = own.iter().position(|a| is_flag(a, "--uninstall-from-temp")) {
        return match own.get(i + 1) {
            Some(dir) => Mode::UninstallTemp { install_dir: PathBuf::from(dir) },
            // Never fall through to Install: this flag only comes from our own relaunch.
            None => Mode::Invalid { reason: "--uninstall-from-temp without a folder" },
        };
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
        } else if t == "--demo-uninstall" {
            d.enabled = true;
            d.uninstall = true;
        } else if t == "--demo-update" {
            d.enabled = true;
            d.update = true;
        }
    }
    d
}

// Release builds never honour --demo*.
#[cfg(not(debug_assertions))]
fn parse_demo(_args: &[OsString]) -> DemoFlags {
    DemoFlags::default()
}

/// R14: a debug build only touches the real machine (registry, installers, app processes) when
/// `--real` is among our own arguments. Without it main refuses to start outside `--demo`.
#[cfg(debug_assertions)]
pub fn real_allowed(args: &[OsString]) -> bool {
    own_args(args).iter().any(|a| text(a) == "--real")
}

// Release builds always use the real backend.
#[cfg(not(debug_assertions))]
pub fn real_allowed(_args: &[OsString]) -> bool {
    true
}

/// R14: a build without the installer payload (uninstall-ui.exe by design, or a debug build)
/// can only uninstall. A double-click (Install) or an update means "uninstall"; `/S` stays a
/// silent install request, which this build cannot do, so it is refused instead of uninstalling.
pub fn without_payload(mode: Mode) -> Mode {
    match mode {
        Mode::Install { .. } | Mode::Update { .. } => Mode::Uninstall,
        Mode::Silent { .. } => Mode::Invalid { reason: "silent install needs the installer payload" },
        other => other,
    }
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

    #[test]
    fn uninstall_from_temp_keeps_dir_with_trailing_real_flag() {
        // relaunch_from_temp appends --real in debug builds, after the folder.
        assert_eq!(
            parse_mode(&v(&["--uninstall-from-temp", "D:\\테스트 폴더\\IWAE", "--real"])),
            Mode::UninstallTemp { install_dir: PathBuf::from("D:\\테스트 폴더\\IWAE") }
        );
    }

    #[test]
    fn uninstall_from_temp_without_dir_is_invalid_not_install() {
        assert!(matches!(
            parse_mode(&v(&["--uninstall-from-temp"])),
            Mode::Invalid { .. }
        ));
    }

    #[test]
    fn old_wizard_form_with_uninstall_flag_is_sync() {
        // `<UninstallString> /S _?=<dir>` with UninstallString = `"...\uninstall-ui.exe" --uninstall`.
        assert_eq!(
            parse_mode(&v(&["--uninstall", "/S", "_?=D:\\테스트 폴더\\IWAE"])),
            Mode::UninstallSync { args: v(&["/S", "_?=D:\\테스트 폴더\\IWAE"]) }
        );
        assert_eq!(
            parse_mode(&v(&["--uninstall", "/P", "/UPDATE", "_?=C:\\x"])),
            Mode::UninstallSync { args: v(&["/P", "/UPDATE", "_?=C:\\x"]) }
        );
    }

    #[test]
    fn sync_wins_over_temp_relaunch_flag() {
        assert!(matches!(
            parse_mode(&v(&["--uninstall-from-temp", "D:\\x", "_?=D:\\x"])),
            Mode::UninstallSync { .. }
        ));
    }

    #[test]
    fn real_flag_alone_is_install() {
        assert_eq!(parse_mode(&v(&["--real"])), Mode::Install { demo: DemoFlags::default() });
    }

    #[cfg(debug_assertions)]
    #[test]
    fn real_needs_flag_in_debug() {
        assert!(!real_allowed(&[]));
        assert!(!real_allowed(&v(&["/S"])));
        assert!(real_allowed(&v(&["--real"])));
        assert!(real_allowed(&v(&["/P", "/R", "/UPDATE", "--real", "/ARGS"])));
        // After /ARGS it belongs to the app.
        assert!(!real_allowed(&v(&["/UPDATE", "/ARGS", "--real"])));
    }

    #[cfg(not(debug_assertions))]
    #[test]
    fn real_always_allowed_in_release() {
        assert!(real_allowed(&[]));
        assert!(real_allowed(&v(&["/S"])));
    }

    #[test]
    fn without_payload_maps_install_and_update_to_uninstall() {
        assert_eq!(without_payload(Mode::Install { demo: DemoFlags::default() }), Mode::Uninstall);
        assert_eq!(without_payload(Mode::Update { app_args: v(&["a"]) }), Mode::Uninstall);
        assert!(matches!(
            without_payload(Mode::Silent { install_dir: None }),
            Mode::Invalid { .. }
        ));
        assert_eq!(without_payload(Mode::Uninstall), Mode::Uninstall);
        let sync = Mode::UninstallSync { args: v(&["/S", "_?=C:\\x"]) };
        assert_eq!(without_payload(sync), Mode::UninstallSync { args: v(&["/S", "_?=C:\\x"]) });
        assert_eq!(
            without_payload(Mode::UninstallTemp { install_dir: PathBuf::from("C:\\x") }),
            Mode::UninstallTemp { install_dir: PathBuf::from("C:\\x") }
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
    fn demo_mode_flags_in_debug() {
        match parse_mode(&v(&["--demo-uninstall"])) {
            Mode::Install { demo } => assert!(demo.enabled && demo.uninstall && !demo.update),
            other => panic!("unexpected {:?}", other),
        }
        match parse_mode(&v(&["--demo-update", "--demo-running"])) {
            Mode::Install { demo } => {
                assert!(demo.enabled && demo.update && demo.running && !demo.uninstall)
            }
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
