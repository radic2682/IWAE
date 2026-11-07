//! MCP 도구: PDF 메모(형광펜 + 메모 카드). 실제 읽기·쓰기는 웹뷰(useMcpMemoBridge)가 한다.

use serde_json::{json, Value};

use super::webview_call;

const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

pub const INSTRUCTIONS: &str = "PDF memos (memo_* tools): a memo is a highlight on a PDF with a short note and an optional topic. \
The topic is a note title: memos with a topic are appended to the IWAE note <Vault>/노트/<topic>.iwnote (listed under 「노트」 in the left sidebar \
and shown in the right memo bar). A note is JSON, not Markdown: a .md file in 노트 is ignored by IWAE. \
memo_list shows existing memos (filter by doc_id/topic). memo_add creates memos: give doc_id, 1-based page, note (write it in the user's language, \
short, explaining what the passage means or why it matters), optional topic, and either from_text/to_text (the exact text to highlight, \
copied from read_page; whitespace/case do not matter) or kind:'region' for a table or figure. \
For a region, first look at the page with page_image and give rect (PDF points, origin top-left; page_image tells you points per pixel) \
so the box covers the caption, header and last row; then check it with page_image + the same rect before adding the memo. \
Use from_text/to_text for a region only when to_text is the last line of the table, and full_width only for figures. \
Prefer one memo per meaningful passage (a requirement sentence, a table row, a figure). Use the same topic for memos about one subject. \
memo_update changes note/topic/color (note:\"\" clears the memo text), memo_delete removes memos. \
Memo text and note text blocks accept Markdown: **bold**, *italic*, `code`, - lists, 1. lists, - [ ] checklists, > quotes, ### headings and | pipe | tables |. \
Notes (note_* tools): note_list lists notes; note_read returns a note's blocks (section titles, text blocks, memo blocks with their quote); \
note_append adds blocks at the end of a note (or after a block id): {kind:'section', title}, {kind:'text', markdown} (or html), or {kind:'memo', highlight_id}; \
the note is created if missing. note_update_block changes a block, note_delete_blocks removes blocks, note_delete moves a whole note to the trash. Use these while IWAE is open; \
never edit .iwnote files directly while IWAE runs. \
source_list/source_add/source_update/source_remove manage a document's original sources (URL, cloud link or folder path) so the user can reopen where a PDF came from.";

