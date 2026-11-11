import type { ExportPdfHighlight, PdfFlatOverlay, PdfToolOp } from '../bridge/pdf'
import type { PersistentPdfHighlight } from '../pdf/persistentHighlight'
import { DEFAULT_HIGHLIGHT_COLORS, highlightExportRgb, type HighlightColorDef } from './highlightColors'
import { isRedaction, type PdfOverlay } from './pdfOverlays'


/** 내 표시 굽기에 넣을 것 */
export interface FlattenChoice {
  readonly highlights: boolean
  readonly overlays: boolean
  readonly notes: boolean
  readonly redactions: boolean
}

export interface FlattenCounts {
  readonly highlights: number
  readonly overlays: number
  readonly notes: number
  readonly redactions: number
}

/** 이 문서의 표시를 종류별로 센다(도구 창에 보일 수) */
export function countMarks(docId: string, highlights: readonly PersistentPdfHighlight[], overlays: readonly PdfOverlay[]): FlattenCounts {
  const mine = highlights.filter((highlight) => highlight.anchor.docId === docId)
  return {
    highlights: mine.filter((highlight) => highlight.kind !== 'region' && highlight.box === undefined).length,
    notes: mine.filter((highlight) => (highlight.kind === 'region' || highlight.box !== undefined) && (highlight.note ?? '').trim() !== '').length,
    overlays: overlays.filter((overlay) => !isRedaction(overlay)).length,
    redactions: overlays.filter(isRedaction).length,
  }
}

function overlayToFlat(overlay: PdfOverlay): PdfFlatOverlay | null {
  switch (overlay.kind) {
    case 'text':
      return overlay.text.trim() === '' ? null : { kind: 'text', page: overlay.page, x: overlay.x, y: overlay.y, w: overlay.w, text: overlay.text, size: overlay.size, color: overlay.color, bold: overlay.bold === true, fill: overlay.fill ?? null, border: overlay.border === true, ...(overlay.border === true && overlay.borderColor !== undefined ? { borderColor: overlay.borderColor } : {}), ...(overlay.font === undefined ? {} : { font: overlay.font }) }
    case 'line':
      return { kind: 'line', page: overlay.page, x1: overlay.x1, y1: overlay.y1, x2: overlay.x2, y2: overlay.y2, color: overlay.color, width: overlay.width, arrow: overlay.arrow === true, arrowStart: overlay.arrowStart === true, dashed: overlay.dashed === true, dotted: overlay.dotted === true }
    case 'ink':
      return overlay.points.length < 2 ? null : { kind: 'ink', page: overlay.page, points: overlay.points, color: overlay.color, width: overlay.width }
    case 'shape':
      return overlay.shape === 'redact' ? null : { kind: 'shape', page: overlay.page, shape: overlay.shape, x: overlay.x, y: overlay.y, w: overlay.w, h: overlay.h, color: overlay.color, width: overlay.width, fill: overlay.fill === true, dashed: overlay.dashed === true, dotted: overlay.dotted === true }
  }
}

/**
 * 내 표시 굽기 요청을 만든다. 글자 형광펜은 PDF 형광펜 주석(메모는 주석 내용), 영역·박스 메모는 붙임 쪽지,
 * 글 상자·선·펜·도형은 PDF 그림으로, 가리기 상자는 정말로 지운다.
 */
