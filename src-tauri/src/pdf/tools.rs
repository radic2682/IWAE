//! PDF 도구(Stirling-PDF 의 도구 목록 가운데 IWAE 에 맞는 것): 보이지 않는 OCR 글자 층, 내 표시 굽기,
//! 가리기, 쪽 뽑기·합치기, 쪽 번호, 워터마크, 여백 자르기, 모아찍기, 암호 풀기, 빈 쪽 찾기, 그림으로 내보내기.
//!
//! 모두 PDFium 스레드 안에서만 돈다. 원본 문서(캐시에 열린 것)는 건드리지 않고, 고치는 도구는 바이트
//! 사본을 따로 열어 고친 뒤 새 바이트를 돌려준다. 그 바이트를 원본 자리에 덮을지(백업을 남기고),
//! 새 파일로 쓸지는 [`super::thread`] 가 정한다.

use std::collections::HashMap;
use std::path::Path;

use image::{DynamicImage, Rgba, RgbaImage};
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};

use super::engine::{
    find_unicode_font, page_origin, pdf_space_rect, quarter_turns, ExportHighlight, LinkRect, PdfEngine,
    SearchablePage, SearchableReport,
};

/// 도구 하나. 웹뷰에서 `{ kind: "...", ... }` 로 온다.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ToolOp {
    /// 글자 층이 없는 쪽에 OCR 줄을 보이지 않는 글자로 깐다.
    Searchable { pages: Vec<SearchablePage> },
    /// 형광펜·덮개(글 상자·선·펜·도형)·메모를 PDF 에 굽고, 가리기 상자는 정말로 지운다.
    Flatten {
        #[serde(default)]
        highlights: Vec<ExportHighlight>,
        #[serde(default)]
        overlays: Vec<FlatOverlay>,
        #[serde(default)]
        notes: Vec<FlatNote>,
        #[serde(default)]
        redactions: Vec<Redaction>,
    },
    /// 고른 쪽(0 부터, 이 순서대로)만 담은 새 PDF.
    Extract { pages: Vec<i32> },
    /// 이 문서 뒤에 다른 PDF 들을 차례로 붙인다.
    Merge { sources: Vec<String> },
    /// 쪽 번호. `template` 의 `{n}` 은 쪽 번호, `{total}` 은 전체 쪽 수.
    PageNumbers {
        position: NumberPosition,
        start: i32,
        template: String,
        size: f32,
        #[serde(default)]
        skip_first: bool,
    },
    /// 쪽 가운데에 비스듬히 옅은 글자.
    Watermark { text: String, size: f32, opacity: f32, angle: f32, color: String },
    /// 보이는 쪽 기준 여백(points)을 잘라 낸다(CropBox).
    Crop { left: f32, top: f32, right: f32, bottom: f32 },
    /// 한 장에 여러 쪽(모아찍기). A4.
    NUp { columns: u8, rows: u8, landscape: bool },
    /// 암호를 뺀 사본(쪽을 새 문서로 옮긴다).
    Unlock,
    /// 쪽에 놓인 크기보다 해상도가 높은 그림(`max_dpi` 초과)을 줄여 JPEG(`quality` 1~100)로 다시 담는다.
    /// 글자·벡터는 그대로 두고, 줄어들지 않으면 사본을 만들지 않는다.
    Compress { max_dpi: f32, quality: u8 },
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NumberPosition {
    BottomCenter,
    BottomRight,
    BottomLeft,
    TopCenter,
    TopRight,
    TopLeft,
}

/// 굽는 덮개. 좌표는 화면 좌표(왼쪽 위 원점, 돌아간 뒤, points) — 웹뷰가 저장하는 그대로다.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FlatOverlay {
    Text {
        page: i32,
        x: f32,
        y: f32,
        w: f32,
        text: String,
        size: f32,
        color: String,
        #[serde(default)]
        bold: bool,
        #[serde(default)]
        fill: Option<String>,
        #[serde(default)]
        border: bool,
    },
    Line {
        page: i32,
        x1: f32,
        y1: f32,
        x2: f32,
        y2: f32,
        color: String,
        width: f32,
        #[serde(default)]
        arrow: bool,
        #[serde(default)]
        arrow_start: bool,
        #[serde(default)]
        dashed: bool,
        #[serde(default)]
        dotted: bool,
    },
    Ink {
        page: i32,
        points: Vec<(f32, f32)>,
        color: String,
        width: f32,
    },
    Shape {
        page: i32,
        shape: String,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        color: String,
        width: f32,
        #[serde(default)]
        fill: bool,
        #[serde(default)]
        dashed: bool,
        #[serde(default)]
        dotted: bool,
    },
}

/// 쪽 위 메모(박스 메모·핀). PDF 의 붙임 쪽지 주석으로 넣는다.
#[derive(Debug, Clone, Deserialize)]
pub struct FlatNote {
    pub page: i32,
    pub rect: LinkRect,
    pub text: String,
}

/// 가릴 곳(화면 좌표).
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Redaction {
    pub page: i32,
    pub rect: LinkRect,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolReport {
    /// OCR 글자 층에 넣은 줄 수 등 도구마다 센 것
    pub written: usize,
    /// 유니코드 글꼴이 없어 빠뜨린 줄 수
    pub skipped: usize,
    /// 그림으로 바꿔 가린 쪽 수
    pub rasterized: usize,
    /// 줄여서 다시 담은 그림 수(압축)
    pub compressed: usize,
    /// 압축 전·후 파일 크기(바이트). 압축 도구만 채운다
    pub size_before: u64,
    pub size_after: u64,
}

/// 가린 쪽을 그림으로 바꿀 때의 해상도(dpi)
const REDACT_DPI: f32 = 200.0;
/// 쪽 번호를 쪽 가장자리에서 얼마나 띄울까(points)
const NUMBER_MARGIN: f32 = 24.0;

fn tool_err(what: &str) -> impl Fn(PdfiumError) -> String + '_ {
    move |err| format!("{what}: {err}")
}

