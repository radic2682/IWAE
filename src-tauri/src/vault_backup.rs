//! 전체 Vault 백업(zip)·백업에서 풀기·휴지통 비우기.
//!
//! Vault 위치는 화면이 넘기지 않고 [`crate::ai::AiState`] 가 들고 있는 열린 Vault 를 쓴다 —
//! 웹뷰가 임의 폴더를 지우거나 묶게 하지 않기 위해서다.
//!
//! 백업은 파일을 하나씩 흘려 넣는다(큰 PDF 도 메모리에 다 올리지 않는다). 이미 압축된
//! 형식(PDF·이미지)은 그대로 담고 나머지만 deflate 한다 — 다시 압축해 봐야 시간만 든다.

use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter};

use crate::ai::AiState;

const PROGRESS_EVENT: &str = "vault-backup-progress";
const CHUNK: usize = 1 << 20;
/// 이 확장자는 이미 압축돼 있어 그대로 담는다.
const STORED_EXTENSIONS: &[&str] = &[
    "pdf", "png", "jpg", "jpeg", "gif", "webp", "avif", "zip", "gz", "7z", "rar", "mp4", "mp3", "woff2", "docx", "xlsx", "pptx",
];

/// 실행 중인 백업·복원 하나를 멈출 수 있게 한다.
#[derive(Default)]
pub struct BackupState {
    cancel: Arc<AtomicBool>,
    running: AtomicBool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupEstimate {
    pub files: u64,
    pub bytes: u64,
    /// 다시 만들 수 있어 뺄 수 있는 검색 색인·캐시 크기
    pub rebuildable_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub path: String,
    pub files: u64,
    pub bytes: u64,
    pub archive_bytes: u64,
    pub millis: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub path: String,
    pub files: u64,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupProgress {
    /// "write" | "restore"
    pub phase: &'static str,
    pub files_done: u64,
    pub files_total: u64,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub current: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashStats {
    /// 휴지통 목록(index.json)에 적힌 항목 수
    pub entries: u64,
    /// 휴지통 폴더 안 실제 파일 수(index.json 제외)
    pub files: u64,
    pub bytes: u64,
}

struct SourceFile {
    absolute: PathBuf,
    /// Vault 기준 `/` 경로
    relative: String,
    size: u64,
    modified: Option<SystemTime>,
}

fn vault_root(ai: &AiState) -> Result<PathBuf, String> {
    ai.root().ok_or_else(|| tr!("열린 Vault 가 없습니다.", "No vault is open."))
}

/// 다시 만들 수 있는 파일 — 검색 색인 DB 와 렌더 캐시. `index/` 아래 다른 파일(설정 등)은 지키는 값이라 남긴다.
fn is_rebuildable(relative: &str) -> bool {
    let lower = relative.to_ascii_lowercase();
    if lower.starts_with(".iwae/cache/") {
        return true;
    }
    if let Some(rest) = lower.strip_prefix(".iwae/index/") {
        return !rest.contains('/') && (rest.ends_with(".sqlite") || rest.ends_with(".sqlite-wal") || rest.ends_with(".sqlite-shm") || rest.ends_with(".sqlite-journal"));
    }
    false
}

fn same_path(left: &Path, right: &Path) -> bool {
    let normalize = |path: &Path| path.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_lowercase();
    normalize(left) == normalize(right)
}

/// Vault 안의 파일을 모두 모은다. 링크는 따라가지 않고, `skip` 경로(만드는 중인 zip)는 뺀다.
fn collect(root: &Path, include_rebuildable: bool, skip: &[PathBuf]) -> io::Result<(Vec<SourceFile>, u64)> {
    let mut files = Vec::new();
    let mut rebuildable = 0u64;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let mut entries: Vec<_> = fs::read_dir(&dir)?.filter_map(Result::ok).collect();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            let meta = match fs::symlink_metadata(&path) {
                Ok(meta) => meta,
                Err(_) => continue,
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                stack.push(path);
                continue;
            }
            if !meta.is_file() || skip.iter().any(|item| same_path(item, &path)) {
                continue;
            }
            let relative = path
                .strip_prefix(root)
                .map_err(|err| io::Error::other(err.to_string()))?
                .components()
                .map(|part| part.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/");
            if is_rebuildable(&relative) {
                rebuildable += meta.len();
                if !include_rebuildable {
                    continue;
                }
            }
            files.push(SourceFile { absolute: path, relative, size: meta.len(), modified: meta.modified().ok() });
        }
    }
    files.sort_by(|a, b| a.relative.cmp(&b.relative));
    Ok((files, rebuildable))
}

pub fn estimate(root: &Path, include_rebuildable: bool) -> Result<BackupEstimate, String> {
    let (files, rebuildable_bytes) = collect(root, include_rebuildable, &[]).map_err(|err| tr!("Vault 를 읽지 못했습니다: {err}", "Could not read the vault: {err}"))?;
    Ok(BackupEstimate { files: files.len() as u64, bytes: files.iter().map(|file| file.size).sum(), rebuildable_bytes })
}

/// 유닉스 초 → zip(MS-DOS) 날짜. 1980 이전이나 범위 밖이면 기본값.
/// zip 시각은 시간대 없는 "현지 시각"이라, 화면이 알려 준 UTC 차이(분)를 더한다.
fn zip_time(modified: Option<SystemTime>, utc_offset_minutes: i32) -> DateTime {
    let Some(seconds) = modified.and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|value| value.as_secs() as i64 + i64::from(utc_offset_minutes) * 60) else {
        return DateTime::default();
    };
    let days = seconds.div_euclid(86_400);
    let rest = seconds.rem_euclid(86_400);
    // Howard Hinnant 의 civil_from_days
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u8;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u8;
    let year = yoe + era * 400 + i64::from(month <= 2);
    if !(1980..=2107).contains(&year) {
        return DateTime::default();
    }
    let second = ((rest % 60) as u8) & !1;
    DateTime::from_date_and_time(year as u16, month, day, (rest / 3600) as u8, ((rest % 3600) / 60) as u8, second).unwrap_or_default()
}

fn compression_for(relative: &str) -> CompressionMethod {
    let extension = relative.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase()).unwrap_or_default();
    if STORED_EXTENSIONS.contains(&extension.as_str()) {
        CompressionMethod::Stored
    } else {
        CompressionMethod::Deflated
    }
}

fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().map(|value| value.to_os_string()).unwrap_or_default();
    name.push(".part");
    dest.with_file_name(name)
}

/// Vault 전체를 `dest` zip 으로 묶는다. 모든 항목은 `<Vault 폴더 이름>/` 아래에 들어간다.
/// 다 쓰기 전에는 `<dest>.part` 에 쓰고, 실패·취소하면 지운다.
pub fn create_backup(
    root: &Path,
    dest: &Path,
    include_rebuildable: bool,
    utc_offset_minutes: i32,
    cancel: &AtomicBool,
    progress: &dyn Fn(BackupProgress),
) -> Result<BackupResult, String> {
    let started = Instant::now();
    if !root.join(".iwae").is_dir() {
        return Err(tr!("IWAE Vault 가 아닌 폴더입니다.", "This folder is not an IWAE vault."));
    }
    let partial = part_path(dest);
    let (files, _) = collect(root, include_rebuildable, &[dest.to_path_buf(), partial.clone()]).map_err(|err| tr!("Vault 를 읽지 못했습니다: {err}", "Could not read the vault: {err}"))?;
    let bytes_total: u64 = files.iter().map(|file| file.size).sum();
    let prefix = root.file_name().map(|name| name.to_string_lossy().into_owned()).filter(|name| !name.is_empty()).unwrap_or_else(|| "vault".into());

    let result = (|| -> Result<(), String> {
        let output = File::create(&partial).map_err(|err| tr!("백업 파일을 만들지 못했습니다: {err}", "Could not create the backup file: {err}"))?;
        let mut zip = ZipWriter::new(BufWriter::with_capacity(CHUNK, output));
        let mut buffer = vec![0u8; CHUNK];
        let mut bytes_done = 0u64;
        let mut last_emit = Instant::now();
        for (index, file) in files.iter().enumerate() {
            if cancel.load(Ordering::Relaxed) {
                return Err(tr!("백업을 취소했습니다.", "Backup canceled."));
            }
            let options = SimpleFileOptions::default()
                .compression_method(compression_for(&file.relative))
                .last_modified_time(zip_time(file.modified, utc_offset_minutes))
                .large_file(file.size >= u64::from(u32::MAX) - CHUNK as u64);
            zip.start_file(format!("{prefix}/{}", file.relative), options).map_err(|err| format!("{}: {err}", file.relative))?;
            let mut reader = BufReader::with_capacity(CHUNK, File::open(&file.absolute).map_err(|err| tr!("{} 을 읽지 못했습니다: {err}", "Could not read {}: {err}", file.relative))?);
            loop {
                let read = reader.read(&mut buffer).map_err(|err| tr!("{} 을 읽지 못했습니다: {err}", "Could not read {}: {err}", file.relative))?;
                if read == 0 {
                    break;
                }
                zip.write_all(&buffer[..read]).map_err(|err| tr!("백업 파일에 쓰지 못했습니다: {err}", "Could not write to the backup file: {err}"))?;
                bytes_done += read as u64;
                if last_emit.elapsed().as_millis() >= 120 {
                    if cancel.load(Ordering::Relaxed) {
                        return Err(tr!("백업을 취소했습니다.", "Backup canceled."));
                    }
                    last_emit = Instant::now();
                    progress(BackupProgress { phase: "write", files_done: index as u64, files_total: files.len() as u64, bytes_done, bytes_total, current: file.relative.clone() });
                }
            }
        }
        let mut writer = zip.finish().map_err(|err| tr!("백업 파일을 마무리하지 못했습니다: {err}", "Could not finish the backup file: {err}"))?;
        writer.flush().map_err(|err| tr!("백업 파일을 마무리하지 못했습니다: {err}", "Could not finish the backup file: {err}"))?;
        progress(BackupProgress { phase: "write", files_done: files.len() as u64, files_total: files.len() as u64, bytes_done: bytes_total, bytes_total, current: String::new() });
        Ok(())
    })();

    if let Err(error) = result {
        let _ = fs::remove_file(&partial);
        return Err(error);
    }
    if dest.exists() {
        fs::remove_file(dest).map_err(|err| {
            let _ = fs::remove_file(&partial);
            tr!("같은 이름의 파일을 바꾸지 못했습니다: {err}", "Could not replace the existing file with the same name: {err}")
        })?;
    }
    fs::rename(&partial, dest).map_err(|err| tr!("백업 파일 이름을 바꾸지 못했습니다: {err}", "Could not rename the backup file: {err}"))?;
    let archive_bytes = fs::metadata(dest).map(|meta| meta.len()).unwrap_or(0);
    Ok(BackupResult {
        path: dest.to_string_lossy().into_owned(),
        files: files.len() as u64,
        bytes: bytes_total,
        archive_bytes,
        millis: started.elapsed().as_millis() as u64,
    })
}

