import { buildAnchor } from './anchor'
import { DEFAULT_HIGHLIGHT_COLORS, nearestColorId, type HighlightColorDef } from './highlightColors'
import type { PageTextIndex } from './textIndex'
import type { ImportedPdfAnnotation, PdfLinkRect } from '../bridge/pdf'
import {
  createPersistentPdfHighlight,
  type PdfHighlightColor,
  type PersistentPdfHighlight,
} from '../pdf/persistentHighlight'

/** 다른 프로그램의 색을 내 형광펜 색 목록 중 가장 가까운 것으로 바꾼다 */
export function nearestHighlightColor(color: readonly [number, number, number] | null, colors: readonly HighlightColorDef[] = DEFAULT_HIGHLIGHT_COLORS): PdfHighlightColor {
  return nearestColorId(colors, color)
}

const overlaps = (box: { x: number; y: number; w: number; h: number }, rect: PdfLinkRect) =>
  box.w > 0 && box.h > 0
  && box.x + box.w * 0.5 >= rect.x && box.x + box.w * 0.5 <= rect.x + rect.w
  && box.y + box.h * 0.5 >= rect.y && box.y + box.h * 0.5 <= rect.y + rect.h

/** 사각형이 덮는 글자 범위. 글자 가운데가 사각형 안에 들어오면 덮은 것으로 친다 */
function coveredRange(index: PageTextIndex, rects: readonly PdfLinkRect[]): [number, number] | null {
  let start = -1
  let end = -1
  index.chars.forEach((box, at) => {
    if (!rects.some((rect) => overlaps(box, rect))) return
    if (start === -1) start = at
    end = at + 1
  })
  return start === -1 ? null : [start, end]
}

/** 붙임 쪽지는 글자를 덮지 않는다. 쪽지 가운데에서 가장 가까운 글자 하나에 붙인다 */
function nearestChar(index: PageTextIndex, rect: PdfLinkRect): [number, number] | null {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  index.chars.forEach((box, at) => {
    if (box.w <= 0 || box.h <= 0 || box.c.trim() === '') return
    const distance = (box.x + box.w / 2 - cx) ** 2 + (box.y + box.h / 2 - cy) ** 2
    if (distance < bestDistance) {
      best = at
      bestDistance = distance
    }
  })
  return best === -1 ? null : [best, best + 1]
}

/**
 * PDF 에서 읽은 주석을 형광펜으로 바꾼다. 글자 층이 없는 페이지(스캔본)의 주석과 이미
 * 같은 글자에 칠해진 형광펜은 건너뛰고 그 수를 돌려준다.
 */
export function importedToHighlights(
  docId: string,
  imported: readonly ImportedPdfAnnotation[],
  pageIndexFor: (page: number) => PageTextIndex | null,
  existing: readonly PersistentPdfHighlight[],
  colors: readonly HighlightColorDef[] = DEFAULT_HIGHLIGHT_COLORS,
): { highlights: PersistentPdfHighlight[]; skipped: number } {
  const seen = new Set(existing.map(({ id }) => id))
  const highlights: PersistentPdfHighlight[] = []
  let skipped = 0
  const importedAt = new Date().toISOString()

  for (const annotation of imported) {
    const index = pageIndexFor(annotation.page)
    if (index === null || index.chars.length === 0 || annotation.rects.length === 0) {
      skipped += 1
      continue
    }
    const range = annotation.kind === 'text'
      ? nearestChar(index, annotation.rects[0]!)
      : coveredRange(index, annotation.rects)
    if (range === null) {
      skipped += 1
      continue
    }
    const highlight = createPersistentPdfHighlight(
      buildAnchor(docId, annotation.page, index, range[0], range[1]),
      nearestHighlightColor(annotation.color, colors),
      { note: annotation.contents ?? undefined, createdAt: importedAt, source: 'imported' },
    )
    if (seen.has(highlight.id)) {
      skipped += 1
      continue
    }
    seen.add(highlight.id)
    highlights.push(highlight)
  }

  return { highlights, skipped }
}
