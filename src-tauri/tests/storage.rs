use app_lib::storage::{
    atomic_write, recover_transaction, scan_recovery, sha256_hex, AtomicWriteRequest,
    RecoveryAction, StorageError,
};
use std::{
    fs,
    path::PathBuf,
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

fn fixture_dir(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "iwae-storage-{label}-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).expect("fixture directory");
    dir
}

fn request(
    root: &std::path::Path,
    contents: &str,
    expected_hash: Option<String>,
) -> AtomicWriteRequest {
    AtomicWriteRequest {
        target_path: root.join("note.canvas").to_string_lossy().into_owned(),
        contents: contents.to_owned(),
        expected_hash,
        journal_root: root.join(".iwae/journal").to_string_lossy().into_owned(),
        history_root: root.join(".iwae/history").to_string_lossy().into_owned(),
        file_id: "note-1".into(),
    }
}

#[test]
fn atomic_write_replaces_with_verified_content_and_clears_journal() {
    let root = fixture_dir("replace");
    fs::write(root.join("note.canvas"), "old").expect("old file");

    let receipt = atomic_write(&request(&root, "new", Some(sha256_hex(b"old"))))
        .expect("atomic write succeeds");

    assert_eq!(fs::read_to_string(root.join("note.canvas")).unwrap(), "new");
    assert_eq!(receipt.content_hash, sha256_hex(b"new"));
    assert!(scan_recovery(root.join(".iwae/journal"))
        .unwrap()
        .is_empty());
}

#[test]
fn expected_hash_mismatch_preserves_current_and_incoming_versions() {
    let root = fixture_dir("conflict");
    fs::write(root.join("note.canvas"), "external").expect("external file");

    let error = atomic_write(&request(&root, "local", Some(sha256_hex(b"old"))))
        .expect_err("revision mismatch must conflict");

    assert!(matches!(error, StorageError::Conflict { .. }));
    assert_eq!(
        fs::read_to_string(root.join("note.canvas")).unwrap(),
        "external"
    );
    let conflict_dir = root.join(".iwae/conflicts");
    let names = fs::read_dir(conflict_dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    assert!(names.iter().any(|name| name.ends_with(".current")));
    assert!(names.iter().any(|name| name.ends_with(".incoming")));
}

#[test]
fn scan_recovery_reports_unfinished_journals() {
    let root = fixture_dir("recovery");
    let journal = root.join(".iwae/journal");
    fs::create_dir_all(&journal).unwrap();
    fs::write(
        journal.join("tx-1.json"),
        r#"{"version":1,"transactionId":"tx-1","targetPath":"C:/Vault/note.canvas","temporaryPath":"C:/Vault/note.canvas.tmp","backupPath":null,"stage":"temporary-written","createdAt":1}"#,
    ).unwrap();

    let records = scan_recovery(&journal).expect("journal scan");

    assert_eq!(records.len(), 1);
    assert_eq!(records[0].transaction_id, "tx-1");
    assert_eq!(records[0].stage, "temporary-written");
}

fn interrupted_transaction(root: &std::path::Path, stage: &str) -> PathBuf {
    let target = root.join("note.canvas");
    let temporary = root.join(".iwae-tx-1.tmp");
    let backup = root.join(".iwae-tx-1.bak");
    let journal = root.join(".iwae/journal/tx-1.json");
    fs::create_dir_all(journal.parent().unwrap()).unwrap();
    fs::write(&temporary, "new").unwrap();
    fs::write(&backup, "old").unwrap();
    fs::write(
        &journal,
        format!(
            r#"{{"version":1,"transactionId":"tx-1","targetPath":{},"temporaryPath":{},"backupPath":{},"stage":"{stage}","createdAt":1}}"#,
            serde_json::to_string(&target.to_string_lossy()).unwrap(),
            serde_json::to_string(&temporary.to_string_lossy()).unwrap(),
            serde_json::to_string(&backup.to_string_lossy()).unwrap(),
        ),
    ).unwrap();
    journal
}

#[test]
fn recovery_retry_finishes_the_validated_replacement() {
    let root = fixture_dir("recovery-retry");
    let journal = interrupted_transaction(&root, "backup-created");

    let result = recover_transaction(&journal, RecoveryAction::Retry)
        .expect("retry should install the validated temporary file");

    assert_eq!(fs::read_to_string(root.join("note.canvas")).unwrap(), "new");
    assert!(!root.join(".iwae-tx-1.tmp").exists());
    assert!(!root.join(".iwae-tx-1.bak").exists());
    assert!(!journal.exists());
    assert_eq!(result.preserved_path, None);
}

#[test]
fn recovery_cancel_restores_the_previous_file() {
    let root = fixture_dir("recovery-cancel");
    let journal = interrupted_transaction(&root, "backup-created");

    recover_transaction(&journal, RecoveryAction::Cancel)
        .expect("cancel should restore the backup");

    assert_eq!(fs::read_to_string(root.join("note.canvas")).unwrap(), "old");
    assert!(!root.join(".iwae-tx-1.tmp").exists());
    assert!(!journal.exists());
}

#[test]
fn recovery_preserve_copy_keeps_both_versions() {
    let root = fixture_dir("recovery-copy");
    let journal = interrupted_transaction(&root, "backup-created");

    let result = recover_transaction(&journal, RecoveryAction::PreserveCopy)
        .expect("copy should preserve the new version and restore the old one");

    assert_eq!(fs::read_to_string(root.join("note.canvas")).unwrap(), "old");
    let preserved = PathBuf::from(result.preserved_path.expect("preserved copy path"));
    assert_eq!(fs::read_to_string(preserved).unwrap(), "new");
    assert!(!journal.exists());
}

#[test]
fn one_hundred_atomic_revisions_keep_exact_content_and_bounded_history() {
    let root = fixture_dir("stress-100-revisions");
    let mut expected_hash = None;

    for revision in 0..100 {
        let contents = format!("revision-{revision:03}");
        let receipt = atomic_write(&request(&root, &contents, expected_hash.clone()))
            .expect("sequential atomic write");
        assert_eq!(receipt.content_hash, sha256_hex(contents.as_bytes()));
        assert_eq!(
            fs::read_to_string(root.join("note.canvas")).unwrap(),
            contents
        );
        assert!(scan_recovery(root.join(".iwae/journal"))
            .unwrap()
            .is_empty());
        expected_hash = Some(receipt.content_hash);
        thread::sleep(std::time::Duration::from_millis(2));
    }

    let history = root.join(".iwae/history/note-1");
    let history_count = fs::read_dir(history).unwrap().count();
    assert!(
        history_count <= 50,
        "history must be bounded, got {history_count}"
    );
    assert_eq!(
        fs::read_to_string(root.join("note.canvas")).unwrap(),
        "revision-099"
    );
    fs::remove_dir_all(root).unwrap();
}

fn interrupted_before_backup(root: &std::path::Path, stage: &str) -> PathBuf {
    let target = root.join("note.canvas");
    let temporary = root.join(".iwae-tx-early.tmp");
    let backup = root.join(".iwae-tx-early.bak");
    let journal = root.join(".iwae/journal/tx-early.json");
    fs::create_dir_all(journal.parent().unwrap()).unwrap();
    fs::write(&target, "old").unwrap();
    fs::write(&temporary, "new").unwrap();
    fs::write(
        &journal,
        format!(
            r#"{{"version":1,"transactionId":"tx-early","targetPath":{},"temporaryPath":{},"backupPath":{},"stage":"{stage}","createdAt":1}}"#,
            serde_json::to_string(&target.to_string_lossy()).unwrap(),
            serde_json::to_string(&temporary.to_string_lossy()).unwrap(),
            serde_json::to_string(&backup.to_string_lossy()).unwrap(),
        ),
    ).unwrap();
    journal
}

#[test]
fn early_interruption_stages_preserve_old_or_incoming_content_for_every_action() {
    for stage in ["started", "temporary-written"] {
        let retry_root = fixture_dir(&format!("{stage}-retry"));
        let retry_journal = interrupted_before_backup(&retry_root, stage);
        recover_transaction(&retry_journal, RecoveryAction::Retry).unwrap();
        assert_eq!(
            fs::read_to_string(retry_root.join("note.canvas")).unwrap(),
            "new"
        );
        assert!(scan_recovery(retry_root.join(".iwae/journal"))
            .unwrap()
            .is_empty());
        fs::remove_dir_all(retry_root).unwrap();

        let preserve_root = fixture_dir(&format!("{stage}-preserve"));
        let preserve_journal = interrupted_before_backup(&preserve_root, stage);
        let result = recover_transaction(&preserve_journal, RecoveryAction::PreserveCopy).unwrap();
        assert_eq!(
            fs::read_to_string(preserve_root.join("note.canvas")).unwrap(),
            "old"
        );
        assert_eq!(
            fs::read_to_string(result.preserved_path.unwrap()).unwrap(),
            "new"
        );
        assert!(scan_recovery(preserve_root.join(".iwae/journal"))
            .unwrap()
            .is_empty());
        fs::remove_dir_all(preserve_root).unwrap();

        let cancel_root = fixture_dir(&format!("{stage}-cancel"));
        let cancel_journal = interrupted_before_backup(&cancel_root, stage);
        recover_transaction(&cancel_journal, RecoveryAction::Cancel).unwrap();
        assert_eq!(
            fs::read_to_string(cancel_root.join("note.canvas")).unwrap(),
            "old"
        );
        assert!(scan_recovery(cancel_root.join(".iwae/journal"))
            .unwrap()
            .is_empty());
        fs::remove_dir_all(cancel_root).unwrap();
    }
}
