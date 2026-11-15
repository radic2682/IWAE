#![allow(dead_code)]
//! Install progress estimate: how many of the expected bytes NSIS has written so far.
//!
//! NSIS restores each file's build-time mtime when it closes the file (SetDateSave on), so
//! "newer than the start time" never works. Instead we snapshot (len, mtime) of every expected
//! file before NSIS starts and count what changed or appeared afterwards.

use crate::payload::ManifestEntry;
use std::fs;
use std::path::Path;
use std::time::SystemTime;

/// Per manifest entry: `Some((len, mtime))` if the file existed, else `None`.
pub type Snapshot = Vec<Option<(u64, SystemTime)>>;

fn stat(path: &Path) -> Option<(u64, SystemTime)> {
    let meta = fs::metadata(path).ok()?;
    Some((meta.len(), meta.modified().ok()?))
}

pub fn snapshot(manifest: &[ManifestEntry], dir: &Path) -> Snapshot {
    manifest.iter().map(|e| stat(&dir.join(&e.rel))).collect()
}

/// An entry counts when it was absent before, or its (len, mtime) differs from the snapshot;
/// at most its expected size. Stays <= 95 until `finished`, then 100.
/// An empty manifest gives 0 until finished.
pub fn percent(manifest: &[ManifestEntry], dir: &Path, before: &Snapshot, finished: bool) -> u8 {
    if finished {
        return 100;
    }
    let total: u64 = manifest.iter().map(|e| e.size).sum();
    if total == 0 {
        return 0;
    }
    let mut written: u64 = 0;
    for (i, e) in manifest.iter().enumerate() {
        let Some((len, mtime)) = stat(&dir.join(&e.rel)) else {
            continue;
        };
        let was = before.get(i).copied().flatten();
        let changed = match was {
            None => true,
            Some((old_len, old_mtime)) => old_len != len || old_mtime != mtime,
        };
        if changed {
            written += len.min(e.size);
        }
    }
    let pct = (written.saturating_mul(100) / total) as u8;
    pct.min(95)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::time::Duration;

    fn entry(rel: &str, size: u64) -> ManifestEntry {
        ManifestEntry { rel: rel.to_string(), size }
    }

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir()
            .join(format!("iwae-setup-progress-{}-{}", std::process::id(), name))
            .join("테스트 폴더");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn old_time() -> SystemTime {
        SystemTime::now() - Duration::from_secs(86_400)
    }

    fn set_mtime(path: &Path, t: SystemTime) {
        let f = File::options().write(true).open(path).unwrap();
        f.set_modified(t).unwrap();
    }

    #[test]
    fn zero_with_no_files() {
        let d = tmp("none");
        let m = vec![entry("a.bin", 100), entry("b.bin", 100)];
        let before = snapshot(&m, &d);
        assert_eq!(percent(&m, &d, &before, false), 0);
    }

    #[test]
    fn half_when_half_the_bytes_are_written() {
        let d = tmp("half");
        let m = vec![entry("a.bin", 100), entry("b.bin", 100)];
        let before = snapshot(&m, &d);
        fs::write(d.join("a.bin"), vec![0u8; 100]).unwrap();
        assert_eq!(percent(&m, &d, &before, false), 50);
    }

    #[test]
    fn partial_file_counts_bytes_and_oversize_is_capped() {
        let d = tmp("partial");
        let m = vec![entry("a.bin", 100), entry("b.bin", 100)];
        let before = snapshot(&m, &d);
        fs::write(d.join("a.bin"), vec![0u8; 50]).unwrap();
        fs::write(d.join("b.bin"), vec![0u8; 500]).unwrap(); // counts as 100 only
        assert_eq!(percent(&m, &d, &before, false), 75);
    }

    #[test]
    fn unchanged_file_present_before_is_not_counted() {
        let d = tmp("same");
        let m = vec![entry("a.bin", 100)];
        fs::write(d.join("a.bin"), vec![0u8; 100]).unwrap();
        let before = snapshot(&m, &d);
        assert_eq!(percent(&m, &d, &before, false), 0);
    }

    #[test]
    fn new_file_with_restored_old_mtime_is_counted() {
        // NSIS SetDateSave: the finished file carries its build-time mtime.
        let d = tmp("restored");
        let m = vec![entry("a.bin", 100)];
        let before = snapshot(&m, &d);
        fs::write(d.join("a.bin"), vec![0u8; 100]).unwrap();
        set_mtime(&d.join("a.bin"), old_time());
        assert_eq!(percent(&m, &d, &before, false), 95);
    }

    #[test]
    fn rewritten_file_with_different_len_is_counted() {
        let d = tmp("rewritten");
        let m = vec![entry("a.bin", 100), entry("b.bin", 100)];
        fs::write(d.join("a.bin"), vec![0u8; 40]).unwrap();
        set_mtime(&d.join("a.bin"), old_time());
        let before = snapshot(&m, &d);
        fs::write(d.join("a.bin"), vec![0u8; 100]).unwrap();
        set_mtime(&d.join("a.bin"), old_time()); // same mtime, only len differs
        assert_eq!(percent(&m, &d, &before, false), 50);
    }

    #[test]
    fn capped_at_95_until_finished() {
        let d = tmp("cap");
        let m = vec![entry("a.bin", 100)];
        let before = snapshot(&m, &d);
        fs::write(d.join("a.bin"), vec![0u8; 100]).unwrap();
        assert_eq!(percent(&m, &d, &before, false), 95);
        assert_eq!(percent(&m, &d, &before, true), 100);
    }

    #[test]
    fn empty_manifest_is_zero_then_hundred() {
        let d = tmp("empty");
        let before = snapshot(&[], &d);
        assert_eq!(percent(&[], &d, &before, false), 0);
        assert_eq!(percent(&[], &d, &before, true), 100);
    }
}
