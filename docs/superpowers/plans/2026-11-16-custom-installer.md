# IWAE Setup Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `IWAE_x.y.z_x64-setup.exe` as a small Tauri app (one night-sky window) that runs the existing Tauri NSIS installer silently and handles install, update and uninstall.

**Architecture:** A separate Tauri 2 app in `setup/` (Rust in `setup/src-tauri`, plain TS/CSS UI in `setup/ui` built by Vite). A release build embeds the NSIS `-setup.exe` that `tauri build` already produces, plus a payload-free copy of itself used as `uninstall-ui.exe`. Rust does the work behind small traits (`RegStore`, `NsisRunner`, `ProcessControl`), so every decision is unit-tested with fakes. The real NSIS install/update/uninstall paths are tested only in a clean Windows (Task 10), never on this PC.

**Tech Stack:**
- **Setup app:** Tauri 2.11.3, Rust (edition 2021, rust-version 1.77.2), `winreg`, `windows` 0.61, `tauri-plugin-dialog` 2.
- **UI:** TypeScript and Vite 8. Tests run in vitest 5.
- **Scripts:** Node release scripts tested with `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-16-custom-installer-design.md` (Korean). Executors read both. Section numbers below (§) refer to the spec.

## Global Constraints

- **Never install, update or uninstall IWAE on this PC.** Do not run the real setup exe without `--demo`, do not run any `IWAE_*-setup.exe` or `uninstall.exe`, and do not touch `%LOCALAPPDATA%\IWAE` or `HKCU\...\Uninstall\IWAE`. The owner's installed IWAE lives there.
- Never touch CDP ports 9223 or 9224. Use 9225 for the setup window audit.
- Build Rust with `CARGO_TARGET_DIR=C:/Users/ash86/AppData/Local/Temp/claude/65042131baae434c/96de63b7-1ec8-4a94-9486-e987eb76c8c6/scratchpad/cargo-target-setup` while developing. Never build into `src-tauri/target`, except the final release script run done by the lead.
- Setup Tauri identifier: `dev.iwae.setup`. Window title: `IWAE 설치` / `IWAE Setup`. No executable this app produces or copies may be named `app.exe`.
- Window: no decorations, 480×320 logical px, not resizable, centred, shadow on (Windows 11 rounded corners).
- UI colours and fonts:
  - Background gradient `radial-gradient(ellipse at 50% 42%, #1b2230 0%, #11141a 58%, #0b0d11 100%)`.
  - Accent `#2f6fb0`, text `#f4f6fa`, radius 6px.
  - Font stack `"Segoe UI Variable","Segoe UI","Malgun Gothic",sans-serif`.
  - Logo: `public/iwae-logo.png`.
- UI copy: use the exact strings in Task 8. Korean is 합니다체 and says 「버전」, never 「판」. No em-dash connectors.
- `npm run release:scan` must pass.
- CSP for the setup window: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ipc: http://ipc.localhost`. Do not loosen the app's own CSP or capabilities.
- Commits:
  - English messages, with no mention of Claude and no Co-Authored-By line.
  - Stage explicit paths only (never `git add -A`).
  - Never push.
- Never print or open signing secrets (`C:\Users\ash86\.iwae-release`, `C:\Workspace\.iwae-release\release.env`). Scripts read them from the environment only.
- Tauri NSIS facts the code relies on (§3):
  - The updater runs the exe with `/P /R /UPDATE /ARGS <escaped app args>`.
  - NSIS `/D=<dir>` must be the last argument and is unquoted.
  - `/S` kills a running `app.exe` without asking.
  - A `/S` fresh install creates `Desktop\IWAE.lnk`.
  - `uninstall.exe /S` keeps app data but leaves `HKCU\Software\iwae\IWAE`.
  - Uninstall key: `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\IWAE`.

## Review Focus

1. **Install path with spaces or non-ASCII characters** (`C:\Users\김 지원\AppData\Local\IWAE`). Every command line we build (`/D=`, `_?=`, `UninstallString`, the relaunch args) must survive it. Pinned by tests in Tasks 2, 4 and 6.
2. **The updater passes app args containing quotes, spaces or `/`** (a PDF path opened at update time). They must reach the relaunched app unchanged. Pinned in Task 2.
3. **The setup window is closed or killed mid-install.** The next run must succeed and must not run the old uninstaller twice against a half-written folder. Pinned in Task 4 (old uninstaller skipped when `uninstall.exe` is missing) and Task 10 scenario 8.
4. **The registry points at a folder that no longer exists** (the user deleted the folder by hand). Treat it as a fresh install into that path and do not fail. Pinned in Task 3.
5. **`installer-language` holds garbage or BOM-prefixed text.** Fall back to the Windows language, never panic. Pinned in Task 2.

---

## File Structure

