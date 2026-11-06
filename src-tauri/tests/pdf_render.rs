//! 페이지 렌더 통합 테스트.
//!
//! URL 파싱은 `src/protocol.rs` 의 단위 테스트가 본다. 여기서는 문서가 있어야만 알 수 있는
//! 것들 — PNG 가 정말 나오는지, 페이지 범위의 양 끝, 그리고 열지 않은 문서는 그려지지
//! 않는다는 것 — 만 본다.

mod common;

use std::time::Instant;

use app_lib::pdf::{
    PdfRenderError, PdfThread, MAX_RENDER_PIXELS, MAX_RENDER_WIDTH, MIN_RENDER_WIDTH,
};
use common::{pdfium_present, write_single_page_pdf, write_two_page_pdf};

const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// PNG 헤더에서 폭·높이를 읽는다. 요청한 폭이 정말 반영됐는지 보려면 이미지 안을 봐야 한다.
fn png_size(png: &[u8]) -> (u32, u32) {
    assert!(png.len() > 24, "PNG 헤더가 잘렸다");
    let read = |at: usize| u32::from_be_bytes([png[at], png[at + 1], png[at + 2], png[at + 3]]);
    (read(16), read(20))
}

#[test]
fn a_rendered_page_is_a_png_at_the_requested_width() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_two_page_pdf("render.pdf"))
        .expect("문서가 열려야 한다");

    let png = pdf
        .render_blocking(meta.doc_id.clone(), 0, 800)
        .expect("첫 페이지는 그려져야 한다");

    assert_eq!(&png[..8], &PNG_MAGIC, "PNG 매직 바이트로 시작해야 한다");

    let (width, height) = png_size(&png);
    assert_eq!(width, 800, "요청한 폭이 그대로 나와야 한다");
    // 612x792 페이지를 800px 폭으로 → 비율대로 1035 근처.
    assert!(
        (1030..=1040).contains(&height),
        "높이는 페이지 비율을 따라야 한다: {height}"
    );
}

/// 0-기반의 양 끝. 여기가 어긋나면 문서 전체가 한 장씩 밀리거나 마지막 장이 안 뜬다.
#[test]
fn page_indices_are_zero_based_at_both_ends() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_two_page_pdf("both-ends.pdf"))
        .expect("문서가 열려야 한다");
    assert_eq!(meta.page_count, 2);

    // 첫 장은 0, 마지막 장은 page_count - 1.
    let first = pdf
        .render_blocking(meta.doc_id.clone(), 0, 400)
        .expect("0 번 페이지");
    let last = pdf
        .render_blocking(meta.doc_id.clone(), meta.page_count - 1, 400)
        .expect("마지막 페이지");

    // 픽스처의 두 페이지는 크기가 달라서(612x792 vs 200x400) 정말 다른 장인지 드러난다.
    assert_ne!(png_size(&first).1, png_size(&last).1);

    // page_count 는 이미 범위 밖이다.
    assert_eq!(
        pdf.render_blocking(meta.doc_id.clone(), meta.page_count, 400),
        Err(PdfRenderError::PageOutOfRange {
            page: 2,
            page_count: 2
        })
    );
    assert_eq!(
        pdf.render_blocking(meta.doc_id, -1, 400),
        Err(PdfRenderError::PageOutOfRange {
            page: -1,
            page_count: 2
        })
    );
}

/// 이 프로토콜의 보안 경계 전부. 열려 있지 않은 문서는 그려지지 않는다.
///
/// 구조가 그것을 보장한다 — [`PdfThread::render_blocking`] 은 경로를 인자로 받지 않으므로
/// 애초에 파일을 열 방법이 없다. 이 테스트는 그 구조가 유지되는지를 지킨다.
#[test]
fn an_unopened_document_cannot_be_rendered() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();

    // 형식은 멀쩡하지만 한 번도 연 적 없는 doc_id.
    assert_eq!(
        pdf.render_blocking("ffffffffffff".to_string(), 0, 800),
        Err(PdfRenderError::UnknownDocument)
    );

    // 파일이 디스크에 실제로 있어도 달라지지 않는다. 열어서 캐시에 들어가기 전까지는
    // 존재하지 않는 문서다.
    let path = write_two_page_pdf("never-opened.pdf");
    assert!(path.is_file());

    let meta = pdf
        .open_blocking(write_two_page_pdf("opened.pdf"))
        .expect("다른 문서를 연다");

    // 열린 문서의 id 를 한 글자만 바꾸면 곧바로 모르는 문서가 된다.
    let mut wrong = meta.doc_id.clone();
    wrong.replace_range(
        0..1,
        if meta.doc_id.starts_with('0') {
            "1"
        } else {
            "0"
        },
    );
    assert_eq!(
        pdf.render_blocking(wrong, 0, 800),
        Err(PdfRenderError::UnknownDocument)
    );
}

