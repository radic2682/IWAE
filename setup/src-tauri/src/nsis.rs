#![allow(dead_code)]
//! Arguments for the inner NSIS installer/uninstaller and the process runner behind them.

use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

pub enum NsisRun {
    /// No UI. `dir` becomes `/D=` (only for a fresh install into a chosen folder).
    Silent { update: bool, dir: Option<PathBuf> },
    /// Passive (progress-only) wizard, used by the no-window fallback.
    Passive { update: bool },
}

/// `/D=` must come last and stays ONE element with the path unquoted (NSIS rule),
/// even with spaces or Korean characters; `RealNsis` passes it with `raw_arg`.
pub fn nsis_args(run: &NsisRun) -> Vec<OsString> {
    let mut out: Vec<OsString> = Vec::new();
    match run {
        NsisRun::Silent { update, dir } => {
            out.push("/S".into());
            if *update {
                out.push("/UPDATE".into());
            }
            if let Some(d) = dir {
                let mut a = OsString::from("/D=");
                a.push(d);
                out.push(a);
            }
        }
        NsisRun::Passive { update } => {
            out.push("/P".into());
            if *update {
                out.push("/UPDATE".into());
            }
        }
    }
    out
}

/// Runs the old install's uninstall.exe in place (`_?=` stops it copying itself to temp, so we
/// can wait for it).
pub fn old_uninstall_args(dir: &Path) -> Vec<OsString> {
    let mut a = OsString::from("_?=");
    a.push(dir);
    vec!["/S".into(), "/UPDATE".into(), a]
}

/// Plain uninstall. `_?=` keeps uninstall.exe from copying itself to %TEMP% and returning at once,
/// so waiting on it really waits for the uninstall (and it can no longer delete itself).
pub fn uninstall_args(dir: &Path) -> Vec<OsString> {
    let mut a = OsString::from("_?=");
    a.push(dir);
    vec!["/S".into(), a]
}

/// Blocks until the process exits and returns its exit code.
/// `Send + Sync` because the install pipeline runs it on a worker thread while it polls progress.
pub trait NsisRunner: Send + Sync {
    fn run(&self, exe: &Path, args: &[OsString]) -> io::Result<i32>;
}

pub struct RealNsis;

impl NsisRunner for RealNsis {
    fn run(&self, exe: &Path, args: &[OsString]) -> io::Result<i32> {
        let mut cmd = Command::new(exe);
        // Never inherit our cwd: it is often the install dir, which then could not be removed.
        cmd.current_dir(std::env::temp_dir());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // raw_arg: Command would quote an arg with spaces, which NSIS /D= and _?= reject.
            for a in args {
                cmd.raw_arg(a);
            }
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        #[cfg(not(windows))]
        {
            cmd.args(args);
        }
        let status = cmd.status()?;
        Ok(status.code().unwrap_or(-1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<OsString> {
        items.iter().map(|s| OsString::from(*s)).collect()
    }

    #[test]
    fn fresh_silent_with_dir_is_one_unquoted_element() {
        let run = NsisRun::Silent { update: false, dir: Some(PathBuf::from(r"D:\테스트 폴더\IWAE")) };
        let args = nsis_args(&run);
        assert_eq!(args, v(&["/S", r"/D=D:\테스트 폴더\IWAE"]));
        assert_eq!(args.len(), 2);
    }

    #[test]
    fn silent_update_without_dir() {
        assert_eq!(nsis_args(&NsisRun::Silent { update: true, dir: None }), v(&["/S", "/UPDATE"]));
    }

    #[test]
    fn silent_fresh_without_dir() {
        assert_eq!(nsis_args(&NsisRun::Silent { update: false, dir: None }), v(&["/S"]));
    }

    #[test]
    fn passive_args() {
        assert_eq!(nsis_args(&NsisRun::Passive { update: true }), v(&["/P", "/UPDATE"]));
        assert_eq!(nsis_args(&NsisRun::Passive { update: false }), v(&["/P"]));
    }

    #[test]
    fn uninstall_args_dir_is_last_unquoted_element() {
        let args = uninstall_args(Path::new(r"D:\테스트 폴더\IWAE"));
        assert_eq!(args, v(&["/S", r"_?=D:\테스트 폴더\IWAE"]));
    }

    #[test]
    fn old_uninstall_dir_stays_one_element() {
        let args = old_uninstall_args(Path::new(r"D:\테스트 폴더\IWAE"));
        assert_eq!(args, v(&["/S", "/UPDATE", r"_?=D:\테스트 폴더\IWAE"]));
    }
}