```
setup/
  package-free (no own package.json; root package.json scripts drive it)
  vite.config.ts            UI build -> setup/dist
  ui/index.html
  ui/main.ts                DOM rendering, invoke/listen wiring only
  ui/copy.ts                every user-facing string, ko + en
  ui/screen.ts              pure: state -> what the window shows
  ui/screen.test.ts
  ui/starfield.ts           canvas stars, respects prefers-reduced-motion
  ui/setup.css
  src-tauri/Cargo.toml      crate iwae-setup, feature "payload"
  src-tauri/build.rs        tauri-build + embeds payload paths when feature on
  src-tauri/tauri.conf.json
  src-tauri/capabilities/default.json
  src-tauri/icons/          copied from src-tauri/icons (icon.ico, 32x32, 128x128)
  src-tauri/src/main.rs     entry: parse mode -> headless path or Tauri window
  src-tauri/src/args.rs     command line -> Mode; /D= and /ARGS parsing
  src-tauri/src/lang.rs     Lang, default language, LCID file read/write
  src-tauri/src/version.rs  semver compare -> InstallKind
  src-tauri/src/registry.rs RegStore trait, WinReg, MemReg, IWAE-specific queries/writes
  src-tauri/src/payload.rs  embedded NSIS + uninstall-ui bytes + file manifest
  src-tauri/src/progress.rs bytes-written progress
  src-tauri/src/nsis.rs     NsisRunner trait, real runner, argument builders
  src-tauri/src/apprun.rs   ProcessControl trait: find/close/kill/launch app.exe
  src-tauri/src/install.rs  install/update pipeline (steps 1-9 of §6.2)
  src-tauri/src/uninstall.rs uninstall UI + sync pass-through (§6.3)
  src-tauri/src/log.rs      %TEMP%\IWAE-setup-<timestamp>.log
  src-tauri/src/commands.rs Tauri commands + events for the UI
  src-tauri/src/demo.rs     debug-only fakes for --demo
  tests/vm/run-vm-tests.ps1 clean-Windows scenarios (Task 10)
scripts/build-setup.mjs     release step: build UI, payload-free exe, payload exe, sign
scripts/build-setup.test.mjs
```

Modified:
- `package.json` (scripts)
- `vitest.config.ts` (include `setup/ui/**/*.test.ts`)
- `scripts/release-local.mjs` and `.test.mjs` (take the setup exe from `bundle/setup`)
- `.gitignore` (`setup/dist/`, `setup/src-tauri/target/`, `setup/src-tauri/gen/`)
- `THIRD_PARTY_NOTICES.md` (new crates)

---

### Task 1: Scaffold the setup app with a demo window

**Files:**
- Create:
  - `setup/vite.config.ts`
  - `setup/ui/index.html`, `setup/ui/main.ts` (placeholder render), `setup/ui/setup.css`
  - `setup/src-tauri/{Cargo.toml,build.rs,tauri.conf.json,capabilities/default.json}`
  - `setup/src-tauri/src/main.rs`
  - `setup/src-tauri/icons/*` (copied)
- Modify: `package.json`, `vitest.config.ts`, `.gitignore`

**Interfaces:**
- Produces:
  - npm scripts:
    - `setup:ui` = `vite build --config setup/vite.config.ts`
    - `setup:dev` = runs `tauri dev` for the setup app with `--demo`
  - Cargo feature `payload` (off by default).
  - `const APP_VERSION: &str = env!("IWAE_APP_VERSION")`, set by `build.rs` from the root `package.json` `version`.

- [ ] **Step 1:** Create the crate.
  - `name = "iwae-setup"`, `[[bin]] name = "iwae-setup"`. An empty `[workspace]` table keeps it standalone.
  - Deps: `tauri = "2.11.3"`, `tauri-build = "2.6.3"`, `serde` (derive), `serde_json`, `tauri-plugin-dialog = "2"`.
  - `tauri.conf.json`:
    - `identifier "dev.iwae.setup"`, `productName "IWAE Setup"`, `mainBinaryName "iwae-setup"`.
    - `version "../../package.json"`.
    - `frontendDist "../dist"`, `devUrl "http://localhost:5181"`.
    - `bundle.active false`.
    - One window `"main"` with `visible false` (shown from Rust after the first paint), the Global Constraints size and decorations, and the CSP.
  - Capability: `core:default`, `core:window:allow-start-dragging`, `core:window:allow-close`, `core:event:default`, `dialog:allow-open`.
- [ ] **Step 2:** `setup/vite.config.ts`: `root: 'setup/ui'`, `build.outDir: '../dist'`, `server.port: 5181`, `publicDir: false`. Copy `public/iwae-logo.png` into the build as `iwae-logo.png` via a static import in `main.ts`.
- [ ] **Step 3:** Add `setup/ui/**/*.test.ts` to `vitest.config.ts` `include`, and add the three `.gitignore` lines.
- [ ] **Step 4:** Verify:
  - Run `npm run setup:ui`. Expected: `setup/dist/index.html` exists.
  - Run `cargo build --manifest-path setup/src-tauri/Cargo.toml` with the scratch `CARGO_TARGET_DIR`. Expected: it builds `iwae-setup.exe`.
- [ ] **Step 5:** Commit: "Scaffold the setup window app".

### Task 2: Command line, language and version rules

**Files:**
- Create: `setup/src-tauri/src/{args.rs,lang.rs,version.rs}`. Tests go in `#[cfg(test)] mod tests` in each file.

