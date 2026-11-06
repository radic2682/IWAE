"""Generate IWAE's self-authored browser PDF preview and PDFium fixture."""

from __future__ import annotations

import hashlib
import json
import textwrap
from pathlib import Path

import pypdfium2 as pdfium
from reportlab.lib.colors import HexColor, white
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public" / "dev-pdf"
PDF = PUBLIC / "iwae-web-preview.pdf"
DATA = ROOT / "src" / "pdf" / "devPdfData.json"
PAGE_WIDTH = 612
PAGE_HEIGHT = 792
TITLE = "IWAE — Evidence-Linked Research Guide"
SECTIONS = [
    "From Evidence to Insight",
    "A Reading Workflow",
    "Capture Meaningful Evidence",
    "Keep Context Attached",
    "Synthesize on the Canvas",
    "Review Checklist",
]

INK = HexColor("#17212B")
MUTED = HexColor("#647181")
PAPER = HexColor("#F4F6F4")
SURFACE = white
NAVY = HexColor("#18334A")
TEAL = HexColor("#147D78")
MINT = HexColor("#BDE8DA")
CORAL = HexColor("#F27C62")
SUN = HexColor("#F5C85B")
LINE = HexColor("#D9E0E4")


def wrapped_lines(text: str, width: int) -> list[str]:
    return textwrap.wrap(text, width=width, break_long_words=False, break_on_hyphens=False)


def draw_text(
    doc: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    *,
    size: float = 11,
    color=INK,
    font: str = "Helvetica",
    width: int = 72,
    leading: float | None = None,
) -> float:
    line_height = leading or size * 1.45
    doc.setFillColor(color)
    doc.setFont(font, size)
    for line in wrapped_lines(text, width):
        doc.drawString(x, y, line)
        y -= line_height
    return y


def rounded_card(doc: canvas.Canvas, x: float, y: float, w: float, h: float, fill=SURFACE, radius: float = 12) -> None:
    doc.setFillColor(fill)
    doc.setStrokeColor(LINE)
    doc.setLineWidth(0.8)
    doc.roundRect(x, y, w, h, radius, fill=1, stroke=1)


def add_outline(doc: canvas.Canvas, page: int, title: str) -> None:
    key = f"page-{page}"
    doc.bookmarkPage(key)
    doc.addOutlineEntry(title, key, level=0, closed=False)


def page_header(doc: canvas.Canvas, page: int, title: str) -> None:
    add_outline(doc, page, title)
    doc.setFillColor(PAPER)
    doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    doc.setFillColor(TEAL)
    doc.roundRect(42, 742, 34, 24, 8, fill=1, stroke=0)
    doc.setFillColor(white)
    doc.setFont("Helvetica-Bold", 10)
    doc.drawCentredString(59, 750, f"{page:02d}")
    doc.setFillColor(MUTED)
    doc.setFont("Helvetica-Bold", 9)
    doc.drawString(88, 751, "IWAE RESEARCH WORKFLOW")
    doc.setStrokeColor(LINE)
    doc.line(42, 730, 570, 730)


def footer(doc: canvas.Canvas, page: int) -> None:
    doc.setStrokeColor(LINE)
    doc.line(42, 42, 570, 42)
    doc.setFillColor(MUTED)
    doc.setFont("Helvetica", 8)
    doc.drawString(42, 28, "Self-authored sample document for testing selection, search, capture, and source tracing.")
    doc.drawRightString(570, 28, f"{page} / {len(SECTIONS)}")


