#![allow(dead_code)]
//! Registry access for the setup window. `RegStore` abstracts it so tests use `MemReg`
//! and never touch the real IWAE keys.
use std::cell::RefCell;
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Hive {
    Hkcu,
    Hklm,
    /// HKLM through the 32-bit (WOW6432Node) view.
    Hklm32,
}

pub trait RegStore {
    fn get_str(&self, hive: Hive, key: &str, name: &str) -> Option<String>;
    fn set_str(&self, hive: Hive, key: &str, name: &str, value: &str) -> io::Result<()>;
    fn delete_tree(&self, hive: Hive, key: &str) -> io::Result<()>;
    fn is_empty_key(&self, hive: Hive, key: &str) -> bool;
    fn subkeys(&self, hive: Hive, key: &str) -> Vec<String>;
}

pub const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\IWAE";
const UNINSTALL_ROOT: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";
const LEFTOVER_KEY: &str = r"Software\iwae\IWAE";
const LEFTOVER_PARENT: &str = r"Software\iwae";
const WEBVIEW2_KEY: &str =
    r"Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

pub struct ExistingInstall {
    pub dir: PathBuf,
    pub version: String,
}

/// Reads the per-user install. Whether the folder still exists is the caller's call.
pub fn existing_install(reg: &dyn RegStore) -> Option<ExistingInstall> {
    let loc = reg.get_str(Hive::Hkcu, UNINSTALL_KEY, "InstallLocation")?;
    let loc = loc.trim().trim_matches('"').trim();
    if loc.is_empty() {
        return None;
    }
    let version = reg
        .get_str(Hive::Hkcu, UNINSTALL_KEY, "DisplayVersion")
        .unwrap_or_default();
    Some(ExistingInstall {
        dir: PathBuf::from(loc),
        version,
    })
}

/// True when an old per-machine (MSI) IWAE install is registered.
pub fn msi_install_present(reg: &dyn RegStore) -> bool {
    [Hive::Hklm, Hive::Hklm32].into_iter().any(|hive| {
        reg.subkeys(hive, UNINSTALL_ROOT).iter().any(|sub| {
            let key = format!(r"{}\{}", UNINSTALL_ROOT, sub);
            reg.get_str(hive, &key, "DisplayName").as_deref() == Some("IWAE")
                && reg.get_str(hive, &key, "WindowsInstaller").as_deref() == Some("1")
        })
    })
}

pub fn webview2_present(reg: &dyn RegStore) -> bool {
    [Hive::Hklm32, Hive::Hklm, Hive::Hkcu].into_iter().any(|hive| {
        reg.get_str(hive, WEBVIEW2_KEY, "pv")
            .map(|pv| {
                let pv = pv.trim();
                !pv.is_empty() && pv != "0.0.0.0"
            })
            .unwrap_or(false)
    })
}

/// Makes Apps & features start the setup window's uninstall UI instead of the NSIS uninstaller.
pub fn point_uninstall_to_ui(reg: &dyn RegStore, install_dir: &Path) -> io::Result<()> {
    let dir = install_dir.display();
    reg.set_str(
        Hive::Hkcu,
        UNINSTALL_KEY,
        "UninstallString",
        &format!("\"{dir}\\uninstall-ui.exe\" --uninstall"),
    )?;
    reg.set_str(
        Hive::Hkcu,
        UNINSTALL_KEY,
        "QuietUninstallString",
        &format!("\"{dir}\\uninstall.exe\" /S"),
    )
}

pub fn remove_leftover_keys(reg: &dyn RegStore) -> io::Result<()> {
    reg.delete_tree(Hive::Hkcu, LEFTOVER_KEY)?;
    if reg.is_empty_key(Hive::Hkcu, LEFTOVER_PARENT) {
        reg.delete_tree(Hive::Hkcu, LEFTOVER_PARENT)?;
    }
    Ok(())
}

// ---------- real registry ----------

#[cfg(windows)]
pub struct WinReg;

#[cfg(windows)]
impl WinReg {
    fn open(hive: Hive, key: &str) -> io::Result<winreg::RegKey> {
        use winreg::enums::*;
        use winreg::RegKey;
        match hive {
            Hive::Hkcu => RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(key, KEY_READ),
            Hive::Hklm => RegKey::predef(HKEY_LOCAL_MACHINE)
                .open_subkey_with_flags(key, KEY_READ | KEY_WOW64_64KEY),
            Hive::Hklm32 => RegKey::predef(HKEY_LOCAL_MACHINE)
                .open_subkey_with_flags(key, KEY_READ | KEY_WOW64_32KEY),
        }
    }
}