**Interfaces:**
- Produces:
  ```rust
  pub enum Mode {
      Install { demo: DemoFlags },
      Update { app_args: Vec<OsString> },               // /UPDATE present (with or without /P /R)
      Silent { install_dir: Option<PathBuf> },          // /S present, no /UPDATE
      Uninstall,                                        // --uninstall
      UninstallSync { args: Vec<OsString> },            // _?= present (called by an old NSIS wizard)
      UninstallTemp { install_dir: PathBuf },           // --uninstall-from-temp <dir> (self-copy relaunch)
  }
  pub struct DemoFlags { pub enabled: bool, pub existing: Option<String>, pub running: bool, pub fail: bool }
  pub fn parse_mode(args: &[OsString]) -> Mode;          // args excludes argv[0]
  pub enum Lang { Ko, En }  impl Lang { pub fn lcid(self) -> u16 /*1042|1033*/; pub fn code(self) -> &'static str /*"ko"|"en"*/ }
  pub fn default_lang(installer_language_file: Option<&str>, windows_ui_lang: u16) -> Lang;
  pub fn read_installer_language(install_dir: &Path) -> Option<String>;
  pub fn write_installer_language(install_dir: &Path, lang: Lang) -> io::Result<()>;   // ASCII digits, no BOM, no newline
  pub fn windows_ui_language() -> u16;                   // GetUserDefaultUILanguage, primary lang id
  pub enum InstallKind { Fresh, Upgrade, Same, Downgrade }
  pub fn install_kind(installed: Option<&str>, this: &str) -> InstallKind;
  ```
- `--demo*` flags (`--demo`, `--demo-existing=0.2.6`, `--demo-running`, `--demo-fail`) are honoured only under `cfg(debug_assertions)`. In release builds they are ignored.

- [ ] **Step 1: Write failing tests**
  - `parse_mode` cases:
    - `[]` gives `Install`.
    - `["/P","/R","/UPDATE","/ARGS"]` gives `Update{app_args: []}`.
    - `["/P","/R","/UPDATE","/ARGS","C:\\문서 폴더\\a b.pdf","--flag=/x"]` gives `Update` with exactly those two args.
    - `["/S"]` gives `Silent{None}`.
    - `["/S","/D=C:\\Users\\김 지원\\AppData\\Local\\IWAE"]` gives `Silent{Some(that path with the space)}`.
    - `["--uninstall"]` gives `Uninstall`.
    - `["/S","/UPDATE","_?=C:\\x y"]` gives `UninstallSync` with all three args kept.
    - In release (`not(debug_assertions)`), `["--demo"]` gives `Install` with `demo.enabled == false`.
  - `default_lang` cases:
    - `(Some("1042"), 0x09)` gives Ko.
    - `(Some("\u{feff}1033"), 0x12)` gives En.
    - `(Some("garbage"), 0x12)` gives Ko.
    - `(None, 0x12)` gives Ko.
    - `(None, 0x09)` gives En.
  - `install_kind` cases:
    - `(None,"0.2.7")` gives Fresh.
    - `("0.2.6","0.2.7")` gives Upgrade.
    - `("0.2.7","0.2.7")` gives Same.
    - `("0.2.8","0.2.7")` gives Downgrade.
    - `("0.2.10","0.2.9")` gives Downgrade.
    - `("junk","0.2.7")` gives Upgrade (unknown installed version is treated as older).
  - `write_installer_language` then `read_installer_language` round-trips `"1042"`.
- [ ] **Step 2:** Run `cargo test --manifest-path setup/src-tauri/Cargo.toml`. Expected: FAIL, functions undefined.
- [ ] **Step 3:** Implement. `/D=` takes the remainder of that single argv element; NSIS rules say it is last. `/ARGS` takes every following element unchanged. Parse semver as three numeric parts and ignore pre-release.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: "Parse setup modes, language and versions".

### Task 3: Registry layer

**Files:**
- Create: `setup/src-tauri/src/registry.rs`
- Modify: `Cargo.toml` (add `winreg`)

**Interfaces:**
- Produces:
  ```rust
  pub trait RegStore {
      fn get_str(&self, hive: Hive, key: &str, name: &str) -> Option<String>;
      fn set_str(&self, hive: Hive, key: &str, name: &str, value: &str) -> io::Result<()>;
      fn delete_tree(&self, hive: Hive, key: &str) -> io::Result<()>;
      fn is_empty_key(&self, hive: Hive, key: &str) -> bool;
      fn subkeys(&self, hive: Hive, key: &str) -> Vec<String>;
  }
  pub enum Hive { Hkcu, Hklm, Hklm32 }   // Hklm32 = WOW6432Node view
  pub struct WinReg; pub struct MemReg { /* HashMap */ }  // MemReg is pub for other modules' tests
  pub const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\IWAE";
  pub struct ExistingInstall { pub dir: PathBuf, pub version: String }
  pub fn existing_install(reg: &dyn RegStore) -> Option<ExistingInstall>;     // HKCU InstallLocation (strip quotes) + DisplayVersion
  pub fn msi_install_present(reg: &dyn RegStore) -> bool;                    // an HKLM/Hklm32 Uninstall\{GUID} whose DisplayName == "IWAE" and WindowsInstaller == 1
  pub fn webview2_present(reg: &dyn RegStore) -> bool;                       // pv of {F3017226-FE2A-4295-8BDF-00C3A9A7E4C5} under HKLM32/HKLM/HKCU Software\Microsoft\EdgeUpdate\Clients, non-empty and != "0.0.0.0"
  pub fn point_uninstall_to_ui(reg: &dyn RegStore, install_dir: &Path) -> io::Result<()>;
  pub fn remove_leftover_keys(reg: &dyn RegStore) -> io::Result<()>;        // delete HKCU Software\iwae\IWAE, then Software\iwae if empty
  ```