def draw_cover(doc: canvas.Canvas) -> None:
    page_header(doc, 1, SECTIONS[0])
    doc.setFillColor(NAVY)
    doc.roundRect(42, 420, 528, 282, 24, fill=1, stroke=0)
    doc.setFillColor(MINT)
    doc.setFont("Helvetica-Bold", 12)
    doc.drawString(72, 660, "IWAE FIELD GUIDE  /  2026")
    doc.setFillColor(white)
    doc.setFont("Helvetica-Bold", 34)
    doc.drawString(72, 603, "From Evidence")
    doc.drawString(72, 561, "to Insight")
    draw_text(
        doc,
        "A practical workflow for turning source material into connected, reviewable knowledge without losing its origin.",
        72,
        518,
        size=13,
        color=HexColor("#DCE7EE"),
        width=58,
        leading=19,
    )
    for index, (label, description, color) in enumerate(
        [
            ("READ", "Inspect the source at full fidelity.", TEAL),
            ("CAPTURE", "Lift only the evidence you need.", CORAL),
            ("CONNECT", "Arrange claims into a visible argument.", SUN),
        ]
    ):
        x = 42 + index * 180
        rounded_card(doc, x, 254, 168, 132)
        doc.setFillColor(color)
        doc.circle(x + 26, 355, 8, fill=1, stroke=0)
        doc.setFillColor(INK)
        doc.setFont("Helvetica-Bold", 12)
        doc.drawString(x + 18, 323, label)
        draw_text(doc, description, x + 18, 296, size=10, color=MUTED, width=25, leading=15)
    doc.setFillColor(TEAL)
    doc.roundRect(42, 98, 528, 112, 18, fill=1, stroke=0)
    doc.setFillColor(white)
    doc.setFont("Helvetica-Bold", 15)
    doc.drawString(66, 173, "The core promise")
    draw_text(
        doc,
        "Every idea remains inspectable: you can see what it means, where it came from, and how it supports the work around it.",
        66,
        145,
        size=11,
        color=white,
        width=76,
        leading=17,
    )
    footer(doc, 1)
    doc.showPage()


def draw_workflow(doc: canvas.Canvas) -> None:
    page_header(doc, 2, SECTIONS[1])
    doc.setFillColor(INK)
    doc.setFont("Helvetica-Bold", 26)
    doc.drawString(42, 688, "A Reading Workflow")
    doc.setFillColor(MUTED)
    doc.setFont("Helvetica", 10)
    doc.drawString(42, 655, "A useful research note preserves the claim, the surrounding context, and a direct route back to the source.")

    steps = [
        ("01", "Orient", "Scan the outline, identify the author's purpose, and mark the section that answers your current question."),
        ("02", "Capture", "Select the smallest passage that still contains the claim, its qualifier, and the words needed to interpret it."),
        ("03", "Connect", "Place the excerpt near related evidence, then add a short note that states why the relationship matters."),
        ("04", "Verify", "Return to the source before publishing. Confirm wording, page location, and whether later evidence changes the claim."),
    ]
    y = 568
    for number, label, body in steps:
        rounded_card(doc, 42, y, 528, 100)
        doc.setFillColor(MINT)
        doc.roundRect(58, y + 20, 54, 60, 12, fill=1, stroke=0)
        doc.setFillColor(NAVY)
        doc.setFont("Helvetica-Bold", 17)
        doc.drawCentredString(85, y + 42, number)
        doc.setFillColor(INK)
        doc.setFont("Helvetica-Bold", 14)
        doc.drawString(132, y + 63, label)
        draw_text(doc, body, 132, y + 40, size=10, color=MUTED, width=70, leading=14)
        y -= 116

    footer(doc, 2)
    doc.showPage()


