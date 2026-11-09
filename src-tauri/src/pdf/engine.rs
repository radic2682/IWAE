//! PDFium 을 아는 유일한 파일.
//!
//! 엔진을 다른 것으로 바꾸거나 `pdfium-render` 를 올릴 때 고쳐야 할 파일이 하나뿐이도록,
//! `pdfium_render` 의 타입은 이 모듈 밖으로 새어나가지 않는다. 바깥은 [`PdfDocMeta`],
//! [`OpenDocument`], [`PdfRenderError`] 와 PNG 바이트만 본다.

use std::collections::HashMap;
use std::fmt;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{imageops, ExtendedColorType, ImageEncoder};
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// 스캔본 판별에 쓸 앞쪽 페이지 수. 앞 몇 장만 봐도 텍스트 레이어 유무는 갈린다.
const TEXT_PROBE_PAGES: i32 = 3;

/// 이만큼도 글자가 없으면 텍스트 레이어가 없다고 본다. 스캔본에도 표지 워터마크 몇 글자는
/// 박혀 있는 경우가 있어 0 이 아니라 여유를 둔 값으로 자른다.
const TEXT_PROBE_MIN_CHARS: usize = 50;

/// 파일 내용 해시를 읽어 들이는 버퍼 크기. 수백 MB 스펙 문서를 통째로 메모리에 올리지 않는다.
const HASH_BUF_BYTES: usize = 64 * 1024;

/// 렌더 폭의 하한. 이보다 작으면 페이지가 아니라 얼룩이고, 굳이 PDFium 을 부를 일이 없다.
pub const MIN_RENDER_WIDTH: u32 = 32;

/// 렌더 폭의 상한.
///
/// 확대 300% 안팎에서도 글자가 뭉개지지 않을 만큼(A4 를 4800px 폭으로 그리면 약 580dpi). 다만 이 상수 하나가
/// 메모리를 묶어 주지는 **않는다** — 출력 높이는 페이지 비율에서 따로 나오기 때문이다.
/// 실제 한도는 [`MAX_RENDER_PIXELS`] 쪽에 적혀 있다.
pub const MAX_RENDER_WIDTH: u32 = 4800;

/// 영역 캡처 해상도. PDF points 는 72dpi 이므로 2px/pt 는 144dpi 다.
pub const CROP_PIXELS_PER_POINT: f32 = 2.0;

/// 출력 픽셀 수(폭 × 높이)의 상한. 메모리를 실제로 묶는 것은 폭이 아니라 이 값이다.
///
/// `PdfRenderConfig::set_target_width` 는 높이를 페이지 비율에서 유도하고 거기에는 상한이
/// 없다(`pdfium-render` 의 `apply_to_page`: `source_height * width_scale` 을 반올림해 그대로
/// 쓴다). PDF 의 MediaBox 는 14400 units 까지 합법이라 200x2000 짜리 세로로 긴 페이지는
/// 악의가 없어도 존재하고, 그 페이지를 `w=3000` 으로 부르면 3000x30000 = 360MB 짜리
/// 비트맵이 된다. 거기서 끝이 아니다 — `as_rgba_bytes()` 가 `as_raw_bytes` 로 한 벌,
/// `bgra_to_rgba` 로 또 한 벌을 더 떠서 같은 순간 세 벌이 산다(1GB 선). Rust 의 할당 실패는
/// 되감기가 아니라 abort 라서 이건 500 이 아니라 프로세스 죽음이다.
///
/// 36M 픽셀로 자른 이유: A4(595x842)를 최대 폭 4800px 으로 그리면 ≈32.6M 이라 들어가고,
/// 비트맵 한 벌이 144MB·인코딩 순간의 세 벌이 430MB 선에서 멎는다. 렌더 큐가 한 번에 한 쪽만
/// 그리므로 이 정점이 겹치지 않는다. 이보다 긴 페이지는 웹뷰가 쪽 비율로 `w` 를 줄여 부른다.
pub const MAX_RENDER_PIXELS: u64 = 36_000_000;

/// 타일 렌더에서 "쪽을 이 폭으로 그렸다고 칠 때"의 상한. 비트맵은 타일 크기만 만들므로
/// 메모리와 상관없고, 확대 1600% 안팎까지 기기 해상도 그대로 그릴 수 있는 값이다.
pub const MAX_TILE_PAGE_WIDTH: u32 = 40_000;

/// 타일 한 변의 상한(px). 타일 하나가 16MB 를 넘지 않는다.
pub const MAX_TILE_SIDE: u32 = 2048;

/// 쪽을 `width` 폭으로 그렸을 때의 픽셀 사각형.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TileRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// 인코딩 전 RGBA 그림.
pub struct RawImage {
    pub width: u32,
    pub height: u32,
    /// RGBA(줄 사이 빈 바이트 없음, 위에서 아래로). PDFium 이 처음부터 이 순서로 그린다
    /// (`set_reverse_byte_order`) — 색 순서를 따로 바꾸지 않는다.
    pub rgba: Vec<u8>,
}

impl RawImage {
    /// 화면용 PNG. 압축은 가장 빠른 단계로 — 웹뷰는 같은 프로세스라 몇 백 KB 더 커지는 것보다
    /// 인코딩 시간이 화면을 더 늦춘다(측정: 2400px 쪽 19ms → 14ms).
    ///
    /// 압축하지 않은 BMP 도 재 보았지만, 웹뷰의 커스텀 프로토콜로 16MB 를 넘기는 데만 200ms 넘게
    /// 걸려 PNG 보다 훨씬 느렸다. 압축 없이 넘기는 길은 공유 메모리(`shared`)다.
    pub fn encode_png_fast(&self) -> Result<Vec<u8>, PdfRenderError> {
        let expected = u64::from(self.width) * u64::from(self.height) * 4;
        if self.rgba.len() as u64 != expected {
            return Err(PdfRenderError::Failed(tr!(
                "비트맵 버퍼 길이가 맞지 않습니다: {}바이트, {}x{}",
                "Bitmap buffer length mismatch: {} bytes, {}x{}",
                self.rgba.len(),
                self.width,
                self.height
            )));
        }
        let mut png = Vec::with_capacity(self.rgba.len() / 6);
        PngEncoder::new_with_quality(&mut png, CompressionType::Fast, FilterType::Sub)
            .write_image(&self.rgba, self.width, self.height, ExtendedColorType::Rgba8)
            .map_err(|err| PdfRenderError::Failed(tr!("PNG 로 인코딩하지 못했습니다: {err}", "Could not encode PNG: {err}")))?;
        Ok(png)
    }
}

/// 바이트 순서를 뒤집어(RGBA) 그린 BGRA 비트맵을, 줄 사이 빈 바이트 없는 RGBA 로 꺼낸다.
/// 보통은 PDFium 버퍼를 그대로 복사하는 것뿐이다.
fn bitmap_rgba(bitmap: &PdfBitmap) -> Vec<u8> {
    let width = bitmap.width().max(0) as usize;
    let height = bitmap.height().max(0) as usize;
    let row = width * 4;
    if matches!(bitmap.format(), Ok(PdfBitmapFormat::BGRA)) && height > 0 {
        let raw = bitmap.as_raw_bytes();
        let stride = raw.len() / height;
        if stride == row {
            return raw;
        }
        if stride > row {
            let mut packed = Vec::with_capacity(row * height);
            for line in raw.chunks_exact(stride) {
                packed.extend_from_slice(&line[..row]);
            }
            return packed;
        }
    }
    bitmap.as_rgba_bytes()
}

/// 웹뷰가 받는 문서 메타.
///
/// `page_sizes` 를 열 때 전부 담아 보내는 이유는 스크롤 막대 때문이다. 문서 전체 높이를
/// 알아야 막대를 그릴 수 있고, 그러려면 모든 페이지 크기가 필요하다. 페이지마다 따로 물으면
/// 1,000 페이지 문서에서 1,000 번의 IPC 가 된다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfDocMeta {
    /// 파일 내용 SHA-256 앞 12자. 경로가 아니라 내용으로 문서를 식별한다.
    pub doc_id: String,
    /// library.json 이 파일 이동 뒤에도 같은 원본인지 확인할 때 쓰는 전체 해시.
    pub sha256: String,
    /// 원본 PDF 크기. 원본을 vault 로 복사하지 않으므로 레지스트리에 함께 기록한다.
    pub size: u64,
    /// 확장자를 뗀 파일 이름.
    pub title: String,
    pub page_count: i32,
    /// 페이지별 (폭, 높이), 단위는 points.
    pub page_sizes: Vec<(f32, f32)>,
    /// 스캔본 판별. false 면 텍스트 발췌가 원천적으로 불가능하다.
    pub has_text: bool,
}

/// 글자 하나와 그 글자가 페이지에서 차지하는 자리.
///
/// # 좌표계 — 왼쪽 위 원점, y 는 아래로
///
/// `x`/`y` 는 상자의 **왼쪽 위** 모서리이고 단위는 페이지 points, y 는 페이지 위쪽 끝에서
/// 아래로 잰다. `w`/`h` 와 함께 `PdfDocMeta::page_sizes` 가 주는 크기 안에 들어간다 — 즉
/// **그려진 그림 위의 자리**다. `/Rotate` 가 걸린 페이지도 돌아간 뒤 기준으로 맞춰 놓는다
/// ([`displayed_box`] 참고). PDFium 이 주는 좌표는 둘 다 다르다.
///
/// 맞추는 일을 여기서 끝내는 이유는 받는 쪽이 되돌릴 수가 없어서다. 히트 테스트는 페이지
/// 왼쪽 위에서 잰 화면 픽셀을 받는데 페이지 크기도 회전도 인자로 오지 않는다 — 즉 아래쪽
/// 어디에도 축을 되돌릴 재료가 없다. 게다가 이 변환은 이동·반사·직각 회전뿐 배율이 아니라서,
/// "좌표는 확대율과 렌더 해상도에 무관하다"(스펙 §5.1)는 성질은 변환 뒤에도 그대로 남는다.
///
/// # 상자가 겹칠 수 있다 — 리거처
///
/// 글자 하나에 상자 하나지만, **서로 다른 글자가 똑같은 상자를 가질 수 있다**. 리거처 때문
/// 이다. `fi` 처럼 두 글자가 글리프 하나로 합쳐져 찍히면 PDFium 은 글자는 둘로 풀어 주면서
/// (`f`, `i`) 두 글자 모두에 합쳐진 글리프 **전체**의 상자를 준다. 실측에서 확인했다 — LaTeX
/// 으로 조판된 논문에서 `f`(120번)와 `i`(121번)가 글자 하나까지 같은 상자를 들고 있었다.
///
/// 받는 쪽에 주는 영향은 이것뿐이다. 겹친 자리를 찍으면 그중 **한 글자**가 답이 된다 —
/// 어느 쪽인지는 히트 테스트가 훑는 순서가 정한다. 글자가 사라지거나 인덱스가 밀리지는
/// 않으므로 인덱스 약속은 그대로다. 리거처의 왼쪽 절반을 찍었는데 `i` 가 잡히는 정도가
/// 최악이고, 발췌는 글자 범위로 잡히므로 한 칸 차이는 따옴표 한 글자 차이로 끝난다.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CharBox {
    /// 글자 하나.
    ///
    /// UTF-16 코드 단위로 반드시 한 칸이다 — [`PageTextIndex`] 의 인덱스 약속이 그것에
    /// 기댄다. 타입이 `char` 가 아니라 `String` 인 것은 계획서가 정한 모양 그대로다.
    pub c: String,
    pub x: f32,
    pub y: f32,
    /// 폭과 높이. 언제나 0 이상이다.
    ///
    /// 0 이 나오는 자리가 실제로 있다. PDFium 은 줄바꿈을 나타내려고 원본에 없는 `\r\n` 을
    /// 끼워 넣는데(`FPDFText_IsGenerated`), 그 글자들의 상자는 줄 끝 한 점으로 눌려 있다.
    /// 면적이 없는 상자는 어떤 점도 품지 못하므로 히트 테스트에서 저절로 걸러진다 — 눈에
    /// 보이지 않는 글자에 대해 정확히 옳은 답이다.
    pub w: f32,
    pub h: f32,
}

