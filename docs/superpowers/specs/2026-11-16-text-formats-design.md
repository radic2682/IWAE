# TXT, HTML and XML documents (design + plan)

Date: 2026-11-16. Owner asked: support TXT, HTML and XML, and avoid building every reader feature once per format ("최대한 같은 함수는 묶고"). The owner skipped the design questions ("ㄱ"), so the choices below marked *(lead call)* are the lead's defaults.

## Intent

IWAE reads PDF and Markdown today. People also keep plain text notes, saved web pages and XML files next to their papers. They should open in IWAE with the same highlights, memos, search, bookmarks, outline, zoom, print and excerpts that Markdown already has, without a third, fourth and fifth reader to maintain.

## How readers work today (survey 2026-11-16)

- Two readers. PDF: PDFium page images + text layer (`src/pdf/PdfPane.tsx`). Markdown: DOM reader (`src/app/documents/MarkdownPane.tsx`): `renderMarkdown` (markdown-it + DOMPurify) → `dangerouslySetInnerHTML`; selection, highlights, search, bookmarks and memos all work on offsets into the article's `textContent`.
- `TabKind = 'pdf' | 'markdown' | 'memoNote' | 'canvas'`; `DocumentView` branches on `tab.kind`.
- File-type checks are scattered over ~15 places in TS and Rust (`isMarkdownPath`, two `kindFromPath`, regexes in `App.tsx`/`useVault.ts`, `documentDrop.ts`, `pickPdfFile`, Rust `open_files.rs`, `clipboard_files.rs`, `rag/source.rs`, MCP enums).
- Markdown is read with plugin-fs `readTextFile` (UTF-8 only, no size limit).

## Approach

Considered:
1. **One "flow" reader for every text format (chosen).** Keep the Markdown DOM reader and put a small per-format renderer in front of it: source text → sanitized HTML + headings. Everything after that (selection, highlights, memos, search, bookmarks, outline, zoom, print, excerpts, write layer) is shared. Formats differ only in one pure function.
2. A separate pane per format. Simple to start, but every feature is built and fixed 3 more times. This is what the owner wants to avoid.
3. Convert TXT/HTML/XML to PDF and use the PDF reader (the dormant `markdownAsPdf` path). One reader, but slow, loses text reflow, and needs a converter per format.

## Decisions

- **Formats** *(lead call)*: `.txt`, `.text`, `.log` → text; `.html`, `.htm`, `.xhtml` → html; `.xml` → xml. Markdown keeps `.md`, `.markdown`.
- **One registry**: `src/core/documentFormat.ts` owns every extension → `{ format: 'pdf'|'markdown'|'text'|'html'|'xml', reader: 'pdf'|'flow' }` decision. Every scattered check in TS calls it; Rust gets one matching helper. `isMarkdownPath` stays only where "Markdown" really means Markdown (legacy note migration, GitHub dialog, markdown export).
- **Tab kind**: keep the persisted value `'markdown'` for every flow document (saved workspaces keep working); document it as "flow document". The format comes from the path.
- **Vault index kind**: `'markdown'` stays for Markdown; new `'text'` for txt/html/xml (format from the extension). RAG and MCP accept `'text'`.
- **Rendering** (`src/core/flowRender.ts`, pure, tested):
  - Markdown: existing `renderMarkdown`.
  - Text: escape, keep line breaks and runs of spaces (`white-space: pre-wrap` block per paragraph; blank lines split paragraphs). No markup interpretation. Headings: none.
  - HTML *(lead call: reader mode)*: parse with DOMParser, keep the readable body (headings, paragraphs, lists, tables, code, images, links), drop scripts, styles, `<link>`, forms, iframes, inline event handlers and page CSS; reuse the Markdown DOMPurify config and image handling (local images through the existing blob loader; remote images stay blocked by the CSP). Reader theme applies. Headings from h1-h3.
  - XML *(lead call)*: pretty-printed, indented source with tag/attribute/text colouring, never interpreted as HTML. Malformed XML falls back to the text renderer with a notice. Headings: none.
- **Reading files**: one `readDocumentText` in the bridge: read bytes, decode UTF-8 (BOM stripped), UTF-16 LE/BE by BOM, else, if UTF-8 decoding produced replacement characters, try `euc-kr` (Korean CP949 files) *(lead call)*. Files over 20 MB are refused with a clear message *(lead call)*.
- **Opening**: open dialog (rename `pickPdfFile` → document picker with one "Documents" filter plus per-format filters), drag-and-drop, vault tree, links inside documents, OS "open with" (`open_files.rs`). No new OS file associations for txt/html/xml (installing IWAE must not take over those types).
- **Shared code cleanup** (owner's request): merge the two `kindFromPath`, the extension regexes, the three copies of the `createPersistentPdfHighlight({ docId, page: 0, ... })` block in `MarkdownPane`, and the duplicated load/pending/undo/subscribe logic of `usePdfHighlights` / `useMarkdownHighlights` / `usePdfBookmarks` into shared helpers. UI panels (search panel, outline panel, print) are not merged in this round: they need their own design and screen audit.
- **Small fix found in the survey**: `MarkdownPane.tsx:143` computes the image extension with `split('..')`, so every local image gets `application/octet-stream` and SVG images do not render.

## Non-goals

- Editing TXT/HTML/XML inside IWAE.
- Running page scripts or page CSS from HTML files.
- Remote images in HTML (blocked by the CSP; unchanged).
- XML tree folding, XSLT, schema validation.

## Global constraints

- Korean UI copy: 합니다체, short plain words, 칸/창/화면 fixed, versions are 「버전」, no em dashes in UI text. Code comments in this repo are Korean.
- Do not weaken the CSP or Tauri capabilities. Untrusted HTML/XML is rendered only through the sanitizer.
- Saved data stays compatible: existing `highlights.json`, `markdown-highlights.json`, `bookmarks.json`, workspace session files must load unchanged.
- Commits: English, no mention of Claude, no Co-Authored-By; explicit paths only; never push. `npm run release:scan` must pass.
- Tests: Vitest next to the source; `npm run typecheck`; `cargo test` for Rust changes (scratch target dir not needed for src-tauri).

## Tasks (sequential; they share files)

1. **Format registry**: `documentFormat.ts` + tests; replace every scattered extension/kind check in TS and Rust with it (keeping behaviour for pdf/md identical); vault index `'text'` kind; RAG/MCP accept `'text'`.
2. **Rendering and decoding**: `flowRender.ts` (text/html/xml renderers + tests incl. hostile HTML), `readDocumentText` (encodings, 20 MB cap + tests); `MarkdownPane` renders through `flowRender` by format; reader styles for text/xml blocks in both themes; SVG MIME fix.
3. **Opening paths**: document picker, drop, vault tree icons/labels per format, in-document links to txt/html/xml, `open_files.rs` / `clipboard_files.rs`, RAG text extraction for html/xml (strip tags), MCP.
4. **Shared code**: merge the duplicated highlight/bookmark storage logic and the repeated anchor block; no behaviour change; existing tests stay green.
5. **Lead audit**: open sample TXT (UTF-8, CP949, UTF-16), HTML (saved page with images, hostile script), XML (valid, malformed) in the dev app; highlight, memo, search, bookmark, outline, zoom, print, both themes, at 2x.