- [ ] **Step 1: Write failing tests on `MemReg`**
  - `existing_install` returns dir `C:\Users\김 지원\AppData\Local\IWAE` (outer quotes stripped) and version `0.2.6`.
  - It returns `None` when the key is missing.
  - It still returns `Some` when the folder doesn't exist. Folder existence is decided in Task 4.
  - `point_uninstall_to_ui` writes:
    - `UninstallString` = `"C:\Users\김 지원\AppData\Local\IWAE\uninstall-ui.exe" --uninstall`
    - `QuietUninstallString` = `"C:\Users\김 지원\AppData\Local\IWAE\uninstall.exe" /S`
  - `remove_leftover_keys`:
    - It deletes `Software\iwae\IWAE`.
    - It keeps `Software\iwae` when another subkey exists and deletes it when empty.
  - `webview2_present`:
    - False for `pv="0.0.0.0"`.
    - True for `pv="131.0.2903.70"` under Hklm32.
  - `msi_install_present`: true for an Hklm entry `{ABC}` with `DisplayName=IWAE` and `WindowsInstaller=1`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. `WinReg` uses `winreg`, with `KEY_WOW64_32KEY` for `Hklm32`. HKLM is read-only for us (`set_str` and `delete_tree` on HKLM return `PermissionDenied`).
- [ ] **Step 4:** Run the tests. Expected: PASS. Do not run any `WinReg` write against the real HKCU uninstall key in tests.
- [ ] **Step 5:** Commit: "Add registry access for the setup window".

### Task 4: Install and update pipeline

**Files:**
- Create: `setup/src-tauri/src/{payload.rs,progress.rs,nsis.rs,log.rs,install.rs}`

**Interfaces:**
- Consumes:
  - Task 2: `Mode`, `Lang`, `InstallKind`, `write_installer_language`.
  - Task 3: `RegStore`, `existing_install`, `msi_install_present`, `webview2_present`, `point_uninstall_to_ui`.
- Produces:
  ```rust
  // payload.rs
  pub struct ManifestEntry { pub rel: String, pub size: u64 }        // e.g. "app.exe", "binaries/pdfium.dll", "_up_/LICENSE"
  pub fn nsis_bytes() -> &'static [u8];      // empty slice without feature "payload"
  pub fn uninstall_ui_bytes() -> &'static [u8];
  pub fn manifest() -> Vec<ManifestEntry>;   // parsed from embedded JSON [{rel,size}]
  // progress.rs
  pub fn percent(manifest: &[ManifestEntry], dir: &Path, since: SystemTime, finished: bool) -> u8; // counts a file only if mtime >= since, min(size, expected); <=95 until finished, then 100
  // nsis.rs
  pub enum NsisRun { Silent { update: bool, dir: Option<PathBuf> }, Passive { update: bool } }
  pub fn nsis_args(run: &NsisRun) -> Vec<OsString>;   // Silent{false,Some(d)} -> ["/S", "/D=<d>"]; Silent{true,None} -> ["/S","/UPDATE"]; Passive{true} -> ["/P","/UPDATE"]
  pub fn old_uninstall_args(dir: &Path) -> Vec<OsString>;  // ["/S","/UPDATE","_?=<dir>"]
  pub trait NsisRunner { fn run(&self, exe: &Path, args: &[OsString]) -> io::Result<i32>; }   // blocks, returns exit code
  // install.rs
  pub struct InstallRequest { pub mode_update: bool, pub dir_override: Option<PathBuf>, pub lang: Lang, pub silent: bool }
  pub enum InstallEvent { Progress(u8), Done { install_dir: PathBuf }, Failed { reason: FailReason, log: PathBuf } }
  pub enum FailReason { Extract, OldUninstall(i32), Nsis(i32), Finish }
  pub struct Env<'a> { pub reg: &'a dyn RegStore, pub nsis: &'a dyn NsisRunner, pub temp: PathBuf, pub desktop: PathBuf, pub default_dir: PathBuf }
  pub fn plan_fallback(env: &Env) -> bool;   // true when WebView2 missing or MSI install present -> run NSIS Passive, no window
  pub fn run_install(env: &Env, req: &InstallRequest, on: &mut dyn FnMut(InstallEvent));
  ```
- `run_install` steps (§6.2 steps 2–9):
  1. Extract `nsis_bytes()` to `<temp>\iwae-setup-<pid>\IWAE-inner-setup.exe`.
  2. If an existing install has `<dir>\uninstall.exe` present and the target dir equals that dir, run `old_uninstall_args`. A non-zero exit gives `Failed(OldUninstall)`. If `uninstall.exe` is missing, skip this step (Review Focus 3).
  3. Remember whether `<desktop>\IWAE.lnk` existed.
  4. Run NSIS with `NsisRun::Silent{update: req.mode_update, dir: req.dir_override}` on a worker thread, emitting `Progress(percent(...))` every 150 ms.
  5. On exit 0: delete the desktop link if it didn't exist before. Then `write_installer_language`, write `uninstall_ui_bytes()` to `<dir>\uninstall-ui.exe`, and only if that file now exists call `point_uninstall_to_ui`. Then delete the temp folder and emit `Done`.
  6. Log every step and exit code via `log.rs`.