/// 페이지 하나의 전체 텍스트와 글자별 상자.
///
/// # 인덱스 약속
///
/// `text` 는 `chars[i].c` 를 순서대로 이어 붙인 것이고, `i` 는 그 글자의 `text` 안
/// **UTF-16 코드 단위 오프셋**과 같다. 즉 `chars.len() == text.encode_utf16().count()` 이다.
///
/// 이 약속이 필요한 이유는 출처 앵커를 다시 푸는 쪽이 JS 이기 때문이다. 그쪽은
/// `text.slice(from, to) === quote` 로 확인하는데 `String.prototype.slice` 는 UTF-16 코드
/// 단위를 센다. 반면 Rust 의 `chars()` 는 스칼라를 센다 — 둘이 어긋나면 BMP 밖 글자 하나
/// 뒤의 모든 앵커가 조용히 한 칸씩 밀린다. 그래서 [`bmp_char`] 가 BMP 밖 글자를 `U+FFFD`
/// 하나로 바꿔 넣어 두 셈법을 강제로 일치시킨다.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PageTextIndex {
    pub text: String,
    pub chars: Vec<CharBox>,
}

/// 색인용 쪽 배치: 글자(크기·굵기 포함), 선·사각형(표 격자), 그림 자리.
/// 좌표는 [`PageTextIndex`] 와 같다 — 포인트, 원점 왼쪽 위, `/Rotate` 적용 뒤 화면 방향.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageLayout {
    pub page: i32,
    pub width: f32,
    pub height: f32,
    /// [`PageTextIndex::text`] 와 같은 글자열. `chars` 와 한 글자씩 짝이 맞는다.
    pub text: String,
    pub chars: Vec<LayoutChar>,
    /// 곧은 선분(가로·세로·사선). 표 격자와 도면 판별에 쓴다.
    pub segments: Vec<LayoutSegment>,
    /// 사각형 경로(채운 것·그은 것). 얇으면 선으로도 쓰인다.
    pub rects: Vec<LayoutRect>,
    /// 곡선을 포함한 경로 수(도면 판별용)
    pub curves: u32,
    /// 그림(래스터) 자리
    pub images: Vec<LayoutRect>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LayoutChar {
    pub c: char,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    /// 글꼴 크기(포인트, 변환 적용)
    pub size: f32,
    pub bold: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct LayoutSegment {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct LayoutRect {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
    pub filled: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOutlineEntry {
    pub title: String,
    /// 0-기반 페이지. 문서 안 목적지가 없는 북마크는 None 이다.
    pub page: Option<i32>,
    pub depth: u32,
}

/// 화면에 그려진 페이지 위의 사각형. 왼쪽 위가 원점이고 points 단위다 — [`CharBox`] 와 같은
/// 좌표계라 웹뷰가 글자 상자와 같은 배율로 그린다.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct LinkRect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// 링크를 눌렀을 때 갈 곳. 둘 중 어디에도 해당하지 않는 링크(자바스크립트, 파일 실행,
/// 다른 PDF 열기)는 아예 내보내지 않는다.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PdfLinkTarget {
    /// 0-기반 페이지와, 알 수 있으면 그 페이지 위에서 잰 세로 위치(왼쪽 위 원점).
    Page { page: i32, y: Option<f32> },
    /// `http`, `https`, `mailto` 만 통과한다. [`sanitize_uri`] 참고.
    Uri { uri: String },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PdfLink {
    pub rect: LinkRect,
    pub target: PdfLinkTarget,
}

/// PDF 정보 사전(/Info). 비어 있는 값은 `None` 이다.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfMetadata {
    pub title: Option<String>,
    pub author: Option<String>,
    pub subject: Option<String>,
    pub keywords: Option<String>,
    pub creation_date: Option<String>,
}

/// 다른 프로그램이 문서에 남긴 주석 하나. `kind` 는 `highlight`, `underline`,
/// `squiggly`, `strikeout`, `text`(붙임 쪽지) 중 하나다.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImportedAnnotation {
    pub page: i32,
    pub kind: String,
    pub rects: Vec<LinkRect>,
    pub color: Option<[u8; 3]>,
    pub contents: Option<String>,
}

/// 내보낼 형광펜 하나. 좌표는 [`LinkRect`] 와 같은 화면 좌표계다.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ExportHighlight {
    pub page: i32,
    pub rects: Vec<LinkRect>,
    pub color: [u8; 3],
    pub note: Option<String>,
}

/// OCR 로 읽은 한 줄. 좌표는 [`LinkRect`] 와 같은 화면 좌표계(왼쪽 위 원점, points)다.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct SearchableLine {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct SearchablePage {
    pub page: i32,
    pub lines: Vec<SearchableLine>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchableReport {
    pub written: usize,
    /// 유니코드 글꼴이 없어 넣지 못한 비ASCII 줄 수.
    pub skipped: usize,
}

/// 한글을 담을 수 있는 시스템 TrueType 글꼴. 보이지 않는 글자 층에 쓴다.
pub fn find_unicode_font() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(windows) = std::env::var_os("WINDIR") {
        let fonts = PathBuf::from(windows).join("Fonts");
        candidates.extend(
            ["malgun.ttf", "arialuni.ttf", "arial.ttf"]
                .iter()
                .map(|name| fonts.join(name)),
        );
    }
    candidates.extend(
        [
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            "/Library/Fonts/Arial Unicode.ttf",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
        .iter()
        .map(PathBuf::from),
    );
    candidates.into_iter().find(|path| path.is_file())
}

/// 웹뷰가 시스템 브라우저로 넘겨도 되는 주소만 남긴다.
///
/// PDF 링크는 문서를 만든 사람이 마음대로 적을 수 있다. `javascript:`, `file:`, 실행 파일
/// 경로 같은 것을 그대로 넘기면 "링크 클릭" 이 곧 임의 동작이 된다 — 그래서 허용 목록이다.
pub fn sanitize_uri(raw: &str) -> Option<String> {
    let uri = raw.trim();
    let lower = uri.to_ascii_lowercase();
    let allowed = lower.starts_with("https://")
        || lower.starts_with("http://")
        || lower.starts_with("mailto:");
    if !allowed || uri.chars().any(|c| c.is_control()) {
        return None;
    }
    Some(uri.to_string())
}

/// [`displayed_box`] 의 역변환 — 화면 좌표(왼쪽 위 원점, 돌아간 뒤)를 PDF 페이지 공간
/// (왼쪽 아래 원점, 돌아가기 전)의 `(left, bottom, right, top)` 으로 되돌린다.
/// 주석을 PDF 에 써 넣을 때 쓴다.
pub fn pdf_space_rect(
    rect: LinkRect,
    quarter_turns: u8,
    page_width: f32,
    page_height: f32,
) -> (f32, f32, f32, f32) {
    let (width, height) = if quarter_turns % 2 == 1 {
        (page_height, page_width)
    } else {
        (page_width, page_height)
    };
    let corners = [(rect.x, rect.y), (rect.x + rect.w, rect.y + rect.h)];
    // 돌아간 화면 좌표 → 돌아가기 전의 왼쪽 위 원점 좌표.
    let unrotated = corners.map(|(dx, dy)| match quarter_turns % 4 {
        1 => (dy, height - dx),
        2 => (width - dx, height - dy),
        3 => (width - dy, dx),
        _ => (dx, dy),
    });
    let left = unrotated[0].0.min(unrotated[1].0);
    let right = unrotated[0].0.max(unrotated[1].0);
    let top_down_min = unrotated[0].1.min(unrotated[1].1);
    let top_down_max = unrotated[0].1.max(unrotated[1].1);
    (left, height - top_down_max, right, height - top_down_min)
}

/// 쪽이 시계 방향으로 몇 번 90° 돌아 보이는가(0..3).
pub(crate) fn quarter_turns(page: &PdfPage) -> u8 {
    quarter_turns_of(page)
}

fn quarter_turns_of(page: &PdfPage) -> u8 {
    match page.rotation() {
        Ok(PdfPageRenderRotation::Degrees90) => 1,
        Ok(PdfPageRenderRotation::Degrees180) => 2,
        Ok(PdfPageRenderRotation::Degrees270) => 3,
        _ => 0,
    }
}

/// 보이는 페이지(CropBox 와 MediaBox 가 겹친 상자)의 왼쪽 아래 모서리(PDF 사용자 공간).
///
/// PDFium 은 그 상자만 그리고 `page_sizes` 도 그 크기라, 글자·링크·주석의 좌표에서 이 원점을
/// 빼야 화면과 맞는다. 원점이 (0,0) 이 아닌 문서(여백을 잘라 낸 스캔·조판 문서)에서 검색 결과와
/// 형광펜이 통째로 밀리던 원인이다. 못 읽으면 (0,0).
pub(crate) fn page_origin(page: &PdfPage) -> (f32, f32) {
    page.boundaries()
        .bounding()
        .ok()
        .map(|boundary| (boundary.bounds.left().value, boundary.bounds.bottom().value))
        .filter(|(x, y)| x.is_finite() && y.is_finite())
        .unwrap_or((0.0, 0.0))
}

fn link_rect_from(
    rect: &PdfRect,
    origin: (f32, f32),
    quarter_turns: u8,
    page_width: f32,
    page_height: f32,
) -> LinkRect {
    let (x, y, w, h) = displayed_box(
        rect.left().value - origin.0,
        rect.bottom().value - origin.1,
        rect.right().value - origin.0,
        rect.top().value - origin.1,
        quarter_turns,
        page_width,
        page_height,
    );
    LinkRect { x, y, w, h }
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

/// 페이지 왼쪽 위 원점, points 단위의 캡처 영역.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CropRect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// 렌더가 실패하는 방식. 프로토콜이 상태 코드로 옮기므로 종류가 곧 응답이 된다.
///
/// 이름과 달리 [`OpenDocument::page_text_index`] 도 이 타입을 쓴다. 그쪽이 실패하는 방식은
/// "모르는 문서"와 "페이지 범위 밖" 둘뿐인데 마침 여기 있는 변종과 글자 하나까지 같아서,
/// 같은 문장을 담을 열거형을 하나 더 만들 이유를 찾지 못했다. 텍스트 전용 변종이 생기는
/// 날(예: 암호화된 텍스트 레이어) 그때 갈라 내면 된다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PdfRenderError {
    /// 캐시에 없는 `doc_id`. 프로토콜은 파일을 열지 않으므로 여기서 끝난다.
    UnknownDocument,
    PageOutOfRange {
        page: i32,
        page_count: i32,
    },
    WidthOutOfRange(u32),
    /// 폭은 범위 안이지만 페이지 비율이 만들어 내는 출력이 [`MAX_RENDER_PIXELS`] 를 넘는다.
    ///
    /// 폭만 봐서는 알 수 없고 페이지 크기를 같이 봐야 나오는 값이라, URL 만 보는 프로토콜이
    /// 아니라 문서를 쥔 이 자리에서만 걸린다. `height` 는 그 폭에서 나왔을 출력 높이다 —
    /// 부르는 쪽이 `w` 를 얼마나 줄여야 하는지 알 수 있도록 같이 돌려준다.
    OutputTooLarge {
        width: u32,
        height: u32,
    },
    CropOutOfRange,
    /// PDFium 이나 인코더가 낸 오류.
    Failed(String),
}

impl fmt::Display for PdfRenderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::UnknownDocument => tr!("열려 있지 않은 문서입니다.", "The document is not open."),
            Self::PageOutOfRange { page, page_count } => tr!(
                "페이지 범위를 벗어났습니다: {page} (0..{page_count})",
                "Page out of range: {page} (0..{page_count})"
            ),
            Self::WidthOutOfRange(width) => tr!(
                "렌더 폭이 범위를 벗어났습니다: {width} ({MIN_RENDER_WIDTH}..={MAX_RENDER_WIDTH})",
                "Render width out of range: {width} ({MIN_RENDER_WIDTH}..={MAX_RENDER_WIDTH})"
            ),
            Self::OutputTooLarge { width, height } => tr!(
                "렌더 결과가 너무 큽니다: {width}x{height} \
                 (픽셀 상한 {MAX_RENDER_PIXELS}). 더 작은 w 로 요청하세요.",
                "Render output is too large: {width}x{height} \
                 (pixel limit {MAX_RENDER_PIXELS}). Request a smaller w."
            ),
            Self::CropOutOfRange => tr!(
                "캡처 영역이 비어 있거나 페이지 밖입니다.",
                "The capture area is empty or outside the page."
            ),
            Self::Failed(message) => return write!(f, "{message}"),
        };
        f.write_str(&text)
    }
}

