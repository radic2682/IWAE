#![allow(dead_code)]
//! Finding, closing, killing and launching the installed IWAE (`<dir>\app.exe`).

use std::ffi::OsString;
use std::io;
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

/// Close wait for the "close and install" flow.
pub const CLOSE_TIMEOUT: Duration = Duration::from_secs(15);
/// Wait for the old process in update mode (it was asked to quit by IWAE itself).
pub const UPDATE_EXIT_TIMEOUT: Duration = Duration::from_secs(10);
pub const POLL: Duration = Duration::from_millis(200);

pub trait ProcessControl: Send + Sync {
    /// Processes whose image path is `<dir>\app.exe`, in our session only.
    fn running_app_pids(&self, install_dir: &Path) -> Vec<u32>;
    /// Posts WM_CLOSE to the pid's visible top-level windows.
    fn request_close(&self, pid: u32);
    fn force_kill(&self, pid: u32);
    /// Detached, no console.
    fn launch(&self, exe: &Path, args: &[OsString]) -> io::Result<()>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseOutcome {
    Closed,
    StillRunning,
}

fn poll_until_gone(
    pc: &dyn ProcessControl,
    dir: &Path,
    timeout: Duration,
    poll: Duration,
) -> CloseOutcome {
    let start = Instant::now();
    loop {
        if pc.running_app_pids(dir).is_empty() {
            return CloseOutcome::Closed;
        }
        if start.elapsed() >= timeout {
            return CloseOutcome::StillRunning;
        }
        thread::sleep(poll);
    }
}

/// Asks every running IWAE to close once, then waits for them to disappear.
pub fn close_and_wait(
    pc: &dyn ProcessControl,
    dir: &Path,
    timeout: Duration,
    poll: Duration,
) -> CloseOutcome {
    let pids = pc.running_app_pids(dir);
    if pids.is_empty() {
        return CloseOutcome::Closed;
    }
    for pid in pids {
        pc.request_close(pid);
    }
    poll_until_gone(pc, dir, timeout, poll)
}

/// Update mode: never sends WM_CLOSE, only waits for the old process to exit.
pub fn wait_for_exit(pc: &dyn ProcessControl, dir: &Path, timeout: Duration) -> CloseOutcome {
    poll_until_gone(pc, dir, timeout, POLL)
}

/// Case-insensitive `\`-separated form for comparing image paths. Not canonicalized:
/// the install dir may not exist yet.
fn normalize(p: &str) -> String {
    p.replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

/// `<dir>\app.exe` in comparison form.
fn app_exe_key(install_dir: &Path) -> String {
    normalize(&format!("{}\\app.exe", normalize(&install_dir.to_string_lossy())))
}

#[cfg(windows)]
pub struct WinProcess;

#[cfg(windows)]
mod win {
    use super::*;
    use std::os::windows::process::CommandExt;
    use windows::core::{BOOL, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, WPARAM};
    use windows::Win32::System::ProcessStatus::EnumProcesses;
    use windows::Win32::System::RemoteDesktop::ProcessIdToSessionId;
    use windows::Win32::System::Threading::{
        GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, TerminateProcess,
        PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, WM_CLOSE,
    };

    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

    fn session_of(pid: u32) -> Option<u32> {
        let mut sid = 0u32;
        unsafe { ProcessIdToSessionId(pid, &mut sid) }.ok()?;
        Some(sid)
    }

    fn all_pids() -> Vec<u32> {
        // Grow until the list is not full (EnumProcesses silently truncates).
        let mut cap = 1024usize;
        loop {
            let mut buf = vec![0u32; cap];
            let mut needed = 0u32;
            let bytes = (cap * std::mem::size_of::<u32>()) as u32;
            if unsafe { EnumProcesses(buf.as_mut_ptr(), bytes, &mut needed) }.is_err() {
                return Vec::new();
            }
            let count = needed as usize / std::mem::size_of::<u32>();
            if count < cap {
                buf.truncate(count);
                return buf;
            }
            cap *= 2;
        }
    }

    fn image_path(pid: u32) -> Option<String> {
        let h = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
        let mut buf = vec![0u16; 32768];
        let mut len = buf.len() as u32;
        let r = unsafe {
            QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len)
        };
        let _ = unsafe { CloseHandle(h) };
        r.ok()?;
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }

    /// State handed to the EnumWindows callback through LPARAM.
    struct Collect {
        pid: u32,
        windows: Vec<HWND>,
    }

    unsafe extern "system" fn collect_windows(hwnd: HWND, lparam: LPARAM) -> BOOL {
        // SAFETY: lparam is the address of the `Collect` owned by request_close, which
        // outlives the synchronous EnumWindows call.
        let state = &mut *(lparam.0 as *mut Collect);
        let mut owner = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut owner));
        if owner == state.pid && IsWindowVisible(hwnd).as_bool() {
            state.windows.push(hwnd);
        }
        BOOL(1) // keep enumerating
    }

    impl ProcessControl for WinProcess {
        fn running_app_pids(&self, install_dir: &Path) -> Vec<u32> {
            let want = app_exe_key(install_dir);
            let our_session = session_of(unsafe { GetCurrentProcessId() });
            all_pids()
                .into_iter()
                .filter(|&pid| pid != 0)
                .filter(|&pid| match image_path(pid) {
                    Some(p) => normalize(&p) == want,
                    None => false,
                })
                .filter(|&pid| our_session.is_some() && session_of(pid) == our_session)
                .collect()
        }

        fn request_close(&self, pid: u32) {
            let mut state = Collect { pid, windows: Vec::new() };
            let _ = unsafe {
                EnumWindows(Some(collect_windows), LPARAM(&mut state as *mut Collect as isize))
            };
            for hwnd in state.windows {
                let _ = unsafe { PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0)) };
            }
        }

        fn force_kill(&self, pid: u32) {
            let h: HANDLE = match unsafe { OpenProcess(PROCESS_TERMINATE, false, pid) } {
                Ok(h) => h,
                Err(_) => return,
            };
            let _ = unsafe { TerminateProcess(h, 1) };
            let _ = unsafe { CloseHandle(h) };
        }

        fn launch(&self, exe: &Path, args: &[OsString]) -> io::Result<()> {
            let child = std::process::Command::new(exe)
                .args(args)
                .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
                .spawn()?;
            drop(child);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// The pids vanish once `running_app_pids` has been called more than `vanish_after` times.
    struct FakeProcesses {
        pids: Vec<u32>,
        vanish_after: usize,
        polls: Mutex<usize>,
        closes: Mutex<Vec<u32>>,
    }

    impl FakeProcesses {
        fn new(pids: Vec<u32>, vanish_after: usize) -> Self {
            Self { pids, vanish_after, polls: Mutex::new(0), closes: Mutex::new(Vec::new()) }
        }
    }

    impl ProcessControl for FakeProcesses {
        fn running_app_pids(&self, _dir: &Path) -> Vec<u32> {
            let mut n = self.polls.lock().unwrap();
            *n += 1;
            if *n > self.vanish_after {
                Vec::new()
            } else {
                self.pids.clone()
            }
        }
        fn request_close(&self, pid: u32) {
            self.closes.lock().unwrap().push(pid);
        }
        fn force_kill(&self, _pid: u32) {}
        fn launch(&self, _exe: &Path, _args: &[OsString]) -> io::Result<()> {
            Ok(())
        }
    }

    const DIR: &str = r"D:\테스트 폴더\IWAE";
    const TIMEOUT: Duration = Duration::from_millis(50);
    const POLL_FAST: Duration = Duration::from_millis(1);

    #[test]
    fn closed_when_pids_vanish_before_timeout() {
        let fake = FakeProcesses::new(vec![10, 11], 3);
        let out = close_and_wait(&fake, Path::new(DIR), TIMEOUT, POLL_FAST);
        assert_eq!(out, CloseOutcome::Closed);
    }

    #[test]
    fn still_running_after_timeout() {
        let fake = FakeProcesses::new(vec![10], usize::MAX);
        let out = close_and_wait(&fake, Path::new(DIR), TIMEOUT, POLL_FAST);
        assert_eq!(out, CloseOutcome::StillRunning);
    }

    #[test]
    fn request_close_once_per_pid() {
        let fake = FakeProcesses::new(vec![10, 11], 5);
        close_and_wait(&fake, Path::new(DIR), TIMEOUT, POLL_FAST);
        let mut closes = fake.closes.lock().unwrap().clone();
        closes.sort();
        assert_eq!(closes, vec![10, 11]);
    }

    #[test]
    fn nothing_running_closes_without_requests() {
        let fake = FakeProcesses::new(vec![], 0);
        let out = close_and_wait(&fake, Path::new(DIR), TIMEOUT, POLL_FAST);
        assert_eq!(out, CloseOutcome::Closed);
        assert!(fake.closes.lock().unwrap().is_empty());
    }

    #[test]
    fn wait_for_exit_never_requests_close() {
        let fake = FakeProcesses::new(vec![10], 2);
        let out = wait_for_exit(&fake, Path::new(DIR), Duration::from_secs(2));
        assert_eq!(out, CloseOutcome::Closed);
        assert!(fake.closes.lock().unwrap().is_empty());
    }

    #[test]
    fn wait_for_exit_times_out() {
        let fake = FakeProcesses::new(vec![10], usize::MAX);
        let out = wait_for_exit(&fake, Path::new(DIR), TIMEOUT);
        assert_eq!(out, CloseOutcome::StillRunning);
        assert!(fake.closes.lock().unwrap().is_empty());
    }

    #[test]
    fn image_path_key_ignores_case_and_separators() {
        let want = app_exe_key(Path::new(r"d:/테스트 폴더/iwae/"));
        assert_eq!(want, normalize(r"D:\테스트 폴더\IWAE\app.exe"));
    }
}
