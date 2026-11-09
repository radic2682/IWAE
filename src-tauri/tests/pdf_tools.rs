//! PDF 도구(`pdf_tool`) 통합 테스트. PDFium 이 실제로 만든 결과를 다시 열어 확인한다.

mod common;

use app_lib::pdf::{
    ExportHighlight, FlatOverlay, LinkRect, NumberPosition, PdfThread, Redaction, SearchableLine, SearchablePage, ToolOp, ToolTarget,
};
use common::{fixture_dir, pdfium_present, write_single_page_pdf, write_text_index_pdf, write_two_page_pdf};

fn new_file(name: &str) -> ToolTarget {
    let path = fixture_dir().join(name);
    let _ = std::fs::remove_file(&path);
    ToolTarget::NewFile { path }
}

#[test]
fn ocr_layer_goes_into_the_original_and_keeps_a_backup() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let source = write_single_page_pdf("tool-ocr-in-place.pdf", 612.0, 792.0);
    let original = std::fs::read(&source).unwrap();
    let meta = pdf.open_blocking(source.clone()).expect("열기");
    assert!(!meta.has_text);
    let backup = fixture_dir().join("backups").join("tool-ocr-in-place.pdf");
    let _ = std::fs::remove_file(&backup);

    let line = SearchableLine { text: "Scanned words become searchable text after the OCR layer is written".into(), x: 50.0, y: 100.0, w: 480.0, h: 14.0 };
    let result = pdf
        .tool_blocking(
            meta.doc_id.clone(),
            ToolOp::Searchable { pages: vec![SearchablePage { page: 0, lines: vec![line] }] },
            ToolTarget::InPlace { path: source.clone(), backup: backup.clone() },
        )
        .expect("OCR 글자 층");
    assert_eq!(result.report.written, 1);
    let reopened = result.meta.expect("다시 연 메타");
    assert_eq!(reopened.doc_id, meta.doc_id, "doc_id 는 그대로(형광펜·메모가 따라온다)");
    assert!(reopened.has_text, "이제 글자가 있다");
    assert_eq!(std::fs::read(&backup).unwrap(), original, "덮기 전 원본이 백업에 남는다");
    let text = pdf.page_text_blocking(meta.doc_id, 0).expect("글자").text;
    assert!(text.contains("Scanned words become searchable text after"), "{text:?}");
}

#[test]
fn extract_merge_and_n_up_make_new_files() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let meta = pdf.open_blocking(write_two_page_pdf("tool-two.pdf")).expect("열기");

    let target = new_file("tool-extract.pdf");
    let ToolTarget::NewFile { path } = &target else { unreachable!() };
    let path = path.clone();
    let result = pdf.tool_blocking(meta.doc_id.clone(), ToolOp::Extract { pages: vec![1] }, target).expect("뽑기");
    assert!(result.meta.is_none(), "원본은 그대로");
    let extracted = pdf.open_blocking(path).expect("뽑은 PDF");
    assert_eq!(extracted.page_count, 1);
    assert_eq!(extracted.page_sizes[0], (200.0, 400.0), "두 번째 쪽만");

    let other = write_text_index_pdf("tool-merge-other.pdf");
    let target = new_file("tool-merged.pdf");
    let ToolTarget::NewFile { path } = &target else { unreachable!() };
    let path = path.clone();
    pdf.tool_blocking(meta.doc_id.clone(), ToolOp::Merge { sources: vec![other.display().to_string()] }, target).expect("합치기");
    assert_eq!(pdf.open_blocking(path).expect("합친 PDF").page_count, 4);

    let target = new_file("tool-nup.pdf");
    let ToolTarget::NewFile { path } = &target else { unreachable!() };
    let path = path.clone();
    pdf.tool_blocking(meta.doc_id, ToolOp::NUp { columns: 2, rows: 1, landscape: true }, target).expect("모아찍기");
    let tiled = pdf.open_blocking(path).expect("모아찍은 PDF");
    assert_eq!(tiled.page_count, 1);
    assert!(tiled.page_sizes[0].0 > tiled.page_sizes[0].1, "A4 가로");
}