pub fn tool_schemas() -> Vec<Value> {
    let memo = json!({
        "type": "object",
        "properties": {
            "doc_id": {"type": "string", "description": "PDF document id (search_vault / list_documents doc_id)"},
            "page": {"type": "integer", "description": "1-based page"},
            "from_text": {"type": "string", "description": "Start of the text to highlight (or of the region), copied from read_page"},
            "to_text": {"type": "string", "description": "End of the text to highlight (searched after from_text). Omit to highlight just from_text"},
            "kind": {"type": "string", "enum": ["text", "region"], "description": "'text' (default) highlights characters; 'region' boxes a table/figure (prefer rect, found with page_image)"},
            "rect": {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "w": {"type": "number"}, "h": {"type": "number"}},
                "description": "region: box in PDF points, origin top-left. Find it with page_image (its result gives points_per_pixel), then confirm with page_image + this rect"},
            "full_width": {"type": "boolean", "description": "region from text, figures only: stretch across the text column"},
            "padding": {"type": "number", "description": "region from text: margin in points (default 6)"},
            "note": {"type": "string", "description": "The memo text (required). Markdown works: **bold**, - lists, | tables |"},
            "topic": {"type": "string", "description": "Note title, e.g. TIMING. The memo is appended to the note <Vault>/노트/<topic>.iwnote (created if missing)."},
            "color": {"type": "string", "enum": ["yellow", "green", "blue", "pink"]}
        },
        "required": ["doc_id", "page", "note"]
    });
    vec![
        json!({"name": "memo_list", "description": "List PDF memos and highlights (highlight + memo text + topic = note title), including highlights without memo text (only_with_note:true skips them). Filter by doc_id and/or topic. Also returns the topics in use.",
            "inputSchema": {"type": "object", "properties": {
                "doc_id": {"type": "string"},
                "topic": {"type": "string"},
                "only_with_note": {"type": "boolean"}
            }}}),
        json!({"name": "memo_add", "description": "Create memos on PDFs: highlight a passage (from_text/to_text) or box a table/figure (kind 'region') and attach memo text. Give topic (a note title) to put the memos into that IWAE note (the 「노트」 list); notes are .iwnote files, never write .md for them. An existing highlight at the same place gets the new text.",
            "inputSchema": {"type": "object", "properties": {"memos": {"type": "array", "items": memo}}, "required": ["memos"]}}),
        json!({"name": "memo_update", "description": "Change note, topic or color of memos by id (from memo_list / memo_add).",
            "inputSchema": {"type": "object", "properties": {"updates": {"type": "array", "items": {"type": "object", "properties": {
                "id": {"type": "string"}, "note": {"type": "string"}, "topic": {"type": "string", "description": "Note title; empty string removes it"},
                "color": {"type": "string", "enum": ["yellow", "green", "blue", "pink"]}
            }, "required": ["id"]}}}, "required": ["updates"]}}),
        json!({"name": "memo_delete", "description": "Delete memos (the highlight and its note) by id.",
            "inputSchema": {"type": "object", "properties": {"ids": {"type": "array", "items": {"type": "string"}}}, "required": ["ids"]}}),
        json!({"name": "source_list", "description": "List the original sources (URL, cloud link, folder/file path) recorded for a document. Without doc_id lists all documents' sources. 문서 원본 출처 목록.",
            "inputSchema": {"type": "object", "properties": {"doc_id": {"type": "string"}}}}),
        json!({"name": "source_add", "description": "Add original sources to a document: where the PDF came from or can be re-downloaded (https URL, cloud/Confluence link, or a folder/file path). Duplicates are skipped.",
            "inputSchema": {"type": "object", "properties": {
                "doc_id": {"type": "string"},
                "sources": {"type": "array", "items": {"type": "object", "properties": {
                    "target": {"type": "string", "description": "https://… or a folder/file path"},
                    "label": {"type": "string", "description": "e.g. original, vendor portal"},
                    "note": {"type": "string"}
                }, "required": ["target"]}}
            }, "required": ["doc_id", "sources"]}}),
        json!({"name": "source_update", "description": "Change a recorded source (target, label, note) by id.",
            "inputSchema": {"type": "object", "properties": {"doc_id": {"type": "string"}, "id": {"type": "string"}, "target": {"type": "string"}, "label": {"type": "string"}, "note": {"type": "string"}}, "required": ["doc_id", "id"]}}),
        json!({"name": "source_remove", "description": "Remove recorded sources by id.",
            "inputSchema": {"type": "object", "properties": {"doc_id": {"type": "string"}, "ids": {"type": "array", "items": {"type": "string"}}}, "required": ["doc_id", "ids"]}}),
        json!({"name": "note_list", "description": "List IWAE notes (the 「노트」 list): title, path, block count. 노트 목록.",
            "inputSchema": {"type": "object", "properties": {}}}),
        json!({"name": "note_read", "description": "Read one note by title: blocks in order (id, kind section/text/memo/ticket; section title, text as plain text + html, memo quote + note + doc/page, ticket also ticket_title).",
            "inputSchema": {"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"]}}),
        json!({"name": "note_append", "description": "Add blocks to a note (created if missing): sections, formatted text (Markdown incl. tables, or html), existing memos, or tickets (a memo shown as title + memo text + quoted requirement). Appends at the end, or after the block id given in after. 노트에 블록 넣기.",
            "inputSchema": {"type": "object", "properties": {
                "title": {"type": "string", "description": "Note title"},
                "after": {"type": "string", "description": "Insert after this block id (default: end)"},
                "blocks": {"type": "array", "items": {"type": "object", "properties": {
                    "kind": {"type": "string", "enum": ["section", "text", "memo", "ticket"]},
                    "title": {"type": "string", "description": "section title, or ticket title"},
                    "markdown": {"type": "string", "description": "text block content in Markdown (bold, lists, checklists, quotes, code, | tables |)"},
                    "html": {"type": "string", "description": "text block content as HTML (b, i, u, s, code, ul/ol/li, blockquote, pre, h2-h4, table/thead/tbody/tr/th/td, span color)"},
                    "highlight_id": {"type": "string", "description": "memo or ticket block: id of an existing memo (memo_list / memo_add)"}
                }, "required": ["kind"]}}
            }, "required": ["title", "blocks"]}}),
        json!({"name": "note_update_block", "description": "Change one block of a note: a section's title, a text block's content (markdown or html), or a memo/ticket block's ticket_id (free-form badge) and ticket_title (both empty turns it back into a plain memo).",
            "inputSchema": {"type": "object", "properties": {
                "title": {"type": "string", "description": "Note title"},
                "id": {"type": "string", "description": "Block id (from note_read / note_append)"},
                "section_title": {"type": "string"},
                "ticket_id": {"type": "string", "description": "free-form ID shown as a badge (REQ-01, TODO, Q1 ...); empty removes it"},
                "ticket_title": {"type": "string"},
                "markdown": {"type": "string"},
                "html": {"type": "string"}
            }, "required": ["title", "id"]}}),
        json!({"name": "note_delete", "description": "Delete a whole note by title (moved to the vault trash, restorable). The PDF memos in it stay.",
            "inputSchema": {"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"]}}),
        json!({"name": "note_delete_blocks", "description": "Remove blocks from a note by id (a memo block only leaves the note; the PDF memo stays).",
            "inputSchema": {"type": "object", "properties": {"title": {"type": "string"}, "ids": {"type": "array", "items": {"type": "string"}}}, "required": ["title", "ids"]}}),
    ]
}

pub fn call(app: &tauri::AppHandle, name: &str, args: &Value) -> Option<Result<Value, String>> {
    if !name.starts_with("memo_") && !name.starts_with("note_") && !name.starts_with("source_") {
        return None;
    }
    let known = tool_schemas().iter().any(|tool| tool["name"].as_str() == Some(name));
    if !known {
        return None;
    }
    Some(webview_call::call(app, name, args, TIMEOUT))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schemas_are_memo_tools_with_object_inputs() {
        let tools = tool_schemas();
        assert_eq!(tools.len(), 14);
        for tool in &tools {
            let name = tool["name"].as_str().unwrap();
            assert!(name.starts_with("memo_") || name.starts_with("note_") || name.starts_with("source_"));
            assert_eq!(tool["inputSchema"]["type"], "object");
        }
        let add = tools.iter().find(|tool| tool["name"] == "memo_add").unwrap();
        let props = &add["inputSchema"]["properties"]["memos"]["items"]["properties"];
        assert!(props.get("from_text").is_some());
        assert!(props.get("topic").is_some());
    }
}