/// 열린 채로 캐시에 머무는 문서. 안쪽의 PDFium 핸들은 밖에서 볼 수 없다.
///
/// 페이지 렌더가 이 핸들을 그대로 재사용한다 — 페이지를 그릴 때마다 문서를 다시 파싱하지
/// 않기 위해서다.
///
/// 메타를 통째로 들고 있지 않고 내용에서 나오는 값만 따로 담는 이유는 `title` 때문이다.
/// 제목은 파일 경로의 성질인데 캐시는 내용(`doc_id`)으로 키를 잡는다. 같은 스펙을 다른
/// 이름으로 복사해 열면 캐시에 남은 제목은 그 순간 거짓이 된다 — 그래서 아예 담지 않는다.
pub struct OpenDocument {
    /// 이 값이 떨어지는 순간 PDFium 이 문서를 닫는다. 캐시가 문서를 "열어 둔다"는 말은 곧
    /// 이 필드를 들고 있다는 뜻이다.
    document: PdfDocument<'static>,
    doc_id: String,
    sha256: String,
    size: u64,
    page_count: i32,
    page_sizes: Vec<(f32, f32)>,
    has_text: bool,
}

/// 쪽 편집 계획의 한 줄: 새 문서의 이 자리에 어느 문서의 몇 쪽을, 얼마나 더 돌려서 놓는가.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageEditOp {
    /// 없으면 편집 중인 문서 자신. 있으면 끼워 넣을 다른 PDF 의 경로.
    #[serde(default)]
    pub source: Option<String>,
    /// 0-기반 원본 쪽.
    pub page: i32,
    /// 지금 회전에 더할 각도(0·90·180·270).
    #[serde(default)]
    pub rotate: i32,
}

fn rotation_degrees(rotation: PdfPageRenderRotation) -> i32 {
    match rotation {
        PdfPageRenderRotation::None => 0,
        PdfPageRenderRotation::Degrees90 => 90,
        PdfPageRenderRotation::Degrees180 => 180,
        PdfPageRenderRotation::Degrees270 => 270,
    }
}

fn rotation_from_degrees(degrees: i32) -> PdfPageRenderRotation {
    match degrees.rem_euclid(360) {
        90 => PdfPageRenderRotation::Degrees90,
        180 => PdfPageRenderRotation::Degrees180,
        270 => PdfPageRenderRotation::Degrees270,
        _ => PdfPageRenderRotation::None,
    }
}