/// `#rrggbb` → 색. 못 읽으면 검정.
pub fn parse_color(value: &str, alpha: u8) -> PdfColor {
    let hex = value.trim().trim_start_matches('#');
    if hex.len() == 6 {
        if let Ok(rgb) = u32::from_str_radix(hex, 16) {
            return PdfColor::new((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8, alpha);
        }
    }
    PdfColor::new(0, 0, 0, alpha)
}

/// 화면 좌표의 점 하나 → PDF 사용자 공간.
fn to_pdf_point(x: f32, y: f32, geometry: &PageGeometry) -> (f32, f32) {
    let (left, bottom, _, _) = pdf_space_rect(LinkRect { x, y, w: 0.0, h: 0.0 }, geometry.turns, geometry.width, geometry.height);
    (left + geometry.origin.0, bottom + geometry.origin.1)
}

/// 화면 좌표의 사각형 → PDF 사용자 공간 `PdfRect`.
fn to_pdf_rect(rect: LinkRect, geometry: &PageGeometry) -> PdfRect {
    let (left, bottom, right, top) = pdf_space_rect(rect, geometry.turns, geometry.width, geometry.height);
    let (ox, oy) = geometry.origin;
    PdfRect::new_from_values(bottom + oy, left + ox, top + oy, right + ox)
}

#[derive(Debug, Clone, Copy)]
struct PageGeometry {
    turns: u8,
    /// 돌아간 뒤(보이는) 크기
    width: f32,
    height: f32,
    origin: (f32, f32),
}

fn geometry_of(page: &PdfPage) -> PageGeometry {
    PageGeometry {
        turns: quarter_turns(page),
        width: page.width().value,
        height: page.height().value,
        origin: page_origin(page),
    }
}

impl PdfEngine {
    /// 열린 문서의 바이트 사본을 고쳐 새 PDF 바이트를 만든다. `password` 는 암호 PDF 를 열었던 그 암호.
    pub fn run_tool(&self, source: &PdfDocument, source_bytes: impl FnOnce() -> Result<Vec<u8>, String>, password: Option<&str>, op: &ToolOp) -> Result<(Vec<u8>, ToolReport), String> {
        let pdfium = self.pdfium();
        match op {
            ToolOp::Extract { pages } => {
                let count = source.pages().len();
                let picked: Vec<i32> = pages.iter().copied().filter(|page| (0..count).contains(page)).collect();
                if picked.is_empty() {
                    return Err(tr!("뽑을 쪽이 없습니다", "No pages to extract"));
                }
                let mut output = pdfium.create_new_pdf().map_err(tool_err("new PDF"))?;
                for (index, page) in picked.iter().enumerate() {
                    output
                        .pages_mut()
                        .copy_page_from_document(source, *page, index as PdfPageIndex)
                        .map_err(|err| tr!("{}쪽을 옮기지 못했습니다: {err}", "Could not copy page {}: {err}", page + 1))?;
                }
                let report = ToolReport { written: picked.len(), ..ToolReport::default() };
                Ok((output.save_to_bytes().map_err(tool_err("save"))?, report))
            }
            ToolOp::Merge { sources } => {
                let mut output = pdfium.create_new_pdf().map_err(tool_err("new PDF"))?;
                output.pages_mut().append(source).map_err(tool_err("append"))?;
                for path in sources {
                    let other = pdfium
                        .load_pdf_from_file(Path::new(path), None)
                        .map_err(|err| tr!("합칠 PDF 를 열지 못했습니다: {path} ({err})", "Could not open a PDF to merge: {path} ({err})"))?;
                    output.pages_mut().append(&other).map_err(tool_err("append"))?;
                }
                let report = ToolReport { written: output.pages().len() as usize, ..ToolReport::default() };
                Ok((output.save_to_bytes().map_err(tool_err("save"))?, report))
            }
            ToolOp::NUp { columns, rows, landscape } => {
                let columns = (*columns).clamp(1, 4);
                let rows = (*rows).clamp(1, 4);
                let paper = if *landscape { PdfPagePaperSize::a4().landscape() } else { PdfPagePaperSize::a4() };
                let tiled = source
                    .pages()
                    .tile_into_new_document(rows, columns, paper)
                    .map_err(|err| tr!("모아찍기를 만들지 못했습니다: {err}", "Could not create the N-up layout: {err}"))?;
                let report = ToolReport { written: tiled.pages().len() as usize, ..ToolReport::default() };
                Ok((tiled.save_to_bytes().map_err(tool_err("save"))?, report))
            }
            ToolOp::Unlock => {
                let mut output = pdfium.create_new_pdf().map_err(tool_err("new PDF"))?;
                output.pages_mut().append(source).map_err(tool_err("append"))?;
                let report = ToolReport { written: output.pages().len() as usize, ..ToolReport::default() };
                Ok((output.save_to_bytes().map_err(tool_err("save"))?, report))
            }
            _ => {
                let bytes = source_bytes()?;
                let source_len = bytes.len() as u64;
                let mut document = pdfium
                    .load_pdf_from_byte_vec(bytes, password)
                    .map_err(|err| tr!("PDF 사본을 열지 못했습니다: {err}", "Could not open the PDF copy: {err}"))?;
                let report = match op {
                    ToolOp::Searchable { pages } => {
                        let found = add_searchable_layer(&mut document, pages)?;
                        ToolReport { written: found.written, skipped: found.skipped, ..ToolReport::default() }
                    }
                    ToolOp::Flatten { highlights, overlays, notes, redactions } => flatten(&mut document, highlights, overlays, notes, redactions)?,
                    ToolOp::PageNumbers { position, start, template, size, skip_first } => add_page_numbers(&mut document, *position, *start, template, *size, *skip_first)?,
                    ToolOp::Watermark { text, size, opacity, angle, color } => add_watermark(&mut document, text, *size, *opacity, *angle, color)?,
                    ToolOp::Crop { left, top, right, bottom } => crop_pages(&mut document, *left, *top, *right, *bottom)?,
                    ToolOp::Compress { max_dpi, quality } => {
                        let before = source_len;
                        let mut report = compress_images(&mut document, *max_dpi, *quality)?;
                        let saved = document.save_to_bytes().map_err(tool_err("save"))?;
                        report.size_before = before;
                        report.size_after = saved.len() as u64;
                        // 줄지 않았으면 사본을 만들 이유가 없다
                        if report.compressed == 0 || report.size_after >= report.size_before {
                            return Err(tr!(
                                "이 PDF 는 더 줄일 수 없습니다(줄일 만큼 큰 그림이 없습니다).",
                                "This PDF cannot be made smaller (it has no images large enough to shrink)."
                            ));
                        }
                        return Ok((saved, report));
                    }
                    _ => unreachable!("위에서 처리했다"),
                };
                Ok((document.save_to_bytes().map_err(tool_err("save"))?, report))
            }
        }
    }
}

/// 이 픽셀 수보다 작은 그림(아이콘·로고)은 건드리지 않는다
const COMPRESS_MIN_PIXELS: u64 = 120_000;
/// 목표 해상도를 이만큼(비율) 넘어야 줄인다. 조금 넘는 그림을 다시 인코딩하면 화질만 잃는다
const COMPRESS_TRIGGER: f32 = 1.2;

/// 쪽에 놓인 크기에 비해 해상도가 높은 그림을 `max_dpi` 로 줄여 JPEG 로 다시 담는다.
/// 투명(마스크)이 있는 그림, 이미 충분히 작은 그림, 다시 담아도 커지는 그림은 그대로 둔다.
fn compress_images(document: &mut PdfDocument, max_dpi: f32, quality: u8) -> Result<ToolReport, String> {
    let max_dpi = max_dpi.clamp(36.0, 600.0);
    let quality = quality.clamp(20, 95);
    let mut report = ToolReport::default();
    let page_count = document.pages().len();

    for page_index in 0..page_count {
        let mut page = document
            .pages()
            .get(page_index)
            .map_err(|err| tr!("페이지를 열지 못했습니다: {err}", "Could not open the page: {err}"))?;
        let mut changed = false;
        // 먼저 줄일 그림과 새 JPEG 를 모은다(쪽을 빌려 읽는 동안에는 고치지 못한다)
        let mut jobs: Vec<(PdfPageObjectIndex, Vec<u8>, PdfMatrix)> = Vec::new();
        {
            let objects = page.objects();
            for index in 0..objects.len() {
                let Ok(object) = objects.get(index) else { continue };
                let Some(image) = object.as_image_object() else { continue };
                let Some(jpeg) = shrunk_jpeg(document, image, max_dpi, quality) else { continue };
                let Ok(matrix) = image.matrix() else { continue };
                jobs.push((index, jpeg, matrix));
            }
        }
        for (index, jpeg, matrix) in jobs {
            let Ok(mut replacement) = PdfPageImageObject::new_from_jpeg_reader(document, std::io::Cursor::new(jpeg)) else { continue };
            if replacement.reset_matrix(matrix).is_err() {
                continue;
            }
            // 같은 자리(겹침 순서 그대로)에 새 그림을 넣고 옛 그림을 뺀다
            let Ok(old) = page.objects_mut().remove_object_at_index(index) else { continue };
            if page.objects_mut().insert_object_at_index(index, PdfPageObject::Image(replacement)).is_err() {
                // 넣지 못하면 옛 그림을 되돌려 놓는다
                let _ = page.objects_mut().insert_object_at_index(index, old);
                continue;
            }
            report.compressed += 1;
            changed = true;
        }
        if changed {
            page.regenerate_content()
                .map_err(|err| tr!("페이지를 다시 쓰지 못했습니다: {err}", "Could not rewrite the page: {err}"))?;
        }
    }
    Ok(report)
}

/// 이 그림을 목표 해상도로 줄여 JPEG 로 인코딩한다. 줄일 이유가 없으면 None.
fn shrunk_jpeg(document: &PdfDocument, image: &PdfPageImageObject, max_dpi: f32, quality: u8) -> Option<Vec<u8>> {
    let width = u32::try_from(image.width().ok()?).ok()?;
    let height = u32::try_from(image.height().ok()?).ok()?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) < COMPRESS_MIN_PIXELS {
        return None;
    }
    let dpi = image.horizontal_dpi().ok()?.max(image.vertical_dpi().ok()?);
    if !dpi.is_finite() || dpi <= max_dpi * COMPRESS_TRIGGER {
        return None;
    }
    // 투명한 부분이 있거나 돌아가 있으면 보이는 그림을 그대로 알 수 없으니 건드리지 않는다
    let probe = image.get_processed_image_with_width(document, 24.try_into().ok()?).ok()?;
    if probe.to_rgba8().pixels().any(|pixel| pixel.0[3] < 255) {
        return None;
    }
    let original = image.get_raw_image_data().ok()?.len();
    let raw = image.get_raw_image().ok()?;
    let scale = max_dpi / dpi;
    let target_width = ((width as f32 * scale).round() as u32).max(1);
    let target_height = ((height as f32 * scale).round() as u32).max(1);
    let small = raw.resize_exact(target_width, target_height, image::imageops::FilterType::Triangle);
    let mut jpeg = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, quality);
    let ok = if small.color().has_color() {
        small.to_rgb8().write_with_encoder(encoder).is_ok()
    } else {
        small.to_luma8().write_with_encoder(encoder).is_ok()
    };
    // 압축한 뒤가 처음보다 작을 때만 바꾼다
    (ok && jpeg.len() < original).then_some(jpeg)
}

