//! 영역 캡처용 PDFium crop 통합 테스트.

mod common;

use app_lib::pdf::{CropRect, PdfRenderError, PdfThread, CROP_PIXELS_PER_POINT};
use common::{pdfium_present, write_text_index_pdf};

#[test]
fn crop_region_returns_only_the_requested_page_area() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_text_index_pdf("crop-region.pdf"))
        .expect("문서 열기");
    let png = pdf
        .crop_blocking(
            meta.doc_id,
            0,
            CropRect {
                x: 0.0,
                y: 0.0,
                w: 306.0,
                h: 396.0,
            },
        )
        .expect("영역 캡처");

    let image = image::load_from_memory(&png).expect("PNG 디코드");
    assert_eq!(image.width(), (306.0 * CROP_PIXELS_PER_POINT) as u32);
    assert_eq!(image.height(), (396.0 * CROP_PIXELS_PER_POINT) as u32);
}

#[test]
fn crop_region_rejects_rectangles_outside_the_page() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_text_index_pdf("crop-outside.pdf"))
        .expect("문서 열기");
    let result = pdf.crop_blocking(
        meta.doc_id,
        0,
        CropRect {
            x: 600.0,
            y: 780.0,
            w: 40.0,
            h: 30.0,
        },
    );

    assert!(matches!(result, Err(PdfRenderError::CropOutOfRange)));
}

#[test]
fn crop_region_rejects_empty_rectangles() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_text_index_pdf("crop-empty.pdf"))
        .expect("문서 열기");
    let result = pdf.crop_blocking(
        meta.doc_id,
        0,
        CropRect {
            x: 20.0,
            y: 20.0,
            w: 0.0,
            h: 30.0,
        },
    );

    assert!(matches!(result, Err(PdfRenderError::CropOutOfRange)));
}