impl OpenDocument {
    /// 쪽 편집이 원본 쪽을 복사해 올 때 쓴다.
    pub fn document(&self) -> &PdfDocument<'static> {
        &self.document
    }

    /// 웹뷰가 받을 메타. 제목은 저장하지 않으므로 부르는 쪽이 방금 연 경로에서 뽑아 넘긴다.
    pub fn meta(&self, title: String) -> PdfDocMeta {
        PdfDocMeta {
            doc_id: self.doc_id.clone(),
            sha256: self.sha256.clone(),
            size: self.size,
            title,
            page_count: self.page_count,
            page_sizes: self.page_sizes.clone(),
            has_text: self.has_text,
        }
    }

    /// 페이지 하나를 PNG 로 그린다. `page` 는 0-기반(PDFium 과 같다).
    ///
    /// PNG 인 이유: 스파이크 측정에서 PNG 인코딩은 2.5–3.8ms 였고 JPEG q85 는 21–36ms 로
    /// 오히려 느렸다. 작은 글씨가 빽빽한 스펙 페이지라 손실 압축이 잘 듣지 않는다.
    pub fn render_png(&self, page: i32, width: u32) -> Result<Vec<u8>, PdfRenderError> {
        // 폭은 프로토콜이 이미 걸렀다. 그래도 여기서 다시 보는 이유는 이 함수가 비트맵
        // 할당을 시키는 당사자이기 때문이다 — 막는 자리는 할당하는 자리 옆이어야 한다.
        if !(MIN_RENDER_WIDTH..=MAX_RENDER_WIDTH).contains(&width) {
            return Err(PdfRenderError::WidthOutOfRange(width));
        }

        if page < 0 || page >= self.page_count {
            return Err(PdfRenderError::PageOutOfRange {
                page,
                page_count: self.page_count,
            });
        }

        // 폭만으로는 할당량이 정해지지 않는다. 높이는 페이지 비율에서 나오고 거기에는 상한이
        // 없으므로, 그릴 자리에 오기 전에 나올 픽셀 수를 직접 세어 본다. 열 때 담아 둔
        // `page_sizes` 가 있어서 PDFium 을 다시 부르지 않고 여기서 끝난다.
        let Some(&page_size) = self.page_sizes.get(page as usize) else {
            // `page_count` 검사를 통과했는데 크기가 없다면 두 값이 어긋난 것이다. 무엇이
            // 나올지 모르는 채로 할당을 시키느니 거절한다.
            return Err(PdfRenderError::Failed(tr!(
                "페이지 크기를 알 수 없습니다: {page}",
                "Unknown page size: {page}"
            )));
        };
        check_output_size(page_size, width)?;

        let config = PdfRenderConfig::new().set_target_width(width as i32);

        let page_handle =
            self.document.pages().get(page).map_err(|err| {
                PdfRenderError::Failed(tr!("페이지를 열지 못했습니다: {err}", "Could not open the page: {err}"))
            })?;

        let bitmap = page_handle
            .render_with_config(&config)
            .map_err(|err| PdfRenderError::Failed(tr!("페이지를 그리지 못했습니다: {err}", "Could not render the page: {err}")))?;

        let (pixel_width, pixel_height) = (bitmap.width(), bitmap.height());
        let rgba = bitmap.as_rgba_bytes();

        encode_png(&rgba, pixel_width, pixel_height)
    }

    /// 화면용 렌더. PNG 로 묶지 않은 RGBA 를 돌려준다 — 인코딩은 PDFium 스레드 밖(프로토콜의
    /// 블로킹 풀)에서 해서, 하나뿐인 PDFium 스레드는 그리기만 한다.
    ///
    /// `tile` 이 있으면 쪽을 `width` 폭으로 그렸을 때의 그 사각형만 그린다. 큰 확대에서 쪽
    /// 전체 비트맵(수십 MB)을 만들지 않고 보이는 부분만 기기 해상도로 그리기 위한 것이라,
    /// 이때 폭 상한은 [`MAX_TILE_PAGE_WIDTH`] 이고 픽셀 상한은 타일 크기에만 걸린다.
    pub fn render_raw(&self, page: i32, width: u32, tile: Option<TileRect>) -> Result<RawImage, PdfRenderError> {
        if page < 0 || page >= self.page_count {
            return Err(PdfRenderError::PageOutOfRange { page, page_count: self.page_count });
        }
        let Some(&page_size) = self.page_sizes.get(page as usize) else {
            return Err(PdfRenderError::Failed(tr!("페이지 크기를 알 수 없습니다: {page}", "Unknown page size: {page}")));
        };
        let page_handle = self
            .document
            .pages()
            .get(page)
            .map_err(|err| PdfRenderError::Failed(tr!("페이지를 열지 못했습니다: {err}", "Could not open the page: {err}")))?;

        let Some(tile) = tile else {
            if !(MIN_RENDER_WIDTH..=MAX_RENDER_WIDTH).contains(&width) {
                return Err(PdfRenderError::WidthOutOfRange(width));
            }
            check_output_size(page_size, width)?;
            let full_height = (f64::from(page_size.1) * f64::from(width) / f64::from(page_size.0)).round().max(1.0) as u32;
            let mut bitmap = PdfBitmap::empty(width as i32, full_height as i32, PdfBitmapFormat::BGRA)
                .map_err(|err| PdfRenderError::Failed(tr!("비트맵을 만들지 못했습니다: {err}", "Could not create the bitmap: {err}")))?;
            let config = PdfRenderConfig::new()
                .set_target_width(width as i32)
                .set_reverse_byte_order(true);
            page_handle
                .render_into_bitmap_with_config(&mut bitmap, &config)
                .map_err(|err| PdfRenderError::Failed(tr!("페이지를 그리지 못했습니다: {err}", "Could not render the page: {err}")))?;
            let (w, h) = (bitmap.width() as u32, bitmap.height() as u32);
            return Ok(RawImage { width: w, height: h, rgba: bitmap_rgba(&bitmap) });
        };

        if !(MIN_RENDER_WIDTH..=MAX_TILE_PAGE_WIDTH).contains(&width) {
            return Err(PdfRenderError::WidthOutOfRange(width));
        }
        let (page_width, page_height) = page_size;
        if !(page_width.is_finite() && page_height.is_finite() && page_width > 0.0 && page_height > 0.0) {
            return Err(PdfRenderError::Failed(tr!("페이지 크기가 이상합니다: {page_width}x{page_height}", "Invalid page size: {page_width}x{page_height}")));
        }
        let full_height = (f64::from(page_height) * f64::from(width) / f64::from(page_width)).round() as u32;
        if tile.x >= width || tile.y >= full_height || tile.width == 0 || tile.height == 0 {
            return Err(PdfRenderError::Failed(tr!("타일이 쪽 밖에 있습니다.", "The tile is outside the page.")));
        }
        // 쪽 가장자리에 걸친 타일은 쪽 안쪽만큼으로 줄인다(흰 여백을 만들지 않는다)
        let tile_width = tile.width.min(MAX_TILE_SIDE).min(width - tile.x);
        let tile_height = tile.height.min(MAX_TILE_SIDE).min(full_height - tile.y);
        let mut bitmap = PdfBitmap::empty(tile_width as i32, tile_height as i32, PdfBitmapFormat::BGRA)
            .map_err(|err| PdfRenderError::Failed(tr!("타일 비트맵을 만들지 못했습니다: {err}", "Could not create the tile bitmap: {err}")))?;
        // 쪽을 전체 크기로 놓되 원점을 타일 왼쪽 위만큼 당긴다 — PDFium 은 비트맵 밖은 그리지 않는다
        let config = PdfRenderConfig::new()
            .set_target_width(width as i32)
            .set_origin(-(tile.x as i32), -(tile.y as i32))
            .set_reverse_byte_order(true);
        page_handle
            .render_into_bitmap_with_config(&mut bitmap, &config)
            .map_err(|err| PdfRenderError::Failed(tr!("타일을 그리지 못했습니다: {err}", "Could not render the tile: {err}")))?;
        Ok(RawImage { width: tile_width, height: tile_height, rgba: bitmap_rgba(&bitmap) })
    }

    /// PDF 북마크를 화면에 그리기 쉬운 전위 순회 목록으로 바꾼다.
    pub fn outline(&self) -> Vec<PdfOutlineEntry> {
        let mut depths = HashMap::new();
        let mut entries = Vec::new();

        for bookmark in self.document.bookmarks().iter() {
            let depth = bookmark
                .parent()
                .and_then(|parent| depths.get(&parent).copied())
                .map(|parent_depth| parent_depth + 1)
                .unwrap_or(0);
            depths.insert(bookmark.clone(), depth);

            let Some(title) = bookmark.title().map(|title| title.trim().to_string()) else {
                continue;
            };
            if title.is_empty() {
                continue;
            }

            let direct_page = bookmark
                .destination()
                .and_then(|destination| destination.page_index().ok());
            let action_page = || {
                let action = bookmark.action()?;
                let local = action.as_local_destination_action()?;
                local.destination().ok()?.page_index().ok()
            };

            entries.push(PdfOutlineEntry {
                title,
                page: direct_page.or_else(action_page),
                depth,
            });
        }

        entries
    }

    fn page_handle(&self, page: i32) -> Result<(PdfPage<'_>, f32, f32), PdfRenderError> {
        if page < 0 || page >= self.page_count {
            return Err(PdfRenderError::PageOutOfRange {
                page,
                page_count: self.page_count,
            });
        }
        let &(page_width, page_height) = self.page_sizes.get(page as usize).ok_or_else(|| {
            PdfRenderError::Failed(tr!("페이지 크기를 알 수 없습니다: {page}", "Unknown page size: {page}"))
        })?;
        let handle =
            self.document.pages().get(page).map_err(|err| {
                PdfRenderError::Failed(tr!("페이지를 열지 못했습니다: {err}", "Could not open the page: {err}"))
            })?;
        Ok((handle, page_width, page_height))
    }

    /// 목적지 하나를 페이지 번호와 세로 위치로 푼다. 범위 밖 페이지는 버린다.
    fn resolve_destination(&self, destination: &PdfDestination) -> Option<PdfLinkTarget> {
        let page = destination.page_index().ok()?;
        if page < 0 || page >= self.page_count {
            return None;
        }
        let height = self.page_sizes.get(page as usize).map(|size| size.1);
        let origin_y = self.document.pages().get(page).map(|target| page_origin(&target).1).unwrap_or(0.0);
        let y = match destination.view_settings() {
            Ok(PdfDestinationViewSettings::SpecificCoordinatesAndZoom(_, Some(y), _)) => {
                height.map(|h| (h - (y.value - origin_y)).clamp(0.0, h))
            }
            _ => None,
        };
        Some(PdfLinkTarget::Page { page, y })
    }

    /// 페이지 하나의 링크. 갈 곳을 모르거나 허용하지 않는 링크는 빠진다.
    pub fn links(&self, page: i32) -> Result<Vec<PdfLink>, PdfRenderError> {
        let (handle, page_width, page_height) = self.page_handle(page)?;
        let quarter_turns = quarter_turns_of(&handle);
        let origin = page_origin(&handle);
        let mut links = Vec::new();

        for link in handle.links().iter() {
            let Ok(rect) = link.rect() else { continue };
            let target = link
                .destination()
                .and_then(|destination| self.resolve_destination(&destination))
                .or_else(|| {
                    let action = link.action()?;
                    if let Some(local) = action.as_local_destination_action() {
                        return self.resolve_destination(&local.destination().ok()?);
                    }
                    let uri = action.as_uri_action()?.uri().ok()?;
                    sanitize_uri(&uri).map(|uri| PdfLinkTarget::Uri { uri })
                });
            let Some(target) = target else { continue };
            let rect = link_rect_from(&rect, origin, quarter_turns, page_width, page_height);
            if rect.w <= 0.0 || rect.h <= 0.0 {
                continue;
            }
            links.push(PdfLink { rect, target });
        }

        Ok(links)
    }

    /// 문서 정보 사전.
    pub fn metadata(&self) -> PdfMetadata {
        let metadata = self.document.metadata();
        let read = |tag| non_empty(metadata.get(tag).map(|entry| entry.value().to_string()));
        PdfMetadata {
            title: read(PdfDocumentMetadataTagType::Title),
            author: read(PdfDocumentMetadataTagType::Author),
            subject: read(PdfDocumentMetadataTagType::Subject),
            keywords: read(PdfDocumentMetadataTagType::Keywords),
            creation_date: read(PdfDocumentMetadataTagType::CreationDate),
        }
    }

    /// 문서 전체의 표시 주석(형광펜·밑줄·물결·취소선·붙임 쪽지). 링크와 양식은 뺀다.
    pub fn annotations(&self) -> Result<Vec<ImportedAnnotation>, PdfRenderError> {
        let mut found = Vec::new();
        for page in 0..self.page_count {
            let (handle, page_width, page_height) = self.page_handle(page)?;
            let quarter_turns = quarter_turns_of(&handle);
            let origin = page_origin(&handle);
            for annotation in handle.annotations().iter() {
                let kind = match annotation.annotation_type() {
                    PdfPageAnnotationType::Highlight => "highlight",
                    PdfPageAnnotationType::Underline => "underline",
                    PdfPageAnnotationType::Squiggly => "squiggly",
                    PdfPageAnnotationType::Strikeout => "strikeout",
                    PdfPageAnnotationType::Text => "text",
                    _ => continue,
                };
                let mut rects: Vec<LinkRect> = if annotation.has_attachment_points() {
                    annotation
                        .attachment_points()
                        .iter()
                        .map(|quad| {
                            link_rect_from(&quad.to_rect(), origin, quarter_turns, page_width, page_height)
                        })
                        .collect()
                } else {
                    Vec::new()
                };
                if rects.is_empty() {
                    if let Ok(bounds) = annotation.bounds() {
                        rects.push(link_rect_from(
                            &bounds,
                            origin,
                            quarter_turns,
                            page_width,
                            page_height,
                        ));
                    }
                }
                rects.retain(|rect| rect.w > 0.0 && rect.h > 0.0);
                let color = annotation
                    .stroke_color()
                    .ok()
                    .map(|color| [color.red(), color.green(), color.blue()]);
                found.push(ImportedAnnotation {
                    page,
                    kind: kind.to_string(),
                    rects,
                    color,
                    contents: non_empty(annotation.contents()),
                });
            }
        }
        Ok(found)
    }

    /// 문서 전체를 바이트로 저장한다. 주석 포함 사본을 만들 때 원본 대신 이 바이트를 고친다.
    pub fn to_bytes(&self) -> Result<Vec<u8>, PdfRenderError> {
        self.document
            .save_to_bytes()
            .map_err(|err| PdfRenderError::Failed(tr!("PDF 를 복사하지 못했습니다: {err}", "Could not copy the PDF: {err}")))
    }

    /// 페이지 좌표(points)로 지정한 영역만 144dpi PNG 로 만든다.
    pub fn crop_png(&self, page: i32, rect: CropRect) -> Result<Vec<u8>, PdfRenderError> {
        if page < 0 || page >= self.page_count {
            return Err(PdfRenderError::PageOutOfRange {
                page,
                page_count: self.page_count,
            });
        }

        let Some(&(page_width, page_height)) = self.page_sizes.get(page as usize) else {
            return Err(PdfRenderError::Failed(tr!(
                "페이지 크기를 알 수 없습니다: {page}",
                "Unknown page size: {page}"
            )));
        };
        let values = [rect.x, rect.y, rect.w, rect.h, page_width, page_height];
        let right = rect.x + rect.w;
        let bottom = rect.y + rect.h;
        if values.iter().any(|value| !value.is_finite())
            || rect.x < 0.0
            || rect.y < 0.0
            || rect.w <= 0.0
            || rect.h <= 0.0
            || right > page_width
            || bottom > page_height
        {
            return Err(PdfRenderError::CropOutOfRange);
        }

        let target_width = (page_width * CROP_PIXELS_PER_POINT)
            .round()
            .clamp(MIN_RENDER_WIDTH as f32, MAX_RENDER_WIDTH as f32)
            as u32;
        let scale = target_width as f32 / page_width;
        let rendered = self.render_png(page, target_width)?;
        let full = image::load_from_memory(&rendered)
            .map_err(|err| PdfRenderError::Failed(tr!("캡처용 PNG를 읽지 못했습니다: {err}", "Could not read the capture PNG: {err}")))?
            .to_rgba8();

        let left = (rect.x * scale).floor() as u32;
        let top = (rect.y * scale).floor() as u32;
        let right = (right * scale).ceil() as u32;
        let bottom = (bottom * scale).ceil() as u32;
        let width = right.saturating_sub(left);
        let height = bottom.saturating_sub(top);
        if width == 0 || height == 0 || right > full.width() || bottom > full.height() {
            return Err(PdfRenderError::CropOutOfRange);
        }

        let cropped = imageops::crop_imm(&full, left, top, width, height).to_image();
        encode_png(cropped.as_raw(), width as i32, height as i32)
    }

    /// 페이지 하나의 전체 텍스트와 글자별 상자. `page` 는 0-기반.
    ///
    /// 글자가 하나도 없는 페이지는 오류가 아니라 빈 [`PageTextIndex`] 다. 문서를 열 때
    /// `has_text` 가 스캔본을 이미 걸렀지만, 텍스트가 있는 문서 안에도 그림만 있는 페이지는
    /// 섞인다 — 표지, 접지 도면, 스캔해 붙인 부록.
    ///
    /// 상자는 `tight_bounds` 가 아니라 `loose_bounds`(`FPDFText_GetLooseCharBox`)에서 온다.
    /// M4 스파이크가 재어 본 것도 그쪽이고, 고르는 데 쓰기에도 이쪽이 맞다 — tight 는 글리프의
    /// 잉크에 딱 붙어서 공백 문자의 상자가 납작해지고 줄 높이도 글자마다 들쭉날쭉해진다.
    /// loose 는 폰트의 올라감·내려감을 담아 같은 줄의 글자가 모두 같은 높이를 갖는다.
    pub fn page_text_index(&self, page: i32) -> Result<PageTextIndex, PdfRenderError> {
        if page < 0 || page >= self.page_count {
            return Err(PdfRenderError::PageOutOfRange {
                page,
                page_count: self.page_count,
            });
        }

        // 좌표를 옮기려면 페이지 크기가 필요하다. PDFium 에 다시 묻지 않고 열 때 담아 둔
        // 값을 쓰는 이유는 일치 때문이다 — 웹뷰는 바로 이 `page_sizes` 로 페이지를
        // 배치하므로, 같은 숫자로 옮겨야 상자와 화면이 어긋날 여지가 없다.
        let Some(&(page_width, page_height)) = self.page_sizes.get(page as usize) else {
            return Err(PdfRenderError::Failed(tr!(
                "페이지 크기를 알 수 없습니다: {page}",
                "Unknown page size: {page}"
            )));
        };

        // NaN 이거나 0 이하면 옮기기가 의미를 잃는다. 좌표를 조용히 망가뜨리느니 거절한다 —
        // `render_png` 이 같은 값을 같은 이유로 보는 것과 짝을 맞춘다.
        let unusable = |value: f32| !value.is_finite() || value <= 0.0;
        if unusable(page_width) || unusable(page_height) {
            return Err(PdfRenderError::Failed(tr!(
                "페이지 크기가 이상합니다: {page_width}x{page_height}",
                "Invalid page size: {page_width}x{page_height}"
            )));
        }

        let page_handle =
            self.document.pages().get(page).map_err(|err| {
                PdfRenderError::Failed(tr!("페이지를 열지 못했습니다: {err}", "Could not open the page: {err}"))
            })?;

        // 회전을 읽지 못하면 안 돌아간 것으로 본다. 돌아간 페이지를 안 돌린 채로 내보내는
        // 것보다 나쁜 선택지가 없어서가 아니라, 회전을 모르는 채로는 어차피 할 수 있는 일이
        // 없기 때문이다 — `/Rotate` 가 없는 페이지가 압도적으로 많으므로 그쪽에 건다.
        let quarter_turns = match page_handle.rotation() {
            Ok(PdfPageRenderRotation::Degrees90) => 1,
            Ok(PdfPageRenderRotation::Degrees180) => 2,
            Ok(PdfPageRenderRotation::Degrees270) => 3,
            _ => 0,
        };

        let (origin_x, origin_y) = page_origin(&page_handle);
        let text = page_handle
            .text()
            .map_err(|err| PdfRenderError::Failed(tr!("텍스트를 읽지 못했습니다: {err}", "Could not read text: {err}")))?;

        let source = text.chars();
        let mut chars = Vec::with_capacity(source.len());
        let mut all = String::new();

        for char_handle in source.iter() {
            // 글자와 상자를 같은 루프에서 담는다. `PdfPageText::all()` 을 따로 부르지 않는
            // 이유는 그쪽이 `FPDFText_GetBoundedText` 라 페이지 상자 밖으로 삐져나간 글자를
            // 떨어뜨릴 수 있기 때문이다. 그러면 `text` 와 `chars` 의 길이가 어긋나고, 인덱스
            // 약속은 어긋나는 순간 전부 거짓이 된다.
            let c = bmp_char(char_handle.unicode_char());
            all.push(c);

            // 상자를 못 얻는 글자는 실측에서 한 번도 보지 못했다(실제 문서 세 종 19,874자,
            // 실패 0). 그래도 `Result` 인 이상 답이 있어야 하고, 면적 0 인 상자가 가장 정직한
            // 답이다 — PDFium 이 끼워 넣은 줄바꿈 글자가 이미 그 모양이고, 어떤 점도 품지
            // 않으므로 "보이지 않는 글자" 로 취급된다. 글자를 빼 버리는 쪽은 고를 수 없다.
            // 뺀 만큼 뒤의 모든 인덱스가 밀린다.
            let (x, y, w, h) = char_handle
                .loose_bounds()
                .map(|rect| {
                    displayed_box(
                        rect.left().value - origin_x,
                        rect.bottom().value - origin_y,
                        rect.right().value - origin_x,
                        rect.top().value - origin_y,
                        quarter_turns,
                        page_width,
                        page_height,
                    )
                })
                .unwrap_or((0.0, 0.0, 0.0, 0.0));

            chars.push(CharBox {
                c: c.to_string(),
                x,
                y,
                w,
                h,
            });
        }

        Ok(PageTextIndex { text: all, chars })
    }

    /// 색인용 쪽 배치. 글자는 [`Self::page_text_index`] 와 같은 순서·좌표에 크기·굵기를 더하고,
    /// 경로·그림 객체에서 선과 사각형·그림 자리를 모은다. `page` 는 0-기반.
    pub fn page_layout(&self, page: i32) -> Result<PageLayout, PdfRenderError> {
        let index = self.page_text_index(page)?;
        let (page_width, page_height) = self.page_sizes[page as usize];
        let page_handle = self
            .document
            .pages()
            .get(page)
            .map_err(|err| PdfRenderError::Failed(tr!("페이지를 열지 못했습니다: {err}", "Could not open the page: {err}")))?;
        let quarter_turns = match page_handle.rotation() {
            Ok(PdfPageRenderRotation::Degrees90) => 1,
            Ok(PdfPageRenderRotation::Degrees180) => 2,
            Ok(PdfPageRenderRotation::Degrees270) => 3,
            _ => 0,
        };
        let text = page_handle
            .text()
            .map_err(|err| PdfRenderError::Failed(tr!("텍스트를 읽지 못했습니다: {err}", "Could not read text: {err}")))?;
        let mut chars = Vec::with_capacity(index.chars.len());
        for (handle, boxed) in text.chars().iter().zip(index.chars.iter()) {
            let weight_bold = match handle.font_weight() {
                Some(PdfFontWeight::Weight600 | PdfFontWeight::Weight700Bold | PdfFontWeight::Weight800 | PdfFontWeight::Weight900) => true,
                Some(PdfFontWeight::Custom(weight)) => weight >= 600,
                _ => false,
            };
            let bold = weight_bold
                || handle.font_is_bold_reenforced()
                || handle.font_name().to_ascii_lowercase().contains("bold");
            chars.push(LayoutChar {
                c: boxed.c.chars().next().unwrap_or(' '),
                x: boxed.x,
                y: boxed.y,
                w: boxed.w,
                h: boxed.h,
                size: handle.scaled_font_size().value,
                bold,
            });
        }
        let mut layout = PageLayout {
            page,
            width: page_width,
            height: page_height,
            text: index.text,
            chars,
            ..PageLayout::default()
        };
        let objects: Vec<PdfPageObject<'static>> = page_handle
            .objects()
            .iter()
            // 쪽 핸들이 이 함수 안에서만 살아 있으므로 수명을 늘려도 밖으로 새지 않는다.
            .map(|object| unsafe { std::mem::transmute::<PdfPageObject<'_>, PdfPageObject<'static>>(object) })
            .collect();
        let mut sink = LayoutSink { layout: &mut layout, quarter_turns, origin: page_origin(&page_handle) };
        sink.collect(objects.into_iter(), IDENTITY, 0);
        Ok(layout)
    }
}

