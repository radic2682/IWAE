//! 브라우저 개발 미리보기 fixture 생성기.
//!
//! `cargo test --test export_web_fixture -- --ignored` 로 실행한다. 브라우저가
//! PDFium을 직접 부를 수는 없으므로, 같은 PDFium 파이프라인이 만든 PNG와
//! 글자 상자를 저장해 웹에서도 선택 UI를 검증한다.

mod common;

use std::path::{Path, PathBuf};

use app_lib::pdf::PdfThread;
use common::pdfium_present;
use serde_json::json;

#[test]
#[ignore = "개발 fixture를 명시적으로 갱신할 때만 실행"]
fn export_pdfium_browser_fixture() {
    if !pdfium_present() {
        panic!("PDFium이 있어야 브라우저 fixture를 만들 수 있습니다");
    }

    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let public_dir = root.join("public").join("dev-pdf");
    let fixture_pdf = public_dir.join("iwae-web-preview.pdf");
    let source = std::env::var_os("IWAE_WEB_PREVIEW_PDF")
        .map(PathBuf::from)
        .unwrap_or_else(|| fixture_pdf.clone());
    assert!(
        source.is_file(),
        "브라우저 fixture 원본 PDF가 없습니다: {}",
        source.display()
    );
    let pdf = PdfThread::shared();
    let mut meta = pdf.open_blocking(source.clone()).expect("fixture PDF 열기");
    let preview_page_count = std::env::var("IWAE_WEB_PREVIEW_PAGES")
        .ok()
        .and_then(|value| value.parse::<i32>().ok())
        .filter(|count| *count > 0)
        .map_or(meta.page_count, |count| count.min(meta.page_count));
    let data_path = root.join("src").join("pdf").join("devPdfData.json");
    std::fs::create_dir_all(&public_dir).expect("public/dev-pdf 생성");
    remove_stale_page_images(&public_dir);
    if source != fixture_pdf {
        std::fs::copy(&source, &fixture_pdf).expect("원본 PDF 복사");
    }

    let mut indexes = Vec::new();
    for page in 0..preview_page_count {
        let png = pdf
            .render_blocking(meta.doc_id.clone(), page, 1200)
            .expect("페이지 PNG 렌더");
        std::fs::write(public_dir.join(format!("page-{}.png", page + 1)), png)
            .expect("페이지 PNG 저장");
        indexes.push(
            pdf.page_text_blocking(meta.doc_id.clone(), page)
                .expect("페이지 텍스트 추출"),
        );
    }

    let outline = pdf
        .outline_blocking(meta.doc_id.clone())
        .expect("PDF 목차 추출")
        .into_iter()
        .filter(|entry| entry.page.is_none_or(|page| page < preview_page_count))
        .collect::<Vec<_>>();
    meta.page_count = preview_page_count;
    meta.page_sizes.truncate(preview_page_count as usize);

    let data = json!({
        "metadata": meta,
        "pages": indexes,
        "outline": outline,
    });
    std::fs::write(
        data_path,
        serde_json::to_vec_pretty(&data).expect("fixture JSON 직렬화"),
    )
    .expect("fixture JSON 저장");
}

fn remove_stale_page_images(public_dir: &Path) {
    for entry in std::fs::read_dir(public_dir).expect("기존 fixture 목록 읽기") {
        let path = entry.expect("기존 fixture 항목 읽기").path();
        let is_page_image = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("page-") && name.ends_with(".png"));
        if is_page_image {
            std::fs::remove_file(path).expect("기존 페이지 PNG 삭제");
        }
    }
}