/// 보이지 않는 OCR 글자 층(검색 가능한 PDF). 이미 글자가 있는 쪽은 부르는 쪽이 빼고 보낸다.
pub fn add_searchable_layer(document: &mut PdfDocument, pages: &[SearchablePage]) -> Result<SearchableReport, String> {
    let unicode_font = find_unicode_font().and_then(|font| document.fonts_mut().load_true_type_from_file(&font, true).ok());
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
        let geometry = geometry_of(&page);
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
            let rect = to_pdf_rect(LinkRect { x: line.x, y: line.y, w: line.w, h: line.h }, &geometry);
            let (left, bottom, right, top) = (rect.left().value, rect.bottom().value, rect.right().value, rect.top().value);
            let size = (top - bottom).max(1.0);
            let mut object = PdfPageTextObject::new(document, text, font, PdfPoints::new(size))
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
    Ok(report)
}

/// 형광펜을 PDF 형광펜 주석으로 넣는다(메모는 주석 내용으로).
pub fn add_highlight_annotations(document: &PdfDocument, highlights: &[ExportHighlight]) -> Result<(), String> {
    let page_count = document.pages().len();
    for highlight in highlights {
        if highlight.page < 0 || highlight.page >= page_count || highlight.rects.is_empty() {
            continue;
        }
        let mut page = document
            .pages()
            .get(highlight.page)
            .map_err(|err| tr!("페이지를 열지 못했습니다: {err}", "Could not open the page: {err}"))?;
        let geometry = geometry_of(&page);
        let rects: Vec<PdfRect> = highlight.rects.iter().map(|rect| to_pdf_rect(*rect, &geometry)).collect();
        let bounds = rects.iter().skip(1).fold(rects[0], |acc, rect| {
            PdfRect::new_from_values(
                acc.bottom().value.min(rect.bottom().value),
                acc.left().value.min(rect.left().value),
                acc.top().value.max(rect.top().value),
                acc.right().value.max(rect.right().value),
            )
        });
        let mut annotation = page
            .annotations_mut()
            .create_highlight_annotation()
            .map_err(|err| tr!("형광펜 주석을 만들지 못했습니다: {err}", "Could not create the highlight annotation: {err}"))?;
        annotation
            .set_bounds(bounds)
            .map_err(|err| tr!("주석 영역을 정하지 못했습니다: {err}", "Could not set the annotation bounds: {err}"))?;
        for rect in rects {
            annotation
                .attachment_points_mut()
                .create_attachment_point_at_end(PdfQuadPoints::from_rect(&rect))
                .map_err(|err| tr!("주석 영역을 더하지 못했습니다: {err}", "Could not add the annotation area: {err}"))?;
        }
        let [red, green, blue] = highlight.color;
        annotation
            .set_stroke_color(PdfColor::new(red, green, blue, 255))
            .map_err(|err| tr!("주석 색을 정하지 못했습니다: {err}", "Could not set the annotation color: {err}"))?;
        if let Some(note) = highlight.note.as_deref().map(str::trim).filter(|note| !note.is_empty()) {
            annotation
                .set_contents(note)
                .map_err(|err| tr!("주석 메모를 적지 못했습니다: {err}", "Could not write the annotation note: {err}"))?;
        }
    }
    Ok(())
}

