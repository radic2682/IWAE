//! `pdf_page_text` 뒤의 텍스트 인덱스 통합 테스트.
//!
//! 뒤집기와 대체 문자의 산술은 `engine.rs` 의 단위 테스트가 본다. 여기서는 PDFium 이 실제로
//! 답해야만 알 수 있는 것들 — 글자 수가 파일에 적힌 그대로인지, 상자가 정말 페이지 위에서
//! 아래로 재어져 오는지, 글자 없는 페이지가 오류가 아닌지, 열지 않은 문서가 오류인지 — 를 본다.

mod common;

use app_lib::pdf::{CharBox, PageTextIndex, PdfRenderError, PdfThread};
use common::{
    pdfium_present, write_cropped_text_pdf, write_text_index_pdf, write_text_index_pdf_rotated, TEXT_INDEX_EXPECTED,
    TEXT_INDEX_FIRST_BASELINE, TEXT_INDEX_LINE_GAP, TEXT_INDEX_PAGE_HEIGHT, TEXT_INDEX_PAGE_WIDTH,
};

/// 인덱스 약속을 한자리에서 확인한다. 이 둘이 어긋나면 BMP 밖 글자 뒤의 모든 앵커가 조용히
/// 밀리므로, 텍스트를 다루는 테스트마다 이 검사를 지나가게 한다.
fn assert_index_domain(index: &PageTextIndex) {
    let rebuilt: String = index.chars.iter().map(|c| c.c.as_str()).collect();
    assert_eq!(
        rebuilt, index.text,
        "text 는 chars 를 이어 붙인 것이어야 한다"
    );

    assert_eq!(
        index.chars.len(),
        index.text.chars().count(),
        "Rust 쪽 셈(스칼라)과 맞아야 한다"
    );
    assert_eq!(
        index.chars.len(),
        index.text.encode_utf16().count(),
        "JS 쪽 셈(UTF-16 코드 단위)과 맞아야 한다 — slice 로 앵커를 되푸는 쪽이 이걸 믿는다"
    );
}

#[test]
fn the_text_is_exactly_what_the_page_says_and_the_index_lines_up() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_text_index_pdf("page-text.pdf"))
        .expect("문서가 열려야 한다");

    let index = pdf
        .page_text_blocking(meta.doc_id, 0)
        .expect("첫 페이지의 텍스트");

    // 폰트를 내장하지 않은 base-14 페이지라 파일에 적힌 글자가 그대로 나온다. 가운데 `\r\n`
    // 은 PDFium 이 줄바꿈 자리에 끼워 넣은 것이다.
    assert_eq!(index.text, TEXT_INDEX_EXPECTED);
    assert_eq!(index.chars.len(), 10, "IWAE + \\r\\n + text");
    assert_index_domain(&index);
}

