//! PDF 모듈의 공개 얼굴.
//!
//! 웹뷰는 [`pdf_open`] 과 [`pdf_page_text`] 만 본다. 그 뒤에 PDFium 전용 스레드가 있다는
//! 사실은 여기서 끝난다.

mod cache;
mod engine;
pub mod shared;
mod thread;

pub use engine::{
    find_unicode_font, pdf_space_rect, sanitize_uri, CharBox, CropRect, ExportHighlight,
    ImportedAnnotation, LayoutChar, LayoutRect, LayoutSegment, LinkRect, PageLayout, PageTextIndex, PdfDocMeta, PdfLink, PdfLinkTarget, PdfMetadata,
    PdfOutlineEntry, PdfRenderError, SearchableLine, SearchablePage, SearchableReport,
    CROP_PIXELS_PER_POINT, MAX_RENDER_PIXELS, MAX_RENDER_WIDTH, MAX_TILE_PAGE_WIDTH, MAX_TILE_SIDE, MIN_RENDER_WIDTH,
    RawImage, TileRect,
};
pub use thread::PdfThread;

use std::path::PathBuf;

use tauri::State;

/// 문서를 열고 메타를 돌려준다.
///
/// 실제 작업은 PDFium 스레드가 하고 이 커맨드는 답을 기다릴 뿐이다. 기다림이 비동기
/// 런타임의 워커를 막지 않도록 블로킹 풀로 넘긴다.
#[tauri::command]
pub async fn pdf_open(
    state: State<'_, PdfThread>,
    path: String,
    doc_id: Option<String>,
) -> Result<PdfDocMeta, String> {
    let pdf = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || pdf.open_with_id_blocking(PathBuf::from(path), doc_id))
        .await
        .map_err(|err| tr!("PDF 열기 작업이 중단되었습니다: {err}", "PDF open task was interrupted: {err}"))?
}

/// 파일의 내용 해시(doc_id·sha256·크기)만 잰다. PDFium 으로 열지 않는다 — 열면 열린 문서 캐시(8개)에서
/// 사용자가 보고 있는 문서가 밀려나 쪽이 빈칸이 된다. 이미 등록된 PDF 인지 가릴 때 쓴다
#[tauri::command]
pub async fn pdf_file_hash(path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let identity = engine::file_identity(&PathBuf::from(path))?;
        Ok(serde_json::json!({"docId": identity.doc_id, "sha256": identity.sha256, "size": identity.size}))
    })
    .await
    .map_err(|err| tr!("해시 작업이 중단되었습니다: {err}", "Hash task was interrupted: {err}"))?
}

/// 페이지 하나의 전체 텍스트와 글자별 상자를 돌려준다. `page` 는 0-기반.
///
/// 커스텀 프로토콜이 아니라 `invoke`(JSON)로 보낸다. 스펙 §6.5 — 1,500자 페이지가 60KB
/// 남짓이라 이미지처럼 부풀 걱정이 없고, 구조를 그대로 표현하는 쪽이 JSON 이다.
///
/// 오류는 [`PdfRenderError`] 를 문장으로 눌러서 보낸다. 프로토콜과 달리 여기서는 종류를
/// 상태 코드로 옮길 자리가 없고, 웹뷰가 이 오류를 보고 갈라서 할 일도 없다 — 열려 있지 않은
/// 문서를 물었다면 그건 고쳐야 할 배선이지 사용자가 다시 시도할 일이 아니다.
#[tauri::command]
pub async fn pdf_page_text(
    state: State<'_, PdfThread>,
    doc_id: String,
    page: i32,
) -> Result<PageTextIndex, String> {
    let pdf = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || pdf.page_text_blocking(doc_id, page))
        .await
        .map_err(|err| tr!("페이지 텍스트 작업이 중단되었습니다: {err}", "Page text task was interrupted: {err}"))?
        .map_err(|err| err.to_string())
}

