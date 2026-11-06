mod common;

use app_lib::pdf::PdfThread;
use common::{pdfium_present, write_outline_pdf};

#[test]
fn reads_bookmark_titles_pages_and_depths() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_outline_pdf("outline.pdf"))
        .expect("목차 PDF 열기");
    let outline = pdf.outline_blocking(meta.doc_id).expect("PDF 목차 읽기");

    assert_eq!(outline.len(), 3);
    assert_eq!(outline[0].title, "Part One");
    assert_eq!(outline[0].page, Some(0));
    assert_eq!(outline[0].depth, 0);
    assert_eq!(outline[1].title, "Details");
    assert_eq!(outline[1].page, Some(1));
    assert_eq!(outline[1].depth, 1);
    assert_eq!(outline[2].title, "Appendix");
    assert_eq!(outline[2].page, Some(1));
    assert_eq!(outline[2].depth, 0);
}