/// PF-1 이 약속한 축. 상자는 페이지 **왼쪽 위**가 원점이고 y 는 아래로 증가한다.
///
/// 이 테스트가 지키는 것은 규약 그 자체다. 히트 테스트는 화면 왼쪽 위에서 잰 픽셀을 받고
/// 페이지 높이를 인자로 받지 않으므로, 여기서 뒤집지 않으면 아래쪽 누구도 뒤집을 수 없다.
#[test]
fn boxes_are_measured_downward_from_the_top_of_the_page() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_text_index_pdf("page-text-axis.pdf"))
        .expect("문서가 열려야 한다");
    assert_eq!(meta.page_sizes[0].1, TEXT_INDEX_PAGE_HEIGHT);

    let index = pdf
        .page_text_blocking(meta.doc_id, 0)
        .expect("첫 페이지의 텍스트");

    // 'I' 와 't' — 두 줄의 첫 글자. 사이에 `\r\n` 두 글자가 있으므로 0번과 6번이다.
    let first_line = &index.chars[0];
    let second_line = &index.chars[6];
    assert_eq!(first_line.c, "I");
    assert_eq!(second_line.c, "t");

    // 아래에 찍힌 줄이 더 큰 y 를 받는다. 뒤집지 않았다면 부등호가 반대로 선다.
    assert!(
        second_line.y > first_line.y,
        "아래 줄의 y 가 더 커야 한다: {} -> {}",
        first_line.y,
        second_line.y
    );
    assert!(
        (second_line.y - first_line.y - TEXT_INDEX_LINE_GAP).abs() < 0.01,
        "줄 간격은 찍은 그대로 {TEXT_INDEX_LINE_GAP}pt 여야 한다"
    );

    // 첫 줄은 기준선이 페이지 아래에서 700pt — 즉 위에서 90pt 조금 안쪽이다. 뒤집지 않았다면
    // 700 근처가 나온다.
    let from_top = TEXT_INDEX_PAGE_HEIGHT - TEXT_INDEX_FIRST_BASELINE;
    assert!(
        (from_top - 20.0..from_top).contains(&first_line.y),
        "첫 줄은 페이지 위쪽에 있어야 한다: y={}",
        first_line.y
    );

    // 두 줄 모두 x 는 찍은 자리(40pt)에서 시작하고, 상자는 페이지 안에 있으며 음수 크기가
    // 없다. 글자 있는 상자는 면적이 있어야 한다.
    assert!((first_line.x - 40.0).abs() < 0.01, "{}", first_line.x);
    assert!((second_line.x - 40.0).abs() < 0.01, "{}", second_line.x);

    for boxed in &index.chars {
        assert!(boxed.w >= 0.0 && boxed.h >= 0.0, "크기는 음수가 아니다");
        assert!(
            boxed.y >= 0.0 && boxed.y + boxed.h <= TEXT_INDEX_PAGE_HEIGHT,
            "상자가 페이지를 벗어났다: {boxed:?}"
        );
        assert!(
            boxed.x.is_finite() && boxed.y.is_finite(),
            "JSON 으로 나갈 값이 유한해야 한다: {boxed:?}"
        );
    }

    // PDFium 이 끼워 넣은 줄바꿈 글자는 면적이 없다. 어떤 점도 품지 않으므로 히트 테스트에서
    // 저절로 걸러진다 — 보이지 않는 글자에 대해 옳은 답이다.
    assert_eq!(index.chars[4].c, "\r");
    assert_eq!(index.chars[5].c, "\n");
    for newline in &index.chars[4..6] {
        assert_eq!((newline.w, newline.h), (0.0, 0.0), "{newline:?}");
    }
    // 반대로 글자가 있는 상자는 면적이 있어야 한다 — 전부 0 이라 통과하는 테스트가 아니다.
    assert!(first_line.w > 0.0 && first_line.h > 0.0, "{first_line:?}");
}

/// 돌아간 페이지의 상자는 **그려진 그림 위의 자리**여야 한다.
///
/// 이 테스트가 잡는 것은 실측으로 드러난 함정이다. `/Rotate 90` 인 페이지에서 `page_sizes` 는
/// 돌아간 뒤 크기(612x792 → 792x612)를 주는데 PDFium 의 글자 상자는 돌아가기 전 공간으로
/// 온다. 맞춰 주지 않으면 y 가 음수가 된다 — 고치기 전 이 픽스처에서 `y=-98.86` 이 나왔다.
///
/// 돌려서 맞추는 쪽이 맞는 이유는 렌더가 이미 그렇게 하고 있어서다. PDFium 은 그릴 때
/// `/Rotate` 를 적용하므로 웹뷰가 받는 그림은 792x612 이고, 히트 테스트는 그 그림 위의
/// 픽셀을 준다.
#[test]
fn a_rotated_page_puts_its_boxes_on_the_rendered_image() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_text_index_pdf_rotated("page-text-rotate90.pdf", 90))
        .expect("문서가 열려야 한다");

    // 돌아간 페이지라 폭과 높이가 뒤바뀌어 나온다. 이게 웹뷰가 배치에 쓰는 값이다.
    let (page_w, page_h) = meta.page_sizes[0];
    assert_eq!(
        (page_w, page_h),
        (TEXT_INDEX_PAGE_HEIGHT, TEXT_INDEX_PAGE_WIDTH)
    );

    let index = pdf
        .page_text_blocking(meta.doc_id, 0)
        .expect("첫 페이지의 텍스트");

    // PDFium 은 글자를 **돌아간 뒤 읽는 순서**로 돌려준다. 세로 페이지의 첫 줄("IWAE")은
    // 시계 방향으로 한 번 돌면 오른쪽 열이 되므로, 왼쪽 열이 된 "text" 가 먼저 온다. 뒤집힌
    // 것처럼 보이지만 오히려 바라던 성질이다 — 발췌한 따옴표의 글자 순서가 사람이 화면에서
    // 읽는 순서와 같아진다.
    assert_eq!(index.text, "text\r\nIWAE");
    assert_eq!(
        index.chars.len(),
        TEXT_INDEX_EXPECTED.chars().count(),
        "순서만 달라질 뿐 글자 수는 같다"
    );
    assert_index_domain(&index);

    for boxed in &index.chars {
        assert!(
            boxed.x >= 0.0 && boxed.x + boxed.w <= page_w,
            "상자가 그림 밖으로 나갔다: {boxed:?}"
        );
        assert!(
            boxed.y >= 0.0 && boxed.y + boxed.h <= page_h,
            "상자가 그림 밖으로 나갔다(고치기 전 여기서 음수가 나왔다): {boxed:?}"
        );
    }

    // 세로 페이지의 글자는 시계 방향으로 한 번 돌면 페이지 오른쪽으로 간다. 그리고 글자가
    // 눕기 때문에 같은 줄의 글자들은 x 가 아니라 **y** 를 따라 흘러간다.
    let first = &index.chars[0];
    assert_eq!(first.c, "t");
    assert!(
        first.x > page_w / 2.0,
        "오른쪽 절반에 있어야 한다: {first:?}"
    );

    let second = &index.chars[1];
    assert_eq!(second.c, "e");
    assert!(
        (second.x - first.x).abs() < 0.01,
        "같은 줄이면 x 가 같아야 한다: {first:?} {second:?}"
    );
    assert!(
        second.y > first.y,
        "같은 줄의 다음 글자는 아래로 간다: {first:?} {second:?}"
    );
}