def draw_capture(doc: canvas.Canvas) -> None:
    page_header(doc, 3, SECTIONS[2])
    doc.setFillColor(INK)
    doc.setFont("Helvetica-Bold", 26)
    doc.drawString(42, 688, "Capture Meaningful Evidence")
    doc.setFillColor(MUTED)
    doc.setFont("Helvetica", 9.5)
    doc.drawString(42, 655, "Capture only enough material to preserve meaning; the smallest useful excerpt is easier to compare and reuse.")

    rounded_card(doc, 42, 454, 528, 160)
    doc.setFillColor(INK)
    doc.setFont("Helvetica-Bold", 13)
    doc.drawString(62, 582, "Selection quality test")
    draw_text(
        doc,
        "Read the excerpt without looking at the page. If the subject, claim, or limiting condition becomes ambiguous, expand the selection by one sentence and test again.",
        62,
        550,
        size=12,
        width=72,
        leading=19,
    )
    doc.setFillColor(SUN)
    doc.roundRect(62, 462, 488, 38, 10, fill=1, stroke=0)
    doc.setFillColor(NAVY)
    doc.setFont("Helvetica-Bold", 10)
    doc.drawString(78, 475, "Good evidence is concise, but never context-free.")

    columns = [42, 218, 394, 570]
    top = 404
    row_height = 54
    headers = ["SIGNAL", "TOO LITTLE", "USEFUL CAPTURE"]
    doc.setFillColor(NAVY)
    doc.rect(42, top, 528, 42, fill=1, stroke=0)
    doc.setFillColor(white)
    doc.setFont("Helvetica-Bold", 9)
    for index, header in enumerate(headers):
        doc.drawString(columns[index] + 10, top + 15, header)
    rows = [
        ("Claim", "Result only", "Result plus subject"),
        ("Constraint", "Number only", "Number plus condition"),
        ("Definition", "Term only", "Term plus defining sentence"),
        ("Exception", "Warning only", "Rule plus exception"),
    ]
    for row_index, row in enumerate(rows):
        y = top - (row_index + 1) * row_height
        doc.setFillColor(SURFACE if row_index % 2 == 0 else HexColor("#E9EFED"))
        doc.rect(42, y, 528, row_height, fill=1, stroke=0)
        doc.setStrokeColor(LINE)
        doc.line(218, y, 218, y + row_height)
        doc.line(394, y, 394, y + row_height)
        for column_index, value in enumerate(row):
            cell_color = INK if column_index != 1 else CORAL
            doc.setFillColor(cell_color)
            doc.setFont("Helvetica-Bold" if column_index == 0 else "Helvetica", 9)
            draw_text(doc, value, columns[column_index] + 10, y + 32, size=9, color=cell_color, width=24, leading=13)

    footer(doc, 3)
    doc.showPage()


def draw_context(doc: canvas.Canvas) -> None:
    page_header(doc, 4, SECTIONS[3])
    doc.setFillColor(INK)
    doc.setFont("Helvetica-Bold", 26)
    doc.drawString(42, 688, "Keep Context Attached")
    draw_text(
        doc,
        "An excerpt is valuable because it can be checked. A source link should survive movement, resizing, translation, and visual rearrangement.",
        42,
        651,
        size=11,
        color=MUTED,
        width=82,
        leading=17,
    )

    rounded_card(doc, 42, 418, 332, 174)
    doc.setFillColor(INK)
    doc.setFont("Helvetica-Bold", 13)
    doc.drawString(62, 558, "A durable source anchor stores")
    items = [
        "Document identity",
        "Page and selected geometry",
        "Exact quoted text",
        "Text before and after the quote",
    ]
    y = 526
    for item in items:
        doc.setFillColor(TEAL)
        doc.circle(70, y + 3, 4, fill=1, stroke=0)
        doc.setFillColor(INK)
        doc.setFont("Helvetica", 11)
        doc.drawString(84, y, item)
        y -= 29

    rounded_card(doc, 394, 418, 176, 174, fill=NAVY)
    doc.setFillColor(MINT)
    doc.setFont("Helvetica-Bold", 11)
    doc.drawString(414, 558, "SOURCE TRACE")
    doc.setStrokeColor(HexColor("#587487"))
    doc.setLineWidth(2)
    doc.line(424, 521, 536, 521)
    doc.setFillColor(SUN)
    doc.circle(424, 521, 7, fill=1, stroke=0)
    doc.setFillColor(CORAL)
    doc.circle(536, 521, 7, fill=1, stroke=0)
    draw_text(doc, "Page 4", 414, 486, size=10, color=white, width=20)
    draw_text(doc, "Excerpt block", 414, 452, size=10, color=white, width=20)

    doc.setFillColor(TEAL)
    doc.roundRect(42, 230, 528, 144, 18, fill=1, stroke=0)
    doc.setFillColor(white)
    doc.setFont("Helvetica-Bold", 13)
    doc.drawString(66, 337, "Trust rule")
    draw_text(
        doc,
        "Keep source identity, page location, selected geometry, and quoted text together. If one part changes, the link should be treated as stale rather than silently trusted.",
        66,
        304,
        size=11,
        color=white,
        width=73,
        leading=18,
    )
    rounded_card(doc, 42, 92, 528, 102)
    doc.setFillColor(CORAL)
    doc.setFont("Helvetica-Bold", 11)
    doc.drawString(62, 160, "Review cue")
    draw_text(doc, "When a source moves, show uncertainty. Never repair a citation by guessing silently.", 62, 134, size=10, color=INK, width=82)

    footer(doc, 4)
    doc.showPage()