#[test]
fn page_numbers_watermark_and_crop_change_the_pages() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let meta = pdf.open_blocking(write_two_page_pdf("tool-decorate.pdf")).expect("열기");

    let target = new_file("tool-numbers.pdf");
    let ToolTarget::NewFile { path } = &target else { unreachable!() };
    let path = path.clone();
    let op = ToolOp::PageNumbers { position: NumberPosition::BottomCenter, start: 1, template: "{n} / {total}".into(), size: 10.0, skip_first: false };
    assert_eq!(pdf.tool_blocking(meta.doc_id.clone(), op, target).expect("쪽 번호").report.written, 2);
    let numbered = pdf.open_blocking(path).expect("번호 PDF");
    let second = pdf.page_text_blocking(numbered.doc_id, 1).expect("글자").text;
    assert!(second.contains("2 / 2"), "{second:?}");

    let target = new_file("tool-watermark.pdf");
    let ToolTarget::NewFile { path } = &target else { unreachable!() };
    let path = path.clone();
    let op = ToolOp::Watermark { text: "DRAFT".into(), size: 60.0, opacity: 0.2, angle: 45.0, color: "#888888".into() };
    pdf.tool_blocking(meta.doc_id.clone(), op, target).expect("워터마크");
    let marked = pdf.open_blocking(path).expect("워터마크 PDF");
    assert!(pdf.page_text_blocking(marked.doc_id, 0).expect("글자").text.contains("DRAFT"));

    let target = new_file("tool-crop.pdf");
    let ToolTarget::NewFile { path } = &target else { unreachable!() };
    let path = path.clone();
    pdf.tool_blocking(meta.doc_id, ToolOp::Crop { left: 50.0, top: 20.0, right: 50.0, bottom: 20.0 }, target).expect("자르기");
    let cropped = pdf.open_blocking(path).expect("자른 PDF");
    assert_eq!(cropped.page_sizes[0], (512.0, 752.0));
}

#[test]
fn flatten_writes_my_marks_and_redaction_really_removes_text() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let meta = pdf.open_blocking(write_text_index_pdf("tool-flatten.pdf")).expect("열기");
    let before = pdf.page_text_blocking(meta.doc_id.clone(), 0).expect("글자");
    assert!(!before.text.is_empty());

    let target = new_file("tool-flatten-out.pdf");
    let ToolTarget::NewFile { path } = &target else { unreachable!() };
    let path = path.clone();
    let overlay = FlatOverlay::Text {
        page: 1,
        x: 40.0,
        y: 60.0,
        w: 200.0,
        text: "Reviewer note on page two".into(),
        size: 11.0,
        color: "#d9363e".into(),
        bold: false,
        fill: Some("yellow".into()),
        border: true,
    };
    let line = FlatOverlay::Line { page: 1, x1: 40.0, y1: 200.0, x2: 300.0, y2: 200.0, color: "#1a73e8".into(), width: 2.0, arrow: true, arrow_start: false, dashed: true, dotted: false };
    // 첫 쪽 전체를 가린다
    let (w, h) = meta.page_sizes[0];
    let redaction = Redaction { page: 0, rect: LinkRect { x: 0.0, y: 0.0, w, h } };
    let highlight = ExportHighlight { page: 0, rects: vec![LinkRect { x: 40.0, y: 60.0, w: 80.0, h: 12.0 }], color: [255, 230, 0], note: None };
    let result = pdf
        .tool_blocking(
            meta.doc_id,
            ToolOp::Flatten { highlights: vec![highlight], overlays: vec![overlay, line], notes: vec![], redactions: vec![redaction] },
            target,
        )
        .expect("굽기");
    assert_eq!(result.report.rasterized, 1);
    let baked = pdf.open_blocking(path).expect("구운 PDF");
    assert_eq!(baked.page_count, 2);
    let first = pdf.page_text_blocking(baked.doc_id.clone(), 0).expect("첫 쪽");
    assert!(first.text.trim().is_empty(), "가린 쪽에는 글자가 남지 않는다: {:?}", first.text);
    let second = pdf.page_text_blocking(baked.doc_id, 1).expect("둘째 쪽").text;
    assert!(second.contains("Reviewer note"), "{second:?}");
}

#[test]
fn blank_pages_are_found_and_pages_export_as_images() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let meta = pdf.open_blocking(write_two_page_pdf("tool-blank.pdf")).expect("열기");
    assert_eq!(pdf.blank_pages_blocking(meta.doc_id.clone()).expect("빈 쪽"), vec![1]);

    let folder = fixture_dir().join("tool-images");
    let _ = std::fs::remove_dir_all(&folder);
    assert_eq!(pdf.export_images_blocking(meta.doc_id, folder.clone(), "page".into(), 72.0).expect("그림"), 2);
    assert!(folder.join("page-01.png").is_file());
    assert!(folder.join("page-02.png").is_file());
}

#[test]
fn unlock_copies_every_page() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let meta = pdf.open_blocking(write_two_page_pdf("tool-unlock.pdf")).expect("열기");
    let target = new_file("tool-unlocked.pdf");
    let ToolTarget::NewFile { path } = &target else { unreachable!() };
    let path = path.clone();
    pdf.tool_blocking(meta.doc_id, ToolOp::Unlock, target).expect("풀기");
    assert_eq!(pdf.open_blocking(path).expect("푼 PDF").page_count, 2);
}
