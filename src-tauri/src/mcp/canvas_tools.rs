//! 노트 캔버스를 바깥 AI(MCP)가 읽고 고치는 도구들(`canvas_*`).
//!
//! 캔버스 상태는 웹뷰에 있으므로 실제 일은 웹뷰가 한다([`super::webview_call`]). 열린 캔버스는
//! 화면에 바로 반영되고, 닫힌 캔버스는 파일을 고친다. PDF 발췌는 웹뷰가 PDF 글자 상자로 직접
//! 만들어 원문 연결(REF)까지 갖춘다.

use std::time::Duration;

use serde_json::{json, Value};

use super::webview_call;

/// 노트 캔버스 기능 스위치(앱의 src/core/features.ts CANVAS_ENABLED 와 같이 맞춘다).
/// 끄면 MCP 도구 목록·호출·안내에서 canvas_* 가 빠진다.
pub const ENABLED: bool = false;

pub const INSTRUCTIONS: &str = "Note canvases (canvas_* tools): call canvas_guide once before building or reorganizing a canvas (layout and excerpt rules). canvas_list finds canvases (pass its `canvas` value back), canvas_read shows blocks \
with ids, positions (canvas px) and sources. canvas_add_blocks adds text/title/heading/code blocks, PDF excerpts (an image crop of a PDF page that \
keeps a clickable link to the source) and rectangles; blocks without x/y are stacked below existing content. For a PDF excerpt give doc_id and \
1-based page plus either rect (PDF points, origin top-left, as in page coordinates) or from_text/to_text (the crop covers every character from the \
first occurrence of from_text through to_text, e.g. a table caption through its last row). canvas_update_blocks moves/resizes/edits, \
canvas_arrange lays blocks out in a grid/column/row, canvas_connect draws arrows, canvas_delete_blocks removes. Changes to an open canvas appear \
immediately; call canvas_read before rearranging. \
캔버스 도구: 발췌는 doc_id·page(1부터)·from_text/to_text 로 표·그림 영역을 잡으면 원문 연결까지 들어갑니다.";

const TIMEOUT: Duration = Duration::from_secs(60);

/// `canvas_guide` 가 돌려주는 작업 안내. 캔버스를 처음 만지기 전에 읽게 한다.
pub const GUIDE: &str = r##"# IWAE canvas guide (read before building or reorganizing a canvas)

## What a good canvas looks like
- One canvas = one question/topic. Start with ONE title block, then one short "how to read this" line.
- Use sections: a heading block per section ("1. Signal definition", "2. Timing" ...).
- EVERY excerpt gets its own note directly to its right, in the user's language (Korean): what it means,
  the key numbers, why it matters for the topic. Short lines or bullets, not paragraphs.
- Crop only what is relevant: no neighbouring table rows, no unrelated paragraph above/below. For a long
  table where only some rows matter, crop caption + header + the relevant rows (use rect) and mark them.
- Prefer few, meaningful excerpts (whole table, whole figure, whole requirement paragraph) over many
  one-line fragments. Never excerpt a single table row cut out of its table; excerpt the table
  (caption through last row) and point at the row with a rectangle or in the note.

## Layout convention (canvas px, origin top-left, y grows downward)
- Rows of [excerpt | note]: all excerpts the SAME width on the left (x = 40, width 840), notes on the
  right touching it (x = 880, width 420). Blocks TOUCH: no gap between excerpt and note, none between
  rows. Row height = max(excerpt, note); give the note that height so the right column has no holes.
  Positions snap to 20px (x) / 10px (y), so use multiples of those. A full-width title on top (width 1260).
- Do NOT compute y yourself for long stacks: omit x/y and let canvas_add_blocks stack blocks below the
  existing content (use `origin` to choose the column start), or add a section, then call
  canvas_read to get real positions/heights before adding the next column.
- Text heights are only known after IWAE renders them. canvas_add_blocks waits for the render and moves
  newly added blocks down if they overlap (the result says so). After big edits, run
  canvas_arrange {layout: "stack"} to remove any remaining overlaps while keeping columns.
- Keep existing user blocks where they are unless asked to reorganize; put new material beside or
  below them (check bounds with canvas_read first).

## PDF excerpts
- Find the passage with search_vault, read the page with read_page (pages are 1-based).
- Crop with from_text/to_text copied exactly from read_page text (whitespace/case do not matter):
  - table: from_text = table caption ("Table 6-3. ..."), to_text = text of the last row or last note.
  - figure: from_text = first label inside the figure, to_text = figure caption; add full_width:true so
    the drawing (lines have no text) is not cut.
  - paragraph/requirement: from_text = first words, to_text = last words of the paragraph.