export function buildFlattenOp(
  docId: string,
  highlights: readonly PersistentPdfHighlight[],
  overlays: readonly PdfOverlay[],
  choice: FlattenChoice,
  colors: readonly HighlightColorDef[] = DEFAULT_HIGHLIGHT_COLORS,
): Extract<PdfToolOp, { kind: 'flatten' }> {
  const mine = highlights.filter((highlight) => highlight.anchor.docId === docId)
  const textMarks: ExportPdfHighlight[] = choice.highlights
    ? mine
        .filter((highlight) => highlight.kind !== 'region' && highlight.box === undefined && highlight.anchor.rects.length > 0)
        .map((highlight) => ({
          page: highlight.anchor.page,
          rects: highlight.anchor.rects.map((rect) => ({ x: rect.x, y: rect.y, w: rect.w, h: rect.h })),
          color: highlightExportRgb(colors, highlight.color),
          note: (highlight.note ?? '').trim() === '' ? null : highlight.note!.trim(),
        }))
    : []
  const notes = choice.notes
    ? mine.flatMap((highlight) => {
        const text = (highlight.note ?? '').trim()
        if (text === '' || (highlight.kind !== 'region' && highlight.box === undefined)) return []
        const rect = highlight.box !== undefined
          ? { x: highlight.box.x, y: highlight.box.y, w: highlight.box.w, h: highlight.box.h ?? 40 }
          : highlight.anchor.rects[0]
        return rect === undefined ? [] : [{ page: highlight.anchor.page, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, text }]
      })
    : []
  return {
    kind: 'flatten',
    highlights: textMarks,
    overlays: choice.overlays ? overlays.flatMap((overlay) => {
      const flat = overlayToFlat(overlay)
      return flat === null ? [] : [flat]
    }) : [],
    notes,
    redactions: choice.redactions
      ? overlays.filter(isRedaction).map((shape) => ({ page: shape.page, rect: { x: shape.x, y: shape.y, w: shape.w, h: shape.h } }))
      : [],
  }
}

/**
 * 「1-3, 5, 8-」 같은 쪽 범위(1 부터)를 0 부터의 쪽 번호로. 순서를 지키고 겹치면 한 번만. 못 읽으면 null.
 * 끝을 비우면(8-) 마지막 쪽까지.
 */
export function parsePageRanges(input: string, pageCount: number): number[] | null {
  const parts = input.split(/[,，\s]+/u).map((part) => part.trim()).filter((part) => part !== '')
  if (parts.length === 0) return null
  const pages: number[] = []
  const seen = new Set<number>()
  for (const part of parts) {
    const match = /^(\d+)?\s*[-~–]\s*(\d+)?$/u.exec(part) ?? /^(\d+)$/u.exec(part)
    if (match === null) return null
    const isRange = /[-~–]/u.test(part)
    const from = match[1] === undefined ? 1 : Number(match[1])
    const to = isRange ? (match[2] === undefined ? pageCount : Number(match[2])) : from
    if (from < 1 || to < 1 || from > pageCount) return null
    const step = from <= to ? 1 : -1
    for (let page = from; step > 0 ? page <= Math.min(to, pageCount) : page >= to; page += step) {
      if (!seen.has(page - 1)) {
        seen.add(page - 1)
        pages.push(page - 1)
      }
    }
  }
  return pages
}

/** 목차 맨 위 단계로 나눌 범위(0 부터, 끝 포함). 첫 장 앞의 쪽은 「앞부분」으로 */
export function chapterRanges(
  outline: readonly { readonly title: string; readonly page: number | null; readonly depth: number }[],
  pageCount: number,
): { title: string; from: number; to: number }[] {
  const top = outline
    .filter((entry) => entry.depth === 0 && entry.page !== null && entry.page >= 0 && entry.page < pageCount)
    .map((entry) => ({ title: entry.title.trim() || '장', page: entry.page! }))
    .sort((a, b) => a.page - b.page)
  const starts = top.filter((entry, index) => index === 0 || entry.page !== top[index - 1]!.page)
  if (starts.length === 0) return []
  const ranges: { title: string; from: number; to: number }[] = []
  if (starts[0]!.page > 0) ranges.push({ title: '앞부분', from: 0, to: starts[0]!.page - 1 })
  starts.forEach((entry, index) => {
    const next = starts[index + 1]
    ranges.push({ title: entry.title, from: entry.page, to: next === undefined ? pageCount - 1 : next.page - 1 })
  })
  return ranges
}

/** 파일 이름에 못 쓰는 글자를 지우고 줄인다 */
export function safeFileStem(name: string, max = 60): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '').replace(/\s+/gu, ' ').trim()
  return (cleaned === '' ? 'PDF' : cleaned).slice(0, max).trim()
}