/// 픽스처 텍스트("IWAEtext") 안에서 딱 한 번 나오는 글자의 상자를 찾는다.
///
/// 회전마다 글자 순서가 달라질 수 있으므로(90도에서 실제로 달라진다) 자리 번호로 짚지 않고
/// 글자로 찾는다.
fn unique_char(index: &PageTextIndex, needle: &str) -> CharBox {
    let found: Vec<&CharBox> = index.chars.iter().filter(|c| c.c == needle).collect();
    assert_eq!(found.len(), 1, "{needle:?} 는 픽스처에 한 번만 나온다");
    found[0].clone()
}

/// 네 방향 회전 모두를 **실제 PDFium** 으로 확인한다.
///
/// # 왜 사분면인가 — "페이지 안에 있다" 로는 부족하다
///
/// 90도만 재어 보고 "PDFium 은 언제나 회전 전 좌표를 준다" 를 180·270 으로 밀어 쓰는 것은
/// 가설이다. 그리고 이 가설이 틀렸을 때 **180도가 가장 조용하다** — 잘못 돌리면 상자가 점
/// 대칭으로 뒤집히는데, 점대칭은 페이지 안에 그대로 남고 크기도 면적도 보존한다. 그래서
/// 단위 테스트의 "페이지 안 + 양수 크기 + 면적 보존" 은 전부 통과하면서 좌표만 거울이 된다.
///
/// 사분면은 그 거울을 잡는다. 픽스처의 글자는 안 돌린 페이지에서 **왼쪽 위**에 있으므로,
/// 시계 방향으로 돌 때마다 왼위 → 오른위 → 오른아래 → 왼아래 로 걸어가야 한다. 점대칭이
/// 일어나면 180도에서 오른아래가 아니라 왼쪽 위가 나온다.
///
/// 한 걸음 더 — 같은 줄에서 다음 글자가 **어느 쪽으로 나아가는지**도 본다. 사분면이 위치를
/// 고정한다면 이쪽은 방향을 고정한다. 180도 페이지의 글자는 거꾸로 서 있으므로 화면에서는
/// 오른쪽에서 왼쪽으로 나아간다.
#[test]
fn every_rotation_lands_its_glyphs_in_the_right_quadrant() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();

    // (회전, 기대 페이지 크기, 'W' 가 있어야 할 사분면, 같은 줄이 나아가는 방향)
    //
    // 마지막 항목은 'I' 에서 'W' 로 갈 때 어느 좌표가 어느 쪽으로 움직이는지다. 안 돌린
    // 페이지는 x 가 커지고(왼→오), 90도는 y 가 커지고(위→아래), 180도는 x 가 작아지고,
    // 270도는 y 가 작아진다.
    type Case = (i32, (f32, f32), (bool, bool), (char, f32));
    let cases: [Case; 4] = [
        (
            0,
            (TEXT_INDEX_PAGE_WIDTH, TEXT_INDEX_PAGE_HEIGHT),
            (false, false),
            ('x', 1.0),
        ),
        (
            90,
            (TEXT_INDEX_PAGE_HEIGHT, TEXT_INDEX_PAGE_WIDTH),
            (true, false),
            ('y', 1.0),
        ),
        (
            180,
            (TEXT_INDEX_PAGE_WIDTH, TEXT_INDEX_PAGE_HEIGHT),
            (true, true),
            ('x', -1.0),
        ),
        (
            270,
            (TEXT_INDEX_PAGE_HEIGHT, TEXT_INDEX_PAGE_WIDTH),
            (false, true),
            ('y', -1.0),
        ),
    ];

    for (degrees, expected_size, (want_right, want_bottom), (axis, sign)) in cases {
        let meta = pdf
            .open_blocking(write_text_index_pdf_rotated(
                &format!("page-text-rotate{degrees}.pdf"),
                degrees,
            ))
            .unwrap_or_else(|err| panic!("/Rotate {degrees} 문서가 열려야 한다: {err}"));

        let (page_w, page_h) = meta.page_sizes[0];
        assert_eq!(
            (page_w, page_h),
            expected_size,
            "/Rotate {degrees}: 홀수 번 돌면 폭과 높이가 뒤바뀐다"
        );

        let index = pdf
            .page_text_blocking(meta.doc_id, 0)
            .unwrap_or_else(|err| panic!("/Rotate {degrees} 의 텍스트: {err}"));

        // 회전은 좌표만 건드린다 — 글자와 인덱스 약속은 그대로다.
        assert_eq!(
            index.chars.len(),
            TEXT_INDEX_EXPECTED.chars().count(),
            "/Rotate {degrees}: 글자 수는 회전과 무관하다"
        );
        assert_index_domain(&index);

        let i_box = unique_char(&index, "I");
        let w_box = unique_char(&index, "W");

        // 사분면. 안 돌린 페이지에서 왼쪽 위에 있던 글자가 시계 방향으로 걸어가야 한다.
        let (cx, cy) = (w_box.x + w_box.w / 2.0, w_box.y + w_box.h / 2.0);
        assert_eq!(
            cx > page_w / 2.0,
            want_right,
            "/Rotate {degrees}: 'W' 의 좌우가 틀렸다 (중심 x={cx}, 페이지 폭 {page_w})"
        );
        assert_eq!(
            cy > page_h / 2.0,
            want_bottom,
            "/Rotate {degrees}: 'W' 의 상하가 틀렸다 (중심 y={cy}, 페이지 높이 {page_h})"
        );

        // 나아가는 방향. 'I' 다음이 'W' 이므로 정해진 축이 정해진 부호로 움직여야 한다.
        let (moving, fixed) = match axis {
            'x' => ((w_box.x - i_box.x, sign), (w_box.y - i_box.y, "y")),
            _ => ((w_box.y - i_box.y, sign), (w_box.x - i_box.x, "x")),
        };
        assert!(
            moving.0 * moving.1 > 0.0,
            "/Rotate {degrees}: 같은 줄이 {axis} 축으로 {} 방향이어야 한다 (움직인 값 {})",
            if sign > 0.0 { "+" } else { "-" },
            moving.0
        );
        assert!(
            fixed.0.abs() < 0.01,
            "/Rotate {degrees}: 같은 줄이면 {} 는 그대로여야 한다 (움직인 값 {})",
            fixed.1,
            fixed.0
        );

        // 상자는 언제나 그림 안에 있고 크기는 양수다 — 위 단언들이 통과해도 이건 따로 본다.
        for boxed in &index.chars {
            assert!(
                boxed.w >= 0.0 && boxed.h >= 0.0,
                "/Rotate {degrees}: 크기가 음수다 {boxed:?}"
            );
            assert!(
                boxed.x >= 0.0 && boxed.x + boxed.w <= page_w,
                "/Rotate {degrees}: 상자가 그림 밖이다 {boxed:?}"
            );
            assert!(
                boxed.y >= 0.0 && boxed.y + boxed.h <= page_h,
                "/Rotate {degrees}: 상자가 그림 밖이다 {boxed:?}"
            );
        }
    }
}