/// 안전한 상대 경로 조각만 남긴다(`..`·드라이브·절대 경로는 거른다).
fn safe_parts(name: &str) -> Option<Vec<String>> {
    let path = Path::new(name);
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!parts.is_empty()).then_some(parts)
}

/// 백업 zip 을 비어 있는(또는 없는) 폴더 `dest` 에 푼다. 모든 항목이 한 폴더 아래 있으면
/// 그 폴더를 벗겨 `dest` 가 곧 Vault 가 되게 한다.
pub fn restore_backup(archive: &Path, dest: &Path, cancel: &AtomicBool, progress: &dyn Fn(BackupProgress)) -> Result<RestoreResult, String> {
    if dest.exists() {
        let mut entries = fs::read_dir(dest).map_err(|err| tr!("복원할 폴더를 읽지 못했습니다: {err}", "Could not read the restore folder: {err}"))?;
        if entries.next().is_some() {
            return Err(tr!("복원할 폴더가 비어 있지 않습니다. 빈 폴더를 고르세요.", "The restore folder is not empty. Choose an empty folder."));
        }
    }
    let mut zip = ZipArchive::new(BufReader::new(File::open(archive).map_err(|err| tr!("백업 파일을 열지 못했습니다: {err}", "Could not open the backup file: {err}"))?))
        .map_err(|err| tr!("zip 파일이 아니거나 손상됐습니다: {err}", "Not a zip file, or the file is damaged: {err}"))?;

    let mut names = Vec::with_capacity(zip.len());
    let mut bytes_total = 0u64;
    for index in 0..zip.len() {
        let entry = zip.by_index_raw(index).map_err(|err| err.to_string())?;
        let parts = safe_parts(entry.name()).ok_or_else(|| tr!("안전하지 않은 경로가 들어 있습니다: {}", "Contains an unsafe path: {}", entry.name()))?;
        bytes_total += entry.size();
        names.push((parts, entry.is_dir()));
    }
    let first = names.first().map(|(parts, _)| parts[0].clone());
    let strip = first.as_ref().is_some_and(|top| names.iter().all(|(parts, is_dir)| &parts[0] == top && (parts.len() > 1 || *is_dir)));
    let has_meta = names.iter().any(|(parts, _)| parts.get(usize::from(strip)).is_some_and(|part| part == ".iwae"));
    if !has_meta {
        return Err(tr!("IWAE Vault 백업이 아닙니다(.iwae 폴더가 없습니다).", "Not an IWAE vault backup (no .iwae folder)."));
    }

    fs::create_dir_all(dest).map_err(|err| tr!("복원할 폴더를 만들지 못했습니다: {err}", "Could not create the restore folder: {err}"))?;
    let mut buffer = vec![0u8; CHUNK];
    let mut bytes_done = 0u64;
    let mut files = 0u64;
    let mut last_emit = Instant::now();
    let total = names.len() as u64;
    for (index, (parts, is_dir)) in names.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err(tr!("복원을 취소했습니다. 이미 푼 파일은 폴더에 남아 있습니다.", "Restore canceled. Files already extracted remain in the folder."));
        }
        let parts = if strip { &parts[1..] } else { &parts[..] };
        if parts.is_empty() {
            continue;
        }
        let target = parts.iter().fold(dest.to_path_buf(), |path, part| path.join(part));
        if *is_dir {
            fs::create_dir_all(&target).map_err(|err| err.to_string())?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let mut entry = zip.by_index(index).map_err(|err| err.to_string())?;
        let mut output = BufWriter::with_capacity(CHUNK, File::create(&target).map_err(|err| tr!("{} 을 만들지 못했습니다: {err}", "Could not create {}: {err}", target.display()))?);
        loop {
            let read = entry.read(&mut buffer).map_err(|err| tr!("{} 을 풀지 못했습니다: {err}", "Could not extract {}: {err}", parts.join("/")))?;
            if read == 0 {
                break;
            }
            output.write_all(&buffer[..read]).map_err(|err| err.to_string())?;
            bytes_done += read as u64;
            if last_emit.elapsed().as_millis() >= 120 {
                last_emit = Instant::now();
                progress(BackupProgress { phase: "restore", files_done: index as u64, files_total: total, bytes_done, bytes_total, current: parts.join("/") });
            }
        }
        output.flush().map_err(|err| err.to_string())?;
        files += 1;
    }
    progress(BackupProgress { phase: "restore", files_done: total, files_total: total, bytes_done: bytes_total, bytes_total, current: String::new() });
    Ok(RestoreResult { path: dest.to_string_lossy().into_owned(), files, bytes: bytes_done })
}

