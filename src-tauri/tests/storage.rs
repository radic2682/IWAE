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
        preserve_conflict: true,
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
fn expected_hash_mismatch_leaves_no_conflict_record_when_the_caller_merges_and_retries() {
    let root = fixture_dir("conflict-silent");
    fs::write(root.join("note.canvas"), "other window").expect("other window file");

    let mut silent = request(&root, "local", Some(sha256_hex(b"old")));
    silent.preserve_conflict = false;
    let error = atomic_write(&silent).expect_err("revision mismatch must still conflict");

    assert!(matches!(error, StorageError::Conflict { .. }));
    assert_eq!(fs::read_to_string(root.join("note.canvas")).unwrap(), "other window");
    assert!(!root.join(".iwae/conflicts").exists(), "no conflict record for a retried write");
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
fn verified_interruption_stages_preserve_old_or_incoming_content_for_every_action() {
    for stage in ["temporary-written", "backup-created"] {
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

fn history_files(root: &std::path::Path) -> usize {
    fs::read_dir(root.join(".iwae/history/note-1")).map(|dir| dir.count()).unwrap_or(0)
}

#[test]
fn unverified_started_stage_refuses_retry_and_preserve_but_cancel_still_works() {
    for action in [RecoveryAction::Retry, RecoveryAction::PreserveCopy] {
        let root = fixture_dir("started-refused");
        let journal = interrupted_before_backup(&root, "started");
        fs::write(root.join(".iwae-tx-early.tmp"), "ne").unwrap(); // torn write
        let error = recover_transaction(&journal, action).expect_err("torn temp must not be applied");
        assert!(matches!(error, StorageError::Invalid(_)));
        assert_eq!(fs::read_to_string(root.join("note.canvas")).unwrap(), "old");
        assert!(journal.exists(), "the journal stays so Cancel can still clean up");
        recover_transaction(&journal, RecoveryAction::Cancel).unwrap();
        assert_eq!(fs::read_to_string(root.join("note.canvas")).unwrap(), "old");
        assert!(!root.join(".iwae-tx-early.tmp").exists());
        assert!(!journal.exists());
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn scan_recovery_skips_a_corrupt_journal_and_moves_it_aside() {
    let root = fixture_dir("scan-corrupt");
    let journal = interrupted_before_backup(&root, "temporary-written");
    let journal_dir = journal.parent().unwrap().to_path_buf();
    fs::write(journal_dir.join("1700000000001-1-f2.json"), "").unwrap();
    fs::write(journal_dir.join("garbage.json"), "{not json").unwrap();

    let records = scan_recovery(&journal_dir).expect("one bad journal must not fail the scan");

    assert_eq!(records.len(), 1);
    assert_eq!(records[0].transaction_id, "tx-early");
    assert!(journal_dir.join("garbage.corrupt").exists());
    assert!(!journal_dir.join("garbage.json").exists());
    assert_eq!(scan_recovery(&journal_dir).unwrap().len(), 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn journals_are_written_without_leaving_temporary_files() {
    let root = fixture_dir("journal-atomic");
    fs::write(root.join("note.canvas"), "old").unwrap();
    atomic_write(&request(&root, "new", Some(sha256_hex(b"old")))).unwrap();
    assert_eq!(fs::read_dir(root.join(".iwae/journal")).unwrap().count(), 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rapid_saves_make_one_history_snapshot_and_keep_the_oldest_version() {
    let root = fixture_dir("history-throttle");
    fs::write(root.join("note.canvas"), "yesterday").unwrap();
    let mut hash = sha256_hex(b"yesterday");
    for i in 0..60 {
        hash = atomic_write(&request(&root, &format!("typing {i}"), Some(hash))).unwrap().content_hash;
        thread::sleep(std::time::Duration::from_millis(2));
    }
    assert_eq!(history_files(&root), 1);
    let only = fs::read_dir(root.join(".iwae/history/note-1")).unwrap().next().unwrap().unwrap().path();
    assert_eq!(fs::read_to_string(only).unwrap(), "yesterday");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn saving_after_the_throttle_window_skips_a_snapshot_equal_to_the_newest() {
    let root = fixture_dir("history-same");
    fs::write(root.join("note.canvas"), "same").unwrap();
    let history = root.join(".iwae/history/note-1");
    fs::create_dir_all(&history).unwrap();
    fs::write(history.join("1000.bak"), "same").unwrap(); // old snapshot, equal to the current content
    atomic_write(&request(&root, "different", Some(sha256_hex(b"same")))).unwrap();
    assert_eq!(history_files(&root), 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn history_older_than_the_throttle_window_is_snapshotted_and_capped_at_fifty() {
    let root = fixture_dir("history-cap");
    let history = root.join(".iwae/history/note-1");
    fs::create_dir_all(&history).unwrap();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64;
    for i in 0..60u64 {
        fs::write(history.join(format!("{}.bak", now - 3_600_000 + i)), format!("old {i}")).unwrap();
    }
    fs::write(root.join("note.canvas"), "current").unwrap();
    atomic_write(&request(&root, "next", Some(sha256_hex(b"current")))).unwrap();
    assert_eq!(history_files(&root), 50);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_read_only_note_is_refused_and_left_untouched() {
    let root = fixture_dir("readonly");
    let target = root.join("note.canvas");
    fs::write(&target, "old").unwrap();
    let mut permissions = fs::metadata(&target).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&target, permissions).unwrap();

    let error = atomic_write(&request(&root, "new", Some(sha256_hex(b"old")))).expect_err("read-only must be refused");

    assert!(matches!(error, StorageError::Invalid(_)));
    assert_eq!(fs::read_to_string(&target).unwrap(), "old");
    assert!(fs::metadata(&target).unwrap().permissions().readonly());
    assert!(!root.join(".iwae/journal").exists() || fs::read_dir(root.join(".iwae/journal")).unwrap().count() == 0);
    let mut permissions = fs::metadata(&target).unwrap().permissions();
    #[allow(clippy::permissions_set_readonly_false)]
    permissions.set_readonly(false);
    fs::set_permissions(&target, permissions).unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
#[test]
fn a_locked_target_leaves_no_temporary_or_journal_and_no_history() {
    use std::os::windows::fs::OpenOptionsExt;
    let root = fixture_dir("locked");
    let target = root.join("note.canvas");
    fs::write(&target, "old").unwrap();
    // another program holds the file open without FILE_SHARE_DELETE
    let holder = fs::OpenOptions::new().read(true).share_mode(0x1 | 0x2).open(&target).unwrap();
    for i in 0..3 {
        let result = atomic_write(&request(&root, &format!("new{i}"), Some(sha256_hex(b"old"))));
        assert!(result.is_err());
        thread::sleep(std::time::Duration::from_millis(3));
    }
    drop(holder);
    let names: Vec<String> = fs::read_dir(&root).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    assert!(names.iter().all(|name| !name.starts_with(".iwae-")), "debris left: {names:?}");
    assert!(scan_recovery(root.join(".iwae/journal")).unwrap().is_empty());
    assert_eq!(history_files(&root), 0, "failed saves must not snapshot");
    assert_eq!(fs::read_to_string(&target).unwrap(), "old");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_file_with_a_utf8_bom_can_be_saved_with_the_hash_of_the_decoded_text() {
    let root = fixture_dir("bom");
    fs::write(root.join("note.canvas"), b"\xEF\xBB\xBF{\"a\":1}").unwrap();
    // The webview hashes what TextDecoder returned: no BOM.
    let hash = sha256_hex(b"{\"a\":1}");

    atomic_write(&request(&root, "{\"a\":2}", Some(hash))).expect("BOM file is saveable");

    assert_eq!(fs::read_to_string(root.join("note.canvas")).unwrap(), "{\"a\":2}");
    assert!(!root.join(".iwae/conflicts").exists());
}

#[test]
fn a_file_with_invalid_utf8_can_be_saved_with_the_hash_of_the_lossy_text() {
    let root = fixture_dir("invalid-utf8");
    fs::write(root.join("note.canvas"), b"a\xFFb\xE2\x82").unwrap();
    let hash = sha256_hex("a\u{FFFD}b\u{FFFD}".as_bytes());

    atomic_write(&request(&root, "fixed", Some(hash))).expect("lossy-decoded hash is accepted");

    assert_eq!(fs::read_to_string(root.join("note.canvas")).unwrap(), "fixed");
}

#[test]
fn a_wrong_hash_still_conflicts_for_bom_files() {
    let root = fixture_dir("bom-conflict");
    fs::write(root.join("note.canvas"), b"\xEF\xBB\xBFold").unwrap();

    let error = atomic_write(&request(&root, "new", Some(sha256_hex(b"something else")))).unwrap_err();

    assert!(matches!(error, StorageError::Conflict { .. }));
    assert_eq!(fs::read(root.join("note.canvas")).unwrap(), b"\xEF\xBB\xBFold");
}

#[test]
fn a_future_dated_snapshot_does_not_stop_history_and_is_not_what_gets_throttled_against() {
    let root = fixture_dir("future-history");
    let directory = root.join(".iwae/history/note-1");
    fs::create_dir_all(&directory).unwrap();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64;
    let future = format!("{}.bak", now + 86_400_000);
    fs::write(directory.join(&future), "from a fast clock").unwrap();
    fs::write(root.join("note.canvas"), "v1").unwrap();

    atomic_write(&request(&root, "v2", None)).unwrap();
    let names = |directory: &std::path::Path| {
        let mut v: Vec<String> = fs::read_dir(directory)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    };
    let after_first = names(&directory);
    assert_eq!(after_first.len(), 2, "the old version was recorded: {after_first:?}");
    assert!(after_first.contains(&future));

    // An immediate second save is still throttled against the real (non-future) snapshot.
    atomic_write(&request(&root, "v3", None)).unwrap();
    assert_eq!(names(&directory).len(), 2);
}

#[test]
fn many_future_dated_snapshots_never_delete_the_one_just_written() {
    let root = fixture_dir("future-prune");
    let directory = root.join(".iwae/history/note-1");
    fs::create_dir_all(&directory).unwrap();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64;
    for i in 0..200u64 {
        fs::write(directory.join(format!("{}.bak", now + 1_000_000 + i)), "future").unwrap();
    }
    fs::write(root.join("note.canvas"), "v1").unwrap();

    atomic_write(&request(&root, "v2", None)).unwrap();

    let kept_old_version = fs::read_dir(&directory)
        .unwrap()
        .any(|e| fs::read(e.unwrap().path()).is_ok_and(|b| b == b"v1"));
    assert!(kept_old_version, "the snapshot of v1 must survive pruning");
}

#[test]
fn conflict_records_are_complete_json_and_leave_no_temporary_files() {
    let root = fixture_dir("conflict-atomic");
    fs::write(root.join("note.canvas"), "current").unwrap();

    atomic_write(&request(&root, "mine", Some(sha256_hex(b"stale")))).unwrap_err();

    let conflicts = root.join(".iwae/conflicts");
    let mut json = 0;
    for entry in fs::read_dir(&conflicts).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        assert!(!name.ends_with(".tmp"), "left a temporary file: {name}");
        if name.ends_with(".json") {
            json += 1;
            let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            assert!(value.get("targetPath").is_some() || value.get("target_path").is_some());
        }
    }
    assert_eq!(json, 1);
}
