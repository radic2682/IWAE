//! MCP 도구: 쪽 그림(page_image).
//!
//! - page_image 는 PDFium 으로 쪽(또는 그 안 네모)을 PNG 로 그려 MCP 그림 내용으로 준다.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::pdf::{CropRect, PdfThread};

pub const INSTRUCTIONS: &str = "Page tools: page_image renders a PDF page (or a box on it, PDF points from top-left) as an image so you can read figures, \
tables and layouts that read_page flattens. Use it before boxing a table or figure (memo_add kind:'region'): read the box from the whole-page image \
(points = pixels × points_per_pixel), then render that rect to confirm the box holds the whole table or figure.";

/// MCP 결과를 글이 아닌 내용(그림 등)으로 돌려줄 때 쓰는 열쇠. rpc 가 알아본다
pub const CONTENT_KEY: &str = "__mcp_content";

pub fn tool_schemas() -> Vec<Value> {
    vec![
        json!({"name": "page_image", "description": "Render one PDF page, or a box on it, as a PNG image (to read figures, diagrams, tables, layout). 쪽을 그림으로.",
            "inputSchema": {"type": "object", "properties": {
                "doc_id": {"type": "string"},
                "page": {"type": "integer", "minimum": 1, "description": "1-based page"},
                "width": {"type": "integer", "minimum": 400, "maximum": 2400, "description": "Image width in pixels for the whole page (default 1400)"},
                "rect": {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "w": {"type": "number"}, "h": {"type": "number"}},
                    "description": "Optional box in PDF points, origin top-left (e.g. a table or figure). Rendered at 2 pixels per point. Use it to check a region before memo_add."}
            }, "required": ["doc_id", "page"]}}),
    ]
}

pub fn call(root: Option<PathBuf>, name: &str, args: &Value) -> Option<Result<Value, String>> {
    if name != "page_image" {
        return None;
    }
    let Some(root) = root else { return Some(Err("IWAE 에 열린 Vault 가 없습니다.".into())) };
    Some(page_image(&root, args))
}

fn str_arg<'a>(args: &'a Value, name: &str) -> Option<&'a str> {
    args.get(name).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty())
}

fn page_arg(args: &Value) -> Result<i64, String> {
    args.get("page").and_then(Value::as_i64).filter(|page| *page >= 1).ok_or_else(|| "page(1부터)가 필요합니다.".to_string())
}

/// library.json 에서 문서 파일 경로를 찾는다
fn document_path(root: &Path, doc_id: &str) -> Result<PathBuf, String> {
    let text = std::fs::read_to_string(root.join(".iwae").join("library.json")).map_err(|err| format!("문서 목록을 읽지 못했습니다: {err}"))?;
    let value: Value = serde_json::from_str(&text).map_err(|err| format!("문서 목록이 깨졌습니다: {err}"))?;
    // documents 는 docId 를 열쇠로 한 객체다(예전 형식은 배열)
    let entry = match value.get("documents") {
        Some(Value::Object(map)) => map.get(doc_id).or_else(|| map.values().find(|entry| entry.get("docId").and_then(Value::as_str) == Some(doc_id))),
        Some(Value::Array(list)) => list.iter().find(|entry| entry.get("docId").and_then(Value::as_str) == Some(doc_id)),
        _ => None,
    }
    .ok_or_else(|| format!("doc_id {doc_id} 인 PDF 가 없습니다. list_documents 로 확인하세요."))?;
    let path = entry.get("path").and_then(Value::as_str).ok_or("문서 경로가 없습니다.")?;
    let path = PathBuf::from(path);
    Ok(if path.is_absolute() { path } else { root.join(path) })
}

fn page_image(root: &Path, args: &Value) -> Result<Value, String> {
    let doc_id = str_arg(args, "doc_id").ok_or("doc_id 가 필요합니다.")?;
    let page = page_arg(args)?;
    let pdf = PdfThread::shared();
    let meta = pdf.open_with_id_blocking(document_path(root, doc_id)?, Some(doc_id.to_string()))?;
    let index = (page - 1) as i32;
    if index >= meta.page_count {
        return Err(format!("쪽 번호가 범위를 벗어났습니다(1–{}).", meta.page_count));
    }
    let (page_width, page_height) = meta.page_sizes.get(index as usize).copied().ok_or("쪽 크기를 알 수 없습니다.")?;
    // 그림 픽셀 → PDF points 배율(영역 메모의 rect 를 그림에서 읽을 때 쓴다)
    let points_per_pixel: f32;
    let mut origin = (0.0f32, 0.0f32);
    let png = if let Some(rect) = args.get("rect").filter(|value| value.is_object()) {
        let number = |key: &str| rect.get(key).and_then(Value::as_f64).map(|value| value as f32);
        let (Some(x), Some(y), Some(w), Some(h)) = (number("x"), number("y"), number("w"), number("h")) else {
            return Err("rect 에는 x, y, w, h(PDF points, 왼쪽 위 기준)가 필요합니다.".into());
        };
        // 쪽 밖으로 나간 부분은 잘라 낸다
        let x = x.clamp(0.0, page_width);
        let y = y.clamp(0.0, page_height);
        let crop = CropRect { x, y, w: w.min(page_width - x), h: h.min(page_height - y) };
        points_per_pixel = 1.0 / crate::pdf::CROP_PIXELS_PER_POINT;
        origin = (x, y);
        pdf.crop_blocking(meta.doc_id.clone(), index, crop).map_err(|err| err.to_string())?
    } else {
        let width = args.get("width").and_then(Value::as_u64).unwrap_or(1400).clamp(400, 2400) as u32;
        points_per_pixel = page_width / width as f32;
        pdf.render_raw_blocking(meta.doc_id.clone(), index, width, None)
            .and_then(|image| image.encode_png_fast())
            .map_err(|err| err.to_string())?
    };
    Ok(json!({ CONTENT_KEY: [
        {"type": "text", "text": json!({
            "doc_id": meta.doc_id, "title": meta.title, "page": page, "pages": meta.page_count,
            "page_size_points": [page_width, page_height],
            // 그림의 (px, py) 픽셀 = PDF points (origin_x + px × points_per_pixel, origin_y + py × points_per_pixel), 왼쪽 위 기준
            "points_per_pixel": (points_per_pixel * 10000.0).round() / 10000.0,
            "origin_points": [origin.0, origin.1],
        }).to_string()},
        {"type": "image", "mimeType": "image/png", "data": base64(&png)},
    ]}))
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_known_values() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }
}

#[cfg(test)]
mod normalize_tests {
    use crate::mcp::rpc::normalize_args;
    use serde_json::json;

    #[test]
    fn common_argument_names_are_mapped_to_what_the_tool_takes() {
        assert_eq!(normalize_args("read_page", json!({"docId": "abc", "pageNumber": "3"})), json!({"doc_id": "abc", "page": 3}));
        assert_eq!(normalize_args("page_image", json!({"doc_key": "abc"})), json!({"doc_id": "abc"}));
        assert_eq!(normalize_args("memo_delete", json!({"id": "h1"})), json!({"ids": ["h1"]}));
        let add = normalize_args("memo_add", json!({"docId": "abc", "page": 2, "fromText": "x", "text": "memo"}));
        assert_eq!(add, json!({"memos": [{"doc_id": "abc", "page": 2, "from_text": "x", "note": "memo"}]}));
        let update = normalize_args("memo_update", json!({"id": "h1", "note": ""}));
        assert_eq!(update, json!({"updates": [{"id": "h1", "note": ""}]}));
    }
}
