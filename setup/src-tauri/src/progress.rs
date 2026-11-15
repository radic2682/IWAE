#![allow(dead_code)]
//! Install progress estimate: how many of the expected bytes NSIS has written so far.

use crate::payload::ManifestEntry;
use std::fs;
use std::path::Path;
use std::time::SystemTime;

/// Counts a file only when its mtime >= `since` (old files from a previous install do not count),
/// and at most its expected size. Stays <= 95 until `finished`, then 100.
/// An empty manifest gives 0 until finished.
pub fn percent(manifest: &[ManifestEntry], dir: &Path, since: SystemTime, finished: bool) -> u8 {
    if finished {
        return 100;
    }
    let total: u64 = manifest.iter().map(|e| e.size).sum();
    if total == 0 {
        return 0;
    }
    let mut written: u64 = 0;
    for e in manifest {
        let Ok(meta) = fs::metadata(dir.join(&e.rel)) else {
            continue;
        };
        let fresh = meta.modified().map(|m| m >= since).unwrap_or(false);
        if fresh {
            written += meta.len().min(e.size);
        }
    }
    let pct = (written.saturating_mul(100) / total) as u8;
    pct.min(95)
}

#[cfg(test)]
mod tests {
    use super::*;
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

    fn hour_ago() -> SystemTime {
        SystemTime::now() - Duration::from_secs(3600)
    }

    #[test]
    fn zero_with_no_files() {
        let d = tmp("none");
        let m = vec![entry("a.bin", 100), entry("b.bin", 100)];
        assert_eq!(percent(&m, &d, hour_ago(), false), 0);
    }

    #[test]
    fn half_when_half_the_bytes_are_written() {
        let d = tmp("half");
        let m = vec![entry("a.bin", 100), entry("b.bin", 100)];
        fs::write(d.join("a.bin"), vec![0u8; 100]).unwrap();
        assert_eq!(percent(&m, &d, hour_ago(), false), 50);
    }

    #[test]
    fn partial_file_counts_bytes_and_oversize_is_capped() {
        let d = tmp("partial");
        let m = vec![entry("a.bin", 100), entry("b.bin", 100)];
        fs::write(d.join("a.bin"), vec![0u8; 50]).unwrap();
        fs::write(d.join("b.bin"), vec![0u8; 500]).unwrap(); // counts as 100 only
        assert_eq!(percent(&m, &d, hour_ago(), false), 75);
    }

    #[test]
    fn ignores_files_older_than_since() {
        let d = tmp("old");
        let m = vec![entry("a.bin", 100)];
        fs::write(d.join("a.bin"), vec![0u8; 100]).unwrap();
        let future = SystemTime::now() + Duration::from_secs(3600);
        assert_eq!(percent(&m, &d, future, false), 0);
    }

    #[test]
    fn capped_at_95_until_finished() {
        let d = tmp("cap");
        let m = vec![entry("a.bin", 100)];
        fs::write(d.join("a.bin"), vec![0u8; 100]).unwrap();
        assert_eq!(percent(&m, &d, hour_ago(), false), 95);
        assert_eq!(percent(&m, &d, hour_ago(), true), 100);
    }

    #[test]
    fn empty_manifest_is_zero_then_hundred() {
        let d = tmp("empty");
        assert_eq!(percent(&[], &d, hour_ago(), false), 0);
        assert_eq!(percent(&[], &d, hour_ago(), true), 100);
    }
}