/// 2차원 아핀 변환 [a, b, c, d, e, f] — PDF 의 `cm` 과 같은 순서.
type Affine = [f32; 6];

const IDENTITY: Affine = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

fn affine_of(matrix: &PdfMatrix) -> Affine {
    [matrix.a(), matrix.b(), matrix.c(), matrix.d(), matrix.e(), matrix.f()]
}

/// child 를 먼저, parent 를 나중에 적용하는 합성(폼 안의 객체 → 폼 → 쪽).
fn compose(parent: Affine, child: Affine) -> Affine {
    let [pa, pb, pc, pd, pe, pf] = parent;
    let [ca, cb, cc, cd, ce, cf] = child;
    [
        ca * pa + cb * pc,
        ca * pb + cb * pd,
        cc * pa + cd * pc,
        cc * pb + cd * pd,
        ce * pa + cf * pc + pe,
        ce * pb + cf * pd + pf,
    ]
}

fn apply(m: Affine, x: f32, y: f32) -> (f32, f32) {
    (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
}

/// 쪽 배치를 모으는 동안 들고 다니는 값
struct LayoutSink<'a> {
    layout: &'a mut PageLayout,
    quarter_turns: u8,
    /// 보이는 페이지의 왼쪽 아래(PDF 공간). 빼야 화면 좌표와 맞는다
    origin: (f32, f32),
}

impl LayoutSink<'_> {
    /// PDF 공간 점 → 화면 좌표(왼쪽 위 원점)
    fn point(&self, x: f32, y: f32) -> (f32, f32) {
        let (x, y) = (x - self.origin.0, y - self.origin.1);
        let (dx, dy, _, _) = displayed_box(x, y, x, y, self.quarter_turns, self.layout.width, self.layout.height);
        (dx, dy)
    }

    fn collect(&mut self, objects: impl Iterator<Item = PdfPageObject<'static>>, parent: Affine, depth: u8) {
        for object in objects {
            match object.object_type() {
                PdfPageObjectType::Path => {
                    if let Some(path) = object.as_path_object() {
                        let matrix = path.matrix().map(|m| compose(parent, affine_of(&m))).unwrap_or(parent);
                        let filled = !matches!(path.fill_mode(), Ok(PdfPathFillMode::None) | Err(_));
                        self.path(path.segments().raw().iter(), matrix, filled);
                    }
                }
                PdfPageObjectType::Image => {
                    if let Ok(bounds) = object.bounds() {
                        let rect = bounds.to_rect();
                        let (x0, y0, w, h) = displayed_box(
                            rect.left().value - self.origin.0,
                            rect.bottom().value - self.origin.1,
                            rect.right().value - self.origin.0,
                            rect.top().value - self.origin.1,
                            self.quarter_turns,
                            self.layout.width,
                            self.layout.height,
                        );
                        self.layout.images.push(LayoutRect { x0, y0, x1: x0 + w, y1: y0 + h, filled: true });
                    }
                }
                PdfPageObjectType::XObjectForm if depth < 4 => {
                    if let Some(form) = object.as_x_object_form_object() {
                        let matrix = form.matrix().map(|m| compose(parent, affine_of(&m))).unwrap_or(parent);
                        let children: Vec<PdfPageObject<'static>> = (0..form.len())
                            .filter_map(|index| form.get(index).ok())
                            // SAFETY 없이 수명만 맞춘다: 폼 객체는 문서가 살아 있는 동안 유효하다.
                            .map(|child| unsafe { std::mem::transmute::<PdfPageObject<'_>, PdfPageObject<'static>>(child) })
                            .collect();
                        self.collect(children.into_iter(), matrix, depth + 1);
                    }
                }
                _ => {}
            }
        }
    }

    /// 경로 하나: 축에 맞춘 사각형이면 사각형으로, 아니면 곧은 선분들로 담는다.
    fn path<'s>(&mut self, segments: impl Iterator<Item = PdfPathSegment<'s>>, matrix: Affine, filled: bool) {
        let mut lines: Vec<(f32, f32, f32, f32)> = Vec::new();
        let mut curves = false;
        let mut current: Option<(f32, f32)> = None;
        let mut start: Option<(f32, f32)> = None;
        let mut bezier_points = 0u8;
        for segment in segments {
            let (px, py) = apply(matrix, segment.x().value, segment.y().value);
            let point = self.point(px, py);
            match segment.segment_type() {
                PdfPathSegmentType::MoveTo => {
                    current = Some(point);
                    start = Some(point);
                }
                PdfPathSegmentType::LineTo => {
                    if let Some((x, y)) = current {
                        lines.push((x, y, point.0, point.1));
                    }
                    current = Some(point);
                }
                PdfPathSegmentType::BezierTo => {
                    curves = true;
                    bezier_points += 1;
                    if bezier_points == 3 {
                        bezier_points = 0;
                        current = Some(point);
                    }
                }
                PdfPathSegmentType::Unknown => {}
            }
            if segment.is_close() {
                if let (Some((x, y)), Some((sx, sy))) = (current, start) {
                    if (x - sx).abs() > 0.01 || (y - sy).abs() > 0.01 {
                        lines.push((x, y, sx, sy));
                    }
                    current = Some((sx, sy));
                }
            }
        }
        if curves {
            self.layout.curves += 1;
        }
        let axis = |l: &(f32, f32, f32, f32)| (l.0 - l.2).abs() < 0.5 || (l.1 - l.3).abs() < 0.5;
        if !curves && (3..=5).contains(&lines.len()) && lines.iter().all(axis) {
            let x0 = lines.iter().flat_map(|l| [l.0, l.2]).fold(f32::MAX, f32::min);
            let x1 = lines.iter().flat_map(|l| [l.0, l.2]).fold(f32::MIN, f32::max);
            let y0 = lines.iter().flat_map(|l| [l.1, l.3]).fold(f32::MAX, f32::min);
            let y1 = lines.iter().flat_map(|l| [l.1, l.3]).fold(f32::MIN, f32::max);
            self.layout.rects.push(LayoutRect { x0, y0, x1, y1, filled });
            return;
        }
        for (x0, y0, x1, y1) in lines {
            self.layout.segments.push(LayoutSegment { x0, y0, x1, y1 });
        }
    }
}

/// PDFium 이 준 글자 상자를 **화면에 나오는 그대로의** 페이지 좌표로 옮긴다.
/// 결과는 왼쪽 위가 원점이고 y 는 아래로 증가한다.
///
/// 옮기는 일이 둘이다.
///
/// # 1. y 뒤집기
///
/// PDFium 의 페이지 공간은 왼쪽 아래가 원점이고 y 가 위로 증가한다. `PdfRect` 는 만들어질 때
/// `bottom <= top`, `left <= right` 로 정렬되므로(`PdfRect::new`) 폭과 높이는 빼기만으로
/// 음수가 되지 않고, 뒤집기는 윗변 하나면 끝난다 — 위에서 잰 거리는 `높이 - top` 이다.
///
/// # 2. `/Rotate` 돌리기
///
/// 이쪽은 실측으로 찾은 함정이다. `/Rotate 90` 인 페이지에서 `page_sizes` 는 **돌아간 뒤**
/// 크기(612x792 페이지가 792x612)를 주는데, 글자 상자는 **돌아가기 전** 공간으로 온다.
/// 그대로 두면 y 가 음수로 나온다 — 직접 만든 픽스처에서 `y=-98.86` 을 봤다. 즉 뒤집기만
/// 해서는 이 함수가 약속한 좌표계가 아예 성립하지 않는다.
///
/// 돌려서 맞추는 쪽을 고른 이유는 렌더가 이미 그렇게 하고 있어서다. PDFium 은 페이지를
/// 그릴 때 `/Rotate` 를 적용하므로 웹뷰가 받는 그림은 792x612 짜리고, 히트 테스트는 그
/// 그림 위의 픽셀을 준다. 상자가 돌아가기 전 공간에 남아 있으면 그림과 영영 어긋난다.
/// 스펙 문서의 접지 도면·가로 표가 흔히 `/Rotate 90` 이라 드문 경우도 아니다.
///
/// `quarter_turns` 는 시계 방향 90도 횟수다. 한 번 돌면 `(x, y) -> (높이 - y, x)` 이고
/// 페이지의 폭과 높이가 서로 바뀐다. 두 모서리를 각각 돌린 뒤 min/max 로 다시 상자를 세우면
/// 어느 방향으로 돌았든 폭과 높이는 양수로 남는다.
///
/// 네 값 중 하나라도 유한하지 않으면 면적 0 인 상자로 접는다. NaN 을 그대로 실어 보내면
/// `serde_json` 이 `null` 로 적고, 그 자리는 숫자를 기대하는 TypeScript 쪽에서 터진다 —
/// 좌표 하나 때문에 페이지 전체의 응답을 못 쓰게 만드는 것보다 낫다.
fn displayed_box(
    left: f32,
    bottom: f32,
    right: f32,
    top: f32,
    quarter_turns: u8,
    page_width: f32,
    page_height: f32,
) -> (f32, f32, f32, f32) {
    if !left.is_finite() || !bottom.is_finite() || !right.is_finite() || !top.is_finite() {
        return (0.0, 0.0, 0.0, 0.0);
    }

    // 돌아가기 전 페이지 크기. `page_width`/`page_height` 는 돌아간 뒤 크기라, 홀수 번
    // 돌아간 페이지는 두 값이 서로 바뀐 것이다.
    let (width, height) = if quarter_turns % 2 == 1 {
        (page_height, page_width)
    } else {
        (page_width, page_height)
    };

    // 여기서부터 왼쪽 위 원점, y 아래로 — 아직 돌아가기 전 공간이다.
    let (x0, y0) = (left, height - top);
    let (x1, y1) = (right, height - bottom);

    let ((ax, ay), (bx, by)) = match quarter_turns % 4 {
        1 => ((height - y0, x0), (height - y1, x1)),
        2 => ((width - x0, height - y0), (width - x1, height - y1)),
        3 => ((y0, width - x0), (y1, width - x1)),
        _ => ((x0, y0), (x1, y1)),
    };

    (ax.min(bx), ay.min(by), (ax - bx).abs(), (ay - by).abs())
}

#[cfg(test)]
pub(crate) fn displayed_box_for_tests(
    left: f32,
    bottom: f32,
    right: f32,
    top: f32,
    quarter_turns: u8,
    page_width: f32,
    page_height: f32,
) -> (f32, f32, f32, f32) {
    displayed_box(
        left,
        bottom,
        right,
        top,
        quarter_turns,
        page_width,
        page_height,
    )
}