/// 이미 열려 있는 PDF의 북마크 목차를 전위 순회 순서로 돌려준다.
#[tauri::command]
pub async fn pdf_outline(
    state: State<'_, PdfThread>,
    doc_id: String,
) -> Result<Vec<PdfOutlineEntry>, String> {
    let pdf = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || pdf.outline_blocking(doc_id))
        .await
        .map_err(|err| tr!("PDF 목차 작업이 중단되었습니다: {err}", "PDF outline task was interrupted: {err}"))?
        .map_err(|err| err.to_string())
}

/// 페이지 하나의 링크. `page` 는 0-기반.
#[tauri::command]
pub async fn pdf_page_links(
    state: State<'_, PdfThread>,
    doc_id: String,
    page: i32,
) -> Result<Vec<PdfLink>, String> {
    let pdf = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || pdf.links_blocking(doc_id, page))
        .await
        .map_err(|err| tr!("PDF 링크 작업이 중단되었습니다: {err}", "PDF link task was interrupted: {err}"))?
        .map_err(|err| err.to_string())
}

/// 문서 정보 사전(제목·저자·만든 날짜 등).
#[tauri::command]
pub async fn pdf_metadata(
    state: State<'_, PdfThread>,
    doc_id: String,
) -> Result<PdfMetadata, String> {
    let pdf = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || pdf.metadata_blocking(doc_id))
        .await
        .map_err(|err| tr!("PDF 정보 작업이 중단되었습니다: {err}", "PDF metadata task was interrupted: {err}"))?
        .map_err(|err| err.to_string())
}

/// 다른 프로그램이 남긴 표시 주석 전부.
#[tauri::command]
pub async fn pdf_annotations(
    state: State<'_, PdfThread>,
    doc_id: String,
) -> Result<Vec<ImportedAnnotation>, String> {
    let pdf = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || pdf.annotations_blocking(doc_id))
        .await
        .map_err(|err| tr!("PDF 주석 작업이 중단되었습니다: {err}", "PDF annotation task was interrupted: {err}"))?
        .map_err(|err| err.to_string())
}

/// 형광펜을 PDF 주석으로 넣은 사본을 저장한다. 저장 위치는 여기서 연 대화상자에서만
/// 받는다 — 웹뷰가 경로를 넘기게 하면 기계 안 아무 곳에나 쓸 수 있게 된다.
/// 사용자가 취소하면 `None`.
#[tauri::command]
pub async fn pdf_export_annotated(
    app: tauri::AppHandle,
    state: State<'_, PdfThread>,
    doc_id: String,
    highlights: Vec<ExportHighlight>,
    suggested_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_name = sanitize_file_name(&suggested_name);
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(&file_name)
            .add_filter("PDF", &["pdf"])
            .blocking_save_file()
    })
    .await
    .map_err(|err| tr!("저장 대화상자가 중단되었습니다: {err}", "Save dialog was interrupted: {err}"))?;

    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let path = chosen
        .into_path()
        .map_err(|err| tr!("저장 경로를 읽지 못했습니다: {err}", "Could not read the save path: {err}"))?;
    let shown = path.display().to_string();
    let pdf = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        pdf.export_annotated_blocking(doc_id, highlights, path)
    })
    .await
    .map_err(|err| tr!("주석 포함 PDF 내보내기가 중단되었습니다: {err}", "Annotated PDF export was interrupted: {err}"))??;
    Ok(Some(shown))
}

