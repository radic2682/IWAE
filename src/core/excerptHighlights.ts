import type { PdfExcerptCrop, PdfExcerptSelection } from './pdfExcerpt'
import { isHighlightColorId } from './highlightColors'

/** 발췌 위 형광펜 색 */
export type ExcerptHighlightColor = string

/**
 * 발췌 이미지 위에 칠한 형광펜. 좌표는 PDF 쪽 좌표(발췌 crop 과 같은 기준)라
 * 블록 크기를 바꿔도 같은 글자 위에 남는다.
 */
export interface ExcerptHighlight {
  readonly id: string
  readonly color: ExcerptHighlightColor
  readonly rects: readonly PdfExcerptCrop[]
}

/** 형광펜에 이어진 선의 손잡이 id. 선은 이 손잡이에서 메모로 간다 */
export function highlightHandleId(highlightId: string, side: 'left' | 'right' = 'right'): string {
  return side === 'right' ? `hl:${highlightId}` : `hl:${highlightId}:left`
}

export function highlightIdFromHandle(handle: string | null | undefined): string | null {
  if (typeof handle !== 'string' || !handle.startsWith('hl:')) return null
  const rest = handle.slice(3)
  return rest.endsWith(':left') ? rest.slice(0, -5) : rest
}

export function isExcerptHighlightColor(value: unknown): value is ExcerptHighlightColor {
  return isHighlightColorId(value)
}

function isFiniteRect(value: unknown): value is PdfExcerptCrop {
  if (typeof value !== 'object' || value === null) return false
  const { x, y, w, h } = value as Record<string, unknown>
  return [x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n)) && (w as number) > 0 && (h as number) > 0
}

export function parseExcerptHighlights(value: unknown): ExcerptHighlight[] | undefined {
  if (!Array.isArray(value)) return undefined
  const highlights = value.flatMap((item): ExcerptHighlight[] => {
    if (typeof item !== 'object' || item === null) return []
    const { id, color, rects } = item as Record<string, unknown>
    if (typeof id !== 'string' || id.length === 0 || !isExcerptHighlightColor(color) || !Array.isArray(rects)) return []
    const valid = rects.filter(isFiniteRect).map(({ x, y, w, h }) => ({ x, y, w, h }))
    return valid.length === 0 ? [] : [{ id, color, rects: valid }]
  })
  return highlights.length === 0 ? undefined : highlights
}

function clipToCrop(rect: PdfExcerptCrop, crop: PdfExcerptCrop): PdfExcerptCrop | null {
  const x0 = Math.max(rect.x, crop.x)
  const y0 = Math.max(rect.y, crop.y)
  const x1 = Math.min(rect.x + rect.w, crop.x + crop.w)
  const y1 = Math.min(rect.y + rect.h, crop.y + crop.h)
  return x1 - x0 > 0.5 && y1 - y0 > 0.5 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

const round = (value: number) => Math.round(value * 100) / 100

/**
 * 끈 영역을 형광펜 모양으로 바꾼다. 글자가 있으면 지나간 글자들을 줄마다 감싸고(형광펜처럼),
 * 글자가 없는 곳(그림·선)이면 끈 네모 그대로 칠한다. 결과는 발췌 영역 밖으로 나가지 않는다.
 */
export function highlightRectsFromDrag(selection: Pick<PdfExcerptSelection, 'crop' | 'glyphs'>, drag: PdfExcerptCrop): PdfExcerptCrop[] {
  const area = clipToCrop(drag, selection.crop)
  if (area === null) return []
  const left = area.x
  const right = area.x + area.w
  const top = area.y
  const bottom = area.y + area.h
  const touched = selection.glyphs.filter((glyph) => {
    if (glyph.c.trim().length === 0 || !(glyph.w > 0) || !(glyph.h > 0)) return false
    const centerX = glyph.x + glyph.w / 2
    if (centerX < left || centerX > right) return false
    const overlap = Math.min(bottom, glyph.y + glyph.h) - Math.max(top, glyph.y)
    // 줄 높이의 1/3 이상 지나간 글자만 (윗줄·아랫줄을 살짝 스친 것은 빼고)
    return overlap >= Math.min(glyph.h, area.h) / 3
  })
  if (touched.length === 0) return [area]

  const lines: { top: number; bottom: number; left: number; right: number }[] = []
  for (const glyph of [...touched].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const middle = glyph.y + glyph.h / 2
    const line = lines.find((candidate) => middle >= candidate.top && middle <= candidate.bottom)
    if (line === undefined) {
      lines.push({ top: glyph.y, bottom: glyph.y + glyph.h, left: glyph.x, right: glyph.x + glyph.w })
    } else {
      line.top = Math.min(line.top, glyph.y)
      line.bottom = Math.max(line.bottom, glyph.y + glyph.h)
      line.left = Math.min(line.left, glyph.x)
      line.right = Math.max(line.right, glyph.x + glyph.w)
    }
  }
  return lines
    .sort((a, b) => a.top - b.top)
    .flatMap((line) => {
      const rect = clipToCrop({ x: line.left - 1, y: line.top - 0.5, w: line.right - line.left + 2, h: line.bottom - line.top + 1 }, selection.crop)
      return rect === null ? [] : [{ x: round(rect.x), y: round(rect.y), w: round(rect.w), h: round(rect.h) }]
    })
}

/** 형광펜 전체를 감싸는 네모(선 손잡이 위치를 정할 때 쓴다) */
export function highlightBounds(highlight: Pick<ExcerptHighlight, 'rects'>): PdfExcerptCrop {
  const x0 = Math.min(...highlight.rects.map((rect) => rect.x))
  const y0 = Math.min(...highlight.rects.map((rect) => rect.y))
  const x1 = Math.max(...highlight.rects.map((rect) => rect.x + rect.w))
  const y1 = Math.max(...highlight.rects.map((rect) => rect.y + rect.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