/// PDFium 이 준 글자를 UTF-16 한 칸짜리로 만든다.
///
/// BMP 밖 글자(코드 단위 두 칸)와 `char` 로 옮기지 못한 값은 `U+FFFD` 로 바꾼다. 바꾸는
/// 이유는 [`PageTextIndex`] 의 인덱스 약속이고, 바꿔도 되는 이유는 대상 문서다 — 영문 기술
/// 문서와 한글 문서는 전부 BMP 안이다. 실측에서도 세 문서 19,874자 중 BMP 밖
/// 글자도, `char` 로 옮기지 못한 값도 하나도 없었다. 있지도 않을 글자 하나를 잃고 인덱스가
/// 정확하다는 보장을 얻는 거래다.
///
/// `None` 이 오는 경우가 실제로 있다. `FPDFText_GetUnicode` 는 UTF-16 코드 단위를 그대로
/// 돌려주므로 BMP 밖 글자는 서로게이트 반쪽으로 오고, `char::from_u32` 는 서로게이트를
/// 거절한다. 즉 아래 두 갈래는 같은 사정의 앞뒤다.
fn bmp_char(unicode: Option<char>) -> char {
    match unicode {
        Some(c) if c.len_utf16() == 1 => c,
        _ => char::REPLACEMENT_CHARACTER,
    }
}

/// 이 폭으로 그렸을 때 나올 출력 크기가 [`MAX_RENDER_PIXELS`] 안인지 본다.
///
/// 셈은 `pdfium-render` 의 `apply_to_page` 와 같은 식이다 — `target_width` 하나만 주면
/// 비율이 유지되어 높이는 `source_height * (target_width / source_width)` 를 반올림한 값이
/// 된다. `set_maximum_height` 로 PDFium 이 알아서 줄이게 하지 않고 거절하는 이유: 그쪽은
/// 비율을 지키느라 폭까지 같이 줄여서, `w=1400` 을 요청한 쪽이 그보다 좁은 그림을 받고도
/// 그 사실을 알 길이 없다. "받은 그림의 폭은 요청한 `w` 다" 라는 약속을 조용히 깨느니
/// 400 으로 돌려보내고 부르는 쪽이 다시 정하게 한다.
///
/// 페이지 크기는 문서에서 온 값이라 0 이나 NaN 일 수 있어서 비율을 내기 전에 먼저 본다.
fn check_output_size(page_size: (f32, f32), width: u32) -> Result<(), PdfRenderError> {
    let (page_width, page_height) = page_size;

    // NaN·무한대·0 이하를 한자리에서 잘라 낸다. 셋 다 비율을 낼 수 없는 값이다.
    let unusable = |value: f32| !value.is_finite() || value <= 0.0;

    if unusable(page_width) || unusable(page_height) {
        return Err(PdfRenderError::Failed(tr!(
            "페이지 크기가 이상합니다: {page_width}x{page_height}",
            "Invalid page size: {page_width}x{page_height}"
        )));
    }

    let scale = f64::from(width) / f64::from(page_width);
    let height = (f64::from(page_height) * scale).round();

    // f64 → u32 캐스팅은 범위를 벗어나면 포화한다(Rust 1.45+). 상한을 한참 넘은 값이
    // u32::MAX 로 접히는 것뿐이라 아래 판정은 달라지지 않는다.
    let height = height.clamp(0.0, f64::from(u32::MAX)) as u32;

    // 높이 0 은 그림이 아니다. 게다가 `as_rgba_bytes()` 가 `bytes.len() / height` 를 하므로
    // 0 짜리 비트맵이 만들어지면 0 으로 나누는 패닉이 된다 — 여기서 잘라 낸다.
    if height == 0 {
        return Err(PdfRenderError::Failed(tr!(
            "출력 높이가 0 픽셀입니다: {page_width}x{page_height} 페이지를 {width}px 폭으로",
            "Output height is 0 pixels: {page_width}x{page_height} page at {width}px width"
        )));
    }

    if u64::from(width) * u64::from(height) > MAX_RENDER_PIXELS {
        return Err(PdfRenderError::OutputTooLarge { width, height });
    }

    Ok(())
}

/// RGBA 바이트를 PNG 로 묶는다.
///
/// PDFium 비트맵은 알파를 들고 있고 페이지 배경은 불투명하므로 RGBA 그대로 넘긴다 —
/// RGB 로 줄이려면 픽셀마다 복사가 한 번 더 생기는데, 그 비용이 PNG 가 아끼는 양보다 크다.
fn encode_png(rgba: &[u8], width: i32, height: i32) -> Result<Vec<u8>, PdfRenderError> {
    let (Ok(width), Ok(height)) = (u32::try_from(width), u32::try_from(height)) else {
        return Err(PdfRenderError::Failed(tr!(
            "비트맵 크기가 이상합니다: {width}x{height}",
            "Invalid bitmap size: {width}x{height}"
        )));
    };

    // 길이를 여기서 세어 보는 이유: `PngEncoder::write_image` 는 버퍼 길이가 안 맞으면
    // `Err` 가 아니라 `assert_eq!` 로 **패닉**한다(image-0.25 `codecs/png.rs`). 지금 안
    // 터지는 것은 세 가지가 우연히 맞아떨어져서일 뿐이다 — 비트맵 형식이 BGRA 라
    // `as_rgba_bytes` 가 4채널 갈래를 타고, PDFium 의 32bpp stride 가 마침 `width * 4` 라
    // 행 패딩이 없다. 그 함수의 `Gray` 갈래는 이름과 달리 픽셀당 1바이트를 그대로 돌려주므로
    // 누가 속도를 위해 흑백 렌더를 켜는 날 확정 패닉이 된다.
    //
    // 이 자리의 패닉은 500 하나로 끝나지 않는다. `render_png` 는 PDFium 전용 스레드 위에서
    // 돌고 그 스레드는 `OnceLock` 뒤에 있어 다시 뜨지 않는다 — 한 번 터지면 남은 세션의
    // 모든 열기와 모든 렌더가 실패한다. 나쁜 페이지 하나는 500 이면 되지만 죽은 스레드는
    // 기능 전체가 죽은 것이다.
    let expected = u64::from(width) * u64::from(height) * 4;
    if rgba.len() as u64 != expected {
        return Err(PdfRenderError::Failed(tr!(
            "비트맵 버퍼 길이가 맞지 않습니다: {}바이트인데 {width}x{height} RGBA 는 \
             {expected}바이트여야 합니다.",
            "Bitmap buffer length mismatch: {} bytes, but {width}x{height} RGBA \
             needs {expected} bytes.",
            rgba.len()
        )));
    }

    let mut png = Vec::new();
    PngEncoder::new(&mut png)
        .write_image(rgba, width, height, ExtendedColorType::Rgba8)
        .map_err(|err| PdfRenderError::Failed(tr!("PNG 로 인코딩하지 못했습니다: {err}", "Could not encode PNG: {err}")))?;

    Ok(png)
}

/// PDFium 바인딩을 쥔 엔진.
///
/// 이 구조체는 [`crate::pdf::thread`] 의 전용 스레드 안에서만 만들어지고 그 스레드를 떠나지
/// 않는다. PDFium 이 스레드 안전하지 않기 때문이며, 그래서 `Send`/`Sync` 를 달지 않는다.
pub struct PdfEngine {
    /// `'static` 으로 누설시킨 이유: [`PdfDocument`] 는 자신을 만든 [`Pdfium`] 을 빌린다.
    /// 엔진이 문서를 캐시에 담아 두려면 `PdfEngine { pdfium, docs }` 가 자기 자신을 참조하는
    /// 꼴이 되는데, 바인딩은 어차피 프로세스가 끝날 때까지 살아 있으므로 할당 하나를
    /// 누설시켜 그 문제를 없앤다.
    pdfium: &'static Pdfium,
}