/// 폭 상한은 프로토콜이 400 으로 먼저 자르지만, 비트맵을 실제로 할당하는 자리에서도 막는다.
#[test]
fn the_width_bound_is_enforced_next_to_the_allocation() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_two_page_pdf("width-bound.pdf"))
        .expect("문서가 열려야 한다");

    for width in [0, MIN_RENDER_WIDTH - 1, MAX_RENDER_WIDTH + 1, 2_000_000] {
        assert_eq!(
            pdf.render_blocking(meta.doc_id.clone(), 0, width),
            Err(PdfRenderError::WidthOutOfRange(width)),
            "폭 {width} 는 거절되어야 한다"
        );
    }

    // 경계는 통과한다.
    assert!(pdf
        .render_blocking(meta.doc_id.clone(), 0, MIN_RENDER_WIDTH)
        .is_ok());
    assert!(pdf
        .render_blocking(meta.doc_id, 0, MAX_RENDER_WIDTH)
        .is_ok());
}

/// 세로로 아주 긴 페이지는 그려지는 대신 거절되어야 한다.
///
/// 폭만 보는 검사로는 이걸 막을 수 없다. MediaBox [0 0 200 2000] 짜리 페이지를 `w=3000`
/// 으로 부르면 출력은 3000x30000 = 9천만 픽셀이고, 비트맵 한 벌이 360MB, 인코딩 순간에는
/// 세 벌이 산다. Rust 의 할당 실패는 되감기가 아니라 abort 라서 그 순간 프로세스가 죽는다 —
/// 즉 이 테스트가 지키는 것은 "500 이 난다" 가 아니라 "앱이 살아 있다" 이다.
#[test]
fn a_tall_narrow_page_is_rejected_instead_of_rendered() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_single_page_pdf("tall-narrow.pdf", 200.0, 2000.0))
        .expect("문서가 열려야 한다");
    assert_eq!(meta.page_sizes, vec![(200.0, 2000.0)]);

    assert_eq!(
        pdf.render_blocking(meta.doc_id.clone(), 0, MAX_RENDER_WIDTH),
        Err(PdfRenderError::OutputTooLarge {
            width: MAX_RENDER_WIDTH,
            height: MAX_RENDER_WIDTH * 10,
        }),
        "1:10 짜리 페이지를 최대 폭으로 부르면 거절되어야 한다"
    );

    // 같은 문서라도 폭을 줄이면 그려진다 — 거절하는 것은 문서가 아니라 요청이다.
    let png = pdf
        .render_blocking(meta.doc_id.clone(), 0, 400)
        .expect("작은 폭에서는 그려져야 한다");
    let (width, height) = png_size(&png);
    assert_eq!((width, height), (400, 4000));
    assert!(
        u64::from(width) * u64::from(height) <= MAX_RENDER_PIXELS,
        "통과한 렌더는 상한 안이어야 한다"
    );
}

/// 진짜 문서의 렌더 시간. 저장소에 수십 MB 짜리 스펙 PDF 를 넣을 수는 없으므로 경로를
/// 환경 변수로 받는다.
///
/// ```text
/// IWAE_BENCH_PDF=C:/…/spec.pdf cargo test --test pdf_render -- --nocapture
/// ```
#[test]
fn render_timing_on_a_real_document() {
    if !pdfium_present() {
        return;
    }

    let Ok(path) = std::env::var("IWAE_BENCH_PDF") else {
        eprintln!("SKIPPED: IWAE_BENCH_PDF 가 없습니다(측정용 테스트).");
        return;
    };

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(path.clone().into())
        .expect("측정용 문서가 열려야 한다");

    let mut samples = Vec::new();
    for step in 0..8i32 {
        let page = (100 + step * 37).min(meta.page_count - 1);
        let started = Instant::now();
        let png = pdf
            .render_blocking(meta.doc_id.clone(), page, 1400)
            .expect("측정용 렌더");
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        samples.push((page, elapsed, png.len()));
    }

    let total: f64 = samples.iter().map(|(_, ms, _)| ms).sum();
    eprintln!("\n[bench] {} ({} pages) @ w=1400", path, meta.page_count);
    for (page, ms, bytes) in &samples {
        eprintln!(
            "  page {page:>5}: {ms:>6.1} ms  {:>6.0} KB",
            *bytes as f64 / 1024.0
        );
    }
    eprintln!(
        "  평균 {:.1} ms (렌더+PNG 인코딩+채널 왕복)\n",
        total / samples.len() as f64
    );
}