def draw_canvas(doc: canvas.Canvas) -> None:
    page_header(doc, 5, SECTIONS[4])
    doc.setFillColor(INK)
    doc.setFont("Helvetica-Bold", 26)
    doc.drawString(42, 688, "Synthesize on the Canvas")
    doc.setFillColor(MUTED)
    doc.setFont("Helvetica", 9.5)
    doc.drawString(42, 655, "Spatial arrangement turns a list of quotations into an argument you can inspect.")

    doc.setStrokeColor(HexColor("#9CB2BD"))
    doc.setLineWidth(2)
    doc.line(166, 520, 305, 600)
    doc.line(166, 520, 305, 446)
    doc.line(421, 600, 492, 520)
    doc.line(421, 446, 492, 520)
    nodes = [
        (42, 466, 124, 108, MINT, "QUESTION", "What does the evidence support?"),
        (305, 552, 116, 96, SURFACE, "SOURCE A", "Direct observation"),
        (305, 398, 116, 96, SURFACE, "SOURCE B", "Limiting condition"),
        (492, 466, 78, 108, SUN, "CLAIM", "A bounded conclusion"),
    ]
    for x, y, w, h, fill, label, body in nodes:
        rounded_card(doc, x, y, w, h, fill=fill)
        doc.setFillColor(NAVY)
        doc.setFont("Helvetica-Bold", 9)
        doc.drawString(x + 14, y + h - 24, label)
        draw_text(doc, body, x + 14, y + h - 49, size=9, color=INK, width=max(10, int(w / 6.5)), leading=13)

    rounded_card(doc, 42, 176, 528, 162, fill=NAVY)
    doc.setFillColor(MINT)
    doc.setFont("Helvetica-Bold", 10)
    doc.drawString(64, 307, "A SMALL, EXPLICIT NOTE IS ENOUGH")
    code_lines = [
        "question  ->  evidence",
        "evidence  ->  interpretation",
        "interpretation  ->  reviewable claim",
    ]
    y = 270
    for line in code_lines:
        doc.setFillColor(white)
        doc.setFont("Courier", 12)
        doc.drawString(66, y, line)
        y -= 31
    rounded_card(doc, 42, 86, 528, 60)
    draw_text(doc, "Use proximity for grouping and visible connectors for claims that must remain explicit.", 62, 118, size=10, color=INK, width=84)

    footer(doc, 5)
    doc.showPage()


