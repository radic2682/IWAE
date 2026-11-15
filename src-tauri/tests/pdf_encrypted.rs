//! 암호가 걸린 PDF: 쪽 편집은 암호를 지우므로 거절하고, 내보내기·합치기는 이미 푼 암호를 쓴다.
//!
//! 픽스처는 `tests/fixtures/gen_encrypted.mjs` 가 만든 RC4-128 PDF 둘이다(쪽 2장).
//! - `user-pw.pdf`: 열기 암호 `secret`
//! - `owner-only.pdf`: 열기 암호는 없고 소유자 암호로 인쇄·수정·복사만 막는다

mod common;

use std::path::{Path, PathBuf};

use app_lib::pdf::{ExportHighlight, LinkRect, PageEditOp, PdfThread, SearchableLine, SearchablePage, ToolOp, ToolTarget, PASSWORD_REQUIRED, PASSWORD_WRONG};
use common::{fixture_dir, pdfium_present, write_two_page_pdf};

const PASSWORD: &str = "secret";

fn copy_fixture(fixture: &str, name: &str) -> PathBuf {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join(fixture);
    let target = fixture_dir().join(name);
    let _ = std::fs::remove_file(&target);
    std::fs::copy(&source, &target).expect("픽스처 복사");
    target
}

fn fresh(name: &str) -> PathBuf {
    let path = fixture_dir().join(name);
    let _ = std::fs::remove_file(&path);
    path
}

fn has_encrypt(path: &Path) -> bool {
    std::fs::read(path).expect("읽기").windows(8).any(|window| window == b"/Encrypt")
}

fn doc_id(name: &str) -> String {
    format!("enc-{name}")
}

fn open_user(pdf: &PdfThread, path: &Path, id: &str) {
    pdf.open_with_password_blocking(path.to_path_buf(), Some(id.into()), Some(PASSWORD.into())).expect("암호로 열기");
}

fn swap_pages() -> Vec<PageEditOp> {
    vec![PageEditOp { source: None, page: 1, rotate: 0 }, PageEditOp { source: None, page: 0, rotate: 0 }]
}

#[test]
fn encrypted_flag_covers_open_passwords_and_owner_only_restrictions() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let user = copy_fixture("user-pw.pdf", "enc-flag-user.pdf");
    let meta = pdf.open_with_password_blocking(user, Some(doc_id("flag-user")), Some(PASSWORD.into())).expect("열기");
    assert!(meta.encrypted, "열기 암호 PDF");
    assert_eq!(meta.page_count, 2);

    let owner = copy_fixture("owner-only.pdf", "enc-flag-owner.pdf");
    let meta = pdf.open_with_password_blocking(owner, Some(doc_id("flag-owner")), None).expect("암호 없이 열린다");
    assert!(meta.encrypted, "소유자 암호만 있는 PDF 도 암호가 걸린 PDF 다");

    let plain = pdf.open_blocking(write_two_page_pdf("enc-flag-plain.pdf")).expect("열기");
    assert!(!plain.encrypted);
}

#[test]
fn page_edit_refuses_a_password_pdf_and_leaves_the_file_alone() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let path = copy_fixture("user-pw.pdf", "enc-edit-user.pdf");
    let id = doc_id("edit-user");
    open_user(&pdf, &path, &id);
    let before = std::fs::read(&path).unwrap();
    let backup = fresh("enc-edit-user.backup.pdf");

    let error = pdf.edit_pages_blocking(id.clone(), path.clone(), backup.clone(), swap_pages()).expect_err("거절해야 한다");
    assert!(error.contains("PDF"), "{error}");
    assert!(!error.contains(PASSWORD_REQUIRED), "암호 요청이 아니라 편집 거절이다: {error}");
    assert_eq!(std::fs::read(&path).unwrap(), before, "원본은 그대로");
    assert!(has_encrypt(&path), "암호도 그대로");
    assert!(!backup.exists(), "덮지 않았으니 백업도 만들지 않는다");
    // 문서는 계속 열려 있어 읽을 수 있다
    assert!(pdf.page_text_blocking(id, 0).expect("글자").text.contains("Secret page one"));
}

#[test]
fn page_edit_refuses_an_owner_password_pdf() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let path = copy_fixture("owner-only.pdf", "enc-edit-owner.pdf");
    let id = doc_id("edit-owner");
    pdf.open_with_password_blocking(path.clone(), Some(id.clone()), None).expect("열기");
    let before = std::fs::read(&path).unwrap();
    let plan = vec![PageEditOp { source: None, page: 0, rotate: 90 }, PageEditOp { source: None, page: 1, rotate: 0 }];

    pdf.edit_pages_blocking(id, path.clone(), fresh("enc-edit-owner.backup.pdf"), plan).expect_err("회전만 해도 권한 제한이 사라지므로 거절");
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert!(has_encrypt(&path));
}