fn trash_dir(root: &Path) -> PathBuf {
    root.join(".iwae").join("trash")
}

fn dir_size(path: &Path) -> (u64, u64) {
    let Ok(meta) = fs::symlink_metadata(path) else { return (0, 0) };
    if meta.is_file() {
        return (1, meta.len());
    }
    if !meta.is_dir() {
        return (0, 0);
    }
    let mut total = (0, 0);
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.filter_map(Result::ok) {
            let (files, bytes) = dir_size(&entry.path());
            total.0 += files;
            total.1 += bytes;
        }
    }
    total
}

pub fn trash_stats(root: &Path) -> Result<TrashStats, String> {
    let dir = trash_dir(root);
    if !dir.is_dir() {
        return Ok(TrashStats { entries: 0, files: 0, bytes: 0 });
    }
    let entries = fs::read_to_string(dir.join("index.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| value.get("entries").and_then(|entries| entries.as_array()).map(|entries| entries.len() as u64))
        .unwrap_or(0);
    let mut files = 0;
    let mut bytes = 0;
    for entry in fs::read_dir(&dir).map_err(|err| tr!("휴지통을 읽지 못했습니다: {err}", "Could not read the trash: {err}"))?.filter_map(Result::ok) {
        if entry.file_name() == "index.json" {
            continue;
        }
        let (count, size) = dir_size(&entry.path());
        files += count;
        bytes += size;
    }
    Ok(TrashStats { entries, files, bytes })
}

/// 휴지통의 파일을 모두 영구히 지우고 목록을 비운다. 지운 양을 돌려준다.
pub fn empty_trash(root: &Path) -> Result<TrashStats, String> {
    let before = trash_stats(root)?;
    let dir = trash_dir(root);
    if !dir.is_dir() {
        return Ok(before);
    }
    let mut failures = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|err| tr!("휴지통을 읽지 못했습니다: {err}", "Could not read the trash: {err}"))?.filter_map(Result::ok) {
        if entry.file_name() == "index.json" {
            continue;
        }
        let path = entry.path();
        let removed = match fs::symlink_metadata(&path) {
            Ok(meta) if meta.is_dir() => fs::remove_dir_all(&path),
            Ok(_) => fs::remove_file(&path),
            Err(err) => Err(err),
        };
        if let Err(err) = removed {
            failures.push(format!("{}: {err}", entry.file_name().to_string_lossy()));
        }
    }
    fs::write(dir.join("index.json"), "{\n  \"version\": 1,\n  \"entries\": []\n}\n").map_err(|err| tr!("휴지통 목록을 비우지 못했습니다: {err}", "Could not clear the trash list: {err}"))?;
    if !failures.is_empty() {
        return Err(tr!("일부 파일을 지우지 못했습니다: {}", "Some files could not be deleted: {}", failures.join(", ")));
    }
    Ok(before)
}

struct RunningGuard<'a>(&'a AtomicBool);
impl Drop for RunningGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn begin(state: &BackupState) -> Result<(), String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err(tr!("이미 백업이나 복원이 진행 중입니다.", "A backup or restore is already in progress."));
    }
    state.cancel.store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn vault_backup_estimate(ai: State<'_, AiState>, include_index: bool) -> Result<BackupEstimate, String> {
    let root = vault_root(&ai)?;
    tauri::async_runtime::spawn_blocking(move || estimate(&root, include_index)).await.map_err(|err| err.to_string())?
}

