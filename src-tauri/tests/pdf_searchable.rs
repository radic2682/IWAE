mod common;

use app_lib::pdf::{find_unicode_font, PdfThread, SearchableLine, SearchablePage};
use common::{fixture_dir, pdfium_present, write_single_page_pdf};

#[test]
fn writes_an_invisible_text_layer_that_pdfium_can_read_back() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let source = write_single_page_pdf("scan-like.pdf", 612.0, 792.0);
    let original = std::fs::read(&source).unwrap();
    let meta = pdf.open_blocking(source.clone()).expect("열기");
    assert!(!meta.has_text);

    let mut lines = vec![SearchableLine {
        text: "Hello OCR layer".into(),
        x: 50.0,
        y: 100.0,
        w: 160.0,
        h: 14.0,
    }];
    let unicode = find_unicode_font().is_some();
    if unicode {
        lines.push(SearchableLine {
            text: "안녕 세계".into(),
            x: 50.0,
            y: 130.0,
            w: 90.0,
            h: 14.0,
        });
    }
    let target = fixture_dir().join("searchable-out.pdf");
    let _ = std::fs::remove_file(&target);
    let report = pdf
        .export_searchable_blocking(
            meta.doc_id,
            vec![SearchablePage { page: 0, lines }],
            target.clone(),
        )
        .expect("검색 가능한 사본 만들기");
    assert_eq!(report.written, if unicode { 2 } else { 1 });
    assert_eq!(std::fs::read(&source).unwrap(), original, "원본은 그대로");

    let copy = pdf.open_blocking(target).expect("사본 열기");
    let text = pdf
        .page_text_blocking(copy.doc_id, 0)
        .expect("사본 글자")
        .text;
    assert!(text.contains("Hello OCR layer"), "{text:?}");
    if unicode {
        assert!(text.contains("안녕 세계"), "{text:?}");
    }
}