impl PdfEngine {
    /// 바인딩. [`super::tools`] 가 새 문서를 만들 때 쓴다.
    pub(crate) fn pdfium(&self) -> &'static Pdfium {
        self.pdfium
    }

    /// 쪽 순서·회전·끼워 넣기를 적용한 새 PDF 를 바이트로 만든다. 원본은 건드리지 않는다.
    pub fn rebuild_pages(&self, source: &PdfDocument, plan: &[PageEditOp]) -> Result<Vec<u8>, String> {
        if plan.is_empty() {
            return Err(tr!("쪽이 하나도 없는 PDF 는 만들 수 없습니다", "Cannot create a PDF with no pages"));
        }
        let mut output = self
            .pdfium
            .create_new_pdf()
            .map_err(|err| tr!("새 PDF 를 만들지 못했습니다: {err}", "Could not create a new PDF: {err}"))?;
        let mut others: HashMap<String, PdfDocument<'static>> = HashMap::new();
        for (index, op) in plan.iter().enumerate() {
            let destination = index as PdfPageIndex;
            let result = match &op.source {
                None => output.pages_mut().copy_page_from_document(source, op.page, destination),
                Some(path) => {
                    if !others.contains_key(path) {
                        let other = self
                            .pdfium
                            .load_pdf_from_file(Path::new(path), None)
                            .map_err(|err| describe_load_error(Path::new(path), &err, false))?;
                        others.insert(path.clone(), other);
                    }
                    let other = others.get(path).expect("방금 넣었다");
                    output.pages_mut().copy_page_from_document(other, op.page, destination)
                }
            };
            result.map_err(|err| tr!("{}쪽을 옮기지 못했습니다: {err}", "Could not move page {}: {err}", op.page + 1))?;
            if op.rotate.rem_euclid(360) != 0 {
                let mut page = output
                    .pages()
                    .get(destination)
                    .map_err(|err| tr!("{}쪽을 돌리지 못했습니다: {err}", "Could not rotate page {}: {err}", index + 1))?;
                let current = page.rotation().map(rotation_degrees).unwrap_or(0);
                page.set_rotation(rotation_from_degrees(current + op.rotate));
            }
        }
        output
            .save_to_bytes()
            .map_err(|err| tr!("편집한 PDF 를 저장하지 못했습니다: {err}", "Could not save the edited PDF: {err}"))
    }

    /// `pdfium.dll` 을 찾아 바인딩한다. 실패하면 사람이 읽을 수 있는 오류를 돌려준다 —
    /// 여기서 패닉하면 사용자는 무엇이 없는지 영영 알 수 없다.
    pub fn new() -> Result<Self, String> {
        let candidates = library_candidates();
        let found = candidates
            .iter()
            .find(|path| path.is_file())
            .ok_or_else(|| missing_library_message(&candidates))?;

        let bindings = Pdfium::bind_to_library(found).map_err(|err| {
            tr!(
                "PDFium 라이브러리를 불러오지 못했습니다: {} ({err})\n\
                 파일이 손상되었거나 아키텍처(x64)가 맞지 않을 수 있습니다.",
                "Could not load the PDFium library: {} ({err})\n\
                 The file may be damaged or built for a different architecture (x64).",
                found.display()
            )
        })?;

        Ok(Self {
            pdfium: Box::leak(Box::new(Pdfium::new(bindings))),
        })
    }

    /// 원본 바이트에 형광펜 주석을 더해 `path` 에 새 파일로 쓴다. 원본 파일과 캐시에 열린
    /// 문서는 건드리지 않는다 — 바이트 사본을 따로 열어 고친다.
    pub fn export_annotated(
        &self,
        source: Vec<u8>,
        highlights: &[ExportHighlight],
        path: &Path,
    ) -> Result<(), String> {
        let document = self
            .pdfium
            .load_pdf_from_byte_vec(source, None)
            .map_err(|err| tr!("PDF 사본을 열지 못했습니다: {err}", "Could not open the PDF copy: {err}"))?;
        let page_count = document.pages().len();

        for highlight in highlights {
            if highlight.page < 0 || highlight.page >= page_count || highlight.rects.is_empty() {
                continue;
            }
            let mut page = document
                .pages()
                .get(highlight.page)
                .map_err(|err| tr!("페이지를 열지 못했습니다: {err}", "Could not open the page: {err}"))?;
            let quarter_turns = quarter_turns_of(&page);
            let (page_width, page_height) = (page.width().value, page.height().value);
            let (ox, oy) = page_origin(&page);
            let quads: Vec<(f32, f32, f32, f32)> = highlight
                .rects
                .iter()
                .map(|rect| {
                    let (l, b, r, t) = pdf_space_rect(*rect, quarter_turns, page_width, page_height);
                    (l + ox, b + oy, r + ox, t + oy)
                })
                .collect();
            let bounds = quads.iter().fold(quads[0], |acc, quad| {
                (
                    acc.0.min(quad.0),
                    acc.1.min(quad.1),
                    acc.2.max(quad.2),
                    acc.3.max(quad.3),
                )
            });

            let mut annotation = page
                .annotations_mut()
                .create_highlight_annotation()
                .map_err(|err| tr!("형광펜 주석을 만들지 못했습니다: {err}", "Could not create the highlight annotation: {err}"))?;
            annotation
                .set_bounds(PdfRect::new_from_values(
                    bounds.1, bounds.0, bounds.3, bounds.2,
                ))
                .map_err(|err| tr!("주석 영역을 정하지 못했습니다: {err}", "Could not set the annotation bounds: {err}"))?;
            for (left, bottom, right, top) in quads {
                let quad =
                    PdfQuadPoints::from_rect(&PdfRect::new_from_values(bottom, left, top, right));
                annotation
                    .attachment_points_mut()
                    .create_attachment_point_at_end(quad)
                    .map_err(|err| tr!("주석 영역을 더하지 못했습니다: {err}", "Could not add the annotation area: {err}"))?;
            }
            let [red, green, blue] = highlight.color;
            annotation
                .set_stroke_color(PdfColor::new(red, green, blue, 255))
                .map_err(|err| tr!("주석 색을 정하지 못했습니다: {err}", "Could not set the annotation color: {err}"))?;
            if let Some(note) = highlight
                .note
                .as_deref()
                .map(str::trim)
                .filter(|note| !note.is_empty())
            {
                annotation
                    .set_contents(note)
                    .map_err(|err| tr!("주석 메모를 적지 못했습니다: {err}", "Could not write the annotation note: {err}"))?;
            }
        }

        document
            .save_to_file(path)
            .map_err(|err| tr!("주석 포함 PDF 를 저장하지 못했습니다: {err}", "Could not save the annotated PDF: {err}"))
    }

    /// OCR 줄을 보이지 않는 글자로 깐 사본을 만든다. 겉모습은 그대로이고, 다른 프로그램(AI
    /// 포함)이 글자를 고르고 찾을 수 있게 된다. 원본은 건드리지 않는다.
    pub fn export_searchable(
        &self,
        source: Vec<u8>,
        pages: &[SearchablePage],
        path: &Path,
    ) -> Result<SearchableReport, String> {
        let mut document = self
            .pdfium
            .load_pdf_from_byte_vec(source, None)
            .map_err(|err| tr!("PDF 사본을 열지 못했습니다: {err}", "Could not open the PDF copy: {err}"))?;
        let unicode_font = find_unicode_font().and_then(|font| {
            document
                .fonts_mut()
                .load_true_type_from_file(&font, true)
                .ok()
        });
        let fallback = document.fonts_mut().helvetica();
        let page_count = document.pages().len();
        let mut report = SearchableReport::default();

        for searchable in pages {
            if searchable.page < 0 || searchable.page >= page_count {
                continue;
            }
            let mut page = document
                .pages()
                .get(searchable.page)
                .map_err(|err| tr!("페이지를 열지 못했습니다: {err}", "Could not open the page: {err}"))?;
            let quarter_turns = quarter_turns_of(&page);
            let (page_ox, page_oy) = page_origin(&page);
            let (page_width, page_height) = (page.width().value, page.height().value);
            for line in &searchable.lines {
                let text = line.text.trim();
                if text.is_empty() || line.w <= 0.0 || line.h <= 0.0 {
                    continue;
                }
                let font = match (text.is_ascii(), unicode_font) {
                    (_, Some(font)) => font,
                    (true, None) => fallback,
                    (false, None) => {
                        report.skipped += 1;
                        continue;
                    }
                };
                let rect = LinkRect {
                    x: line.x,
                    y: line.y,
                    w: line.w,
                    h: line.h,
                };
                let (left, bottom, right, top) =
                    pdf_space_rect(rect, quarter_turns, page_width, page_height);
                let (left, bottom, right, top) = (left + page_ox, bottom + page_oy, right + page_ox, top + page_oy);
                let size = (top - bottom).max(1.0);
                let mut object =
                    PdfPageTextObject::new(&document, text, font, PdfPoints::new(size))
                        .map_err(|err| tr!("글자 층을 만들지 못했습니다: {err}", "Could not create the text layer: {err}"))?;
                object
                    .set_render_mode(PdfPageTextRenderMode::Invisible)
                    .map_err(|err| tr!("글자 층을 숨기지 못했습니다: {err}", "Could not hide the text layer: {err}"))?;
                // 글꼴 폭이 원래 글자와 다르므로 줄 폭에 맞춰 가로로만 늘이거나 줄인다.
                let natural = object.width().map(|width| width.value).unwrap_or(0.0);
                if natural > 0.0 {
                    object
                        .scale((right - left) / natural, 1.0)
                        .map_err(|err| tr!("글자 층 크기를 맞추지 못했습니다: {err}", "Could not size the text layer: {err}"))?;
                }
                // 기준선은 줄 아래쪽에서 글자 높이의 약 1/5 위다.
                object
                    .translate(PdfPoints::new(left), PdfPoints::new(bottom + size * 0.2))
                    .map_err(|err| tr!("글자 층을 옮기지 못했습니다: {err}", "Could not position the text layer: {err}"))?;
                page.objects_mut()
                    .add_text_object(object)
                    .map_err(|err| tr!("글자 층을 넣지 못했습니다: {err}", "Could not add the text layer: {err}"))?;
                report.written += 1;
            }
            page.regenerate_content()
                .map_err(|err| tr!("페이지를 다시 쓰지 못했습니다: {err}", "Could not rewrite the page: {err}"))?;
        }

        document
            .save_to_file(path)
            .map_err(|err| tr!("검색 가능한 PDF 를 저장하지 못했습니다: {err}", "Could not save the searchable PDF: {err}"))?;
        Ok(report)
    }

    /// 문서를 열고 메타를 뽑는다.
    ///
    /// PDFium 은 xref 만 읽고 페이지는 미룬다. 그래서 여는 것 자체는 거의 공짜이고,
    /// 여기서 페이지를 로드하기 시작하면 그 성질이 곧바로 사라진다 — `page_sizes()` 가
    /// 페이지를 로드하지 않는 경로인 이유다.
    ///
    /// 파일 정체성을 인자로 받는 이유: 호출자가 캐시를 먼저 뒤지려면 어차피 해시가 필요하고,
    /// 같은 파일을 두 번 읽을 이유는 없다. [`file_identity`] 로 구한 값을 넘긴다.
    pub fn open(&self, path: &Path, identity: FileIdentity, password: Option<&str>) -> Result<OpenDocument, String> {
        let document = self
            .pdfium
            .load_pdf_from_file(path, password)
            .map_err(|err| describe_load_error(path, &err, password.is_some()))?;

        let pages = document.pages();
        let page_count = pages.len();

        // 페이지를 로드하지 않고 크기만 긁는다(FPDF_GetPageSizeByIndexF).
        let page_sizes = pages
            .page_sizes()
            .map_err(|err| tr!("페이지 크기를 읽지 못했습니다: {err}", "Could not read page sizes: {err}"))?
            .into_iter()
            .map(|rect| (rect.width().value, rect.height().value))
            .collect();

        let has_text = probe_has_text(pages);

        Ok(OpenDocument {
            document,
            doc_id: identity.doc_id,
            sha256: identity.sha256,
            size: identity.size,
            page_count,
            page_sizes,
            has_text,
        })
    }
}

/// 앞쪽 몇 페이지의 글자 수로 텍스트 레이어 유무를 판정한다.
///
/// 글자 수 세기 자체가 실패하면(암호화된 텍스트 등) 없는 것으로 친다 — UI 가 "발췌할 수
/// 있다"고 약속했다가 못 지키는 쪽이 더 나쁘다.
fn probe_has_text(pages: &PdfPages) -> bool {
    let probe = TEXT_PROBE_PAGES.min(pages.len());
    let mut chars = 0usize;

    for index in 0..probe {
        let Ok(page) = pages.get(index) else { continue };
        let Ok(text) = page.text() else { continue };
        chars += text.chars().len();

        if chars >= TEXT_PROBE_MIN_CHARS {
            return true;
        }
    }

    false
}

/// 확장자를 뗀 파일 이름.
pub fn title_for_file(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// 파일 내용 SHA-256 의 앞 12자(스펙 §4.2).
///
/// 경로가 아니라 내용으로 문서를 식별한다 — 같은 스펙 PDF 를 다른 폴더에 복사해 두어도
/// 노트가 가리키는 출처는 하나여야 하기 때문이다.
pub struct FileIdentity {
    pub doc_id: String,
    pub sha256: String,
    pub size: u64,
}

pub fn file_identity(path: &Path) -> Result<FileIdentity, String> {
    let mut file = File::open(path)
        .map_err(|err| tr!("파일을 열 수 없습니다: {} ({err})", "Cannot open file: {} ({err})", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; HASH_BUF_BYTES];
    let mut size = 0u64;

    loop {
        let read = file
            .read(&mut buf)
            .map_err(|err| tr!("파일을 읽는 중 오류: {} ({err})", "Error while reading file: {} ({err})", path.display()))?;
        if read == 0 {
            break;
        }
        size += read as u64;
        hasher.update(&buf[..read]);
    }

    let sha256 = hex(&hasher.finalize());
    Ok(FileIdentity {
        doc_id: sha256[..12].to_string(),
        sha256,
        size,
    })
}

fn hex(digest: &[u8]) -> String {
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// 암호 걸린 문서와 그냥 깨진 문서는 사용자가 할 수 있는 일이 다르므로 구분해서 말한다.
/// 암호가 필요하다는 오류의 머리말. 웹뷰가 이것을 보고 암호를 묻는다.
pub const PASSWORD_REQUIRED: &str = "IWAE_PDF_PASSWORD_REQUIRED";
/// 준 암호가 틀렸다는 오류의 머리말.
pub const PASSWORD_WRONG: &str = "IWAE_PDF_PASSWORD_WRONG";

fn describe_load_error(path: &Path, err: &PdfiumError, tried_password: bool) -> String {
    let name = path.display();

    match err {
        PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::PasswordError) => {
            if tried_password {
                format!("{PASSWORD_WRONG}: {}", tr!("암호가 맞지 않습니다: {name}", "Wrong password: {name}"))
            } else {
                format!("{PASSWORD_REQUIRED}: {}", tr!("암호로 보호된 PDF 입니다: {name}", "This PDF is password-protected: {name}"))
            }
        }
        PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::FormatError) => {
            tr!(
                "PDF 형식이 아니거나 파일이 손상되었습니다: {name}",
                "Not a PDF, or the file is damaged: {name}"
            )
        }
        PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::FileError) => {
            tr!("파일을 읽을 수 없습니다: {name}", "Cannot read file: {name}")
        }
        other => tr!("PDF 를 열지 못했습니다: {name} ({other})", "Could not open the PDF: {name} ({other})"),
    }
}

/// `pdfium.dll` 을 찾아볼 자리들.
///
/// 배포본에서는 `bundle.resources` 가 실행 파일 옆 `binaries/` 로 넣고, 개발·테스트에서는
/// 크레이트 안의 `src-tauri/binaries/` 에 있다.
fn library_candidates() -> Vec<PathBuf> {
    let name = Pdfium::pdfium_platform_library_name();
    let mut paths = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("binaries").join(&name));
            paths.push(dir.join(&name));
            // macOS 앱 묶음: 실행 파일은 `IWAE.app/Contents/MacOS/`, `bundle.resources` 는
            // `IWAE.app/Contents/Resources/` 아래에 들어간다
            #[cfg(target_os = "macos")]
            if let Some(contents) = dir.parent() {
                paths.push(contents.join("Resources").join("binaries").join(&name));
                paths.push(contents.join("Resources").join(&name));
            }
        }
    }

    // 크레이트 안의 `binaries/` 는 개발·테스트에서만 의미가 있다. 배포본에 남기면 찾은 자리를
    // 나열하는 오류 메시지에 빌드한 기계의 절대 경로가 그대로 찍힌다 — 사용자에게는 쓸모가
    // 없고, 우리 쪽 디렉터리 구조만 흘린다.
    #[cfg(debug_assertions)]
    paths.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(&name),
    );

    paths
}

fn missing_library_message(candidates: &[PathBuf]) -> String {
    let looked = candidates
        .iter()
        .map(|path| format!("  - {}", path.display()))
        .collect::<Vec<_>>()
        .join("\n");

    tr!(
        "PDFium 라이브러리({})를 찾지 못했습니다. 찾아본 자리:\n{looked}\n\
         https://github.com/bblanchon/pdfium-binaries 에서 내려받아 src-tauri/binaries/ 에 두세요.",
        "Could not find the PDFium library ({}). Looked in:\n{looked}\n\
         Download it from https://github.com/bblanchon/pdfium-binaries and put it in src-tauri/binaries/.",
        Pdfium::pdfium_platform_library_name().to_string_lossy()
    )
}
#[cfg(test)]
mod tests {
    use super::*;