- [ ] **Step 1: Write failing tests** with `MemReg`, a `FakeNsis` that records args and writes the manifest files into the dir, and temp dirs:
  - `nsis_args` exact vectors as above. The dir with spaces and Korean characters stays a single element `/D=C:\Users\김 지원\IWAE`.
  - `percent`:
    - 0 with no files.
    - 50 when half the bytes are written after `since`.
    - Ignores files older than `since`.
    - Capped at 95 when not finished; 100 when finished.
  - Fresh install:
    - FakeNsis gets `["/S"]`.
    - No old uninstall runs.
    - `installer-language` is `1042` for Ko.
    - `uninstall-ui.exe` exists.
    - `UninstallString` points at it.
    - `IWAE.lnk` created by FakeNsis is deleted.
  - Upgrade where `uninstall.exe` exists: the old uninstall runs first with `["/S","/UPDATE","_?=<dir>"]`, then NSIS.
  - Upgrade where `uninstall.exe` is missing: no old uninstall runs.
  - Desktop link existed before: it is kept.
  - NSIS exit 2: `Failed(Nsis(2))`, and `UninstallString` is unchanged.
  - Old uninstall exit 1: `Failed(OldUninstall(1))`, and NSIS never runs.
  - `plan_fallback`:
    - True when `webview2_present` is false.
    - True when an MSI install is present.
    - False otherwise.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. The real `NsisRunner` uses `std::process::Command` with `CREATE_NO_WINDOW` and `wait()`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: "Add the install and update pipeline".

### Task 5: Running IWAE detection, close, kill and launch

**Files:**
- Create: `setup/src-tauri/src/apprun.rs`
- Modify: `Cargo.toml` (`windows` 0.61 features: `Win32_System_Threading`, `Win32_System_ProcessStatus`, `Win32_UI_WindowsAndMessaging`, `Win32_Foundation`, `Win32_System_RemoteDesktop`)

**Interfaces:**
- Produces:
  ```rust
  pub trait ProcessControl {
      fn running_app_pids(&self, install_dir: &Path) -> Vec<u32>;   // processes whose image path == <dir>\app.exe, current session only
      fn request_close(&self, pid: u32);                            // PostMessage WM_CLOSE to that pid's top-level visible windows
      fn force_kill(&self, pid: u32);
      fn launch(&self, exe: &Path, args: &[OsString]) -> io::Result<()>;   // detached, no console
  }
  pub struct WinProcess;
  pub enum CloseOutcome { Closed, StillRunning }
  pub fn close_and_wait(pc: &dyn ProcessControl, dir: &Path, timeout: Duration, poll: Duration) -> CloseOutcome;
  pub fn wait_for_exit(pc: &dyn ProcessControl, dir: &Path, timeout: Duration) -> CloseOutcome;   // update mode: no WM_CLOSE, just wait (10 s)
  ```
- Close timeout is 15 s for the 「닫고 설치」 flow (§6.2 step 4) and 10 s for update mode.

- [ ] **Step 1: Write failing tests** with a `FakeProcesses` whose pids disappear after N polls:
  - `close_and_wait` gives `Closed` when they vanish before the timeout and `StillRunning` after it.
  - `request_close` is called exactly once per pid.
  - `wait_for_exit` never calls `request_close`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement `close_and_wait` and `wait_for_exit`, then `WinProcess`:
  - Use `EnumProcesses` and `QueryFullProcessImageNameW`, filtered by `ProcessIdToSessionId` equal to our session.
  - `request_close` uses `EnumWindows`, `GetWindowThreadProcessId` and `PostMessageW(WM_CLOSE)`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: "Detect and close a running IWAE before installing".

### Task 6: Uninstall flows

**Files:**
- Create: `setup/src-tauri/src/uninstall.rs`

**Interfaces:**
- Consumes:
  - Task 3: `RegStore`, `existing_install`, `remove_leftover_keys`.
  - Task 4: `NsisRunner` (also used to run `uninstall.exe`).
  - Task 5: `ProcessControl`.
- Produces:
  ```rust
  pub fn relaunch_from_temp(current_exe: &Path, install_dir: &Path, temp: &Path) -> io::Result<()>;   // copies to <temp>\iwae-uninstall-<pid>.exe, launches with --uninstall-from-temp <dir>
  pub enum UninstallEvent { Progress, Done, Failed { code: i32, log: PathBuf } }
  pub fn run_uninstall(reg: &dyn RegStore, runner: &dyn NsisRunner, install_dir: &Path, on: &mut dyn FnMut(UninstallEvent));
  pub fn run_sync_passthrough(runner: &dyn NsisRunner, current_exe_dir: &Path, args: &[OsString]) -> i32;   // runs <dir>\uninstall.exe with the same args, returns its code
  pub fn schedule_self_delete(exe: &Path);   // detached hidden `cmd /c ping -n 3 127.0.0.1 >nul & del /f /q "<exe>"`
  ```
- `run_uninstall` steps:
  1. Run `<dir>\uninstall.exe /S` and wait.
  2. On exit 0, delete `<dir>\uninstall-ui.exe`.
  3. Remove the dir if it is empty.
  4. Call `remove_leftover_keys`.
  5. Emit `Done`.
- On a non-zero exit, emit `Failed` and touch nothing else.

