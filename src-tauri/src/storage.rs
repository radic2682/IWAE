use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fmt,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_HISTORY_FILES: usize = 50;
const MAX_HISTORY_AGE_MILLIS: u64 = 30 * 24 * 60 * 60 * 1_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AtomicWriteRequest {
    pub target_path: String,
    pub contents: String,
    pub expected_hash: Option<String>,
    pub journal_root: String,
    pub history_root: String,
    pub file_id: String,
    /// 기대 해시가 어긋났을 때 두 내용을 충돌 기록(.iwae/conflicts)으로 남길까. 기본은 남긴다.
    /// 여러 창이 같은 파일에 쓰는 경로는 어긋나면 디스크를 다시 읽어 합쳐 다시 쓰므로(core/vaultSync) 첫 시도들은 끈다 —
    /// 기록을 남기면 정상적인 겹침마다 사용자에게 「파일 충돌」로 보인다
    #[serde(default = "default_true")]
    pub preserve_conflict: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WriteReceipt {
    pub content_hash: String,
    pub size: u64,
    pub modified_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryRecord {
    pub version: u8,
    pub transaction_id: String,
    pub target_path: String,
    pub temporary_path: String,
    pub backup_path: Option<String>,
    pub stage: String,
    pub created_at: u64,
    #[serde(skip)]
    pub journal_path: String,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecoveryAction {
    Retry,
    PreserveCopy,
    Cancel,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryRequest {
    pub journal_path: String,
    pub action: RecoveryAction,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryResult {
    pub preserved_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConflictRecord {
    version: u8,
    id: String,
    target_path: String,
    current_path: String,
    incoming_path: String,
    created_at: u64,
}

#[derive(Debug)]
pub enum StorageError {
    Conflict { target_path: String },
    Io(String),
    Invalid(String),
}

impl fmt::Display for StorageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Conflict { target_path } => formatter.write_str(&tr!("외부 변경 충돌: {target_path}", "Conflict with an external change: {target_path}")),
            Self::Io(message) | Self::Invalid(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for StorageError {}

fn io_error(context: &str, error: std::io::Error) -> StorageError {
    StorageError::Io(format!("{context}: {error}"))
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn safe_component(value: &str) -> String {
    let cleaned = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if cleaned.is_empty() {
        "file".into()
    } else {
        cleaned
    }
}

fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), StorageError> {
    let mut file =
        File::create(path).map_err(|error| io_error(&tr!("파일을 만들지 못했습니다", "Could not create the file"), error))?;
    file.write_all(bytes)
        .map_err(|error| io_error(&tr!("파일을 쓰지 못했습니다", "Could not write the file"), error))?;
    file.sync_all()
        .map_err(|error| io_error(&tr!("파일을 디스크에 반영하지 못했습니다", "Could not flush the file to disk"), error))
}

fn write_journal(path: &Path, record: &RecoveryRecord) -> Result<(), StorageError> {
    let bytes = serde_json::to_vec_pretty(record)
        .map_err(|error| StorageError::Invalid(tr!("저널을 직렬화하지 못했습니다: {error}", "Could not serialize the journal: {error}")))?;
    write_synced(path, &bytes)
}

fn preserve_conflict(request: &AtomicWriteRequest, current: &[u8]) -> Result<(), StorageError> {
    let journal_root = Path::new(&request.journal_root);
    let metadata_root = journal_root.parent().ok_or_else(|| {
        StorageError::Invalid(tr!("저널 경로에서 .iwae 폴더를 찾지 못했습니다.", "Could not find the .iwae folder in the journal path."))
    })?;
    let conflict_root = metadata_root.join("conflicts");
    fs::create_dir_all(&conflict_root)
        .map_err(|error| io_error(&tr!("충돌 폴더를 만들지 못했습니다", "Could not create the conflict folder"), error))?;
    let created_at = now_millis();
    let prefix = format!("{}-{}", created_at, safe_component(&request.file_id));
    let current_path = conflict_root.join(format!("{prefix}.current"));
    let incoming_path = conflict_root.join(format!("{prefix}.incoming"));
    write_synced(&current_path, current)?;
    write_synced(&incoming_path, request.contents.as_bytes())?;
    let record = ConflictRecord {
        version: 1,
        id: prefix.clone(),
        target_path: request.target_path.clone(),
        current_path: current_path.to_string_lossy().into_owned(),
        incoming_path: incoming_path.to_string_lossy().into_owned(),
        created_at,
    };
    let bytes = serde_json::to_vec_pretty(&record).map_err(|error| {
        StorageError::Invalid(tr!("충돌 기록을 직렬화하지 못했습니다: {error}", "Could not serialize the conflict record: {error}"))
    })?;
    write_synced(&conflict_root.join(format!("{prefix}.json")), &bytes)
}

fn snapshot_current(
    request: &AtomicWriteRequest,
    current: &[u8],
    timestamp: u64,
) -> Result<(), StorageError> {
    if current.is_empty() {
        return Ok(());
    }
    let directory = Path::new(&request.history_root).join(safe_component(&request.file_id));
    fs::create_dir_all(&directory)
        .map_err(|error| io_error(&tr!("버전 기록 폴더를 만들지 못했습니다", "Could not create the version history folder"), error))?;
    write_synced(&directory.join(format!("{timestamp}.bak")), current)?;
    prune_history(&directory, timestamp)
}

fn prune_history(directory: &Path, now: u64) -> Result<(), StorageError> {
    let cutoff = now.saturating_sub(MAX_HISTORY_AGE_MILLIS);
    let mut revisions = fs::read_dir(directory)
        .map_err(|error| io_error(&tr!("버전 기록 폴더를 읽지 못했습니다", "Could not read the version history folder"), error))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            let timestamp = path.file_stem()?.to_str()?.parse::<u64>().ok()?;
            (path.extension().and_then(|value| value.to_str()) == Some("bak"))
                .then_some((timestamp, path))
        })
        .collect::<Vec<_>>();
    revisions.sort_by_key(|(timestamp, _)| std::cmp::Reverse(*timestamp));

    for (index, (timestamp, path)) in revisions.into_iter().enumerate() {
        if index >= MAX_HISTORY_FILES || timestamp < cutoff {
            fs::remove_file(path)
                .map_err(|error| io_error(&tr!("오래된 버전 기록을 정리하지 못했습니다", "Could not clean up old version history"), error))?;
        }
    }
    Ok(())
}

pub fn atomic_write(request: &AtomicWriteRequest) -> Result<WriteReceipt, StorageError> {
    let target = PathBuf::from(&request.target_path);
    let parent = target
        .parent()
        .ok_or_else(|| StorageError::Invalid(tr!("대상 파일의 상위 폴더가 없습니다.", "The target file has no parent folder.")))?;
    fs::create_dir_all(parent).map_err(|error| io_error(&tr!("대상 폴더를 만들지 못했습니다", "Could not create the target folder"), error))?;
    fs::create_dir_all(&request.journal_root)
        .map_err(|error| io_error(&tr!("저널 폴더를 만들지 못했습니다", "Could not create the journal folder"), error))?;

    let current = if target.exists() {
        fs::read(&target).map_err(|error| io_error(&tr!("현재 파일을 읽지 못했습니다", "Could not read the current file"), error))?
    } else {
        Vec::new()
    };
    if let Some(expected_hash) = &request.expected_hash {
        if sha256_hex(&current) != *expected_hash {
            if request.preserve_conflict {
                preserve_conflict(request, &current)?;
            }
            return Err(StorageError::Conflict {
                target_path: request.target_path.clone(),
            });
        }
    }

    let created_at = now_millis();
    let transaction_id = format!(
        "{}-{}-{}",
        created_at,
        std::process::id(),
        safe_component(&request.file_id)
    );
    let temporary = parent.join(format!(".iwae-{transaction_id}.tmp"));
    let backup = parent.join(format!(".iwae-{transaction_id}.bak"));
    let journal_path = Path::new(&request.journal_root).join(format!("{transaction_id}.json"));
    let mut record = RecoveryRecord {
        version: 1,
        transaction_id,
        target_path: target.to_string_lossy().into_owned(),
        temporary_path: temporary.to_string_lossy().into_owned(),
        backup_path: target
            .exists()
            .then(|| backup.to_string_lossy().into_owned()),
        stage: "started".into(),
        created_at,
        journal_path: journal_path.to_string_lossy().into_owned(),
    };
    write_journal(&journal_path, &record)?;

    write_synced(&temporary, request.contents.as_bytes())?;
    let verified = fs::read(&temporary)
        .map_err(|error| io_error(&tr!("임시 파일을 다시 읽지 못했습니다", "Could not re-read the temporary file"), error))?;
    if verified != request.contents.as_bytes() {
        return Err(StorageError::Invalid(
            tr!("임시 파일 검증에 실패했습니다.", "Temporary file verification failed."),
        ));
    }
    record.stage = "temporary-written".into();
    write_journal(&journal_path, &record)?;

    snapshot_current(request, &current, created_at)?;
    if target.exists() {
        fs::rename(&target, &backup)
            .map_err(|error| io_error(&tr!("현재 파일을 백업하지 못했습니다", "Could not back up the current file"), error))?;
        record.stage = "backup-created".into();
        write_journal(&journal_path, &record)?;
    }
    if let Err(error) = fs::rename(&temporary, &target) {
        if backup.exists() && !target.exists() {
            let _ = fs::rename(&backup, &target);
        }
        return Err(io_error(&tr!("검증된 파일로 교체하지 못했습니다", "Could not replace it with the verified file"), error));
    }
    if backup.exists() {
        fs::remove_file(&backup)
            .map_err(|error| io_error(&tr!("교체 백업을 정리하지 못했습니다", "Could not clean up the replacement backup"), error))?;
    }
    fs::remove_file(&journal_path)
        .map_err(|error| io_error(&tr!("완료된 저널을 정리하지 못했습니다", "Could not clean up the completed journal"), error))?;

    let final_bytes =
        fs::read(&target).map_err(|error| io_error(&tr!("저장 결과를 확인하지 못했습니다", "Could not verify the saved result"), error))?;
    Ok(WriteReceipt {
        content_hash: sha256_hex(&final_bytes),
        size: final_bytes.len().try_into().unwrap_or(u64::MAX),
        modified_at: now_millis(),
    })
}

pub fn scan_recovery(root: impl AsRef<Path>) -> Result<Vec<RecoveryRecord>, StorageError> {
    let root = root.as_ref();
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut records = Vec::new();
    for entry in
        fs::read_dir(root).map_err(|error| io_error(&tr!("저널 폴더를 읽지 못했습니다", "Could not read the journal folder"), error))?
    {
        let path = entry
            .map_err(|error| io_error(&tr!("저널 항목을 읽지 못했습니다", "Could not read a journal entry"), error))?
            .path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let bytes =
            fs::read(&path).map_err(|error| io_error(&tr!("저널 파일을 읽지 못했습니다", "Could not read the journal file"), error))?;
        let mut record: RecoveryRecord = serde_json::from_slice(&bytes).map_err(|error| {
            StorageError::Invalid(tr!("저널 형식이 올바르지 않습니다: {error}", "Invalid journal format: {error}"))
        })?;
        record.journal_path = path.to_string_lossy().into_owned();
        records.push(record);
    }
    records.sort_by_key(|record| record.created_at);
    Ok(records)
}

fn remove_if_exists(path: &Path) -> Result<(), StorageError> {
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| io_error(&tr!("복구 파일을 정리하지 못했습니다", "Could not clean up recovery files"), error))?;
    }
    Ok(())
}

fn read_recovery_record(journal_path: &Path) -> Result<RecoveryRecord, StorageError> {
    let bytes =
        fs::read(journal_path).map_err(|error| io_error(&tr!("복구 저널을 읽지 못했습니다", "Could not read the recovery journal"), error))?;
    let mut record: RecoveryRecord = serde_json::from_slice(&bytes).map_err(|error| {
        StorageError::Invalid(tr!("복구 저널 형식이 올바르지 않습니다: {error}", "Invalid recovery journal format: {error}"))
    })?;
    record.journal_path = journal_path.to_string_lossy().into_owned();
    Ok(record)
}

fn validate_recovery_paths(
    journal_path: &Path,
    record: &RecoveryRecord,
) -> Result<(), StorageError> {
    let target = Path::new(&record.target_path);
    let target_parent = target
        .parent()
        .ok_or_else(|| StorageError::Invalid(tr!("복구 대상의 상위 폴더가 없습니다.", "The recovery target has no parent folder.")))?;
    let temporary = Path::new(&record.temporary_path);
    let expected_temp = format!(".iwae-{}.tmp", record.transaction_id);
    if temporary.parent() != Some(target_parent)
        || temporary.file_name().and_then(|value| value.to_str()) != Some(expected_temp.as_str())
    {
        return Err(StorageError::Invalid(
            tr!("복구 임시 파일 경로가 안전하지 않습니다.", "The recovery temporary file path is unsafe."),
        ));
    }
    if let Some(backup_path) = &record.backup_path {
        let backup = Path::new(backup_path);
        let expected_backup = format!(".iwae-{}.bak", record.transaction_id);
        if backup.parent() != Some(target_parent)
            || backup.file_name().and_then(|value| value.to_str()) != Some(expected_backup.as_str())
        {
            return Err(StorageError::Invalid(
                tr!("복구 백업 파일 경로가 안전하지 않습니다.", "The recovery backup file path is unsafe."),
            ));
        }
    }
    if journal_path.file_stem().and_then(|value| value.to_str())
        != Some(record.transaction_id.as_str())
    {
        return Err(StorageError::Invalid(
            tr!("복구 저널 ID가 파일 이름과 일치하지 않습니다.", "The recovery journal ID does not match the file name."),
        ));
    }
    Ok(())
}

fn restore_backup(record: &RecoveryRecord) -> Result<(), StorageError> {
    let target = Path::new(&record.target_path);
    let Some(backup_path) = &record.backup_path else {
        return Ok(());
    };
    let backup = Path::new(backup_path);
    if backup.exists() && !target.exists() {
        fs::rename(backup, target)
            .map_err(|error| io_error(&tr!("이전 파일을 복원하지 못했습니다", "Could not restore the previous file"), error))?;
    }
    Ok(())
}

pub fn recover_transaction(
    journal_path: impl AsRef<Path>,
    action: RecoveryAction,
) -> Result<RecoveryResult, StorageError> {
    let journal_path = journal_path.as_ref();
    let record = read_recovery_record(journal_path)?;
    validate_recovery_paths(journal_path, &record)?;
    let target = Path::new(&record.target_path);
    let temporary = Path::new(&record.temporary_path);
    let backup = record.backup_path.as_deref().map(Path::new);

    if !temporary.exists() && target.exists() {
        if let Some(path) = backup {
            remove_if_exists(path)?;
        }
        remove_if_exists(journal_path)?;
        return Ok(RecoveryResult {
            preserved_path: None,
        });
    }

    let preserved_path = match action {
        RecoveryAction::Retry => {
            if !temporary.exists() {
                return Err(StorageError::Invalid(
                    tr!("재시도할 검증된 임시 파일이 없습니다.", "There is no verified temporary file to retry."),
                ));
            }
            if target.exists() {
                let backup = backup.ok_or_else(|| {
                    StorageError::Invalid(tr!("현재 파일을 보존할 백업 경로가 없습니다.", "There is no backup path to preserve the current file."))
                })?;
                if backup.exists() {
                    return Err(StorageError::Invalid(tr!("복구 백업이 이미 존재합니다.", "A recovery backup already exists.")));
                }
                fs::rename(target, backup).map_err(|error| {
                    io_error(&tr!("현재 파일을 복구 백업으로 옮기지 못했습니다", "Could not move the current file to the recovery backup"), error)
                })?;
            }
            if let Err(error) = fs::rename(temporary, target) {
                restore_backup(&record)?;
                return Err(io_error(&tr!("검증된 임시 파일을 적용하지 못했습니다", "Could not apply the verified temporary file"), error));
            }
            if let Some(path) = backup {
                remove_if_exists(path)?;
            }
            None
        }
        RecoveryAction::PreserveCopy => {
            if !temporary.exists() {
                return Err(StorageError::Invalid(
                    tr!("보존할 검증된 임시 파일이 없습니다.", "There is no verified temporary file to preserve."),
                ));
            }
            let file_name = target
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("recovered");
            let copy_path = target.with_file_name(format!(
                "{file_name}.recovered-{}.copy",
                safe_component(&record.transaction_id),
            ));
            if copy_path.exists() {
                return Err(StorageError::Invalid(
                    tr!("같은 이름의 복구 사본이 이미 존재합니다.", "A recovery copy with the same name already exists."),
                ));
            }
            fs::copy(temporary, &copy_path)
                .map_err(|error| io_error(&tr!("새 내용을 복구 사본으로 보존하지 못했습니다", "Could not preserve the new content as a recovery copy"), error))?;
            restore_backup(&record)?;
            remove_if_exists(temporary)?;
            if let Some(path) = backup {
                remove_if_exists(path)?;
            }
            Some(copy_path.to_string_lossy().into_owned())
        }
        RecoveryAction::Cancel => {
            restore_backup(&record)?;
            remove_if_exists(temporary)?;
            if let Some(path) = backup {
                remove_if_exists(path)?;
            }
            None
        }
    };

    remove_if_exists(journal_path)?;
    Ok(RecoveryResult { preserved_path })
}

#[tauri::command]
pub fn atomic_write_text(request: AtomicWriteRequest) -> Result<WriteReceipt, String> {
    atomic_write(&request).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn scan_storage_recovery(journal_root: String) -> Result<Vec<RecoveryRecord>, String> {
    scan_recovery(journal_root).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn recover_storage_transaction(request: RecoveryRequest) -> Result<RecoveryResult, String> {
    recover_transaction(request.journal_path, request.action).map_err(|error| error.to_string())
}