#[test]
fn page_edit_of_a_plain_pdf_still_works() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let path = write_two_page_pdf("enc-edit-plain.pdf");
    let id = doc_id("edit-plain");
    pdf.open_with_password_blocking(path.clone(), Some(id.clone()), None).expect("열기");
    let meta = pdf.edit_pages_blocking(id, path.clone(), fresh("enc-edit-plain.backup.pdf"), swap_pages()).expect("편집");
    assert_eq!(meta.page_count, 2);
    assert!(!meta.encrypted);
}

#[test]
fn exports_of_a_password_pdf_open_the_copy_with_the_remembered_password() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let path = copy_fixture("user-pw.pdf", "enc-export-user.pdf");
    let id = doc_id("export-user");
    open_user(&pdf, &path, &id);

    let highlight = ExportHighlight { page: 0, rects: vec![LinkRect { x: 60.0, y: 80.0, w: 200.0, h: 20.0 }], color: [255, 230, 0], note: Some("memo".into()) };
    let annotated = fresh("enc-export-user-annotated.pdf");
    pdf.export_annotated_blocking(id.clone(), vec![highlight], annotated.clone()).expect("주석 내보내기");
    assert!(annotated.exists());
    // 사본도 같은 암호로 열린다(암호는 사본에 그대로 남는다)
    let reopened = pdf.open_with_password_blocking(annotated, Some(doc_id("export-user-annotated")), Some(PASSWORD.into())).expect("사본 열기");
    assert_eq!(reopened.page_count, 2);

    let searchable = fresh("enc-export-user-searchable.pdf");
    let pages = vec![SearchablePage { page: 0, lines: vec![SearchableLine { text: "ocr words".into(), x: 10.0, y: 10.0, w: 80.0, h: 10.0 }] }];
    pdf.export_searchable_blocking(id, pages, searchable.clone()).expect("검색 가능한 PDF");
    let reopened = pdf.open_with_password_blocking(searchable, Some(doc_id("export-user-searchable")), Some(PASSWORD.into())).expect("사본 열기");
    assert_eq!(reopened.page_count, 2);
}

#[test]
fn inserting_pages_from_a_pdf_the_user_already_unlocked_works() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let host = write_two_page_pdf("enc-insert-host.pdf");
    let other = copy_fixture("user-pw.pdf", "enc-insert-other.pdf");
    open_user(&pdf, &other, &doc_id("insert-other"));
    let id = doc_id("insert-host");
    pdf.open_with_password_blocking(host.clone(), Some(id.clone()), None).expect("열기");

    let plan = vec![
        PageEditOp { source: None, page: 0, rotate: 0 },
        PageEditOp { source: Some(other.to_string_lossy().into_owned()), page: 0, rotate: 0 },
    ];
    let meta = pdf.edit_pages_blocking(id, host, fresh("enc-insert-host.backup.pdf"), plan).expect("암호를 푼 PDF 의 쪽을 끼운다");
    assert_eq!(meta.page_count, 2);
}

#[test]
fn inserting_pages_from_a_still_locked_pdf_asks_for_the_password() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let host = write_two_page_pdf("enc-insert-locked-host.pdf");
    // 이 경로로는 한 번도 암호를 풀지 않았다
    let other = copy_fixture("user-pw.pdf", "enc-insert-locked-other.pdf");
    let id = doc_id("insert-locked-host");
    pdf.open_with_password_blocking(host.clone(), Some(id.clone()), None).expect("열기");
    let plan = vec![PageEditOp { source: Some(other.to_string_lossy().into_owned()), page: 0, rotate: 0 }];

    let error = pdf.edit_pages_blocking(id, host, fresh("enc-insert-locked.backup.pdf"), plan).expect_err("암호를 모른다");
    assert!(error.starts_with(PASSWORD_REQUIRED), "웹뷰가 암호를 물을 수 있는 오류여야 한다: {error}");
}

#[test]
fn merging_a_pdf_the_user_already_unlocked_works_and_says_the_copy_has_no_password() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let plain = write_two_page_pdf("enc-merge-plain.pdf");
    let other = copy_fixture("user-pw.pdf", "enc-merge-other.pdf");
    open_user(&pdf, &other, &doc_id("merge-other"));
    let id = doc_id("merge-plain");
    pdf.open_with_password_blocking(plain, Some(id.clone()), None).expect("열기");

    let out = fresh("enc-merge-out.pdf");
    let result = pdf
        .tool_blocking(id, ToolOp::Merge { sources: vec![other.to_string_lossy().into_owned()] }, ToolTarget::NewFile { path: out.clone() })
        .expect("합치기");
    assert_eq!(result.report.written, 4);
    assert!(result.report.unencrypted_copy, "암호 PDF 가 섞였으니 결과에 암호가 없다고 알려야 한다");
    assert!(!has_encrypt(&out));
}

