mod common;

use app_lib::pdf::{ExportHighlight, LinkRect, PdfLinkTarget, PdfThread};
use common::{fixture_dir, pdfium_present, write_links_and_annotations_pdf};

fn close(a: f32, b: f32) -> bool {
    (a - b).abs() < 1.0
}

#[test]
fn reads_internal_and_web_links_and_drops_unsafe_uris() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_links_and_annotations_pdf("links.pdf"))
        .expect("링크 PDF 열기");
    let links = pdf
        .links_blocking(meta.doc_id.clone(), 0)
        .expect("링크 읽기");

    assert_eq!(links.len(), 2, "javascript: 링크는 버려야 한다: {links:?}");

    let internal = links
        .iter()
        .find(|link| matches!(link.target, PdfLinkTarget::Page { .. }))
        .expect("내부 링크");
    // 왼쪽 위 원점 좌표: 792 - 620 = 172
    assert!(
        close(internal.rect.x, 40.0) && close(internal.rect.y, 172.0),
        "{internal:?}"
    );
    assert!(
        close(internal.rect.w, 160.0) && close(internal.rect.h, 20.0),
        "{internal:?}"
    );
    match internal.target {
        PdfLinkTarget::Page { page, y } => {
            assert_eq!(page, 1);
            // /XYZ 0 500 → 왼쪽 위 원점에서 792 - 500 = 292
            assert!(y.map(|value| close(value, 292.0)).unwrap_or(true), "{y:?}");
        }
        PdfLinkTarget::Uri { .. } => unreachable!(),
    }

    assert!(links.iter().any(|link| matches!(
        &link.target,
        PdfLinkTarget::Uri { uri } if uri == "https://example.com/paper"
    )));

    // 링크가 없는 페이지는 빈 목록이다(오류가 아니다).
    assert!(pdf
        .links_blocking(meta.doc_id.clone(), 1)
        .expect("2쪽 링크")
        .is_empty());
    // 범위 밖 페이지는 오류다.
    assert!(pdf.links_blocking(meta.doc_id, 9).is_err());
}

#[test]
fn reads_document_info_metadata() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_links_and_annotations_pdf("metadata.pdf"))
        .expect("PDF 열기");
    let info = pdf.metadata_blocking(meta.doc_id).expect("메타데이터 읽기");

    assert_eq!(info.title.as_deref(), Some("Linked Paper"));
    assert_eq!(info.author.as_deref(), Some("Kim, Lee"));
    assert_eq!(info.keywords.as_deref(), Some("pdf; links"));
    assert!(info
        .creation_date
        .as_deref()
        .unwrap_or_default()
        .contains("2023"));
}

#[test]
fn reads_markup_annotations_but_not_links() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_links_and_annotations_pdf("annotations.pdf"))
        .expect("PDF 열기");
    let annotations = pdf.annotations_blocking(meta.doc_id).expect("주석 읽기");

    assert_eq!(annotations.len(), 2, "{annotations:?}");
    let highlight = annotations
        .iter()
        .find(|a| a.kind == "highlight")
        .expect("형광펜");
    assert_eq!(highlight.page, 0);
    assert_eq!(highlight.contents.as_deref(), Some("memo text"));
    assert_eq!(highlight.color, Some([255, 255, 0]));
    assert_eq!(highlight.rects.len(), 1);
    // 792 - 712 = 80
    assert!(
        close(highlight.rects[0].y, 80.0) && close(highlight.rects[0].h, 15.0),
        "{highlight:?}"
    );

    let sticky = annotations
        .iter()
        .find(|a| a.kind == "text")
        .expect("붙임 쪽지");
    assert_eq!(sticky.contents.as_deref(), Some("sticky note"));
}

#[test]
fn exports_a_copy_with_highlight_annotations_and_leaves_the_original_alone() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let source = write_links_and_annotations_pdf("export-source.pdf");
    let original = std::fs::read(&source).expect("원본 읽기");
    let meta = pdf.open_blocking(source.clone()).expect("PDF 열기");
    let target = fixture_dir().join("export-target.pdf");
    let _ = std::fs::remove_file(&target);

    pdf.export_annotated_blocking(
        meta.doc_id,
        vec![ExportHighlight {
            page: 1,
            rects: vec![LinkRect {
                x: 50.0,
                y: 100.0,
                w: 120.0,
                h: 14.0,
            }],
            color: [120, 200, 255],
            note: Some("exported note".into()),
        }],
        target.clone(),
    )
    .expect("주석 포함 PDF 내보내기");

    assert_eq!(
        std::fs::read(&source).expect("원본 다시 읽기"),
        original,
        "원본은 그대로여야 한다"
    );

    let exported = pdf.open_blocking(target).expect("내보낸 PDF 열기");
    let annotations = pdf
        .annotations_blocking(exported.doc_id)
        .expect("내보낸 주석 읽기");
    let added = annotations
        .iter()
        .find(|a| a.page == 1 && a.kind == "highlight")
        .expect("2쪽 형광펜");
    assert_eq!(added.contents.as_deref(), Some("exported note"));
    assert!(
        close(added.rects[0].x, 50.0) && close(added.rects[0].y, 100.0),
        "{added:?}"
    );
}

/// 회귀: 쪽을 한 번 그리면 PDFium 이 형광펜 주석의 그림(AP)을 만든다. 그 뒤에 주석 색을 읽을 때
/// pdfium-render 의 stroke_color() 는 주석 핸들을 페이지 객체로 잘못 넘겨 프로세스를 죽였다
/// (STATUS_ACCESS_VIOLATION). 그린 뒤에 읽어도 죽지 않고, 색도 그대로 나와야 한다.
#[test]
fn reads_annotation_colors_after_the_page_was_rendered() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_links_and_annotations_pdf("annotations-rendered.pdf"))
        .expect("PDF 열기");
    pdf.render_blocking(meta.doc_id.clone(), 0, 600).expect("1쪽 그리기");
    let first = pdf.annotations_blocking(meta.doc_id.clone()).expect("그린 뒤 주석 읽기");
    let again = pdf.annotations_blocking(meta.doc_id).expect("두 번째 읽기");

    let highlight = first.iter().find(|a| a.kind == "highlight").expect("형광펜");
    assert_eq!(highlight.color, Some([255, 255, 0]), "{highlight:?}");
    assert_eq!(first.len(), again.len());
}