/// 내 표시 굽기. 가리기를 먼저 한다 — 가린 쪽은 그림 한 장이 되고(글자·주석이 정말로 사라진다), 그 위에
/// 나머지 표시를 얹는다.
fn flatten(
    document: &mut PdfDocument,
    highlights: &[ExportHighlight],
    overlays: &[FlatOverlay],
    notes: &[FlatNote],
    redactions: &[Redaction],
) -> Result<ToolReport, String> {
    let mut report = ToolReport::default();
    let mut by_page: HashMap<i32, Vec<LinkRect>> = HashMap::new();
    for redaction in redactions {
        if redaction.rect.w > 0.0 && redaction.rect.h > 0.0 {
            by_page.entry(redaction.page).or_default().push(redaction.rect);
        }
    }
    let mut redacted: Vec<i32> = by_page.keys().copied().collect();
    redacted.sort_unstable();
    for page in &redacted {
        rasterize_redacted_page(document, *page, &by_page[page])?;
        report.rasterized += 1;
    }

    // 가린 쪽 안의 형광펜은 버린다(가린 글자를 가리키는 주석이 남으면 안 된다)
    let kept: Vec<ExportHighlight> = highlights
        .iter()
        .filter(|highlight| !by_page.get(&highlight.page).is_some_and(|rects| highlight.rects.iter().any(|rect| rects.iter().any(|hidden| overlaps(*rect, *hidden)))))
        .cloned()
        .collect();
    add_highlight_annotations(document, &kept)?;

    let unicode_font = find_unicode_font().and_then(|font| document.fonts_mut().load_true_type_from_file(&font, true).ok());
    let fallback = document.fonts_mut().helvetica();
    let fallback_bold = document.fonts_mut().helvetica_bold();
    let page_count = document.pages().len();
    let mut touched: Vec<i32> = Vec::new();
    for overlay in overlays {
        let page_index = overlay_page(overlay);
        if page_index < 0 || page_index >= page_count {
            continue;
        }
        let mut page = document.pages().get(page_index).map_err(tool_err("page"))?;
        let geometry = geometry_of(&page);
        draw_overlay(document, &mut page, &geometry, overlay, unicode_font, fallback, fallback_bold)?;
        report.written += 1;
        if !touched.contains(&page_index) {
            touched.push(page_index);
        }
    }
    for page_index in touched {
        document.pages().get(page_index).map_err(tool_err("page"))?.regenerate_content().map_err(tool_err("regenerate"))?;
    }

    for note in notes {
        if note.page < 0 || note.page >= page_count || note.text.trim().is_empty() {
            continue;
        }
        let mut page = document.pages().get(note.page).map_err(tool_err("page"))?;
        let geometry = geometry_of(&page);
        let rect = to_pdf_rect(note.rect, &geometry);
        let mut annotation = page.annotations_mut().create_text_annotation(note.text.trim()).map_err(tool_err("note"))?;
        annotation.set_bounds(rect).map_err(tool_err("note bounds"))?;
        report.written += 1;
    }
    Ok(report)
}

