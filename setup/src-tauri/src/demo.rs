//! Debug-only demo backend (`--demo*` flags). Never touches the real registry, the real NSIS
//! installer or real processes: everything is fake and lives under `<temp>\iwae-setup-demo`.
//! This module is compiled out of release builds (see `mod demo` in main.rs).

use crate::apprun::ProcessControl;
use crate::args::DemoFlags;
use crate::commands::Backend;
use crate::nsis::NsisRunner;
use crate::payload::ManifestEntry;
use crate::registry::{Hive, MemReg, RegStore, UNINSTALL_KEY};
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

/// Small fake file list; the fake installer writes these over about four seconds.
const FILES: &[(&str, u64)] = &[
    ("app.exe", 4096),
    ("binaries/pdfium.dll", 6144),
    ("resources/index.dat", 2048),
    ("_up_/LICENSE", 512),
    ("resources/fonts.bin", 3072),
    ("resources/icons.bin", 1536),
    ("locales/ko.json", 256),
    ("locales/en.json", 256),
];
const TOTAL_MS: u64 = 4000;

pub fn root() -> PathBuf {
    std::env::temp_dir().join("iwae-setup-demo")
}

pub fn manifest() -> Vec<ManifestEntry> {
    FILES
        .iter()
        .map(|(rel, size)| ManifestEntry { rel: (*rel).to_string(), size: *size })
        .collect()
}

/// Demo safety net: the fake installer must never touch anything outside the demo root.
fn ensure_sandboxed(dir: &Path) -> io::Result<()> {
    if dir.starts_with(root()) && !dir.components().any(|c| c.as_os_str() == "..") {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("demo refuses to touch {}", dir.display()),
        ))
    }
}

/// Fake NSIS: `_?=` calls (old uninstall / uninstall) are quick no-ops that succeed; the install
/// call writes the fake files into the `/D=` folder, and exits 2 halfway when `fail`.
struct DemoNsis {
    fail: bool,
}

impl NsisRunner for DemoNsis {
    fn run(&self, _exe: &Path, args: &[OsString]) -> io::Result<i32> {
        let text: Vec<String> = args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
        if let Some(target) = text.iter().find_map(|a| a.strip_prefix("_?=")) {
            ensure_sandboxed(Path::new(target))?;
            thread::sleep(Duration::from_millis(800));
            // The old-uninstall call (/UPDATE) always succeeds; only the plain uninstall fails.
            let is_update = text.iter().any(|a| a.eq_ignore_ascii_case("/UPDATE"));
            return Ok(if self.fail && !is_update { 3 } else { 0 });
        }
        let dir = text
            .iter()
            .find_map(|a| a.strip_prefix("/D=").map(PathBuf::from))
            .unwrap_or_else(|| root().join("IWAE"));
        ensure_sandboxed(&dir)?;
        let step = Duration::from_millis(TOTAL_MS / FILES.len() as u64);
        let limit = if self.fail { FILES.len() / 2 } else { FILES.len() };
        for (rel, size) in FILES.iter().take(limit) {
            thread::sleep(step);
            let p = dir.join(rel);
            if let Some(parent) = p.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(p, vec![1u8; *size as usize])?;
        }
        thread::sleep(step);
        Ok(if self.fail { 2 } else { 0 })
    }
}

/// Reports one running pid until it is asked to close or killed (when `--demo-running`).
struct DemoProcs {
    running: AtomicBool,
}

impl ProcessControl for DemoProcs {
    fn running_app_pids(&self, _install_dir: &Path) -> Vec<u32> {
        if self.running.load(Ordering::SeqCst) {
            vec![4242]
        } else {
            Vec::new()
        }
    }

    fn request_close(&self, _pid: u32) {
        self.running.store(false, Ordering::SeqCst);
    }

    fn force_kill(&self, _pid: u32) {
        self.running.store(false, Ordering::SeqCst);
    }

    fn launch(&self, exe: &Path, args: &[OsString]) -> io::Result<()> {
        eprintln!("[demo] would launch {} {:?}", exe.display(), args);
        Ok(())
    }
}

pub fn backend(flags: &DemoFlags) -> Backend {
    let root = root();
    let dir = root.join("IWAE");
    let existing = flags.existing.clone();
    if existing.is_some() || flags.uninstall {
        // The old-uninstall step only runs when uninstall.exe is there.
        let _ = fs::create_dir_all(&dir);
        let _ = fs::write(dir.join("uninstall.exe"), b"demo");
    }
    if flags.uninstall {
        // A few fake files so the uninstall window has something to remove.
        let _ = fs::write(dir.join("uninstall-ui.exe"), b"demo");
        for (rel, size) in FILES {
            let p = dir.join(rel);
            if let Some(parent) = p.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::write(p, vec![1u8; *size as usize]);
        }
    }
    let seed_dir = dir.clone();
    Backend {
        // MemReg uses RefCell (not Sync), so each caller gets its own freshly seeded copy.
        reg: Box::new(move || {
            let mut reg = MemReg::new();
            if let Some(v) = &existing {
                reg = reg
                    .with(Hive::Hkcu, UNINSTALL_KEY, "DisplayVersion", v)
                    .with(
                        Hive::Hkcu,
                        UNINSTALL_KEY,
                        "InstallLocation",
                        &seed_dir.to_string_lossy(),
                    );
            }
            Box::new(reg) as Box<dyn RegStore>
        }),
        nsis: Arc::new(DemoNsis { fail: flags.fail }),
        procs: Arc::new(DemoProcs { running: AtomicBool::new(flags.running) }),
        temp: std::env::temp_dir(),
        desktop: root.join("Desktop"),
        default_dir: dir,
        demo_root: Some(root),
        manifest: manifest(),
        nsis_exe: b"demo-nsis",
        uninstall_ui: b"demo-uninstall-ui",
    }
}
