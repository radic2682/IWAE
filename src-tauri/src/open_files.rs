//! 파일 탐색기에서 PDF(또는 테마 파일 .iwtheme)를 열었을 때(IWAE 를 기본 PDF 앱·연결 프로그램으로 쓸 때) 그 경로를 화면에 넘긴다.
//!
//! - 처음 켜질 때의 명령줄 인자는 화면이 준비된 뒤 `take_open_files` 로 가져간다.
//! - 이미 켜져 있으면 두 번째 실행은 곧바로 끝나고(single-instance), 그 인자를 이 창에 `iwae:open-files` 로 보낸다.
//! - Vault 밖 파일이라 fs 범위에 그 파일을 열어 둔다(Vault 로 가져올 때 복사해야 한다).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_fs::FsExt;

pub const EVENT: &str = "iwae:open-files";

#[derive(Default)]
pub struct PendingOpenFiles(pub Mutex<Vec<String>>);

/// 화면이 처음 경로를 가져갔는가(`take_open_files`). 그 뒤에 온 파일은 이벤트로 보낸다
#[derive(Default)]
pub struct OpenFilesTaken(pub std::sync::atomic::AtomicBool);

/// macOS: Finder 에서 연 PDF 는 명령줄 인자가 아니라 Apple Event(`RunEvent::Opened`)로 온다.
/// 화면이 아직 준비되지 않았으면 처음 경로에 쌓고, 이미 켜져 있으면 바로 보낸다
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn on_opened_paths<R: Runtime>(app: &AppHandle<R>, paths: Vec<PathBuf>) {
    let files: Vec<String> = paths
        .into_iter()
        .filter(|path| is_openable(path))
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    if files.is_empty() {
        return;
    }
    let taken = app
        .try_state::<OpenFilesTaken>()
        .is_some_and(|state| state.0.load(std::sync::atomic::Ordering::SeqCst));
    if !taken {
        if let Some(pending) = app.try_state::<PendingOpenFiles>() {
            pending.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).extend(files);
            return;
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    allow_in_scope(app, &files);
    let _ = app.emit_to(crate::windows::MAIN_LABEL, EVENT, files);
}

/// 탐색기에서 열 수 있는 파일: PDF, 테마 파일(.iwtheme). 화면이 종류별로 갈라 처리한다
fn is_openable(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf") || ext.eq_ignore_ascii_case("iwtheme"))
}

/// `.`·`..` 를 글자 기준으로 걷어 낸다(`C:\a\b` + `..\x.pdf` → `C:\a\x.pdf`). 파일 시스템은 보지 않는다
fn normalize_lexically(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                if !matches!(out.components().next_back(), Some(Component::Normal(_))) || !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// 인자 가운데 실제로 있는 PDF·테마 파일만. 첫 인자(실행 파일)는 뺀다. 상대 경로는 cwd 기준
pub fn pdf_args<I: IntoIterator<Item = String>>(args: I, cwd: Option<&Path>) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|arg| is_openable(Path::new(arg)))
        .map(|arg| {
            let path = PathBuf::from(&arg);
            match (path.is_absolute(), cwd) {
                (false, Some(base)) => normalize_lexically(&base.join(path)),
                _ => path,
            }
        })
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

pub fn allow_in_scope<R: Runtime>(app: &AppHandle<R>, files: &[String]) {
    for file in files {
        let _ = app.fs_scope().allow_file(file);
    }
    scope_log::record(app, files);
}

/// 탐색기·두 번째 실행으로 연 파일마다 fs 범위(persisted-scope)에 항목이 하나씩 영구히 쌓이는 것을 막는다.
///
/// 범위에서 항목을 빼는 API 는 없고, 저장 파일(`.persisted-scope`)은 앱이 켜질 때 한 번 읽어 범위로 복원한다.
/// 그래서 (1) 연 파일을 날짜와 함께 따로 적어 두고(`open-files-scope.json`), (2) 다음에 켤 때 persisted-scope 가
/// 저장 파일을 읽기 **전에** 오래됐거나(30일) 100개를 넘는 것, 이미 없어진 파일의 항목을 저장 파일에서 덜어 낸다.
/// 이 플러그인은 persisted-scope 보다 먼저 등록해야 한다.
pub mod scope_log {
    use std::path::{Path, PathBuf};

    use serde::{Deserialize, Serialize};
    use tauri::plugin::{Builder, TauriPlugin};
    use tauri::{AppHandle, Manager, Runtime};

    pub const LOG_FILE: &str = "open-files-scope.json";
    pub const SCOPE_FILE: &str = ".persisted-scope";
    pub const MAX_AGE_SECS: u64 = 30 * 24 * 60 * 60;
    pub const MAX_ENTRIES: usize = 100;

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    pub struct Opened {
        pub path: String,
        /// 마지막으로 연 때(유닉스 초)
        pub at: u64,
    }

    /// persisted-scope 의 저장 형식(bincode). 필드 순서가 같아야 한다
    #[derive(Debug, Default, Serialize, Deserialize)]
    struct ScopeState {
        allowed_paths: Vec<String>,
        forbidden_patterns: Vec<String>,
    }

    fn now_secs() -> u64 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
    }

    /// glob 패턴 글자(`? * [ ]`)를 글자 그대로의 패턴으로(tauri 가 경로를 범위에 넣을 때와 같은 방식)
    pub fn escape_glob(path: &str) -> String {
        let mut out = String::with_capacity(path.len());
        for ch in path.chars() {
            match ch {
                '?' | '*' | '[' | ']' => {
                    out.push('[');
                    out.push(ch);
                    out.push(']');
                }
                _ => out.push(ch),
            }
        }
        out
    }

    /// 같은 경로의 두 표기(앞에 `\?` 가 붙은 것과 아닌 것)·구분자·대소문자를 한 가지로 본다
    fn normalize(path: &str) -> String {
        path.strip_prefix(r"\\?\").unwrap_or(path).replace('/', "\\").to_lowercase()
    }

    /// 이 파일이 **확실히 없어졌나**: 파일이 든 폴더에는 닿는데 파일만 없을 때만 참이다.
    /// 드라이브(USB)·공유 폴더가 꺼져 있거나 폴더째 안 보이는 것은 없어진 것이 아니라 지금 못 닿는 것이므로 거짓이다.
    /// 그걸 없어진 것으로 치면 한 번 빼 놓고 켠 것만으로 그 파일의 열람 허락이 영영 사라진다.
    pub fn definitely_gone(path: &str) -> bool {
        // 공유 폴더(UNC) 경로는 서버가 안 닿으면 확인이 수십 초 걸린다. 시작을 붙잡지 않으려고 확인하지 않고 남긴다
        if is_network_path(path) {
            return false;
        }
        let path = Path::new(path);
        match std::fs::symlink_metadata(path) {
            Ok(_) => false,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => path.parent().is_some_and(|parent| parent.is_dir()),
            Err(_) => false,
        }
    }

    /// 공유 폴더 꼴(`\\서버\공유`, `//서버/공유`, `\\?\UNC\…`)인가
    fn is_network_path(path: &str) -> bool {
        let slashed = path.replace('\\', "/");
        slashed.starts_with("//") && (!slashed.starts_with("//?/") || slashed.to_ascii_lowercase().starts_with("//?/unc/"))
    }

    /// 기록을 갱신한다: 같은 파일은 때만 새로, 새 파일은 끝에. 그다음 오래된 것과 100개 초과분을 자른다.
    /// `gone` 이 참인(확실히 없어진, [`definitely_gone`]) 파일도 뺀다. 잘려 나간(저장 파일에서도 덜어 낼) 경로를 돌려준다
    pub fn update_log(log: &mut Vec<Opened>, opened: &[String], now: u64, gone: &dyn Fn(&str) -> bool) -> Vec<String> {
        for path in opened {
            match log.iter_mut().find(|entry| normalize(&entry.path) == normalize(path)) {
                Some(entry) => entry.at = now,
                None => log.push(Opened { path: path.clone(), at: now }),
            }
        }
        // 최근 것이 앞으로
        log.sort_by_key(|entry| std::cmp::Reverse(entry.at));
        let mut removed = Vec::new();
        let mut kept = Vec::new();
        for entry in log.drain(..) {
            let stale = now.saturating_sub(entry.at) > MAX_AGE_SECS || gone(&entry.path) || kept.len() >= MAX_ENTRIES;
            if stale {
                removed.push(entry.path);
            } else {
                kept.push(entry);
            }
        }
        *log = kept;
        removed
    }

    /// 저장된 범위 항목에서 `removed` 와 확실히 없어진 단일 파일 항목을 덜어 낸다. 폴더 항목(`*`·`**` 로 끝남)은 건드리지 않는다.
    /// 못 닿는 드라이브·공유 폴더 위의 파일 항목은 남긴다([`definitely_gone`])
    pub fn prune_patterns(patterns: Vec<String>, removed: &[String], gone: &dyn Fn(&str) -> bool) -> Vec<String> {
        let removed: Vec<String> = removed.iter().map(|path| normalize(&escape_glob(path))).collect();
        patterns
            .into_iter()
            .filter(|pattern| {
                if pattern.ends_with('*') && !pattern.ends_with("[*]") {
                    return true; // 폴더 항목
                }
                if removed.contains(&normalize(pattern)) {
                    return false;
                }
                // 단일 파일 항목이 가리키던 파일이 없어졌으면 버린다(글자 패턴 표기를 되돌려 본다)
                let plain = pattern.replace("[?]", "?").replace("[*]", "*").replace("[[]", "[").replace("[]]", "]");
                let looks_like_file = Path::new(&plain).extension().is_some();
                !(looks_like_file && gone(&plain))
            })
            .collect()
    }

    fn app_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
        app.path().app_data_dir().ok()
    }

    fn read_log(path: &Path) -> Vec<Opened> {
        std::fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
    }

    fn write_log(path: &Path, log: &[Opened]) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string_pretty(log) {
            let _ = std::fs::write(path, text);
        }
    }

    /// 새로 연 파일을 기록에 남긴다(여기서는 자르지 않는다 — 자르는 일은 다음에 켤 때)
    pub fn record<R: Runtime>(app: &AppHandle<R>, files: &[String]) {
        let Some(dir) = app_dir(app) else { return };
        let path = dir.join(LOG_FILE);
        let mut log = read_log(&path);
        let now = now_secs();
        for file in files {
            match log.iter_mut().find(|entry| normalize(&entry.path) == normalize(file)) {
                Some(entry) => entry.at = now,
                None => log.push(Opened { path: file.clone(), at: now }),
            }
        }
        write_log(&path, &log);
    }

    /// 저장 파일을 정리한다(시작할 때 한 번). 정리한 항목 수를 돌려준다
    pub fn prune_files(dir: &Path, now: u64, gone: &dyn Fn(&str) -> bool) -> usize {
        let log_path = dir.join(LOG_FILE);
        let mut log = read_log(&log_path);
        let removed = update_log(&mut log, &[], now, gone);
        write_log(&log_path, &log);
        let scope_path = dir.join(SCOPE_FILE);
        let Ok(bytes) = std::fs::read(&scope_path) else { return 0 };
        let Ok(mut state) = bincode::deserialize::<ScopeState>(&bytes) else { return 0 };
        let before = state.allowed_paths.len();
        state.allowed_paths = prune_patterns(std::mem::take(&mut state.allowed_paths), &removed, gone);
        let dropped = before - state.allowed_paths.len();
        if dropped > 0 {
            if let Ok(out) = bincode::serialize(&state) {
                let _ = std::fs::write(&scope_path, out);
            }
        }
        dropped
    }

    /// 시작할 때 파일 확인에 쓸 수 있는 시간 전체
    const CHECK_BUDGET: std::time::Duration = std::time::Duration::from_millis(1500);

    /// [`definitely_gone`] 을 따로 띄운 스레드에서 `deadline` 까지만 기다린다. 그때까지 답이 없으면(응답 없는 드라이브) 없어진 것으로 치지 않는다
    fn gone_before(path: &str, deadline: std::time::Instant) -> bool {
        let Some(wait) = deadline.checked_duration_since(std::time::Instant::now()).filter(|wait| !wait.is_zero()) else { return false };
        let (tx, rx) = std::sync::mpsc::channel();
        let owned = path.to_string();
        std::thread::spawn(move || {
            let _ = tx.send(definitely_gone(&owned));
        });
        rx.recv_timeout(wait).unwrap_or(false)
    }

    /// persisted-scope 보다 먼저 등록한다: 저장 파일을 읽히기 전에 정리해 둔다
    pub fn pruner<R: Runtime>() -> TauriPlugin<R> {
        Builder::<R>::new("iwae-scope-pruner")
            .setup(|app, _api| {
                if let Ok(dir) = app.path().app_data_dir() {
                    // 확인이 느린 곳(꺼진 드라이브·공유 폴더)이 시작을 붙잡지 않게 전체에 시간 제한을 둔다. 제한을 넘기면 남긴다
                    let deadline = std::time::Instant::now() + CHECK_BUDGET;
                    let dropped = prune_files(&dir, now_secs(), &|path| gone_before(path, deadline));
                    if dropped > 0 {
                        log::info!("pruned {dropped} stale externally-opened file entries from the persisted fs scope");
                    }
                }
                Ok(())
            })
            .build()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        const DAY: u64 = 24 * 60 * 60;

        #[test]
        fn log_keeps_the_newest_and_drops_old_missing_and_excess_entries() {
            let mut log = vec![
                Opened { path: "C:/a/old.pdf".into(), at: 1_000 },
                Opened { path: "C:/a/gone.pdf".into(), at: 1_000 + 40 * DAY },
                Opened { path: "C:/a/fresh.pdf".into(), at: 1_000 + 40 * DAY },
            ];
            let now = 1_000 + 41 * DAY;
            let removed = update_log(&mut log, &[], now, &|path| path.ends_with("gone.pdf"));
            assert_eq!(log.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), vec!["C:/a/fresh.pdf"]);
            assert!(removed.contains(&"C:/a/old.pdf".to_string()) && removed.contains(&"C:/a/gone.pdf".to_string()));

            // 다시 열면 때만 새로 고친다(같은 파일의 다른 표기도 한 항목)
            let mut log = vec![Opened { path: "C:/a/fresh.pdf".into(), at: 5 }];
            update_log(&mut log, &["C:\\a\\Fresh.pdf".to_string()], now, &|_| false);
            assert_eq!(log.len(), 1);
            assert_eq!(log[0].at, now);

            // 100개를 넘으면 오래된 것부터 자른다
            let mut log: Vec<Opened> = (0..120).map(|i| Opened { path: format!("C:/f/{i}.pdf"), at: now - i as u64 }).collect();
            let removed = update_log(&mut log, &[], now, &|_| false);
            assert_eq!(log.len(), MAX_ENTRIES);
            assert_eq!(removed.len(), 20);
            assert!(removed.contains(&"C:/f/119.pdf".to_string()) && !removed.contains(&"C:/f/0.pdf".to_string()));
        }

        #[test]
        fn pruning_patterns_leaves_folders_and_live_files_alone() {
            let patterns = vec![
                "C:\\Users\\me\\Vault".to_string(),
                "C:\\Users\\me\\Vault\\**".to_string(),
                "C:\\Docs\\stale.pdf".to_string(),
                "C:\\Docs\\gone[[]1[]].pdf".to_string(),
                "C:\\Docs\\live.pdf".to_string(),
            ];
            let kept = prune_patterns(patterns, &["C:/Docs/stale.pdf".to_string()], &|path| path.contains("gone"));
            assert_eq!(kept, vec!["C:\\Users\\me\\Vault", "C:\\Users\\me\\Vault\\**", "C:\\Docs\\live.pdf"]);
            assert_eq!(escape_glob("a[1]*?.pdf"), "a[[]1[]][*][?].pdf");
        }

        #[test]
        fn a_file_is_gone_only_when_its_folder_is_reachable() {
            let dir = std::env::temp_dir().join(format!("iwae-gone-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let there = dir.join("there.pdf");
            std::fs::write(&there, b"%PDF").unwrap();
            assert!(!definitely_gone(&there.to_string_lossy()), "있는 파일");
            assert!(definitely_gone(&dir.join("deleted.pdf").to_string_lossy()), "폴더는 있는데 파일이 없다");
            assert!(!definitely_gone(&dir.join("unplugged").join("paper.pdf").to_string_lossy()), "폴더째 안 보이면(USB 를 뺐다) 모른다");
            assert!(!definitely_gone(r"\\no-such-host-iwae\share\paper.pdf"));
            assert!(!definitely_gone("//no-such-host-iwae/share/paper.pdf"));
            let _ = std::fs::remove_dir_all(&dir);
        }

        #[test]
        fn log_entries_of_unreachable_files_are_kept() {
            let now = 1_000 + DAY;
            let mut log = vec![Opened { path: "E:/usb/paper.pdf".into(), at: now - 10 }];
            let removed = update_log(&mut log, &[], now, &|_| false);
            assert!(removed.is_empty());
            assert_eq!(log.len(), 1);
        }

        #[test]
        fn prune_files_rewrites_the_persisted_scope_file() {
            let dir = std::env::temp_dir().join(format!("iwae-scope-prune-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let live = dir.join("live.pdf");
            std::fs::write(&live, b"%PDF").unwrap();
            let live_text = live.to_string_lossy().into_owned();
            let state = ScopeState {
                allowed_paths: vec![escape_glob(&live_text), escape_glob(&dir.join("missing.pdf").to_string_lossy()), format!("{}\\**", dir.display())],
                forbidden_patterns: vec!["x".into()],
            };
            std::fs::write(dir.join(SCOPE_FILE), bincode::serialize(&state).unwrap()).unwrap();
            let dropped = prune_files(&dir, now_secs(), &definitely_gone);
            assert_eq!(dropped, 1);
            let after: ScopeState = bincode::deserialize(&std::fs::read(dir.join(SCOPE_FILE)).unwrap()).unwrap();
            assert_eq!(after.allowed_paths.len(), 2);
            assert_eq!(after.forbidden_patterns, vec!["x".to_string()]);
            std::fs::remove_dir_all(&dir).ok();
        }
    }
}

/// 이미 켜진 IWAE 에 두 번째 실행이 넘긴 인자
pub fn on_second_instance<R: Runtime>(app: &AppHandle<R>, argv: Vec<String>, cwd: String) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let files = pdf_args(argv, Some(Path::new(&cwd)));
    if files.is_empty() {
        return;
    }
    allow_in_scope(app, &files);
    let _ = app.emit_to(crate::windows::MAIN_LABEL, EVENT, files);
}

/// 처음 켜질 때 받은 PDF 경로(한 번만 준다)
#[tauri::command]
pub fn take_open_files<R: Runtime>(app: AppHandle<R>, state: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    let mut pending = state.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let files = std::mem::take(&mut *pending);
    // 잠근 채로 깃발을 세운다 — 그 사이 macOS 가 보낸 파일이 쌓이기만 하고 사라지는 일이 없게
    if let Some(taken) = app.try_state::<OpenFilesTaken>() {
        taken.0.store(true, std::sync::atomic::Ordering::SeqCst);
    }
    drop(pending);
    allow_in_scope(&app, &files);
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_arguments_with_dot_dot_are_normalized_against_the_cwd() {
        let base = std::env::temp_dir().join(format!("iwae-open-files-dotdot-{}", std::process::id()));
        let sub = base.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let pdf = base.join("file.pdf");
        std::fs::write(&pdf, b"%PDF").unwrap();
        for arg in ["../file.pdf", r"..\file.pdf", "./../file.pdf"] {
            if arg.contains('\\') && !cfg!(windows) {
                continue;
            }
            let files = pdf_args(vec!["iwae.exe".to_string(), arg.to_string()], Some(&sub));
            assert_eq!(files, vec![pdf.to_string_lossy().into_owned()], "arg {arg}");
        }
        assert!(pdf_args(vec!["iwae.exe".to_string(), "../../../../nope.pdf".to_string()], Some(&sub)).is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn keeps_only_existing_pdf_arguments() {
        let dir = std::env::temp_dir().join("iwae-open-files-test");
        std::fs::create_dir_all(&dir).unwrap();
        let pdf = dir.join("spec.PDF");
        std::fs::write(&pdf, b"%PDF").unwrap();
        let args = vec![
            "iwae.exe".to_string(),
            "--flag".to_string(),
            "spec.PDF".to_string(),
            "missing.pdf".to_string(),
        ];
        let files = pdf_args(args, Some(&dir));
        assert_eq!(files, vec![pdf.to_string_lossy().into_owned()]);
        let theme = dir.join("숲.IWTHEME");
        std::fs::write(&theme, b"{}").unwrap();
        let files = pdf_args(vec!["iwae.exe".to_string(), "숲.IWTHEME".to_string(), "notes.txt".to_string()], Some(&dir));
        assert_eq!(files, vec![theme.to_string_lossy().into_owned()]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