fn overlaps(a: LinkRect, b: LinkRect) -> bool {
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

fn overlay_page(overlay: &FlatOverlay) -> i32 {
    match overlay {
        FlatOverlay::Text { page, .. } | FlatOverlay::Line { page, .. } | FlatOverlay::Ink { page, .. } | FlatOverlay::Shape { page, .. } => *page,
    }
}

/// 쪽 하나를 그림으로 바꾸고 가릴 곳을 검게 칠한다. 쪽의 글자·그림·주석·링크는 모두 사라진다.
/// 돌아간 쪽은 보이는 방향 그대로 회전 없는 쪽이 된다(화면 좌표는 그대로 맞는다).
fn rasterize_redacted_page(document: &mut PdfDocument, page_index: i32, rects: &[LinkRect]) -> Result<(), String> {
    let (width, height, image) = {
        let page = document
            .pages()
            .get(page_index)
            .map_err(|err| tr!("가릴 쪽을 열지 못했습니다: {err}", "Could not open the page to redact: {err}"))?;
        let (width, height) = (page.width().value, page.height().value);
        let pixels_wide = ((width / 72.0) * REDACT_DPI).round().clamp(64.0, 6000.0) as i32;
        let config = PdfRenderConfig::new().set_target_width(pixels_wide).render_form_data(true).render_annotations(true);
        let bitmap = page
            .render_with_config(&config)
            .map_err(|err| tr!("가릴 쪽을 그리지 못했습니다: {err}", "Could not render the page to redact: {err}"))?;
        let mut image: RgbaImage = bitmap
            .as_image()
            .map_err(|err| tr!("가릴 쪽 그림을 만들지 못했습니다: {err}", "Could not build the page image: {err}"))?
            .into_rgba8();
        let scale_x = image.width() as f32 / width;
        let scale_y = image.height() as f32 / height;
        for rect in rects {
            let x0 = (rect.x * scale_x).floor().max(0.0) as u32;
            let y0 = (rect.y * scale_y).floor().max(0.0) as u32;
            let x1 = ((rect.x + rect.w) * scale_x).ceil().min(image.width() as f32) as u32;
            let y1 = ((rect.y + rect.h) * scale_y).ceil().min(image.height() as f32) as u32;
            for y in y0..y1 {
                for x in x0..x1 {
                    image.put_pixel(x, y, Rgba([0, 0, 0, 255]));
                }
            }
        }
        (width, height, DynamicImage::ImageRgba8(image).into_rgb8())
    };

    document
        .pages()
        .get(page_index)
        .map_err(tool_err("page"))?
        .delete()
        .map_err(|err| tr!("가릴 쪽을 지우지 못했습니다: {err}", "Could not remove the page to redact: {err}"))?;
    let mut page = document
        .pages_mut()
        .create_page_at_index(PdfPagePaperSize::new_custom(PdfPoints::new(width), PdfPoints::new(height)), page_index)
        .map_err(|err| tr!("가린 쪽을 만들지 못했습니다: {err}", "Could not create the redacted page: {err}"))?;
    let mut object = PdfPageImageObject::new(document, &DynamicImage::ImageRgb8(image))
        .map_err(|err| tr!("가린 쪽 그림을 넣지 못했습니다: {err}", "Could not add the redacted image: {err}"))?;
    object.scale(width, height).map_err(tool_err("scale"))?;
    page.objects_mut().add_image_object(object).map_err(tool_err("add image"))?;
    page.regenerate_content().map_err(tool_err("regenerate"))?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn draw_overlay<'a>(
    document: &PdfDocument<'a>,
    page: &mut PdfPage<'a>,
    geometry: &PageGeometry,
    overlay: &FlatOverlay,
    unicode_font: Option<PdfFontToken>,
    fallback: PdfFontToken,
    fallback_bold: PdfFontToken,
) -> Result<(), String> {
    match overlay {
        FlatOverlay::Line { x1, y1, x2, y2, color, width, arrow, arrow_start, dashed, dotted, .. } => {
            let stroke = parse_color(color, 255);
            let width = width.max(0.3);
            for (a, b) in dash_segments((*x1, *y1), (*x2, *y2), width, *dashed, *dotted) {
                add_polyline(document, page, geometry, &[a, b], stroke, width, None)?;
            }
            if *arrow {
                add_arrowhead(document, page, geometry, (*x1, *y1), (*x2, *y2), stroke, width)?;
            }
            if *arrow_start {
                add_arrowhead(document, page, geometry, (*x2, *y2), (*x1, *y1), stroke, width)?;
            }
        }
        FlatOverlay::Ink { points, color, width, .. } => {
            if points.len() >= 2 {
                add_polyline(document, page, geometry, points, parse_color(color, 255), width.max(0.3), None)?;
            }
        }
        FlatOverlay::Shape { shape, x, y, w, h, color, width, fill, dashed, dotted, .. } => {
            let stroke = parse_color(color, 255);
            let fill_color = fill.then(|| parse_color(color, 40));
            let width = width.max(0.3);
            if shape == "ellipse" {
                let rect = to_pdf_rect(LinkRect { x: *x, y: *y, w: *w, h: *h }, geometry);
                let object = PdfPagePathObject::new_ellipse(document, rect, (!*dashed && !*dotted).then_some(stroke), Some(PdfPoints::new(width)), fill_color)
                    .map_err(tool_err("ellipse"))?;
                page.objects_mut().add_path_object(object).map_err(tool_err("add ellipse"))?;
                if *dashed || *dotted {
                    // 점선 동그라미: 둘레를 짧은 선으로
                    let steps = 72;
                    let around: Vec<(f32, f32)> = (0..=steps)
                        .map(|i| {
                            let t = i as f32 / steps as f32 * std::f32::consts::TAU;
                            (x + w / 2.0 + (w / 2.0) * t.cos(), y + h / 2.0 + (h / 2.0) * t.sin())
                        })
                        .collect();
                    for pair in around.windows(2) {
                        for (a, b) in dash_segments(pair[0], pair[1], width, *dashed, *dotted) {
                            add_polyline(document, page, geometry, &[a, b], stroke, width, None)?;
                        }
                    }
                }
            } else {
                if let Some(fill_color) = fill_color {
                    let rect = to_pdf_rect(LinkRect { x: *x, y: *y, w: *w, h: *h }, geometry);
                    let object = PdfPagePathObject::new_rect(document, rect, None, None, Some(fill_color)).map_err(tool_err("rect"))?;
                    page.objects_mut().add_path_object(object).map_err(tool_err("add rect"))?;
                }
                let corners = [(*x, *y), (x + w, *y), (x + w, y + h), (*x, y + h), (*x, *y)];
                if *dashed || *dotted {
                    for pair in corners.windows(2) {
                        for (a, b) in dash_segments(pair[0], pair[1], width, *dashed, *dotted) {
                            add_polyline(document, page, geometry, &[a, b], stroke, width, None)?;
                        }
                    }
                } else {
                    add_polyline(document, page, geometry, &corners, stroke, width, None)?;
                }
            }
        }
        FlatOverlay::Text { x, y, w, text, size, color, bold, fill, border, .. } => {
            let size = size.clamp(4.0, 96.0);
            let font = if text.is_ascii() { if *bold { fallback_bold } else { fallback } } else { unicode_font.unwrap_or(fallback) };
            let padding = 4.0;
            let line_height = size * 1.3;
            let inner = (w - padding * 2.0).max(size);
            let lines = wrap_text(document, text, font, size, inner);
            let height = lines.len().max(1) as f32 * line_height + padding * 2.0;
            let box_rect = LinkRect { x: *x, y: *y, w: *w, h: height };
            if let Some(fill) = fill.as_deref() {
                let fill_color = if fill == "yellow" { PdfColor::new(255, 246, 191, 255) } else { PdfColor::new(255, 255, 255, 255) };
                let object = PdfPagePathObject::new_rect(document, to_pdf_rect(box_rect, geometry), None, None, Some(fill_color)).map_err(tool_err("text fill"))?;
                page.objects_mut().add_path_object(object).map_err(tool_err("add text fill"))?;
            }
            if *border {
                let corners = [(*x, *y), (x + w, *y), (x + w, y + height), (*x, y + height), (*x, *y)];
                add_polyline(document, page, geometry, &corners, parse_color(color, 255), 0.8, None)?;
            }
            for (index, line) in lines.iter().enumerate() {
                if line.trim().is_empty() {
                    continue;
                }
                // 기준선(화면 좌표): 줄 위쪽 + 글자 크기
                let baseline_y = y + padding + index as f32 * line_height + size * 1.0;
                add_text_line(document, page, geometry, line, font, size, (x + padding, baseline_y), parse_color(color, 255), *bold && !text.is_ascii())?;
            }
        }
    }
    Ok(())
}

/// 실선은 그대로, 점선·짧은 점선은 조각으로 나눈다(화면 좌표).
fn dash_segments(from: (f32, f32), to: (f32, f32), width: f32, dashed: bool, dotted: bool) -> Vec<((f32, f32), (f32, f32))> {
    if !dashed && !dotted {
        return vec![(from, to)];
    }
    let (on, off) = if dotted { (width.max(0.6), width * 2.2) } else { (width * 3.0, width * 2.0) };
    let length = ((to.0 - from.0).powi(2) + (to.1 - from.1).powi(2)).sqrt();
    if length <= 0.0 {
        return Vec::new();
    }
    let (ux, uy) = ((to.0 - from.0) / length, (to.1 - from.1) / length);
    let mut out = Vec::new();
    let mut at = 0.0;
    while at < length {
        let end = (at + on).min(length);
        out.push(((from.0 + ux * at, from.1 + uy * at), (from.0 + ux * end, from.1 + uy * end)));
        at = end + off;
    }
    out
}

fn add_polyline<'a>(
    document: &PdfDocument<'a>,
    page: &mut PdfPage<'a>,
    geometry: &PageGeometry,
    points: &[(f32, f32)],
    stroke: PdfColor,
    width: f32,
    fill: Option<PdfColor>,
) -> Result<(), String> {
    let Some(first) = points.first() else { return Ok(()) };
    let (sx, sy) = to_pdf_point(first.0, first.1, geometry);
    let mut path = PdfPagePathObject::new(document, PdfPoints::new(sx), PdfPoints::new(sy), Some(stroke), Some(PdfPoints::new(width)), fill)
        .map_err(tool_err("path"))?;
    for point in &points[1..] {
        let (px, py) = to_pdf_point(point.0, point.1, geometry);
        path.line_to(PdfPoints::new(px), PdfPoints::new(py)).map_err(tool_err("line"))?;
    }
    if fill.is_some() {
        path.close_path().map_err(tool_err("close"))?;
    }
    path.set_line_cap(PdfPageObjectLineCap::Round).map_err(tool_err("cap"))?;
    path.set_line_join(PdfPageObjectLineJoin::Round).map_err(tool_err("join"))?;
    page.objects_mut().add_path_object(path).map_err(tool_err("add path"))?;
    Ok(())
}