def draw_checklist(doc: canvas.Canvas) -> None:
    page_header(doc, 6, SECTIONS[5])
    doc.setFillColor(INK)
    doc.setFont("Helvetica-Bold", 26)
    doc.drawString(42, 688, "Review Checklist")
    draw_text(
        doc,
        "Before a note becomes a decision, draft, or published explanation, test whether another reader can retrace the reasoning.",
        42,
        651,
        size=11,
        color=MUTED,
        width=82,
        leading=17,
    )
    checks = [
        ("SOURCE", "Can every excerpt return to its document and page?"),
        ("CONTEXT", "Does each capture include the qualifier that changes its meaning?"),
        ("STRUCTURE", "Can the reader tell which evidence supports, limits, or contradicts the claim?"),
        ("LANGUAGE", "Are your own words visually distinct from quoted material?"),
        ("REVIEW", "Did you revisit the original source after arranging the final argument?"),
    ]
    y = 540
    for index, (label, question) in enumerate(checks):
        rounded_card(doc, 42, y, 528, 86)
        doc.setFillColor(TEAL if index % 2 == 0 else CORAL)
        doc.roundRect(60, y + 22, 42, 42, 10, fill=1, stroke=0)
        doc.setFillColor(white)
        doc.setFont("Helvetica-Bold", 16)
        doc.drawCentredString(81, y + 35, "OK")
        doc.setFillColor(INK)
        doc.setFont("Helvetica-Bold", 10)
        doc.drawString(122, y + 53, label)
        draw_text(doc, question, 122, y + 31, size=10, color=MUTED, width=67, leading=14)
        y -= 101

    doc.setFillColor(NAVY)
    doc.roundRect(42, 72, 528, 64, 16, fill=1, stroke=0)
    doc.setFillColor(white)
    doc.setFont("Helvetica-Bold", 11)
    doc.drawCentredString(306, 98, "Evidence is useful when it remains understandable, connected, and verifiable.")
    footer(doc, 6)
    doc.showPage()


def make_pdf() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    doc = canvas.Canvas(str(PDF), pagesize=(PAGE_WIDTH, PAGE_HEIGHT), pageCompression=1)
    doc.setTitle(TITLE)
    doc.setAuthor("IWAE")
    doc.setSubject("Evidence-linked reading and note-taking sample")
    draw_cover(doc)
    draw_workflow(doc)
    draw_capture(doc)
    draw_context(doc)
    draw_canvas(doc)
    draw_checklist(doc)
    doc.save()


def remove_stale_pages() -> None:
    for path in PUBLIC.glob("page-*.png"):
        path.unlink()


def export_fixture() -> None:
    make_pdf()
    remove_stale_pages()
    document = pdfium.PdfDocument(str(PDF))
    pages = []
    page_sizes = []
    has_text = False
    for page_number in range(len(document)):
        page = document[page_number]
        width, height = page.get_size()
        page_sizes.append([width, height])
        bitmap = page.render(scale=1440 / width, rev_byteorder=True)
        bitmap.to_pil().save(PUBLIC / f"page-{page_number + 1}.png", optimize=True)
        text_page = page.get_textpage()
        count = text_page.count_chars()
        text = text_page.get_text_range()
        chars = []
        for char_index in range(count):
            left, bottom, right, top = text_page.get_charbox(char_index)
            chars.append(
                {
                    "c": text[char_index] if char_index < len(text) else "",
                    "x": left,
                    "y": height - top,
                    "w": max(0, right - left),
                    "h": max(0, top - bottom),
                }
            )
        has_text = has_text or any(character["c"].strip() for character in chars)
        pages.append({"page": page_number, "text": text, "chars": chars})
        text_page.close()
        page.close()
    document.close()

    digest = hashlib.sha256(PDF.read_bytes()).hexdigest()
    fixture = {
        "metadata": {
            "docId": digest[:12],
            "sha256": digest,
            "size": PDF.stat().st_size,
            "title": TITLE,
            "pageCount": len(pages),
            "pageSizes": page_sizes,
            "hasText": has_text,
        },
        "pages": pages,
        "outline": [
            {"title": title, "page": page_number, "depth": 0}
            for page_number, title in enumerate(SECTIONS)
        ],
    }
    DATA.write_text(json.dumps(fixture, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    export_fixture()
