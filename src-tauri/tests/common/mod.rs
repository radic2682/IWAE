//! 통합 테스트가 같이 쓰는 픽스처.
//!
//! 저장소에 PDF 바이너리를 넣지 않으려고 여기서 만들어 쓴다.

// 테스트 바이너리마다 쓰는 함수가 달라서, 안 쓰는 쪽에서 경고가 난다.
#![allow(dead_code)]

use std::path::PathBuf;

use app_lib::pdf::PdfThread;

/// dll 은 `.gitignore` 로 빠져 있다. `tauri.conf.json` 의 `bundle.resources` 덕에 dll 없이는
/// 빌드 자체가 멈추지만, 빌드 뒤에 dll 만 사라진 경우에는 여기까지 온다 — 그때 엉뚱한
/// 단언 실패로 헤매게 두지 않고 이유를 밝히고 건너뛴다.
///
/// 경로를 직접 보지 않고 엔진에게 묻는 이유: 찾아볼 자리 목록은 빌드 프로파일에 따라 다르다.
/// 크레이트 안의 `binaries/` 는 `#[cfg(debug_assertions)]` 뒤에 있으므로 `--release` 에서는
/// 후보에 끼지도 않는데, 그 경로를 짐작으로 보면 "있다" 고 답해 놓고 엔진은 못 불러오는
/// 어긋남이 생긴다. 그러면 건너뛰어야 할 테스트가 전부 `.expect` 에서 무너지고 — 이 함수가
/// 막으려던 바로 그 오해가 된다. 짐작하지 말고 묻는다.
///
/// 건너뛸 때의 이유는 여기서 한 번 찍는다. 부르는 쪽은 `if !pdfium_present() { return; }` 만
/// 쓰면 된다.
pub fn pdfium_present() -> bool {
    match PdfThread::shared().engine_status() {
        Ok(()) => true,
        Err(message) => {
            eprintln!("SKIPPED: {message}");
            false
        }
    }
}

pub fn fixture_dir() -> PathBuf {
    let dir = std::env::temp_dir().join("iwae-pdf-fixtures");
    std::fs::create_dir_all(&dir).expect("픽스처 폴더");
    dir
}