/// 그림만 있는 페이지는 오류가 아니다.
///
/// 문서를 열 때 `has_text` 가 스캔본을 걸러 주지만 그것은 문서 단위의 판정이다. 텍스트가
/// 있는 문서 안에도 글자 없는 페이지는 섞인다 — 픽스처의 1번 페이지가 그것이다. 같은 문서의
/// 0번은 글자가 나오고 1번은 안 나오는 것이 이 테스트의 요점이라, 두 페이지를 나란히 묻는다.
#[test]
fn a_page_without_text_is_empty_not_an_error() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_text_index_pdf("page-text-blank.pdf"))
        .expect("문서가 열려야 한다");

    let has_text = pdf
        .page_text_blocking(meta.doc_id.clone(), 0)
        .expect("0번 페이지의 텍스트");
    assert!(!has_text.chars.is_empty(), "0번에는 글자가 있다");

    let index = pdf
        .page_text_blocking(meta.doc_id, 1)
        .expect("글자 없는 페이지도 오류가 아니라 답이 있어야 한다");

    assert_eq!(index.text, "");
    assert!(index.chars.is_empty());
    assert_index_domain(&index);
}

/// 0-기반의 양 끝. 여기가 어긋나면 앵커가 통째로 한 장씩 밀린다.
#[test]
fn page_indices_are_zero_based_at_both_ends() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();
    let meta = pdf
        .open_blocking(write_text_index_pdf("page-text-ends.pdf"))
        .expect("문서가 열려야 한다");
    assert_eq!(meta.page_count, 2);

    assert_eq!(
        pdf.page_text_blocking(meta.doc_id.clone(), meta.page_count),
        Err(PdfRenderError::PageOutOfRange {
            page: 2,
            page_count: 2
        })
    );
    assert_eq!(
        pdf.page_text_blocking(meta.doc_id, -1),
        Err(PdfRenderError::PageOutOfRange {
            page: -1,
            page_count: 2
        })
    );
}

