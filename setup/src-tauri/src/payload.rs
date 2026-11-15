#![allow(dead_code)]
//! Embedded installer payload. Without the `payload` feature (dev/test builds) everything is empty.

use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ManifestEntry {
    /// Path relative to the install dir, e.g. "app.exe", "binaries/pdfium.dll", "_up_/LICENSE".
    pub rel: String,
    pub size: u64,
}

#[cfg(feature = "payload")]
static NSIS: &[u8] = include_bytes!(env!("IWAE_SETUP_NSIS"));
#[cfg(not(feature = "payload"))]
static NSIS: &[u8] = &[];

#[cfg(feature = "payload")]
static UNINSTALL_UI: &[u8] = include_bytes!(env!("IWAE_SETUP_UNINSTALL_UI"));
#[cfg(not(feature = "payload"))]
static UNINSTALL_UI: &[u8] = &[];

#[cfg(feature = "payload")]
static MANIFEST: &[u8] = include_bytes!(env!("IWAE_SETUP_MANIFEST"));
#[cfg(not(feature = "payload"))]
static MANIFEST: &[u8] = &[];

pub fn nsis_bytes() -> &'static [u8] {
    NSIS
}

pub fn uninstall_ui_bytes() -> &'static [u8] {
    UNINSTALL_UI
}

/// Files the NSIS installer writes, with sizes. Empty without the payload.
pub fn manifest() -> Vec<ManifestEntry> {
    parse_manifest(MANIFEST)
}

fn parse_manifest(json: &[u8]) -> Vec<ManifestEntry> {
    if json.is_empty() {
        return Vec::new();
    }
    serde_json::from_slice(json).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_manifest_json() {
        let m = parse_manifest(br#"[{"rel":"app.exe","size":10},{"rel":"_up_/LICENSE","size":3}]"#);
        assert_eq!(m.len(), 2);
        assert_eq!(m[0], ManifestEntry { rel: "app.exe".into(), size: 10 });
        assert_eq!(m[1].rel, "_up_/LICENSE");
    }

    #[test]
    fn empty_or_bad_manifest_is_empty() {
        assert!(parse_manifest(b"").is_empty());
        assert!(parse_manifest(b"not json").is_empty());
    }
}