- [ ] **Step 1: Write failing tests:**
  - `run_uninstall` with FakeNsis exit 0:
    - The runner got `[<dir>\uninstall.exe, ["/S"]]`.
    - `uninstall-ui.exe` is gone.
    - The empty dir is gone.
    - `Software\iwae\IWAE` is deleted in MemReg.
  - With exit 3: `Failed{code:3}`, and the registry is untouched.
  - The dir holds a user file: the dir is kept.
  - `run_sync_passthrough` forwards `["/S","/UPDATE","_?=C:\\김 지원\\IWAE"]` unchanged and returns the fake's exit code.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: "Add uninstall flows for the setup window".

### Task 7: Wire modes, commands and the window

**Files:**
- Create: `setup/src-tauri/src/{commands.rs,demo.rs}`
- Modify: `setup/src-tauri/src/main.rs`

**Interfaces:**
- Consumes: everything above.
- Produces the Tauri commands (camelCase JSON) used by Task 8:
  ```
  get_context() -> { mode: "install"|"update"|"uninstall", lang: "ko"|"en", version: string,
                     existing: null | { version: string, kind: "upgrade"|"same"|"downgrade" },
                     installDir: string, defaultDir: string }
  set_lang(lang)                      -> ()
  pick_dir()                          -> string | null      // folder dialog; returns <picked>\IWAE when picked folder isn't named IWAE
  app_running()                       -> boolean
  close_app(force: boolean)           -> "closed" | "stillRunning"
  start_install(dir: string | null)   -> ()   // events below
  start_uninstall()                   -> ()
  open_app()                          -> ()   // launch <dir>\app.exe, then exit
  show_log()                          -> ()   // explorer /select,<log>
  quit()                              -> ()
  events: "setup://progress" {percent}, "setup://done" {}, "setup://failed" {reason, log}
  ```
- `main.rs` dispatch:
  - `Silent`: run the pipeline headless. Use `lang = default_lang(read_installer_language(existing dir), windows_ui_language())`. Exit with the NSIS code, or 1 on a finish failure.
  - `UninstallSync`: `run_sync_passthrough`, then exit with its code.
  - `Uninstall` (not from temp): `relaunch_from_temp`, then exit 0.
  - `Install`/`Update` where `plan_fallback` is true: run NSIS `Passive{update}`. Then do the finish steps from Task 4 step 5, but write the language as `default_lang`. No window.
  - Otherwise open the window.
- Update mode, inside the window:
  - Call `wait_for_exit` (10 s), then start the install immediately.
  - On `Done`, launch `app.exe` with `app_args` and exit.
  - On failure, 「닫기」 launches the previous `app.exe` with `app_args` if it exists.
- WebView2 user data folder: `<temp>\iwae-setup-webview-<pid>` via `WebviewWindowBuilder::data_directory`.
  - On `RunEvent::Exit`, try `remove_dir_all` five times, 200 ms apart.
  - If it still fails, run `schedule_self_delete`-style detached `rmdir /s /q`.
- Show the window only after the UI calls a `ready` command, so no white flash.
- Debug builds only: `--demo*` uses `demo.rs`:
  - a `MemReg` seeded from the flags
  - a `FakeNsis` that writes the manifest files over 4 s into `<temp>\iwae-setup-demo\IWAE` and fails with code 2 when `--demo-fail`
  - a `FakeProcesses` that reports running until `close_app` when `--demo-running`
  - Demo mode must never construct `WinReg`, the real `NsisRunner` or `WinProcess`.

- [ ] **Step 1:** Write a failing unit test: `commands::context_for(mode, reg, ...)` returns `existing.kind == "same"` for an installed `0.2.7` with this version `0.2.7`. Pull `context_for` out as a pure function so it is testable.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the commands, dispatch, data dir cleanup and demo.
- [ ] **Step 4:** Run `cargo test`. Expected: PASS. Then run `npm run setup:dev -- -- --demo` (with the scratch target). Expected: a frameless 480×320 window opens.
- [ ] **Step 5:** Commit: "Wire setup modes and commands to the window".

### Task 8: The night-sky UI

**Files:**
- Create: `setup/ui/{copy.ts,screen.ts,screen.test.ts,starfield.ts}`
- Modify: `setup/ui/{main.ts,setup.css,index.html}`

**Interfaces:**
- Consumes: Task 7 commands and events.
- Produces:
  ```ts
  export type Phase = 'start' | 'appRunning' | 'appStuck' | 'installing' | 'done' | 'failed'
                    | 'uninstallStart' | 'uninstalling' | 'uninstalled'
  export interface SetupState { mode: 'install'|'update'|'uninstall'; phase: Phase; lang: 'ko'|'en'; version: string;
                                existing: null | { version: string; kind: 'upgrade'|'same'|'downgrade' };
                                installDir: string; customDir: string | null; percent: number }
  export interface ScreenModel { title: string | null; sub: string | null; primary: { label: string; action: Action } | null;
                                 secondary: { label: string; action: Action } | null; link: { label: string; action: Action } | null;
                                 showVersion: boolean; progress: number | 'indeterminate' | null; closable: boolean; showLang: boolean }
  export type Action = 'install' | 'pickDir' | 'closeAndInstall' | 'forceClose' | 'cancel' | 'openApp' | 'retry' | 'showLog'
                     | 'close' | 'uninstall' | 'closeAndUninstall'
  export function screenFor(s: SetupState): ScreenModel
  ```
