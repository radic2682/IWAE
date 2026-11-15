#![allow(dead_code)]
//! Version comparison for fresh/upgrade/same/downgrade decisions.

use std::cmp::Ordering;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallKind {
    Fresh,
    Upgrade,
    Same,
    Downgrade,
}

/// Three numeric parts; pre-release/build suffix is ignored. None when unparseable.
fn parse(v: &str) -> Option<(u64, u64, u64)> {
    let core = v.trim().trim_start_matches('v');
    let core = core.split(|c| c == '-' || c == '+').next()?;
    let mut parts = core.split('.');
    let a = parts.next()?.parse().ok()?;
    let b = parts.next()?.parse().ok()?;
    let c = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((a, b, c))
}

pub fn install_kind(installed: Option<&str>, this: &str) -> InstallKind {
    let Some(installed) = installed else {
        return InstallKind::Fresh;
    };
    // An unreadable installed version counts as older.
    let Some(old) = parse(installed) else {
        return InstallKind::Upgrade;
    };
    let Some(new) = parse(this) else {
        return InstallKind::Upgrade;
    };
    match old.cmp(&new) {
        Ordering::Less => InstallKind::Upgrade,
        Ordering::Equal => InstallKind::Same,
        Ordering::Greater => InstallKind::Downgrade,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds() {
        assert_eq!(install_kind(None, "0.2.7"), InstallKind::Fresh);
        assert_eq!(install_kind(Some("0.2.6"), "0.2.7"), InstallKind::Upgrade);
        assert_eq!(install_kind(Some("0.2.7"), "0.2.7"), InstallKind::Same);
        assert_eq!(install_kind(Some("0.2.8"), "0.2.7"), InstallKind::Downgrade);
        assert_eq!(install_kind(Some("0.2.10"), "0.2.9"), InstallKind::Downgrade);
        assert_eq!(install_kind(Some("junk"), "0.2.7"), InstallKind::Upgrade);
    }

    #[test]
    fn prerelease_ignored() {
        assert_eq!(install_kind(Some("0.2.7-beta.1"), "0.2.7"), InstallKind::Same);
    }
}