fn add_arrowhead<'a>(document: &PdfDocument<'a>, page: &mut PdfPage<'a>, geometry: &PageGeometry, from: (f32, f32), tip: (f32, f32), color: PdfColor, width: f32) -> Result<(), String> {
    let length = (width * 4.0).max(7.0);
    let angle = (tip.1 - from.1).atan2(tip.0 - from.0);
    let spread = 0.45_f32;
    let left = (tip.0 - length * (angle - spread).cos(), tip.1 - length * (angle - spread).sin());
    let right = (tip.0 - length * (angle + spread).cos(), tip.1 - length * (angle + spread).sin());
    add_polyline(document, page, geometry, &[tip, left, right, tip], color, width.min(1.0), Some(color))
}

/// 한 줄 글자(화면 좌표 기준선 왼쪽 끝 `at`). 돌아간 쪽에서도 화면에서 똑바로 읽히게 돌린다.
#[allow(clippy::too_many_arguments)]
fn add_text_line<'a>(
    document: &PdfDocument<'a>,
    page: &mut PdfPage<'a>,
    geometry: &PageGeometry,
    text: &str,
    font: PdfFontToken,
    size: f32,
    at: (f32, f32),
    color: PdfColor,
    fake_bold: bool,
) -> Result<(), String> {
    let mut object = PdfPageTextObject::new(document, text, font, PdfPoints::new(size)).map_err(tool_err("text"))?;
    object.set_fill_color(color).map_err(tool_err("text color"))?;
    if fake_bold {
        object.set_render_mode(PdfPageTextRenderMode::FilledThenStroked).map_err(tool_err("bold"))?;
        object.set_stroke_color(color).map_err(tool_err("bold color"))?;
        object.set_stroke_width(PdfPoints::new(size * 0.03)).map_err(tool_err("bold width"))?;
    }
    if geometry.turns != 0 {
        object.rotate_counter_clockwise_degrees(90.0 * geometry.turns as f32).map_err(tool_err("rotate"))?;
    }
    let (px, py) = to_pdf_point(at.0, at.1, geometry);
    object.translate(PdfPoints::new(px), PdfPoints::new(py)).map_err(tool_err("move"))?;
    page.objects_mut().add_text_object(object).map_err(tool_err("add text"))?;
    Ok(())
}

