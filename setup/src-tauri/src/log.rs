#![allow(dead_code)]
//! Plain-text setup log in the temp folder, shown to the user when something fails.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct SetupLog {
    path: PathBuf,
}

fn unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl SetupLog {
    /// Creates `IWAE-setup-<unix seconds>.log` in `temp`.
    pub fn create(temp: &Path) -> io::Result<SetupLog> {
        fs::create_dir_all(temp)?;
        let path = temp.join(format!("IWAE-setup-{}.log", unix_secs()));
        OpenOptions::new().create(true).append(true).open(&path)?;
        Ok(SetupLog { path })
    }

    /// A log that only knows its path (file creation failed); `line` then does nothing useful.
    pub fn fallback(temp: &Path) -> SetupLog {
        SetupLog { path: temp.join(format!("IWAE-setup-{}.log", unix_secs())) }
    }

    /// Appends one timestamped line. Write errors are ignored: logging must never fail an install.
    pub fn line(&self, msg: &str) {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&self.path) {
            let _ = writeln!(f, "[{}] {}", unix_secs(), msg);
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_named_file_and_appends_lines() {
        let dir = std::env::temp_dir().join(format!("iwae-setup-log-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let log = SetupLog::create(&dir).unwrap();
        let name = log.path().file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with("IWAE-setup-") && name.ends_with(".log"));
        log.line("first");
        log.line("second");
        let text = fs::read_to_string(log.path()).unwrap();
        assert!(text.contains("first") && text.contains("second"));
        assert_eq!(text.lines().count(), 2);
        let _ = fs::remove_dir_all(&dir);
    }
}