- Exact copy (`copy.ts`, keys are free, strings are fixed):

  | key | ko | en |
  |---|---|---|
  | install | 설치 | Install |
  | update | 업데이트 | Update |
  | reinstall | 다시 설치 | Reinstall |
  | olderNote | 설치된 버전 {v}보다 낮은 버전입니다 | Older than the installed {v} |
  | version | 버전 {v} | Version {v} |
  | changeLocation | 설치 위치 바꾸기 | Change location |
  | change | 바꾸기 | Change |
  | appOpen | IWAE가 켜져 있습니다 | IWAE is open |
  | appOpenSub | 저장할 것이 있으면 저장해 주세요. | Save anything you need first. |
  | closeAndInstall | 닫고 설치 | Close and install |
  | closeAndUninstall | 닫고 지우기 | Close and uninstall |
  | appStuck | IWAE가 닫히지 않았습니다 | IWAE didn't close |
  | forceClose | 강제로 닫기 | Force close |
  | cancel | 취소 | Cancel |
  | installing | 설치하고 있습니다 {p}% | Installing {p}% |
  | installed | 설치했습니다 | Installed |
  | openApp | IWAE 열기 | Open IWAE |
  | failed | 설치하지 못했습니다 | Couldn't install |
  | failedSub | 기록에 원인을 남겼습니다. | The cause is in the log. |
  | retry | 다시 시도 | Try again |
  | showLog | 기록 보기 | Show log |
  | close | 닫기 | Close |
  | uninstallTitle | IWAE를 지웁니다 | Uninstall IWAE |
  | uninstallSub | Vault와 설정은 남겨 둡니다. | Your vaults and settings stay. |
  | uninstall | 지우기 | Uninstall |
  | uninstalling | 지우고 있습니다 | Uninstalling |
  | uninstalled | 지웠습니다 | Uninstalled |
  | uninstallFailed | 지우지 못했습니다 | Couldn't uninstall |
  | langKo | 한국어 | 한국어 |
  | langEn | English | English |

- [ ] **Step 1: Write failing tests** in `screen.test.ts`:
  - `start`, fresh, ko: primary `설치`/`install`, link `설치 위치 바꾸기`/`pickDir`, `showVersion`, `closable`, `showLang`.
  - `start` with `existing.kind 'upgrade'`: primary `업데이트`. Link null (location hidden).
  - `start` with `'same'`: primary `다시 설치`.
  - `start` with `'downgrade'` and existing `0.2.8`: primary `설치`, sub `설치된 버전 0.2.8보다 낮은 버전입니다`.
  - `start` with `customDir` set: link label is the shortened path plus `바꾸기`. The path shows at most 34 characters with a leading `…` and the end of the path kept.
  - `appRunning` in install mode: title `IWAE가 켜져 있습니다`, primary `닫고 설치`/`closeAndInstall`, link `취소`/`cancel`. In uninstall mode the primary is `닫고 지우기`.
  - `appStuck`: primary `강제로 닫기`, secondary `취소`.
  - `installing` at 62: progress 62, title `설치하고 있습니다 62%`, `closable false`, no buttons.
  - `done` in install mode: `설치했습니다`, primary `IWAE 열기`.
  - `failed` in install mode: primary `다시 시도`, link `기록 보기`. In update mode it adds secondary `닫기`/`close`.
  - `uninstalling`: progress `'indeterminate'`, `closable false`.
  - English: `installing` at 5 gives `Installing 5%`.
- [ ] **Step 2:** Run `npx vitest run setup/ui`. Expected: FAIL.
- [ ] **Step 3:** Implement `screen.ts` and `copy.ts`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Implement `main.ts`, `setup.css` and `starfield.ts` from the mockup `docs/superpowers/specs/2026-11-16-custom-installer-mockup.html` (option A) at real size:
  - Logo 72px, name 18px weight 750 letter-spacing 0.14em, version 12px at 60% opacity, primary button 14px padding 9px 40px.
  - Progress bar 200×4px, fill `linear-gradient(90deg,#4f8fd0,#8cc1f2)`.
  - The whole background is `data-tauri-drag-region`.
  - ✕ is top-right, 28px hit area. It is disabled with 35% opacity when `closable` is false.
  - The language menu sits bottom-left. Clicking it toggles between the two languages and calls `set_lang`.
  - Keys: Enter = primary, Esc = close when `closable`.
  - Starfield: about 70 stars on a canvas sized to devicePixelRatio, twinkling slowly. It draws one static frame under `prefers-reduced-motion`.
  - The progress number eases toward the target, never moves backwards, and moves at most 4%/s once it reaches 95.
- [ ] **Step 6:** Commit: "Build the night-sky setup screens".

### Task 9: Release integration