/// 글 상자 폭에 맞춰 줄을 나눈다. 띄어쓰기에서 먼저 끊고, 한 낱말이 폭보다 길면(한글·중국어 등) 글자에서 끊는다.
fn wrap_text(document: &PdfDocument, text: &str, font: PdfFontToken, size: f32, width: f32) -> Vec<String> {
    let measure = |candidate: &str| -> f32 {
        PdfPageTextObject::new(document, candidate, font, PdfPoints::new(size))
            .ok()
            .and_then(|object| object.width().ok())
            .map(|w| w.value)
            .unwrap_or(candidate.chars().count() as f32 * size * 0.55)
    };
    let mut lines = Vec::new();
    for paragraph in text.split('\n') {
        let mut current = String::new();
        for word in paragraph.split(' ') {
            let candidate = if current.is_empty() { word.to_string() } else { format!("{current} {word}") };
            if measure(&candidate) <= width {
                current = candidate;
                continue;
            }
            if !current.is_empty() {
                lines.push(std::mem::take(&mut current));
            }
            // 낱말 하나가 폭을 넘으면 글자에서 끊는다
            let mut piece = String::new();
            for ch in word.chars() {
                let next = format!("{piece}{ch}");
                if !piece.is_empty() && measure(&next) > width {
                    lines.push(std::mem::take(&mut piece));
                    piece.push(ch);
                } else {
                    piece = next;
                }
            }
            current = piece;
        }
        lines.push(current);
    }
    lines
}

fn add_page_numbers(document: &mut PdfDocument, position: NumberPosition, start: i32, template: &str, size: f32, skip_first: bool) -> Result<ToolReport, String> {
    let template = if template.trim().is_empty() { "{n}" } else { template };
    let unicode_font = if template.is_ascii() { None } else { find_unicode_font().and_then(|font| document.fonts_mut().load_true_type_from_file(&font, true).ok()) };
    let font = unicode_font.unwrap_or_else(|| document.fonts_mut().helvetica());
    let size = size.clamp(5.0, 48.0);
    let total = document.pages().len();
    let mut report = ToolReport::default();
    for index in 0..total {
        if skip_first && index == 0 {
            continue;
        }
        let number = start + index - if skip_first { 1 } else { 0 };
        let label = template.replace("{n}", &number.to_string()).replace("{total}", &(total - if skip_first { 1 } else { 0 }).to_string());
        let mut page = document.pages().get(index).map_err(tool_err("page"))?;
        let geometry = geometry_of(&page);
        let text_width = PdfPageTextObject::new(document, &label, font, PdfPoints::new(size))
            .ok()
            .and_then(|object| object.width().ok())
            .map(|w| w.value)
            .unwrap_or(size * label.len() as f32 * 0.55);
        let x = match position {
            NumberPosition::BottomLeft | NumberPosition::TopLeft => NUMBER_MARGIN,
            NumberPosition::BottomRight | NumberPosition::TopRight => geometry.width - NUMBER_MARGIN - text_width,
            NumberPosition::BottomCenter | NumberPosition::TopCenter => (geometry.width - text_width) / 2.0,
        };
        let baseline = match position {
            NumberPosition::TopLeft | NumberPosition::TopCenter | NumberPosition::TopRight => NUMBER_MARGIN + size * 0.8,
            _ => geometry.height - NUMBER_MARGIN,
        };
        add_text_line(document, &mut page, &geometry, &label, font, size, (x, baseline), PdfColor::new(40, 40, 40, 255), false)?;
        page.regenerate_content().map_err(tool_err("regenerate"))?;
        report.written += 1;
    }
    Ok(report)
}