- If the crop looks cut (text missing at an edge), retry with a larger padding (10-16) or full_width,
  or give rect in PDF points (origin top-left) instead.
- The excerpt keeps a REF link to the source page; the user can click it to jump to the PDF.

## Emphasis
- To highlight part of an excerpt, add a rectangle (border_color "#ef4444", background "transparent")
  over it: x/y relative to the canvas, inside the excerpt's box. Rectangles over a block move with it.
- Use background colors on notes sparingly: "#fff4d6" (caution), "#e8f3ff" (definition), "#eaf7ee" (ok).

## Workflow
1. canvas_list -> pick the canvas; canvas_read -> see what is already there.
2. Plan sections. For each section: canvas_add_blocks with [heading, excerpt(s), note] and refs; connect
   only when an arrow adds meaning (cause -> effect, step order). Don't connect everything.
3. canvas_read to verify (no overlaps, nothing cut). Fix with canvas_update_blocks / canvas_arrange.
4. Tell the user what you added and where (section names), briefly.
"##;


pub fn tool_schemas() -> Vec<Value> {
    let canvas = json!({"type": "string", "description": "Canvas path from canvas_list (e.g. \"Folder/name.canvas\") or its exact title"});
    let style = json!({
        "background": {"type": "string", "description": "CSS color, e.g. #fff4d6 or transparent"},
        "border_color": {"type": "string", "description": "CSS color for the block border"},
        "border_width": {"type": "number", "description": "Border thickness in px (0 = none, max 24)"},
        "color": {"type": "string", "description": "Text color"},
    });
    let mut block_props = json!({
        "type": {"type": "string", "enum": ["title", "heading", "text", "code", "pdf_excerpt", "rectangle", "ellipse", "image"]},
        "ref": {"type": "string", "description": "Your label for this block, usable in edges of the same call"},
        "x": {"type": "number"}, "y": {"type": "number"},
        "width": {"type": "number"}, "height": {"type": "number", "description": "Text blocks grow to fit their text; excerpts keep the crop's aspect ratio"},
        "text": {"type": "string", "description": "Plain text. Use newlines for lines; with list it becomes bullet/numbered lines"},
        "level": {"type": "string", "enum": ["h1", "h2", "h3", "h4"], "description": "Heading level for type heading (default h2)"},
        "list": {"type": "string", "enum": ["none", "bullet", "number"]},
        "bold": {"type": "boolean"},
        "font_size": {"type": "number"},
        "doc_id": {"type": "string", "description": "pdf_excerpt: document id (search_vault / list_documents doc_id)"},
        "page": {"type": "integer", "description": "pdf_excerpt: 1-based page"},
        "rect": {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "w": {"type": "number"}, "h": {"type": "number"}},
            "description": "pdf_excerpt: crop in PDF points, origin top-left of the page"},
        "from_text": {"type": "string", "description": "pdf_excerpt: crop starts at the first occurrence of this text on the page"},
        "to_text": {"type": "string", "description": "pdf_excerpt: crop ends after this text (searched after from_text). Omit to crop just from_text"},
        "padding": {"type": "number", "description": "pdf_excerpt: extra margin in points around from_text/to_text (default 6)"},
        "full_width": {"type": "boolean", "description": "pdf_excerpt: stretch the crop across the page's text column width"},
        "path": {"type": "string", "description": "image: absolute path or vault-relative path of a png/jpg/webp/gif file"},
        "alt": {"type": "string"},
    });
    if let (Some(props), Some(extra)) = (block_props.as_object_mut(), style.as_object()) {
        for (key, value) in extra {
            props.insert(key.clone(), value.clone());
        }
    }
    let edge = json!({"type": "object", "properties": {
        "from": {"type": "string", "description": "Block id or ref"},
        "to": {"type": "string", "description": "Block id or ref"},
        "arrow": {"type": "boolean", "description": "Arrow head at `to` (default true)"}
    }, "required": ["from", "to"]});
    vec![
        json!({"name": "canvas_guide", "description": "How to build a clean, readable canvas in IWAE: layout convention, how to crop PDF excerpts (tables, figures, paragraphs), emphasis, workflow. Read this before adding or rearranging blocks. 캔버스 작성 가이드.",
            "inputSchema": {"type": "object", "properties": {}}}),
        json!({"name": "canvas_list", "description": "List note canvases in the vault (path, title, folder, block count when known, whether open in IWAE). 캔버스 목록.",
            "inputSchema": {"type": "object", "properties": {}}}),
        json!({"name": "canvas_read", "description": "Read one canvas: blocks (id, kind, x, y, width, height, text, PDF source doc/page/quote, colors) and edges.",
            "inputSchema": {"type": "object", "properties": {"canvas": canvas}, "required": ["canvas"]}}),
        json!({"name": "canvas_add_blocks", "description": "Add blocks (text, headings, PDF excerpts with source link, rectangles, images) and optional edges to a canvas. Returns created ids and geometry.",
            "inputSchema": {"type": "object", "properties": {
                "canvas": canvas,
                "blocks": {"type": "array", "items": {"type": "object", "properties": block_props, "required": ["type"]}},
                "edges": {"type": "array", "items": edge},
                "origin": {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}}, "description": "Where auto-stacked blocks start (default: below existing content)"},
                "gap": {"type": "number", "description": "Gap between auto-stacked blocks (default 24)"},
                "tidy": {"type": "boolean", "description": "After IWAE renders the new blocks, move them down if they overlap others (default true)"}
            }, "required": ["canvas", "blocks"]}}),
        json!({"name": "canvas_update_blocks", "description": "Change existing blocks: position, size, text, colors.",
            "inputSchema": {"type": "object", "properties": {
                "canvas": canvas,
                "updates": {"type": "array", "items": {"type": "object", "properties": {
                    "id": {"type": "string"}, "x": {"type": "number"}, "y": {"type": "number"}, "width": {"type": "number"}, "height": {"type": "number"},
                    "text": {"type": "string"}, "background": {"type": "string"}, "border_color": {"type": "string"}, "border_width": {"type": "number"}, "color": {"type": "string"},
                    "bold": {"type": "boolean"}, "font_size": {"type": "number"}, "list": {"type": "string", "enum": ["none", "bullet", "number"]}
                }, "required": ["id"]}}
            }, "required": ["canvas", "updates"]}}),
        json!({"name": "canvas_arrange", "description": "Lay out blocks: grid (columns), column (top to bottom), row (left to right) in the given order, or stack (keep x, push overlapping blocks down using real heights). Rectangles drawn over a moved block move with it.",
            "inputSchema": {"type": "object", "properties": {
                "canvas": canvas,
                "ids": {"type": "array", "items": {"type": "string"}, "description": "Blocks in layout order (default: all non-shape blocks, top-to-bottom)"},
                "layout": {"type": "string", "enum": ["grid", "column", "row", "stack"]},
                "columns": {"type": "integer", "description": "grid: number of columns (default 2)"},
                "gap": {"type": "number", "description": "Gap in px (default 32)"},
                "x": {"type": "number"}, "y": {"type": "number"}
            }, "required": ["canvas", "layout"]}}),
        json!({"name": "canvas_connect", "description": "Draw arrows/lines between blocks.",
            "inputSchema": {"type": "object", "properties": {"canvas": canvas, "edges": {"type": "array", "items": edge}}, "required": ["canvas", "edges"]}}),
        json!({"name": "canvas_delete_blocks", "description": "Delete blocks (and their edges) from a canvas.",
            "inputSchema": {"type": "object", "properties": {"canvas": canvas, "ids": {"type": "array", "items": {"type": "string"}}}, "required": ["canvas", "ids"]}}),
    ]
}

/// 내 도구가 아니면 None.
pub fn call(app: &tauri::AppHandle, name: &str, args: &Value) -> Option<Result<Value, String>> {
    if !name.starts_with("canvas_") {
        return None;
    }
    if name == "canvas_guide" {
        return Some(Ok(Value::String(GUIDE.to_string())));
    }
    let known = tool_schemas()
        .iter()
        .any(|tool| tool["name"].as_str() == Some(name));
    if !known {
        return None;
    }
    Some(webview_call::call(app, name, args, TIMEOUT))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schemas_are_canvas_tools_with_object_inputs() {
        let tools = tool_schemas();
        assert_eq!(tools.len(), 8);
        for tool in &tools {
            assert!(tool["name"].as_str().unwrap().starts_with("canvas_"));
            assert_eq!(tool["inputSchema"]["type"], "object");
        }
        let add = tools.iter().find(|tool| tool["name"] == "canvas_add_blocks").unwrap();
        let props = &add["inputSchema"]["properties"]["blocks"]["items"]["properties"];
        assert!(props.get("from_text").is_some());
        assert!(props.get("background").is_some());
    }
}
