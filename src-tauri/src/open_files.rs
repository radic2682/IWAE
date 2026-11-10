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

/// 인자 가운데 실제로 있는 PDF·테마 파일만. 첫 인자(실행 파일)는 뺀다. 상대 경로는 cwd 기준
pub fn pdf_args<I: IntoIterator<Item = String>>(args: I, cwd: Option<&Path>) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|arg| is_openable(Path::new(arg)))
        .map(|arg| {
            let path = PathBuf::from(&arg);
            match (path.is_absolute(), cwd) {
                (false, Some(base)) => base.join(path),
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

    /// 기록을 갱신한다: 같은 파일은 때만 새로, 새 파일은 끝에. 그다음 오래된 것과 100개 초과분을 자른다.
    /// 잘려 나간(저장 파일에서도 덜어 낼) 경로를 돌려준다
    pub fn update_log(log: &mut Vec<Opened>, opened: &[String], now: u64, exists: &dyn Fn(&str) -> bool) -> Vec<String> {
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
            let stale = now.saturating_sub(entry.at) > MAX_AGE_SECS || !exists(&entry.path) || kept.len() >= MAX_ENTRIES;
            if stale {
                removed.push(entry.path);
            } else {
                kept.push(entry);
            }
        }
        *log = kept;
        removed
    }

    /// 저장된 범위 항목에서 `removed` 와 이미 없어진 단일 파일 항목을 덜어 낸다. 폴더 항목(`*`·`**` 로 끝남)은 건드리지 않는다
    pub fn prune_patterns(patterns: Vec<String>, removed: &[String], exists: &dyn Fn(&str) -> bool) -> Vec<String> {
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
                !(looks_like_file && !exists(&plain))
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
    pub fn prune_files(dir: &Path, now: u64, exists: &dyn Fn(&str) -> bool) -> usize {
        let log_path = dir.join(LOG_FILE);
        let mut log = read_log(&log_path);
        let removed = update_log(&mut log, &[], now, exists);
        write_log(&log_path, &log);
        let scope_path = dir.join(SCOPE_FILE);
        let Ok(bytes) = std::fs::read(&scope_path) else { return 0 };
        let Ok(mut state) = bincode::deserialize::<ScopeState>(&bytes) else { return 0 };
        let before = state.allowed_paths.len();
        state.allowed_paths = prune_patterns(std::mem::take(&mut state.allowed_paths), &removed, exists);
        let dropped = before - state.allowed_paths.len();
        if dropped > 0 {
            if let Ok(out) = bincode::serialize(&state) {
                let _ = std::fs::write(&scope_path, out);
            }
        }
        dropped
    }

    /// persisted-scope 보다 먼저 등록한다: 저장 파일을 읽히기 전에 정리해 둔다
    pub fn pruner<R: Runtime>() -> TauriPlugin<R> {
        Builder::<R>::new("iwae-scope-pruner")
            .setup(|app, _api| {
                if let Ok(dir) = app.path().app_data_dir() {
                    let dropped = prune_files(&dir, now_secs(), &|path| Path::new(path).exists());
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
            let removed = update_log(&mut log, &[], now, &|path| !path.ends_with("gone.pdf"));
            assert_eq!(log.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), vec!["C:/a/fresh.pdf"]);
            assert!(removed.contains(&"C:/a/old.pdf".to_string()) && removed.contains(&"C:/a/gone.pdf".to_string()));

            // 다시 열면 때만 새로 고친다(같은 파일의 다른 표기도 한 항목)
            let mut log = vec![Opened { path: "C:/a/fresh.pdf".into(), at: 5 }];
            update_log(&mut log, &["C:\\a\\Fresh.pdf".to_string()], now, &|_| true);
            assert_eq!(log.len(), 1);
            assert_eq!(log[0].at, now);

            // 100개를 넘으면 오래된 것부터 자른다
            let mut log: Vec<Opened> = (0..120).map(|i| Opened { path: format!("C:/f/{i}.pdf"), at: now - i as u64 }).collect();
            let removed = update_log(&mut log, &[], now, &|_| true);
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
            let kept = prune_patterns(patterns, &["C:/Docs/stale.pdf".to_string()], &|path| !path.contains("gone"));
            assert_eq!(kept, vec!["C:\\Users\\me\\Vault", "C:\\Users\\me\\Vault\\**", "C:\\Docs\\live.pdf"]);
            assert_eq!(escape_glob("a[1]*?.pdf"), "a[[]1[]][*][?].pdf");
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
            let dropped = prune_files(&dir, now_secs(), &|path| Path::new(path).exists());
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
