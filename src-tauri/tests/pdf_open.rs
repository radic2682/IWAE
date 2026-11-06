//! `pdf_open` 뒤의 엔진·스레드 통합 테스트.

mod common;

use std::fs;

use app_lib::pdf::PdfThread;
use common::{fixture_dir, pdfium_present, write_two_page_pdf};

#[test]
fn open_reports_page_count_and_a_size_per_page() {
    if !pdfium_present() {
        return;
    }

    // `spawn` 이 아니라 `shared` 다. 부를 때마다 Pdfium 이 하나씩 더 초기화되면 cargo 의 병렬
    // 러너 아래에서 앱이 절대 쓰지 않는 구성이 만들어진다.
    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_two_page_pdf("two-page.pdf"))
        .expect("문서가 열려야 한다");

    assert_eq!(meta.page_count, 2);
    assert_eq!(meta.page_sizes.len(), meta.page_count as usize);
    assert_eq!(meta.page_sizes[0], (612.0, 792.0));
    assert_eq!(meta.page_sizes[1], (200.0, 400.0));
    assert_eq!(meta.title, "two-page");
    assert!(
        meta.has_text,
        "글자가 든 픽스처는 텍스트 레이어가 있어야 한다"
    );
}

#[test]
fn same_file_yields_the_same_doc_id() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let path = write_two_page_pdf("doc-id.pdf");

    let first = pdf.open_blocking(path.clone()).expect("첫 번째 열기");
    let second = pdf.open_blocking(path).expect("두 번째 열기");

    assert_eq!(first.doc_id, second.doc_id);
    assert_eq!(first.doc_id.len(), 12);

    // 내용이 같고 이름만 다르면 doc_id 도 같아야 한다 — 경로가 아니라 내용으로 식별하므로.
    // 다만 제목은 방금 연 파일의 것이어야 한다(캐시에 남은 옛 이름이 아니라).
    let copy = pdf
        .open_blocking(write_two_page_pdf("doc-id-copy.pdf"))
        .expect("복사본 열기");
    assert_eq!(first.doc_id, copy.doc_id);
    assert_eq!(copy.title, "doc-id-copy");

    // 캐시 적중을 한 번 더 지나도 옛 이름으로 되돌아가지 않아야 한다 — 제목을 캐시에 담지
    // 않는 이유가 이것이다.
    let again = pdf
        .open_blocking(write_two_page_pdf("doc-id-copy.pdf"))
        .expect("복사본 다시 열기");
    assert_eq!(again.title, "doc-id-copy");
}

#[test]
fn open_reports_full_sha256_and_file_size_for_the_vault_registry() {
    if !pdfium_present() {
        return;
    }

    let path = write_two_page_pdf("vault-identity.pdf");
    let expected_size = fs::metadata(&path).expect("픽스처 메타").len();
    let meta = PdfThread::shared()
        .open_blocking(path)
        .expect("문서가 열려야 한다");

    assert_eq!(meta.sha256.len(), 64);
    assert_eq!(meta.doc_id, meta.sha256[..12]);
    assert_eq!(meta.size, expected_size);
}

#[test]
fn a_missing_file_is_an_error_not_a_panic() {
    let pdf = PdfThread::shared();
    let result = pdf.open_blocking(fixture_dir().join("nope-does-not-exist.pdf"));

    assert!(result.is_err(), "없는 파일은 오류여야 한다");
}