/// 진행은 `vault-backup-progress` 이벤트로 온다.
#[tauri::command]
pub async fn vault_backup_create(app: AppHandle, ai: State<'_, AiState>, state: State<'_, BackupState>, dest: String, include_index: bool, utc_offset_minutes: Option<i32>) -> Result<BackupResult, String> {
    let root = vault_root(&ai)?;
    let dest = PathBuf::from(dest);
    if !dest.is_absolute() {
        return Err(tr!("저장 위치가 올바르지 않습니다.", "Invalid save location."));
    }
    begin(&state)?;
    let _guard = RunningGuard(&state.running);
    let cancel = state.cancel.clone();
    tauri::async_runtime::spawn_blocking(move || {
        create_backup(&root, &dest, include_index, utc_offset_minutes.unwrap_or(0).clamp(-14 * 60, 14 * 60), &cancel, &|progress| {
            let _ = app.emit(PROGRESS_EVENT, progress);
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn vault_backup_restore(app: AppHandle, state: State<'_, BackupState>, archive: String, dest: String) -> Result<RestoreResult, String> {
    let (archive, dest) = (PathBuf::from(archive), PathBuf::from(dest));
    if !archive.is_absolute() || !dest.is_absolute() {
        return Err(tr!("경로가 올바르지 않습니다.", "Invalid path."));
    }
    begin(&state)?;
    let _guard = RunningGuard(&state.running);
    let cancel = state.cancel.clone();
    tauri::async_runtime::spawn_blocking(move || {
        restore_backup(&archive, &dest, &cancel, &|progress| {
            let _ = app.emit(PROGRESS_EVENT, progress);
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn vault_backup_cancel(state: State<'_, BackupState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn vault_trash_stats(ai: State<'_, AiState>) -> Result<TrashStats, String> {
    let root = vault_root(&ai)?;
    tauri::async_runtime::spawn_blocking(move || trash_stats(&root)).await.map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn vault_trash_empty(ai: State<'_, AiState>) -> Result<TrashStats, String> {
    let root = vault_root(&ai)?;
    tauri::async_runtime::spawn_blocking(move || empty_trash(&root)).await.map_err(|err| err.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("iwae-backup-{name}-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_vault() -> PathBuf {
        let root = temp_dir("vault").join("MyVault");
        fs::create_dir_all(root.join(".iwae/index")).unwrap();
        fs::create_dir_all(root.join(".iwae/cache/pages")).unwrap();
        fs::create_dir_all(root.join(".iwae/trash/folder")).unwrap();
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::write(root.join(".iwae/index.json"), "{\"version\":1,\"entries\":[]}").unwrap();
        fs::write(root.join(".iwae/index/settings.json"), "{}").unwrap();
        fs::write(root.join(".iwae/index/rag.sqlite"), vec![7u8; 5000]).unwrap();
        fs::write(root.join(".iwae/cache/pages/1.png"), vec![1u8; 300]).unwrap();
        fs::write(root.join("docs/a.pdf"), b"%PDF-1.7 hello".repeat(1000)).unwrap();
        fs::write(root.join("notes.md"), "# 노트\n본문").unwrap();
        fs::write(root.join(".iwae/trash/index.json"), "{\"version\":1,\"entries\":[{\"id\":\"x\"}]}").unwrap();
        fs::write(root.join(".iwae/trash/x-old.pdf"), vec![0u8; 100]).unwrap();
        fs::write(root.join(".iwae/trash/folder/y.md"), vec![0u8; 20]).unwrap();
        root
    }

    #[test]
    fn rebuildable_paths_are_only_index_databases_and_cache() {
        assert!(is_rebuildable(".iwae/index/rag.sqlite"));
        assert!(is_rebuildable(".iwae/index/rag.sqlite-wal"));
        assert!(is_rebuildable(".iwae/cache/x/y.png"));
        assert!(!is_rebuildable(".iwae/index/settings.json"));
        assert!(!is_rebuildable(".iwae/index.json"));
        assert!(!is_rebuildable("docs/rag.sqlite"));
    }

    #[test]
    fn zip_time_converts_unix_seconds() {
        let time = UNIX_EPOCH + std::time::Duration::from_secs(1_760_000_000); // 2025-10-09 08:53:20 UTC
        let converted = zip_time(Some(time), 0);
        assert_eq!(zip_time(Some(time), 540).hour(), 17);
        assert_eq!((converted.year(), converted.month(), converted.day()), (2025, 10, 9));
        assert_eq!((converted.hour(), converted.minute(), converted.second()), (8, 53, 20));
    }

    #[test]
    fn backup_round_trips_and_can_skip_rebuildable_files() {
        let root = sample_vault();
        let out = temp_dir("out");
        let estimate_all = estimate(&root, true).unwrap();
        let estimate_small = estimate(&root, false).unwrap();
        assert_eq!(estimate_all.rebuildable_bytes, 5300);
        assert_eq!(estimate_all.bytes - estimate_small.bytes, 5300);

        let dest = out.join("backup.zip");
        let cancel = AtomicBool::new(false);
        let result = create_backup(&root, &dest, false, 0, &cancel, &|_| {}).unwrap();
        assert_eq!(result.files, estimate_small.files);
        assert!(!part_path(&dest).exists());

        let mut archive = ZipArchive::new(File::open(&dest).unwrap()).unwrap();
        let names: Vec<String> = (0..archive.len()).map(|i| archive.by_index(i).unwrap().name().to_string()).collect();
        assert!(names.contains(&"MyVault/docs/a.pdf".to_string()));
        assert!(names.contains(&"MyVault/.iwae/index/settings.json".to_string()));
        assert!(!names.iter().any(|name| name.ends_with("rag.sqlite") || name.contains("/cache/")));

        let restored = out.join("restored");
        let restore = restore_backup(&dest, &restored, &cancel, &|_| {}).unwrap();
        assert_eq!(restore.files, result.files);
        assert_eq!(fs::read(restored.join("docs/a.pdf")).unwrap(), fs::read(root.join("docs/a.pdf")).unwrap());
        assert_eq!(fs::read_to_string(restored.join("notes.md")).unwrap(), "# 노트\n본문");

        // 비어 있지 않은 폴더에는 풀지 않는다
        assert!(restore_backup(&dest, &restored, &cancel, &|_| {}).is_err());
        let _ = fs::remove_dir_all(root.parent().unwrap());
        let _ = fs::remove_dir_all(out);
    }

    #[test]
    fn cancelled_backup_leaves_no_files() {
        let root = sample_vault();
        let out = temp_dir("cancel");
        let dest = out.join("backup.zip");
        let cancel = AtomicBool::new(true);
        assert!(create_backup(&root, &dest, true, 0, &cancel, &|_| {}).is_err());
        assert!(!dest.exists() && !part_path(&dest).exists());
        let _ = fs::remove_dir_all(root.parent().unwrap());
        let _ = fs::remove_dir_all(out);
    }

    #[test]
    fn backup_inside_vault_skips_itself() {
        let root = sample_vault();
        let dest = root.join("backup.zip");
        let cancel = AtomicBool::new(false);
        create_backup(&root, &dest, true, 0, &cancel, &|_| {}).unwrap();
        let mut archive = ZipArchive::new(File::open(&dest).unwrap()).unwrap();
        assert!((0..archive.len()).all(|i| !archive.by_index(i).unwrap().name().contains("backup.zip")));
        let _ = fs::remove_dir_all(root.parent().unwrap());
    }

    #[test]
    fn restore_rejects_archives_without_vault_metadata_or_with_unsafe_paths() {
        let out = temp_dir("bad");
        let path = out.join("bad.zip");
        let mut zip = ZipWriter::new(File::create(&path).unwrap());
        zip.start_file("x/readme.txt", SimpleFileOptions::default()).unwrap();
        zip.write_all(b"hi").unwrap();
        zip.finish().unwrap();
        let cancel = AtomicBool::new(false);
        assert!(restore_backup(&path, &out.join("r1"), &cancel, &|_| {}).unwrap_err().contains(".iwae"));
        assert!(safe_parts("../evil.txt").is_none());
        assert!(safe_parts("C:/evil.txt").is_none() || cfg!(not(windows)));
        let _ = fs::remove_dir_all(out);
    }

    #[test]
    fn trash_stats_and_empty() {
        let root = sample_vault();
        assert_eq!(trash_stats(&root).unwrap(), TrashStats { entries: 1, files: 2, bytes: 120 });
        let removed = empty_trash(&root).unwrap();
        assert_eq!(removed.bytes, 120);
        assert_eq!(trash_stats(&root).unwrap(), TrashStats { entries: 0, files: 0, bytes: 0 });
        assert!(root.join(".iwae/trash/index.json").exists());
        let _ = fs::remove_dir_all(root.parent().unwrap());
    }
}

/// 자동 백업 한 번의 결과: 만든 백업과, 보관 개수를 넘어 지운 옛 자동 백업
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBackupResult {
    pub backup: BackupResult,
    pub removed: Vec<String>,
}

/// 자동 백업 파일 이름: `<Vault 이름>-auto-YYYY-MM-DD-HHMM.zip`. 지울 때도 이 모양만 지운다(손으로 만든 백업은 건드리지 않는다)
fn auto_backup_prefix(root: &Path) -> String {
    let name = root.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    let safe: String = name.chars().map(|ch| if "\\/:*?\"<>|".contains(ch) { '_' } else { ch }).collect();
    format!("{}-auto-", if safe.trim().is_empty() { "vault" } else { safe.trim() })
}

/// `dir` 안의 자동 백업 중 새것 `keep` 개만 남기고 지운다. 지운 파일 경로
pub fn prune_auto_backups(dir: &Path, prefix: &str, keep: usize) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut found: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
            path.is_file() && name.starts_with(prefix) && name.ends_with(".zip")
        })
        .collect();
    // 이름에 시각이 들어 있어 이름순 = 시간순
    found.sort();
    let excess = found.len().saturating_sub(keep.max(1));
    found
        .into_iter()
        .take(excess)
        .filter_map(|path| std::fs::remove_file(&path).ok().map(|_| path.to_string_lossy().into_owned()))
        .collect()
}

/// 자동 백업: `dir` 폴더(없으면 만든다)에 전체 백업을 하나 만들고, 자동 백업을 `keep` 개만 남긴다.
/// `stamp` 는 웹뷰가 준 현지 시각 글자(YYYY-MM-DD-HHMM)
#[tauri::command]
pub async fn vault_backup_auto(
    app: AppHandle,
    ai: State<'_, AiState>,
    state: State<'_, BackupState>,
    dir: String,
    stamp: String,
    keep: u32,
    include_index: bool,
    utc_offset_minutes: Option<i32>,
) -> Result<AutoBackupResult, String> {
    let root = vault_root(&ai)?;
    let dir = PathBuf::from(dir);
    if !dir.is_absolute() {
        return Err(tr!("자동 백업 폴더가 올바르지 않습니다.", "Invalid auto-backup folder."));
    }
    if !stamp.chars().all(|ch| ch.is_ascii_digit() || ch == '-') || stamp.len() > 20 {
        return Err(tr!("시각 형식이 올바르지 않습니다.", "Invalid timestamp format."));
    }
    // Vault 안에 백업을 두면 다음 백업이 그것까지 묶어 점점 커진다
    if dir.starts_with(&root) {
        return Err(tr!("자동 백업 폴더는 Vault 밖이어야 합니다.", "The auto-backup folder must be outside the vault."));
    }
    begin(&state)?;
    let _guard = RunningGuard(&state.running);
    let cancel = state.cancel.clone();
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&dir).map_err(|err| tr!("자동 백업 폴더를 만들지 못했습니다: {err}", "Could not create the auto-backup folder: {err}"))?;
        let prefix = auto_backup_prefix(&root);
        let dest = dir.join(format!("{prefix}{stamp}.zip"));
        let backup = create_backup(&root, &dest, include_index, utc_offset_minutes.unwrap_or(0).clamp(-14 * 60, 14 * 60), &cancel, &|progress| {
            let _ = app.emit(PROGRESS_EVENT, progress);
        })?;
        let removed = prune_auto_backups(&dir, &prefix, keep.clamp(1, 100) as usize);
        Ok(AutoBackupResult { backup, removed })
    })
    .await
    .map_err(|err| err.to_string())?
}

#[cfg(test)]
mod auto_tests {
    use super::*;

    #[test]
    fn prune_keeps_the_newest_auto_backups_only() {
        let dir = std::env::temp_dir().join(format!("iwae-prune-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["V-auto-2026-01-01-0000.zip", "V-auto-2026-02-01-0000.zip", "V-auto-2026-03-01-0000.zip", "V-backup-2020-01-01-0000.zip", "other.zip"] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        let removed = prune_auto_backups(&dir, "V-auto-", 2);
        assert_eq!(removed.len(), 1);
        assert!(removed[0].ends_with("V-auto-2026-01-01-0000.zip"));
        assert!(dir.join("V-backup-2020-01-01-0000.zip").exists());
        assert!(dir.join("other.zip").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn auto_prefix_uses_the_vault_folder_name() {
        assert_eq!(auto_backup_prefix(Path::new("C:/x/My Vault")), "My Vault-auto-");
    }
}
