//! PDF 도구(`pdf_tool`) 통합 테스트. PDFium 이 실제로 만든 결과를 다시 열어 확인한다.

mod common;

use app_lib::pdf::{
    ExportHighlight, FlatOverlay, LinkRect, NumberPosition, PdfThread, Redaction, SearchableLine, SearchablePage, ToolOp, ToolTarget,
};
use common::{fixture_dir, pdfium_present, write_photo_pdf, write_single_page_pdf, write_text_index_pdf, write_two_page_pdf};

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
        border_color: None,
        font: None,
    };
    // 글꼴·소수 크기·직접 고른 배경색·테두리색(한글 글꼴은 시스템 글꼴 파일, 영문은 PDF 기본 글꼴)
    let styled = FlatOverlay::Text {
        page: 1,
        x: 40.0,
        y: 120.0,
        w: 220.0,
        text: "Batang sample 9.5pt".into(),
        size: 9.5,
        color: "#222222".into(),
        bold: true,
        fill: Some("#cde8ff".into()),
        border: true,
        border_color: Some("#e4572e".into()),
        font: Some("batang".into()),
    };
    let serif = FlatOverlay::Text {
        page: 1,
        x: 40.0,
        y: 160.0,
        w: 220.0,
        text: "Times serif sample".into(),
        size: 10.5,
        color: "#222222".into(),
        bold: false,
        fill: None,
        border: false,
        border_color: None,
        font: Some("times".into()),
    };
    let line = FlatOverlay::Line { page: 1, x1: 40.0, y1: 200.0, x2: 300.0, y2: 200.0, color: "#1a73e8".into(), width: 2.0, arrow: true, arrow_start: false, dashed: true, dotted: false };
    // 첫 쪽 전체를 가린다
    let (w, h) = meta.page_sizes[0];
    let redaction = Redaction { page: 0, rect: LinkRect { x: 0.0, y: 0.0, w, h } };
    let highlight = ExportHighlight { page: 0, rects: vec![LinkRect { x: 40.0, y: 60.0, w: 80.0, h: 12.0 }], color: [255, 230, 0], note: None };
    let result = pdf
        .tool_blocking(
            meta.doc_id,
            ToolOp::Flatten { highlights: vec![highlight], overlays: vec![overlay, styled, serif, line], notes: vec![], redactions: vec![redaction] },
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
    assert!(second.contains("Batang sample 9.5pt"), "{second:?}");
    assert!(second.contains("Times serif sample"), "{second:?}");
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

#[test]
fn compress_shrinks_a_high_resolution_photo_and_keeps_the_text() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    // 540pt 폭에 3600px 사진 = 약 480 dpi
    let source = write_photo_pdf("tool-photo.pdf", 3600, 2700);
    let before = std::fs::metadata(&source).unwrap().len();
    let meta = pdf.open_blocking(source).expect("열기");

    for (label, max_dpi, quality, ratio) in [("normal", 150.0_f32, 80_u8, 0.35_f64), ("small", 96.0, 65, 0.2)] {
        let target = new_file(&format!("tool-photo-{label}.pdf"));
        let ToolTarget::NewFile { path } = &target else { unreachable!() };
        let path = path.clone();
        let result = pdf
            .tool_blocking(meta.doc_id.clone(), ToolOp::Compress { max_dpi, quality }, target)
            .expect("압축");
        assert_eq!(result.report.compressed, 1);
        assert!(result.report.size_before.abs_diff(before) < before / 100, "원본 크기와 거의 같아야 한다");
        let after = std::fs::metadata(&path).unwrap().len();
        assert_eq!(result.report.size_after, after);
        eprintln!("compress {label}: {before} -> {after} bytes ({:.0}%)", after as f64 * 100.0 / before as f64);
        assert!((after as f64) < before as f64 * ratio, "{label}: {before} -> {after}");

        let compressed = pdf.open_blocking(path).expect("압축한 PDF");
        assert_eq!(compressed.page_count, 1);
        assert_eq!(compressed.page_sizes[0], (612.0, 792.0));
        let text = pdf.page_text_blocking(compressed.doc_id, 0).expect("글자").text;
        assert!(text.contains("Compression keeps this text"), "{text:?}");
    }
}

#[test]
fn compress_refuses_when_nothing_can_shrink() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    // 이미 낮은 해상도(540pt 에 600px = 80 dpi) 사진과 글자뿐인 쪽은 줄일 것이 없다
    let low = pdf.open_blocking(write_photo_pdf("tool-photo-low.pdf", 600, 450)).expect("열기");
    let target = new_file("tool-photo-low-out.pdf");
    let ToolTarget::NewFile { path } = &target else { unreachable!() };
    let path = path.clone();
    let err = pdf
        .tool_blocking(low.doc_id, ToolOp::Compress { max_dpi: 150.0, quality: 80 }, target)
        .expect_err("줄일 것이 없다");
    assert!(!err.is_empty());
    assert!(!path.exists(), "줄지 않으면 사본을 쓰지 않는다");

    let text_only = pdf.open_blocking(write_two_page_pdf("tool-two-compress.pdf")).expect("열기");
    let target = new_file("tool-two-compress-out.pdf");
    assert!(pdf.tool_blocking(text_only.doc_id, ToolOp::Compress { max_dpi: 96.0, quality: 65 }, target).is_err());
}