#[test]
fn merging_a_still_locked_pdf_asks_for_the_password() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let plain = write_two_page_pdf("enc-merge-locked-plain.pdf");
    let other = copy_fixture("user-pw.pdf", "enc-merge-locked-other.pdf");
    let id = doc_id("merge-locked-plain");
    pdf.open_with_password_blocking(plain, Some(id.clone()), None).expect("열기");

    let error = pdf
        .tool_blocking(id, ToolOp::Merge { sources: vec![other.to_string_lossy().into_owned()] }, ToolTarget::NewFile { path: fresh("enc-merge-locked-out.pdf") })
        .expect_err("암호를 모른다");
    assert!(error.starts_with(PASSWORD_REQUIRED), "{error}");
}

#[test]
fn extract_and_n_up_of_an_encrypted_pdf_report_that_the_copy_has_no_password() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let path = copy_fixture("user-pw.pdf", "enc-extract.pdf");
    let id = doc_id("extract");
    open_user(&pdf, &path, &id);

    let out = fresh("enc-extract-out.pdf");
    let result = pdf.tool_blocking(id.clone(), ToolOp::Extract { pages: vec![1] }, ToolTarget::NewFile { path: out.clone() }).expect("뽑기");
    assert!(result.report.unencrypted_copy);
    assert!(!has_encrypt(&out));

    let out = fresh("enc-nup-out.pdf");
    let result = pdf.tool_blocking(id.clone(), ToolOp::NUp { columns: 2, rows: 1, landscape: true }, ToolTarget::NewFile { path: out }).expect("모아찍기");
    assert!(result.report.unencrypted_copy);

    // 암호 없는 PDF 에는 알릴 것이 없다
    let plain = pdf.open_blocking(write_two_page_pdf("enc-extract-plain.pdf")).expect("열기");
    let result = pdf.tool_blocking(plain.doc_id, ToolOp::Extract { pages: vec![0] }, ToolTarget::NewFile { path: fresh("enc-extract-plain-out.pdf") }).expect("뽑기");
    assert!(!result.report.unencrypted_copy);

    // 원본을 그 결과로 덮는 일은 막는다
    let before = std::fs::read(&path).unwrap();
    pdf.tool_blocking(id, ToolOp::Extract { pages: vec![0, 1] }, ToolTarget::InPlace { path: path.clone(), backup: fresh("enc-extract.backup.pdf") })
        .expect_err("새 문서로 다시 쓰는 도구를 암호 PDF 위에 덮지 않는다");
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[test]
fn byte_copy_tools_keep_the_encryption_of_the_original() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    for (fixture, password) in [("user-pw.pdf", Some(PASSWORD)), ("owner-only.pdf", None)] {
        let path = copy_fixture(fixture, &format!("enc-watermark-{fixture}"));
        let id = doc_id(&format!("watermark-{fixture}"));
        pdf.open_with_password_blocking(path.clone(), Some(id.clone()), password.map(str::to_string)).expect("열기");
        let op: ToolOp = serde_json::from_str(r##"{"kind":"watermark","text":"DRAFT","size":40,"opacity":0.2,"angle":45,"color":"#ff0000"}"##).unwrap();
        let backup = fresh(&format!("enc-watermark-{fixture}.backup.pdf"));
        let result = pdf.tool_blocking(id, op, ToolTarget::InPlace { path: path.clone(), backup }).expect("워터마크");
        assert!(!result.report.unencrypted_copy);
        assert!(has_encrypt(&path), "{fixture}: 바이트 사본을 고치는 도구는 암호를 지키므로 원본에 덮어도 된다");
    }
}

#[test]
fn checking_a_source_reports_the_password_state_without_touching_the_open_document_cache() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let plain = write_two_page_pdf("enc-check-plain.pdf");
    let locked = copy_fixture("user-pw.pdf", "enc-check-locked.pdf");

    pdf.check_source_blocking(plain, None).expect("a plain PDF needs no password");
    let required = pdf.check_source_blocking(locked.clone(), None).expect_err("locked");
    assert!(required.starts_with(PASSWORD_REQUIRED), "{required}");
    assert!(required.contains("enc-check-locked.pdf"), "the error names the path: {required}");
    let wrong = pdf.check_source_blocking(locked.clone(), Some("nope".into())).expect_err("wrong password");
    assert!(wrong.starts_with(PASSWORD_WRONG), "{wrong}");

    // A right password is remembered for that path, so a later merge works without opening the source into the cache.
    pdf.check_source_blocking(locked.clone(), Some(PASSWORD.into())).expect("right password");
    pdf.check_source_blocking(locked.clone(), None).expect("remembered");
    let host = write_two_page_pdf("enc-check-host.pdf");
    let id = doc_id("check-host");
    pdf.open_with_password_blocking(host, Some(id.clone()), None).expect("host");
    pdf.tool_blocking(id, ToolOp::Merge { sources: vec![locked.to_string_lossy().into_owned()] }, ToolTarget::NewFile { path: fresh("enc-check-merged.pdf") })
        .expect("merge with the remembered password");
}
