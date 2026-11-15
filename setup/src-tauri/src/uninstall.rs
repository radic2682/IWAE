#![allow(dead_code)]
//! Uninstall flows (spec 6.3): the window's own uninstall, the pass-through for an old NSIS
//! wizard, and the temp-copy relaunch that lets uninstall-ui.exe delete itself.

use crate::nsis::{uninstall_args, NsisRunner};
use crate::registry::{remove_leftover_keys, RegStore};
use crate::setup_log::SetupLog;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, PartialEq)]
pub enum UninstallEvent {
    Progress,
    Done,
    Failed { code: i32, log: PathBuf },
}

/// `<temp>\iwae-uninstall-<pid>.exe`; never named app.exe so it cannot be mistaken for the app.
pub fn temp_copy_path(temp: &Path, pid: u32) -> PathBuf {
    temp.join(format!("iwae-uninstall-{pid}.exe"))
}

/// uninstall-ui.exe lives in the install dir and could not delete it, so it copies itself to
/// temp and runs from there with `--uninstall-from-temp <dir>` (two separate argv elements,
/// read by our own parser, so normal quoting is fine).
pub fn relaunch_from_temp(current_exe: &Path, install_dir: &Path, temp: &Path) -> io::Result<()> {
    fs::create_dir_all(temp)?;
    let copy = temp_copy_path(temp, std::process::id());
    fs::copy(current_exe, &copy)?;
    let mut cmd = Command::new(&copy);
    cmd.arg("--uninstall-from-temp").arg(install_dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP: outlive this process.
        cmd.creation_flags(0x0000_0008 | 0x0000_0200);
    }
    cmd.spawn()?;
    Ok(())
}

pub fn run_uninstall(
    reg: &dyn RegStore,
    runner: &dyn NsisRunner,
    install_dir: &Path,
    temp: &Path,
    on: &mut dyn FnMut(UninstallEvent),
) {
    let log = SetupLog::create(temp).unwrap_or_else(|_| SetupLog::fallback(temp));
    log.line(&format!("uninstall start: {}", install_dir.display()));
    on(UninstallEvent::Progress);

    let exe = install_dir.join("uninstall.exe");
    let args = uninstall_args(install_dir);
    log.line(&format!("run: {} {:?}", exe.display(), args));
    let code = match runner.run(&exe, &args) {
        Ok(c) => c,
        Err(e) => {
            log.line(&format!("uninstall.exe could not start: {e}"));
            -1
        }
    };
    log.line(&format!("uninstall.exe exit {code}"));
    if code != 0 {
        // Touch nothing else: the registry still describes the (partly) installed app.
        on(UninstallEvent::Failed { code, log: log.path().to_path_buf() });
        return;
    }

    // With `_?=` uninstall.exe cannot delete itself, so both exes are removed here.
    for name in ["uninstall.exe", "uninstall-ui.exe"] {
        let p = install_dir.join(name);
        match fs::remove_file(&p) {
            Ok(()) => log.line(&format!("deleted {name}")),
            Err(e) if e.kind() == io::ErrorKind::NotFound => log.line(&format!("{name} not present")),
            Err(e) => log.line(&format!("could not delete {name}: {e}")),
        }
    }

    // remove_dir only succeeds on an empty dir, so user files keep the folder alive.
    match fs::remove_dir(install_dir) {
        Ok(()) => log.line("removed install dir"),
        Err(e) => log.line(&format!("install dir kept: {e}")),
    }

    match remove_leftover_keys(reg) {
        Ok(()) => log.line("leftover registry keys removed"),
        Err(e) => log.line(&format!("leftover registry keys: {e}")),
    }

    log.line("uninstall done");
    on(UninstallEvent::Done);
}

/// Called by an old NSIS wizard that already passes `_?=`: forward everything unchanged to the
/// uninstall.exe next to us and return its code. Never copies or relaunches itself.
pub fn run_sync_passthrough(runner: &dyn NsisRunner, current_exe_dir: &Path, args: &[OsString]) -> i32 {
    let exe = current_exe_dir.join("uninstall.exe");
    match runner.run(&exe, args) {
        Ok(code) => code,
        Err(_) => -1,
    }
}