/// OCR 줄로 보이지 않는 글자 층을 깐 사본을 저장한다. 저장 위치는 Rust 대화상자에서만 받는다.
#[tauri::command]
pub async fn pdf_export_searchable(
    app: tauri::AppHandle,
    state: State<'_, PdfThread>,
    doc_id: String,
    pages: Vec<SearchablePage>,
    suggested_name: String,
) -> Result<Option<SearchableExport>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_name = sanitize_file_name(&suggested_name);
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(&file_name)
            .add_filter("PDF", &["pdf"])
            .blocking_save_file()
    })
    .await
    .map_err(|err| tr!("저장 대화상자가 중단되었습니다: {err}", "Save dialog was interrupted: {err}"))?;
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let path = chosen
        .into_path()
        .map_err(|err| tr!("저장 경로를 읽지 못했습니다: {err}", "Could not read the save path: {err}"))?;
    let shown = path.display().to_string();
    let pdf = state.inner().clone();
    let report = tauri::async_runtime::spawn_blocking(move || {
        pdf.export_searchable_blocking(doc_id, pages, path)
    })
    .await
    .map_err(|err| tr!("검색 가능한 PDF 만들기가 중단되었습니다: {err}", "Creating the searchable PDF was interrupted: {err}"))??;
    Ok(Some(SearchableExport {
        path: shown,
        written: report.written,
        skipped: report.skipped,
    }))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchableExport {
    pub path: String,
    pub written: usize,
    pub skipped: usize,
}

/// 대화상자에 미리 채울 이름. 경로 구분자와 윈도우에서 못 쓰는 글자를 지운다.
fn sanitize_file_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| {
            !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !c.is_control()
        })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "annotated.pdf".to_string()
    } else if trimmed.to_ascii_lowercase().ends_with(".pdf") {
        trimmed.to_string()
    } else {
        format!("{trimmed}.pdf")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggested_names_lose_path_characters_and_gain_an_extension() {
        assert_eq!(sanitize_file_name("../evil\\name"), "..evilname.pdf");
        assert_eq!(sanitize_file_name("논문 주석.pdf"), "논문 주석.pdf");
        assert_eq!(sanitize_file_name("  "), "annotated.pdf");
    }

    #[test]
    fn only_web_and_mail_links_survive() {
        assert_eq!(
            sanitize_uri(" https://example.com/a "),
            Some("https://example.com/a".into())
        );
        assert_eq!(sanitize_uri("HTTP://x.org"), Some("HTTP://x.org".into()));
        assert_eq!(
            sanitize_uri("mailto:me@example.com"),
            Some("mailto:me@example.com".into())
        );
        assert_eq!(sanitize_uri("javascript:alert(1)"), None);
        assert_eq!(sanitize_uri("file:///C:/Windows/notepad.exe"), None);
        assert_eq!(sanitize_uri("https://x.org/\nnext"), None);
    }

    #[test]
    fn pdf_space_rect_inverts_the_displayed_box_for_every_rotation() {
        let rect = LinkRect {
            x: 50.0,
            y: 100.0,
            w: 120.0,
            h: 14.0,
        };
        for quarter_turns in 0..4u8 {
            // 돌아간 뒤 크기를 준다(612x792 페이지를 홀수 번 돌리면 792x612).
            let (page_width, page_height) = if quarter_turns % 2 == 1 {
                (792.0, 612.0)
            } else {
                (612.0, 792.0)
            };
            let (left, bottom, right, top) =
                pdf_space_rect(rect, quarter_turns, page_width, page_height);
            let back = engine::displayed_box_for_tests(
                left,
                bottom,
                right,
                top,
                quarter_turns,
                page_width,
                page_height,
            );
            assert!(
                (back.0 - rect.x).abs() < 0.01 && (back.1 - rect.y).abs() < 0.01,
                "{quarter_turns}: {back:?}"
            );
            assert!(
                (back.2 - rect.w).abs() < 0.01 && (back.3 - rect.h).abs() < 0.01,
                "{quarter_turns}: {back:?}"
            );
        }
    }
}

/// 쪽 순서·회전·끼워 넣기를 적용해 원본을 덮어쓴다. 덮기 전 원본은 `backup` 에 남긴다.
#[tauri::command]
pub async fn pdf_edit_pages(
    state: State<'_, PdfThread>,
    doc_id: String,
    path: String,
    backup: String,
    plan: Vec<engine::PageEditOp>,
) -> Result<PdfDocMeta, String> {
    let pdf = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        pdf.edit_pages_blocking(doc_id, PathBuf::from(path), PathBuf::from(backup), plan)
    })
    .await
    .map_err(|err| tr!("쪽 편집 작업이 중단되었습니다: {err}", "Page edit task was interrupted: {err}"))?
}