**Files:**
- Create: `scripts/build-setup.mjs`, `scripts/build-setup.test.mjs`
- Modify:
  - `package.json`: `setup:build`, append `&& npm run setup:build` to `release:build`, add the test to `test:release-scripts`
  - `scripts/release-local.mjs` and `scripts/release-local.test.mjs`
  - `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Produces (exported from `build-setup.mjs`):
  ```js
  export function installedFiles(resources)        // tauri.conf bundle.resources -> [{ rel, src }]; "../LICENSE" -> rel "_up_/LICENSE", "binaries/pdfium.dll" -> rel "binaries/pdfium.dll"; plus { rel: "app.exe", src: "target/release/app.exe" }
  export function payloadManifest(files, statSize)  // -> [{ rel, size }]
  export function setupOutputName(version)          // "IWAE_<version>_x64-setup.exe"
  ```
- Build order inside `setup:build`:
  1. `npm run setup:ui`.
  2. Build `iwae-setup` release without `payload`, and copy it to `setup/src-tauri/target/stage/uninstall-ui.exe`.
  3. Write `stage/manifest.json`.
  4. Build `iwae-setup` release with `--features payload`. Env vars:
     - `IWAE_SETUP_NSIS` = `src-tauri/target/release/bundle/nsis/IWAE_<v>_x64-setup.exe`
     - `IWAE_SETUP_UNINSTALL_UI` = the staged `uninstall-ui.exe`
     - `IWAE_SETUP_MANIFEST` = `manifest.json`
     - `build.rs` turns them into `include_bytes!` sources and fails the build when the feature is on and one is missing.
  5. Copy the result to `src-tauri/target/release/bundle/setup/IWAE_<v>_x64-setup.exe`.
  6. Run `npx tauri signer sign <that file>`, which reads `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from the environment and produces `<file>.sig`.
- `release-local.mjs` selects the Windows exe and sig from `bundle/setup` instead of `bundle/nsis`. The MSI stays the same. The inner NSIS exe is never uploaded.

- [ ] **Step 1: Write failing tests**:
  - `installedFiles(["binaries/pdfium.dll","../LICENSE","../THIRD_PARTY_NOTICES.md","licenses/pdfium-licenses.txt"])` gives the four rels above plus `app.exe`.
  - `setupOutputName("0.2.7")` gives `IWAE_0.2.7_x64-setup.exe`.
  - A `release-local` test: given a `bundle/setup` listing with exe and sig and a `bundle/nsis` listing holding a different exe, the selected exe comes from `setup`.
- [ ] **Step 2:** Run `npm run test:release-scripts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Add `winreg` and any other new crates to `THIRD_PARTY_NOTICES.md` in the existing format.
- [ ] **Step 4:** Run `npm run test:release-scripts`, `npm test` and `npm run release:scan`. Expected: all pass.
- [ ] **Step 5:** Commit: "Build and sign the setup window during release".

### Task 10: Clean-Windows scenario script

**Files:**
- Create: `setup/tests/vm/run-vm-tests.ps1` and `setup/tests/vm/README.md` (English, how to run it)

**Interfaces:**
- Consumes:
  - the built `IWAE_<v>_x64-setup.exe`
  - `IWAE_0.2.6_x64-setup.exe` from the v0.2.6 GitHub release
  - The script takes both paths as parameters and downloads nothing itself.
- Produces `results.json`: `[{ name, passed, detail }]`.

- [ ] **Step 1:** Write the script with these scenarios. Each asserts files, registry and processes.
  1. Silent fresh install `/S`:
     - `%LOCALAPPDATA%\IWAE\app.exe` and `uninstall-ui.exe` exist.
     - `UninstallString` ends with `uninstall-ui.exe" --uninstall`.
     - No `Desktop\IWAE.lnk`.
     - `installer-language` is `1042` or `1033`.
  2. Silent install to `C:\Users\Public\IWAE 테스트`.
  3. Old 0.2.6 then update. Install 0.2.6 with its own `/S`, start `app.exe`, then run the new exe with `/P /R /UPDATE /ARGS`. Check:
     - `app.exe` is running again within 60 s.
     - `DisplayVersion` is the new version.
     - `%APPDATA%\dev.iwae.desktop` is untouched (hash a sentinel file placed before).
  4. Update from the new version to itself with `/UPDATE` (the update chain keeps working).
  5. `"<dir>\uninstall-ui.exe" /S _?=<dir>` sync uninstall returns 0, and the files are gone.
  6. Reinstall `/S` after uninstall.
  7. `--uninstall` UI mode: start it and check that a window titled `IWAE 설치` or `IWAE Setup` appears. Then close the process. Clicking is out of scope here.
  8. Kill the setup process 2 s into a `/S` install, then run `/S` again. The second run exits 0 and `app.exe` exists.
  9. Run `Start-MpScan -ScanType CustomScan -ScanPath <setup exe>` and record the threat result.
- [ ] **Step 2:** Lint with `powershell -NoProfile -Command "[ScriptBlock]::Create((Get-Content setup/tests/vm/run-vm-tests.ps1 -Raw)) | Out-Null"`. Expected: no parse error. **Do not run the script on this PC.**
- [ ] **Step 3:** Commit: "Add clean-Windows scenarios for the setup window".

### Task 11 (lead): Audit and VM run

Not for an implementer subagent.
- Run the demo build with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9225`. Screenshot every phase at 2x in ko and en, with `--demo-existing`, `--demo-running` and `--demo-fail`.
- Check centring, spacing, the ✕ hit area, focus rings, and dragging. Run the strata-style detail checklist.
- Run Task 10 in a clean Windows. The environment is the owner's choice: Windows Sandbox or a GitHub Actions Windows runner.
- Report anything unverified, for example a PC without WebView2.