/// Deletes our temp copy after we exit (a running exe cannot delete itself); `ping` is the
/// usual delay trick. Errors are ignored: a stray temp file is harmless.
pub fn schedule_self_delete(exe: &Path) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("cmd.exe");
        let mut line = OsString::from("/c ping -n 3 127.0.0.1 >nul & del /f /q \"");
        line.push(exe);
        line.push("\"");
        cmd.raw_arg(line);
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let _ = cmd.spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = exe;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::{Hive, MemReg, PREVIOUS_LOCATION_KEY};
    use std::sync::Mutex;

    type Call = (PathBuf, Vec<OsString>);

    struct FakeRunner {
        calls: Mutex<Vec<Call>>,
        code: i32,
    }

    impl FakeRunner {
        fn new(code: i32) -> Self {
            FakeRunner { calls: Mutex::new(Vec::new()), code }
        }
        fn calls(&self) -> Vec<Call> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl NsisRunner for FakeRunner {
        fn run(&self, exe: &Path, args: &[OsString]) -> io::Result<i32> {
            self.calls.lock().unwrap().push((exe.to_path_buf(), args.to_vec()));
            Ok(self.code)
        }
    }

    struct Fx {
        root: PathBuf,
        dir: PathBuf,
        temp: PathBuf,
    }

    fn fx(name: &str) -> Fx {
        let root = std::env::temp_dir().join(format!("iwae-setup-uninstall-{}-{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&root);
        let f = Fx { dir: root.join("테스트 폴더").join("IWAE"), temp: root.join("Temp"), root };
        fs::create_dir_all(&f.dir).unwrap();
        fs::create_dir_all(&f.temp).unwrap();
        fs::write(f.dir.join("uninstall.exe"), b"nsis").unwrap();
        fs::write(f.dir.join("uninstall-ui.exe"), b"ui").unwrap();
        f
    }

    fn reg() -> MemReg {
        MemReg::new().with(Hive::Hkcu, PREVIOUS_LOCATION_KEY, "", "D:\\x")
    }

    fn run(f: &Fx, reg: &MemReg, runner: &FakeRunner) -> Vec<UninstallEvent> {
        let mut events = Vec::new();
        run_uninstall(reg, runner, &f.dir, &f.temp, &mut |e| events.push(e));
        events
    }

    #[test]
    fn success_removes_exes_dir_and_leftover_keys() {
        let f = fx("ok");
        let reg = reg();
        let runner = FakeRunner::new(0);
        let events = run(&f, &reg, &runner);

        let calls = runner.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, f.dir.join("uninstall.exe"));
        let mut dir_arg = OsString::from("_?=");
        dir_arg.push(&f.dir);
        assert_eq!(calls[0].1, vec![OsString::from("/S"), dir_arg]);
        assert!(!f.dir.join("uninstall-ui.exe").exists());
        assert!(!f.dir.join("uninstall.exe").exists());
        assert!(!f.dir.exists());
        assert_eq!(reg.get_str(Hive::Hkcu, PREVIOUS_LOCATION_KEY, ""), None);
        assert_eq!(events.last(), Some(&UninstallEvent::Done));
        let _ = fs::remove_dir_all(&f.root);
    }

    #[test]
    fn nonzero_exit_fails_and_touches_nothing() {
        let f = fx("fail");
        let reg = reg();
        let runner = FakeRunner::new(3);
        let events = run(&f, &reg, &runner);

        match events.last() {
            Some(UninstallEvent::Failed { code, log }) => {
                assert_eq!(*code, 3);
                assert!(log.exists());
            }
            other => panic!("unexpected {:?}", other),
        }
        assert!(f.dir.join("uninstall-ui.exe").exists());
        assert!(f.dir.join("uninstall.exe").exists());
        assert_eq!(
            reg.get_str(Hive::Hkcu, PREVIOUS_LOCATION_KEY, "").as_deref(),
            Some("D:\\x")
        );
        let _ = fs::remove_dir_all(&f.root);
    }

    #[test]
    fn user_file_keeps_the_dir() {
        let f = fx("userfile");
        fs::write(f.dir.join("my-notes.txt"), b"keep").unwrap();
        let reg = reg();
        let runner = FakeRunner::new(0);
        let events = run(&f, &reg, &runner);

        assert!(f.dir.join("my-notes.txt").exists());
        assert!(!f.dir.join("uninstall-ui.exe").exists());
        assert_eq!(events.last(), Some(&UninstallEvent::Done));
        let _ = fs::remove_dir_all(&f.root);
    }

    #[test]
    fn passthrough_forwards_args_unchanged_and_returns_code() {
        let f = fx("pass");
        let runner = FakeRunner::new(7);
        let args: Vec<OsString> = vec![
            "/S".into(),
            "/UPDATE".into(),
            OsString::from(r"_?=D:\테스트 폴더\IWAE"),
        ];
        let code = run_sync_passthrough(&runner, &f.dir, &args);

        assert_eq!(code, 7);
        let calls = runner.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, f.dir.join("uninstall.exe"));
        assert_eq!(calls[0].1, args);
        let _ = fs::remove_dir_all(&f.root);
    }

    #[test]
    fn temp_copy_name_uses_pid_and_is_not_app_exe() {
        let p = temp_copy_path(Path::new(r"D:\테스트 폴더\Temp"), 4242);
        assert_eq!(p.file_name().unwrap().to_string_lossy(), "iwae-uninstall-4242.exe");
    }
}