    /// A4 를 최대 폭으로 그리는 것은 통과해야 한다. 상한이 여기까지 내려오면 정상 문서가
    /// 안 보이기 시작한다.
    #[test]
    fn an_ordinary_page_at_the_maximum_width_passes() {
        assert_eq!(check_output_size((612.0, 792.0), MAX_RENDER_WIDTH), Ok(()));
        assert_eq!(check_output_size((612.0, 792.0), 1400), Ok(()));
        // 가로로 긴 페이지도 문제가 아니다 — 위험한 쪽은 높이다.
        assert_eq!(check_output_size((2000.0, 200.0), MAX_RENDER_WIDTH), Ok(()));
    }

    /// 리뷰가 든 바로 그 페이지. MediaBox [0 0 200 2000] 을 w=3000 으로 부르면
    /// 3000x30000 = 360MB 비트맵이고, 인코딩 순간에는 그 세 벌이 산다.
    #[test]
    fn a_tall_narrow_page_is_rejected_before_anything_is_allocated() {
        assert_eq!(
            check_output_size((200.0, 2000.0), 3000),
            Err(PdfRenderError::OutputTooLarge {
                width: 3000,
                height: 30_000,
            })
        );

        // MediaBox 의 법적 최대치(14400 units)까지 늘린 모양. 웹뷰가 실제로 쓰는 폭에서도
        // 거절되어야 한다.
        assert!(matches!(
            check_output_size((200.0, 14400.0), 1400),
            Err(PdfRenderError::OutputTooLarge { .. })
        ));

        // 같은 페이지라도 폭을 줄이면 통과한다 — 문서가 아니라 요청을 거절하는 것이다.
        assert_eq!(check_output_size((200.0, 2000.0), 400), Ok(()));
    }

    /// 상한의 양 끝. 정확히 상한이면 통과하고 한 픽셀 더면 거절이다.
    #[test]
    fn the_pixel_bound_is_inclusive() {
        // 4800 x 7500 = 36,000,000 — 정확히 상한.
        assert_eq!(check_output_size((4800.0, 7500.0), 4800), Ok(()));
        // 4800 x 7501 — 한 줄 넘겼다.
        assert_eq!(
            check_output_size((4800.0, 7501.0), 4800),
            Err(PdfRenderError::OutputTooLarge {
                width: 4800,
                height: 7501,
            })
        );
    }

    /// 문서에서 온 값이라 0 이나 NaN 일 수 있다. 비율을 낼 수 없으면 그리지 않는다.
    #[test]
    fn a_degenerate_page_size_never_reaches_pdfium() {
        assert!(matches!(
            check_output_size((0.0, 792.0), 800),
            Err(PdfRenderError::Failed(_))
        ));
        assert!(matches!(
            check_output_size((612.0, f32::NAN), 800),
            Err(PdfRenderError::Failed(_))
        ));
        assert!(matches!(
            check_output_size((-612.0, 792.0), 800),
            Err(PdfRenderError::Failed(_))
        ));
        // 반올림해서 0 이 되는 높이도 마찬가지다. `as_rgba_bytes` 가 높이로 나누므로
        // 0 짜리 비트맵은 곧 0 나누기 패닉이다.
        assert!(matches!(
            check_output_size((14400.0, 1.0), MIN_RENDER_WIDTH),
            Err(PdfRenderError::Failed(_))
        ));
    }

    /// 길이가 어긋난 버퍼는 인코더의 `assert_eq!` 에 닿기 전에 오류가 되어야 한다.
    /// 여기서 패닉하면 500 하나가 아니라 PDFium 스레드 전체를 잃는다.
    #[test]
    fn a_buffer_of_the_wrong_length_is_an_error_not_a_panic() {
        // 4x4 RGBA 는 64바이트여야 한다.
        assert!(matches!(
            encode_png(&[0u8; 63], 4, 4),
            Err(PdfRenderError::Failed(_))
        ));
        assert!(matches!(
            encode_png(&[0u8; 65], 4, 4),
            Err(PdfRenderError::Failed(_))
        ));
        // `as_rgba_bytes` 의 Gray 갈래가 돌려주는 모양(픽셀당 1바이트).
        assert!(matches!(
            encode_png(&[0u8; 16], 4, 4),
            Err(PdfRenderError::Failed(_))
        ));
        // 음수 크기도 패닉이 아니라 오류다.
        assert!(matches!(
            encode_png(&[0u8; 64], -4, 4),
            Err(PdfRenderError::Failed(_))
        ));

        // 길이가 맞으면 정말로 PNG 가 나온다.
        let png = encode_png(&[0u8; 64], 4, 4).expect("길이가 맞으면 인코딩된다");
        assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
    }

    /// A4 세로 페이지. 여기 쓰인 숫자는 지어낸 것이 아니라 스파이크가 실제로 찍은 값이다 —
    /// 792pt 높이 페이지의 `40 700 Td` 자리에 12pt Helvetica 로 찍은 'H' 의 loose 상자가
    /// `l=40.00 b=697.47 r=48.66 t=710.86` 이었다.
    const H_GLYPH: (f32, f32, f32, f32) = (40.00, 697.47, 48.66, 710.86);
    const A4: (f32, f32) = (612.0, 792.0);

    /// 돌아가지 않은 A4 페이지에 놓고 옮긴다.
    fn unrotated(glyph: (f32, f32, f32, f32)) -> (f32, f32, f32, f32) {
        displayed_box(glyph.0, glyph.1, glyph.2, glyph.3, 0, A4.0, A4.1)
    }

    /// 페이지 위쪽에 찍힌 글자는 작은 y 를 받아야 한다. 이 단언이 두 규약을 갈라놓는 자리다 —
    /// 뒤집지 않았다면 697.47, 즉 페이지 아래쪽 88% 지점이 나온다.
    #[test]
    fn a_box_near_the_top_of_the_page_gets_a_small_y() {
        let (x, y, w, h) = unrotated(H_GLYPH);

        assert_eq!(x, 40.00);
        assert!((y - 81.14).abs() < 0.01, "위에서 잰 거리여야 한다: {y}");
        assert!((w - 8.66).abs() < 0.01, "{w}");
        assert!((h - 13.39).abs() < 0.01, "{h}");
        assert!(y < A4.1 / 2.0, "페이지 위쪽에 찍힌 글자다");
    }

    /// 아래에 찍힌 줄이 더 큰 y 를 받아야 한다. y 가 아래로 증가한다는 말의 전부다.
    #[test]
    fn a_lower_line_gets_a_larger_y() {
        // 같은 페이지의 둘째 줄(20pt 아래). 스파이크가 찍은 값 그대로다.
        let (_, first, _, _) = unrotated(H_GLYPH);
        let (_, second, _, _) = unrotated((40.00, 677.47, 51.33, 690.86));

        assert!(
            second > first,
            "아래 줄이 더 커야 한다: {first} -> {second}"
        );
        assert!((second - first - 20.0).abs() < 0.01, "간격은 그대로 20pt");
    }

    /// 면적 0 인 상자는 옮겨도 면적 0 이다. PDFium 이 끼워 넣는 줄바꿈 글자가 이 모양이라
    /// 실제로 자주 지나간다 — 여기서 폭이나 높이가 음수로 새면 히트 테스트가 엉킨다.
    #[test]
    fn a_zero_area_box_survives_the_transform() {
        // 스파이크가 찍은 '\r' 의 상자: 줄 끝 한 점.
        let (x, y, w, h) = unrotated((67.34, 700.0, 67.34, 700.0));

        assert_eq!((x, w, h), (67.34, 0.0, 0.0));
        assert!((y - 92.0).abs() < 0.01, "{y}");
    }

    /// `/Rotate 90` 페이지. 돌리지 않으면 y 가 음수로 나온다 — 픽스처에서 실제로 `-98.86` 을
    /// 봤다. 세로 페이지 왼쪽 위에 있던 글자는 시계 방향으로 한 번 돌면 가로 페이지의
    /// **오른쪽 위**로 가고, 글자가 눕기 때문에 상자의 폭과 높이도 서로 바뀐다.
    #[test]
    fn a_rotated_page_puts_its_boxes_where_the_rendered_image_is() {
        // page_sizes 는 돌아간 뒤 크기 = 792x612.
        let (x, y, w, h) = displayed_box(H_GLYPH.0, H_GLYPH.1, H_GLYPH.2, H_GLYPH.3, 1, A4.1, A4.0);
        let (ux, uy, uw, uh) = unrotated(H_GLYPH);

        assert!((x - (A4.1 - uy - uh)).abs() < 0.01, "오른쪽 끝 근처: {x}");
        assert!((y - ux).abs() < 0.01, "돌기 전의 x 가 y 가 된다: {y}");
        assert!((w - uh).abs() < 0.01, "폭과 높이가 바뀐다: {w}");
        assert!((h - uw).abs() < 0.01, "{h}");

        // 무엇보다 — 상자가 페이지 안에 있고 크기가 양수여야 한다.
        assert!(x >= 0.0 && x + w <= A4.1, "{x} + {w}");
        assert!(y >= 0.0 && y + h <= A4.0, "{y} + {h}");
        assert!(w > 0.0 && h > 0.0);
    }

    /// 네 방향 모두. 어느 쪽으로 돌든 상자는 페이지 안에 있고 크기는 양수이며 면적은 같다.
    #[test]
    fn every_rotation_keeps_boxes_inside_the_page_with_positive_size() {
        let (_, _, uw, uh) = unrotated(H_GLYPH);

        for turns in 0..4u8 {
            // 홀수 번 돌아간 페이지는 page_sizes 의 폭과 높이가 바뀐다.
            let (page_w, page_h) = if turns % 2 == 1 { (A4.1, A4.0) } else { A4 };
            let (x, y, w, h) = displayed_box(
                H_GLYPH.0, H_GLYPH.1, H_GLYPH.2, H_GLYPH.3, turns, page_w, page_h,
            );

            assert!(w > 0.0 && h > 0.0, "{turns}번: 크기가 양수여야 한다");
            assert!(x >= 0.0 && x + w <= page_w, "{turns}번: x={x} w={w}");
            assert!(y >= 0.0 && y + h <= page_h, "{turns}번: y={y} h={h}");
            assert!((w * h - uw * uh).abs() < 0.01, "{turns}번: 면적이 달라졌다");
        }
    }

    /// NaN 이 그대로 나가면 `serde_json` 이 `null` 로 적고, 숫자를 기대하는 쪽에서 터진다.
    #[test]
    fn a_non_finite_coordinate_collapses_instead_of_becoming_null() {
        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            for slot in 0..4 {
                let mut glyph = [0.0f32, 0.0, 10.0, 10.0];
                glyph[slot] = bad;
                assert_eq!(
                    displayed_box(glyph[0], glyph[1], glyph[2], glyph[3], 0, A4.0, A4.1),
                    (0.0, 0.0, 0.0, 0.0),
                    "{slot}번 자리의 {bad}"
                );
            }
        }

        // 옮겨 나온 값이 유한한지도 같이 본다 — 성한 값만 들어오면 성한 값만 나간다.
        let (x, y, w, h) = unrotated((1.0, 2.0, 3.0, 4.0));
        assert!(x.is_finite() && y.is_finite() && w.is_finite() && h.is_finite());
    }

    /// 인덱스 약속의 뿌리. 여기서 나온 글자는 언제나 UTF-16 한 칸이어야 한다.
    #[test]
    fn every_char_costs_exactly_one_utf16_unit() {
        // BMP 안이면 그대로 지나간다 — 라틴·한글·CJK·조합용 낱자 모두.
        for c in ['A', ' ', '\r', '가', '한', '漢', '\u{0301}', '\u{FFFD}'] {
            assert_eq!(bmp_char(Some(c)), c, "{c:?} 는 그대로여야 한다");
        }

        // BMP 밖(코드 단위 두 칸)은 대체 문자가 된다. 이걸 그대로 내보내면 `chars` 의 인덱스와
        // JS 의 `slice` 오프셋이 이 글자 뒤로 영영 한 칸씩 어긋난다.
        assert_eq!(bmp_char(Some('𝄞')), char::REPLACEMENT_CHARACTER);
        assert_eq!(bmp_char(Some('😀')), char::REPLACEMENT_CHARACTER);

        // `char::from_u32` 가 거절한 값(서로게이트 반쪽 등)도 같은 자리로 간다.
        assert_eq!(bmp_char(None), char::REPLACEMENT_CHARACTER);

        // 약속 그 자체.
        for input in [Some('A'), Some('가'), Some('𝄞'), Some('😀'), None] {
            assert_eq!(bmp_char(input).len_utf16(), 1, "{input:?}");
        }
    }
}