fn add_watermark(document: &mut PdfDocument, text: &str, size: f32, opacity: f32, angle: f32, color: &str) -> Result<ToolReport, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err(tr!("워터마크 글자가 비어 있습니다", "The watermark text is empty"));
    }
    let unicode_font = if text.is_ascii() { None } else { find_unicode_font().and_then(|font| document.fonts_mut().load_true_type_from_file(&font, true).ok()) };
    let font = unicode_font.unwrap_or_else(|| document.fonts_mut().helvetica_bold());
    let size = size.clamp(8.0, 200.0);
    let alpha = (opacity.clamp(0.03, 1.0) * 255.0).round() as u8;
    let mut report = ToolReport::default();
    for index in 0..document.pages().len() {
        let mut page = document.pages().get(index).map_err(tool_err("page"))?;
        let geometry = geometry_of(&page);
        let mut object = PdfPageTextObject::new(document, text, font, PdfPoints::new(size)).map_err(tool_err("watermark"))?;
        object.set_fill_color(parse_color(color, alpha)).map_err(tool_err("watermark color"))?;
        let text_width = object.width().map(|w| w.value).unwrap_or(size * text.len() as f32 * 0.6);
        // 글자 가운데를 원점에 두고 돌린 뒤, 화면 기준 각도(+ 쪽 회전)만큼 돌려 쪽 가운데로 옮긴다
        object.translate(PdfPoints::new(-text_width / 2.0), PdfPoints::new(-size * 0.35)).map_err(tool_err("move"))?;
        object.rotate_counter_clockwise_degrees(angle + 90.0 * geometry.turns as f32).map_err(tool_err("rotate"))?;
        let (cx, cy) = to_pdf_point(geometry.width / 2.0, geometry.height / 2.0, &geometry);
        object.translate(PdfPoints::new(cx), PdfPoints::new(cy)).map_err(tool_err("move"))?;
        page.objects_mut().add_text_object(object).map_err(tool_err("add watermark"))?;
        page.regenerate_content().map_err(tool_err("regenerate"))?;
        report.written += 1;
    }
    Ok(report)
}

fn crop_pages(document: &mut PdfDocument, left: f32, top: f32, right: f32, bottom: f32) -> Result<ToolReport, String> {
    let mut report = ToolReport::default();
    for index in 0..document.pages().len() {
        let mut page = document.pages().get(index).map_err(tool_err("page"))?;
        let geometry = geometry_of(&page);
        let keep = LinkRect {
            x: left.max(0.0),
            y: top.max(0.0),
            w: (geometry.width - left.max(0.0) - right.max(0.0)).max(36.0),
            h: (geometry.height - top.max(0.0) - bottom.max(0.0)).max(36.0),
        };
        let rect = to_pdf_rect(keep, &geometry);
        page.boundaries_mut().set_crop(rect).map_err(|err| tr!("{}쪽 여백을 자르지 못했습니다: {err}", "Could not crop page {}: {err}", index + 1))?;
        report.written += 1;
    }
    Ok(report)
}

/// 빈 쪽(거의 흰 쪽)의 번호(0 부터). 작게 그려 어두운 픽셀 비율을 본다.
pub fn blank_pages(document: &PdfDocument) -> Result<Vec<i32>, String> {
    let config = PdfRenderConfig::new().set_target_width(160).render_annotations(false);
    let mut blanks = Vec::new();
    for (index, page) in document.pages().iter().enumerate() {
        let bitmap = page.render_with_config(&config).map_err(tool_err("render"))?;
        let rgba = bitmap.as_rgba_bytes();
        let pixels = rgba.len() / 4;
        let dark = rgba.chunks_exact(4).filter(|px| (u32::from(px[0]) + u32::from(px[1]) + u32::from(px[2])) < 3 * 235).count();
        if pixels > 0 && (dark as f32 / pixels as f32) < 0.0015 {
            blanks.push(index as i32);
        }
    }
    Ok(blanks)
}

/// 쪽마다 PNG 를 `folder` 에 쓴다. 쓴 파일 수.
pub fn export_page_images(document: &PdfDocument, folder: &Path, stem: &str, dpi: f32) -> Result<usize, String> {
    std::fs::create_dir_all(folder).map_err(|err| tr!("폴더를 만들지 못했습니다: {err}", "Could not create the folder: {err}"))?;
    let digits = document.pages().len().to_string().len().max(2);
    let mut written = 0;
    for (index, page) in document.pages().iter().enumerate() {
        let width = ((page.width().value / 72.0) * dpi).round().clamp(64.0, 6000.0) as i32;
        let config = PdfRenderConfig::new().set_target_width(width).render_form_data(true);
        let image = page.render_with_config(&config).map_err(tool_err("render"))?.as_image().map_err(tool_err("image"))?;
        let path = folder.join(format!("{stem}-{:0digits$}.png", index + 1));
        image.save(&path).map_err(|err| tr!("그림을 쓰지 못했습니다: {err}", "Could not write the image: {err}"))?;
        written += 1;
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colors_parse_from_hex_and_fall_back_to_black() {
        let red = parse_color("#d9363e", 255);
        assert_eq!((red.red(), red.green(), red.blue(), red.alpha()), (0xd9, 0x36, 0x3e, 255));
        let bad = parse_color("red", 128);
        assert_eq!((bad.red(), bad.green(), bad.blue(), bad.alpha()), (0, 0, 0, 128));
    }

    #[test]
    fn solid_lines_stay_whole_and_dashes_split() {
        assert_eq!(dash_segments((0.0, 0.0), (10.0, 0.0), 1.0, false, false).len(), 1);
        let dashes = dash_segments((0.0, 0.0), (20.0, 0.0), 1.0, true, false);
        // 3 켜고 2 끄기: 0-3, 5-8, 10-13, 15-18
        assert_eq!(dashes.len(), 4);
        assert!((dashes[1].0 .0 - 5.0).abs() < 1e-4);
    }

    #[test]
    fn overlap_needs_shared_area() {
        let a = LinkRect { x: 0.0, y: 0.0, w: 10.0, h: 10.0 };
        assert!(overlaps(a, LinkRect { x: 5.0, y: 5.0, w: 10.0, h: 10.0 }));
        assert!(!overlaps(a, LinkRect { x: 10.0, y: 0.0, w: 5.0, h: 5.0 }));
    }
}