#[cfg(windows)]
fn hklm_denied() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "HKLM is read-only for the setup window",
    )
}

#[cfg(windows)]
impl RegStore for WinReg {
    fn get_str(&self, hive: Hive, key: &str, name: &str) -> Option<String> {
        let k = Self::open(hive, key).ok()?;
        if let Ok(s) = k.get_value::<String, _>(name) {
            return Some(s);
        }
        // WindowsInstaller is a DWORD; give it back as decimal text.
        k.get_value::<u32, _>(name).ok().map(|n| n.to_string())
    }

    fn set_str(&self, hive: Hive, key: &str, name: &str, value: &str) -> io::Result<()> {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        if hive != Hive::Hkcu {
            return Err(hklm_denied());
        }
        let (k, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(key)?;
        k.set_value(name, &value)
    }

    fn delete_tree(&self, hive: Hive, key: &str) -> io::Result<()> {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        if hive != Hive::Hkcu {
            return Err(hklm_denied());
        }
        match RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(key) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            other => other,
        }
    }

    fn is_empty_key(&self, hive: Hive, key: &str) -> bool {
        match Self::open(hive, key) {
            Err(_) => true,
            Ok(k) => k
                .query_info()
                .map(|i| i.sub_keys == 0 && i.values == 0)
                .unwrap_or(false),
        }
    }

    fn subkeys(&self, hive: Hive, key: &str) -> Vec<String> {
        match Self::open(hive, key) {
            Err(_) => Vec::new(),
            Ok(k) => k.enum_keys().filter_map(|r| r.ok()).collect(),
        }
    }
}

// ---------- in-memory fake ----------

type KeyId = (Hive, String);

/// In-memory registry. Key paths and value names are matched case-insensitively
/// (stored lowercased), like the real one, so `subkeys` returns lowercased names.
#[derive(Default)]
pub struct MemReg {
    keys: RefCell<HashMap<KeyId, HashMap<String, String>>>,
}

fn norm(key: &str) -> String {
    key.trim_matches('\\').to_lowercase()
}

impl MemReg {
    pub fn new() -> Self {
        Self::default()
    }

    /// Seeds one value (test setup).
    pub fn with(self, hive: Hive, key: &str, name: &str, value: &str) -> Self {
        self.keys
            .borrow_mut()
            .entry((hive, norm(key)))
            .or_default()
            .insert(name.to_lowercase(), value.to_string());
        self
    }

    fn children(&self, hive: Hive, key: &str) -> Vec<String> {
        let prefix = format!("{}\\", norm(key));
        let mut out: Vec<String> = Vec::new();
        for (h, path) in self.keys.borrow().keys() {
            if *h != hive {
                continue;
            }
            if let Some(rest) = path.strip_prefix(&prefix) {
                let first = rest.split('\\').next().unwrap_or("").to_string();
                if !first.is_empty() && !out.contains(&first) {
                    out.push(first);
                }
            }
        }
        out
    }
}

impl RegStore for MemReg {
    fn get_str(&self, hive: Hive, key: &str, name: &str) -> Option<String> {
        self.keys
            .borrow()
            .get(&(hive, norm(key)))
            .and_then(|vals| vals.get(&name.to_lowercase()).cloned())
    }