/// 열려 있지 않은 문서에서는 글자를 긁어 갈 수 없다.
///
/// 렌더와 같은 경계다 — [`PdfThread::page_text_blocking`] 은 경로를 인자로 받지 않으므로
/// 애초에 파일을 열 방법이 없다. 이 테스트는 그 구조가 유지되는지를 지킨다.
#[test]
fn an_unopened_document_has_no_text() {
    if !pdfium_present() {
        return;
    }

    let pdf = PdfThread::shared();

    assert_eq!(
        pdf.page_text_blocking("ffffffffffff".to_string(), 0),
        Err(PdfRenderError::UnknownDocument)
    );

    // 파일이 디스크에 실제로 있어도 달라지지 않는다. 열어서 캐시에 들어가기 전까지는
    // 존재하지 않는 문서다.
    let path = write_text_index_pdf("page-text-never-opened.pdf");
    assert!(path.is_file());

    let meta = pdf
        .open_blocking(write_text_index_pdf("page-text-opened.pdf"))
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
        pdf.page_text_blocking(wrong, 0),
        Err(PdfRenderError::UnknownDocument)
    );
}

/// CropBox 원점이 (0,0) 이 아닌 페이지: 글자 상자는 보이는 페이지(잘라 낸 상자) 기준이어야 한다.
/// 원점을 빼지 않으면 검색 결과·형광펜이 (100, 200) 만큼 통째로 밀려 엉뚱한 곳에 칠해진다.
#[test]
fn boxes_are_measured_from_the_crop_box_origin() {
    if !pdfium_present() {
        return;
    }
    let pdf = PdfThread::shared();
    let meta = pdf.open_blocking(write_cropped_text_pdf("page-text-cropped.pdf")).expect("문서가 열려야 한다");
    let (page_w, page_h) = meta.page_sizes[0];
    assert_eq!((page_w, page_h), (400.0, 500.0), "보이는 페이지 크기는 CropBox");
    let index = pdf.page_text_blocking(meta.doc_id, 0).expect("텍스트");
    assert_eq!(index.text, "Cropped");
    let first = &index.chars[0];
    assert!((first.x - 40.0).abs() < 1.0, "왼쪽에서 40pt 여야 한다: {}", first.x);
    // 기준선 y=600, CropBox 위 700 → 위에서 100pt 언저리(글자 윗변은 그보다 조금 위)
    assert!(first.y > 80.0 && first.y < 100.0, "위에서 100pt 언저리여야 한다: {}", first.y);
}