/// 페이지 두 장(612x792, 200x400)짜리 최소 PDF 를 만든다. xref 오프셋까지 제대로 계산해
/// PDFium 의 복구 경로가 아니라 정상 경로를 타게 한다.
pub fn write_two_page_pdf(name: &str) -> PathBuf {
    let objects: Vec<String> = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".into(),
        "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>".into(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>".into(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 400] /Resources << >> >>".into(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into(),
        {
            // has_text 가 true 가 되려면 앞쪽 페이지에 글자가 실제로 있어야 한다.
            let text = "BT /F1 12 Tf 40 700 Td (IWAE fixture page with enough text to count as a text layer) Tj ET";
            format!("<< /Length {} >>\nstream\n{}\nendstream", text.len(), text)
        },
    ];

    write_pdf(name, objects)
}

/// 두 장과 2단계 북마크 트리를 가진 PDF. 목차 순서·깊이·목적 페이지를 함께 검증한다.
pub fn write_outline_pdf(name: &str) -> PathBuf {
    let objects: Vec<String> = vec![
        "<< /Type /Catalog /Pages 2 0 R /Outlines 5 0 R /PageMode /UseOutlines >>".into(),
        "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>".into(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>".into(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>".into(),
        "<< /Type /Outlines /First 6 0 R /Last 8 0 R /Count 3 >>".into(),
        "<< /Title (Part One) /Parent 5 0 R /First 7 0 R /Last 7 0 R /Count 1 /Next 8 0 R /Dest [3 0 R /Fit] >>".into(),
        "<< /Title (Details) /Parent 6 0 R /Dest [4 0 R /Fit] >>".into(),
        "<< /Title (Appendix) /Parent 5 0 R /Prev 6 0 R /Dest [4 0 R /Fit] >>".into(),
    ];

    write_pdf(name, objects)
}

/// 브라우저 개발 미리보기용 PDF. 웹에서는 PDFium DLL을 직접 부를 수 없으므로,
/// 이 문서를 PDFium으로 미리 렌더한 PNG와 글자 상자를 함께 체크인한다.
pub fn write_web_preview_pdf(name: &str) -> PathBuf {
    let first = concat!(
        "BT /F1 28 Tf 54 720 Td (IWAE PDF Text Selection) Tj ",
        "/F1 14 Tf 0 -44 Td (Rendered by PDFium for the browser preview.) Tj ",
        "0 -28 Td (Drag across this sentence to create a source anchor.) Tj ",
        "0 -28 Td (The native app uses the same character-box pipeline.) Tj ET"
    );
    let second = concat!(
        "BT /F1 26 Tf 54 720 Td (Engineering Lecture Notes) Tj ",
        "/F1 14 Tf 0 -44 Td (Dynamic address assignment begins after bus initialization.) Tj ",
        "0 -28 Td (Each excerpt keeps its page and character range.) Tj ",
        "0 -28 Td (Source jump can resolve the saved anchor later.) Tj ET"
    );

    let stream = |content: &str| {
        format!(
            "<< /Length {} >>\nstream\n{}\nendstream",
            content.len(),
            content
        )
    };

    let objects: Vec<String> = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".into(),
        "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>".into(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>".into(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>".into(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into(),
        stream(first),
        stream(second),
    ];

    write_pdf(name, objects)
}

/// 텍스트 인덱스 시험용 픽스처의 첫 페이지에 찍히는 글자들.
///
/// 두 줄인 것이 요점이다. 한 줄로는 "y 가 아래로 증가한다" 를 확인할 수가 없다 — 아래에
/// 찍힌 줄이 더 큰 y 를 받는지 보려면 줄이 둘이어야 한다.
pub const TEXT_INDEX_LINES: [&str; 2] = ["IWAE", "text"];

/// [`TEXT_INDEX_LINES`] 를 찍은 페이지에서 PDFium 이 돌려줄 텍스트.
///
/// 가운데 `\r\n` 은 원본 콘텐츠 스트림에 없다. PDFium 이 줄이 바뀐 자리에 끼워 넣는
/// 글자들이고(`FPDFText_IsGenerated`), 이 픽스처로 실제로 재어 본 값이다. 글자 수가
/// 4 + 2 + 4 = 10 으로 손으로 셀 수 있게 짧은 낱말만 쓴 이유가 이것이다.
pub const TEXT_INDEX_EXPECTED: &str = "IWAE\r\ntext";

/// 첫 줄의 기준선 y(페이지 아래에서 잰 PDF 좌표)와 두 줄 사이 간격, 그리고 페이지 크기.
pub const TEXT_INDEX_FIRST_BASELINE: f32 = 700.0;
pub const TEXT_INDEX_LINE_GAP: f32 = 20.0;
pub const TEXT_INDEX_PAGE_WIDTH: f32 = 612.0;
pub const TEXT_INDEX_PAGE_HEIGHT: f32 = 792.0;

/// 텍스트 인덱스 시험용 두 장짜리 PDF.
///
/// - 0번: base-14 Helvetica 로 [`TEXT_INDEX_LINES`] 를 두 줄 찍은 페이지. 폰트를 내장하지
///   않으므로 글자 수가 파일에 적힌 그대로고, 기대값을 테스트에서 눈으로 확인할 수 있다.
/// - 1번: 텍스트 연산자가 **아예 없는** 페이지(`/Contents` 자체가 없다). 스캔본 페이지의
///   최소 형태다 — 텍스트가 있는 문서 안에도 그림만 있는 페이지는 섞이므로, 그 페이지가
///   오류가 아니라 빈 결과를 돌려주는지 보려면 한 문서 안에 둘 다 있어야 한다.
pub fn write_text_index_pdf(name: &str) -> PathBuf {
    write_text_index_pdf_rotated(name, 0)
}

/// [`write_text_index_pdf`] 와 같지만 첫 페이지에 `/Rotate` 를 건다.
///
/// 돌아간 페이지가 필요한 이유는 실측으로 드러났다. `/Rotate 90` 인 페이지에서
/// `page_sizes` 는 돌아간 뒤 크기를 주는데 PDFium 의 글자 상자는 돌아가기 전 공간으로 온다 —
/// 맞춰 주지 않으면 y 가 음수로 나온다. 스펙 문서의 접지 도면·가로 표가 흔히 이 모양이다.
pub fn write_text_index_pdf_rotated(name: &str, degrees: i32) -> PathBuf {
    let [first, second] = TEXT_INDEX_LINES;
    let content = format!(
        "BT /F1 12 Tf 40 {TEXT_INDEX_FIRST_BASELINE} Td ({first}) Tj \
         0 -{TEXT_INDEX_LINE_GAP} Td ({second}) Tj ET"
    );

    let objects: Vec<String> = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".into(),
        "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>".into(),
        format!(
            "<< /Type /Page /Parent 2 0 R /Rotate {degrees} \
             /MediaBox [0 0 {TEXT_INDEX_PAGE_WIDTH} {TEXT_INDEX_PAGE_HEIGHT}] \
             /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>"
        ),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>".into(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into(),
        format!(
            "<< /Length {} >>\nstream\n{}\nendstream",
            content.len(),
            content
        ),
    ];

    write_pdf(name, objects)
}

/// CropBox 의 원점이 (0,0) 이 아닌 한 장짜리 PDF. MediaBox [0 0 612 792], CropBox [100 200 500 700],
/// 글자는 사용자 공간 (140, 600) 에 찍는다 — 보이는 페이지에서는 왼쪽 40, 위에서 100 언저리다.
/// 스캔·조판 도구가 여백을 잘라 낸 문서가 흔히 이 모양이고, 원점을 빼지 않으면 형광펜이 통째로 밀린다.
pub fn write_cropped_text_pdf(name: &str) -> PathBuf {
    let content = "BT /F1 12 Tf 140 600 Td (Cropped) Tj ET";
    let objects: Vec<String> = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".into(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /CropBox [100 200 500 700] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".into(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into(),
        format!("<< /Length {} >>
stream
{}
endstream", content.len(), content),
    ];

    write_pdf(name, objects)
}

/// MediaBox 를 마음대로 준 한 장짜리 PDF.
///
/// 세로로 아주 긴 페이지(스펙 문서의 접지 도면, 또는 그냥 이상하게 만들어진 문서)가 렌더
/// 상한에 걸리는지 보려면 그런 페이지가 필요한데, PDF 는 MediaBox 를 14400 units 까지
/// 허용하므로 그런 문서는 악의 없이도 존재한다.
pub fn write_single_page_pdf(name: &str, page_width: f32, page_height: f32) -> PathBuf {
    let objects: Vec<String> = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".into(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into(),
        format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_width} {page_height}] \
             /Resources << >> >>"
        ),
    ];

    write_pdf(name, objects)
}