    fn set_str(&self, hive: Hive, key: &str, name: &str, value: &str) -> io::Result<()> {
        if hive != Hive::Hkcu {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "HKLM is read-only"));
        }
        self.keys
            .borrow_mut()
            .entry((hive, norm(key)))
            .or_default()
            .insert(name.to_lowercase(), value.to_string());
        Ok(())
    }

    fn delete_tree(&self, hive: Hive, key: &str) -> io::Result<()> {
        if hive != Hive::Hkcu {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "HKLM is read-only"));
        }
        let root = norm(key);
        let prefix = format!("{root}\\");
        self.keys
            .borrow_mut()
            .retain(|(h, path), _| !(*h == hive && (*path == root || path.starts_with(&prefix))));
        Ok(())
    }

    fn is_empty_key(&self, hive: Hive, key: &str) -> bool {
        let has_values = self
            .keys
            .borrow()
            .get(&(hive, norm(key)))
            .map(|v| !v.is_empty())
            .unwrap_or(false);
        !has_values && self.children(hive, key).is_empty()
    }

    fn subkeys(&self, hive: Hive, key: &str) -> Vec<String> {
        self.children(hive, key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seeded() -> MemReg {
        MemReg::new()
            .with(
                Hive::Hkcu,
                UNINSTALL_KEY,
                "InstallLocation",
                r#""D:\테스트 폴더\IWAE""#,
            )
            .with(Hive::Hkcu, UNINSTALL_KEY, "DisplayVersion", "0.2.6")
    }

    #[test]
    fn existing_install_strips_quotes() {
        let e = existing_install(&seeded()).unwrap();
        assert_eq!(e.dir, PathBuf::from(r"D:\테스트 폴더\IWAE"));
        assert_eq!(e.version, "0.2.6");
    }

    #[test]
    fn existing_install_none_when_missing() {
        assert!(existing_install(&MemReg::new()).is_none());
    }

    #[test]
    fn existing_install_does_not_check_folder() {
        // The folder does not exist on this machine; still Some.
        assert!(existing_install(&seeded()).is_some());
    }

    #[test]
    fn point_uninstall_writes_both_strings() {
        let reg = seeded();
        point_uninstall_to_ui(&reg, Path::new(r"D:\테스트 폴더\IWAE")).unwrap();
        assert_eq!(
            reg.get_str(Hive::Hkcu, UNINSTALL_KEY, "UninstallString").unwrap(),
            r#""D:\테스트 폴더\IWAE\uninstall-ui.exe" --uninstall"#
        );
        assert_eq!(
            reg.get_str(Hive::Hkcu, UNINSTALL_KEY, "QuietUninstallString").unwrap(),
            r#""D:\테스트 폴더\IWAE\uninstall.exe" /S"#
        );
    }

    #[test]
    fn leftover_keys_removed_and_empty_parent_deleted() {
        let reg = MemReg::new().with(Hive::Hkcu, r"Software\iwae\IWAE", "x", "1");
        remove_leftover_keys(&reg).unwrap();
        assert!(reg.get_str(Hive::Hkcu, r"Software\iwae\IWAE", "x").is_none());
        assert!(reg.is_empty_key(Hive::Hkcu, r"Software\iwae"));
    }

    #[test]
    fn leftover_parent_kept_when_other_subkey_exists() {
        let reg = MemReg::new()
            .with(Hive::Hkcu, r"Software\iwae\IWAE", "x", "1")
            .with(Hive::Hkcu, r"Software\iwae\Other", "y", "2");
        remove_leftover_keys(&reg).unwrap();
        assert!(!reg.is_empty_key(Hive::Hkcu, r"Software\iwae"));
        assert_eq!(reg.subkeys(Hive::Hkcu, r"Software\iwae"), vec!["other".to_string()]);
        assert_eq!(reg.get_str(Hive::Hkcu, r"Software\iwae\Other", "Y").unwrap(), "2");
    }

    #[test]
    fn webview2_detection() {
        let zero = MemReg::new().with(Hive::Hklm32, WEBVIEW2_KEY, "pv", "0.0.0.0");
        assert!(!webview2_present(&zero));
        let ok = MemReg::new().with(Hive::Hklm32, WEBVIEW2_KEY, "pv", "131.0.2903.70");
        assert!(webview2_present(&ok));
        assert!(!webview2_present(&MemReg::new()));
    }

    #[test]
    fn msi_detection() {
        let key = format!(r"{}\{{ABC}}", UNINSTALL_ROOT);
        let reg = MemReg::new()
            .with(Hive::Hklm, &key, "DisplayName", "IWAE")
            .with(Hive::Hklm, &key, "WindowsInstaller", "1");
        assert!(msi_install_present(&reg));
        let other = MemReg::new().with(Hive::Hklm, &key, "DisplayName", "Other");
        assert!(!msi_install_present(&other));
        // The per-user NSIS entry is not an MSI install.
        assert!(!msi_install_present(&seeded()));
    }

    #[test]
    fn hklm_writes_are_denied() {
        let reg = MemReg::new();
        let e = reg.set_str(Hive::Hklm, "Software\\x", "a", "b").unwrap_err();
        assert_eq!(e.kind(), io::ErrorKind::PermissionDenied);
    }
}