/// 쪽 전체를 덮는 8x8 그림 한 장(스캔본)에, 원하면 글자 한 줄을 얹은 한 장짜리 PDF.
/// `image` 가 false 면 그림 없이 글자만 둔다(짧은 글자뿐인 텍스트 PDF). `text` 가 None 이면 순수 스캔본, Some 이면 스캔본에 글자가 조금 박힌 꼴이다.
pub fn write_scanned_page_pdf(name: &str, text: Option<&str>, with_image: bool) -> PathBuf {
    let hex = "80".repeat(64);
    let image = format!(
        "<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray          /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length {} >>
stream
{}>
endstream",
        hex.len() + 1,
        hex
    );
    let picture = if with_image { "q 612 0 0 792 0 0 cm /Im0 Do Q " } else { "" };
    let content = match text {
        Some(text) => format!("{picture}BT /F1 12 Tf 40 700 Td ({text}) Tj ET"),
        None => picture.trim().to_string(),
    };
    let objects: Vec<String> = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".into(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 5 0 R >> >> /Contents 6 0 R >>".into(),
        image,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into(),
        format!("<< /Length {} >>
stream
{}
endstream", content.len(), content),
    ];
    write_pdf(name, objects)
}

/// 링크·주석·문서 정보를 가진 두 장짜리 PDF.
///
/// 0번 페이지에 다섯 개의 주석을 단다 — 내부 링크(2쪽 y=500), https 링크, 열면 안 되는
/// `javascript:` 링크, 노란 형광펜(메모 포함), 그리고 붙임 쪽지. 트레일러에 `/Info` 를 건다.
pub fn write_links_and_annotations_pdf(name: &str) -> PathBuf {
    let content = "BT /F1 12 Tf 40 700 Td (Highlighted words on the first page) Tj ET";
    let objects: Vec<String> = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".into(),
        "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>".into(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R /Annots [7 0 R 8 0 R 9 0 R 10 0 R 11 0 R] >>".into(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>".into(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into(),
        format!("<< /Length {} >>\nstream\n{}\nendstream", content.len(), content),
        "<< /Type /Annot /Subtype /Link /Rect [40 600 200 620] /Border [0 0 0] /Dest [4 0 R /XYZ 0 500 0] >>".into(),
        "<< /Type /Annot /Subtype /Link /Rect [40 560 200 580] /Border [0 0 0] /A << /S /URI /URI (https://example.com/paper) >> >>".into(),
        "<< /Type /Annot /Subtype /Link /Rect [40 520 200 540] /Border [0 0 0] /A << /S /URI /URI (javascript:void 0) >> >>".into(),
        "<< /Type /Annot /Subtype /Highlight /Rect [40 697 300 712] /QuadPoints [40 712 300 712 40 697 300 697] /C [1 1 0] /Contents (memo text) >>".into(),
        "<< /Type /Annot /Subtype /Text /Rect [500 700 520 720] /Contents (sticky note) >>".into(),
        "<< /Title (Linked Paper) /Author (Kim, Lee) /Subject (Testing) /Keywords (pdf; links) /CreationDate (D:20230115120000Z) >>".into(),
    ];

    write_pdf_with_info(name, objects, Some(12))
}

/// 객체 목록을 xref 오프셋까지 제대로 계산한 PDF 파일로 떨군다.
fn write_pdf(name: &str, objects: Vec<String>) -> PathBuf {
    write_pdf_with_info(name, objects, None)
}

/// [`write_pdf`] 와 같지만 트레일러에 `/Info` 객체 번호를 걸 수 있다.
fn write_pdf_with_info(name: &str, objects: Vec<String>, info: Option<usize>) -> PathBuf {
    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = Vec::with_capacity(objects.len());

    for (index, body) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.push_str(&format!("{} 0 obj\n{}\nendobj\n", index + 1, body));
    }

    let xref_at = pdf.len();
    pdf.push_str(&format!("xref\n0 {}\n", objects.len() + 1));
    pdf.push_str("0000000000 65535 f \n");
    for offset in &offsets {
        pdf.push_str(&format!("{offset:010} 00000 n \n"));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R{} >>\nstartxref\n{}\n%%EOF\n",
        objects.len() + 1,
        info.map(|object| format!(" /Info {object} 0 R"))
            .unwrap_or_default(),
        xref_at
    ));

    let path = fixture_dir().join(name);
    std::fs::write(&path, pdf.as_bytes()).expect("픽스처 쓰기");
    path
}
