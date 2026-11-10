import { buildAnchor, type Anchor } from './anchor'
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

/** 글자 층의 양끝 공백을 범위에서 덜어 낸다(밑줄이 앞 공백까지 덮은 경우 등) */
function trimRange(index: PageTextIndex, [start, end]: [number, number]): [number, number] {
  let from = start
  let to = end
  while (from < to && /\s/u.test(index.text[from] ?? '')) from += 1
  while (to > from && /\s/u.test(index.text[to - 1] ?? '')) to -= 1
  return [from, to]
}

/** 뜻 있는 글자(공백·기호 제외)가 둘 이상 있어야 인용으로 쓴다 */
export function hasMeaningfulQuote(quote: string): boolean {
  return (quote.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2
}

/** 인용으로 쓸 만하지 않으면 글을 비운 앵커로 바꾼다(자리 사각형은 그대로). 빈 인용은 charRange 가 [끝,끝] 이라 그대로 맞는다 */
function withoutQuote(anchor: Anchor): Anchor {
  const at = anchor.charRange[0]
  return { ...anchor, charRange: [at, at], quote: '', prefix: '', suffix: '' }
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
    let anchor: Anchor
    if (annotation.kind === 'text') {
      // 붙임 쪽지는 덮은 글이 없으니 인용도 없다. 가까운 글자 자리에 쪽지 네모만 건다
      const rect = annotation.rects[0]!
      anchor = withoutQuote({
        ...buildAnchor(docId, annotation.page, index, range[0], range[1]),
        rects: [{ x: rect.x, y: rect.y, w: rect.w, h: rect.h }],
      })
    } else {
      const [from, to] = trimRange(index, range)
      anchor = from === to ? buildAnchor(docId, annotation.page, index, range[0], range[1]) : buildAnchor(docId, annotation.page, index, from, to)
      if (!hasMeaningfulQuote(anchor.quote)) anchor = withoutQuote(anchor)
    }
    const highlight = createPersistentPdfHighlight(
      anchor,
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

// ───────────── 열 때 한 번 권하기 ─────────────

const OFFER_KEY = 'iwae:annotation-offer:v1'
const OFFER_LIMIT = 500

type OfferStorage = Pick<Storage, 'getItem' | 'setItem'>

/** 이 문서에 대해 가져오기를 이미 권했는가(권하고 나면 사용자가 무시해도 다시 권하지 않는다) */
export function annotationOfferSeen(docId: string, storage: OfferStorage = window.localStorage): boolean {
  try {
    const list = JSON.parse(storage.getItem(OFFER_KEY) ?? '[]') as unknown
    return Array.isArray(list) && list.includes(docId)
  } catch {
    return false
  }
}

export function markAnnotationOfferSeen(docId: string, storage: OfferStorage = window.localStorage): void {
  try {
    const parsed = JSON.parse(storage.getItem(OFFER_KEY) ?? '[]') as unknown
    const list = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    if (list.includes(docId)) return
    storage.setItem(OFFER_KEY, JSON.stringify([...list, docId].slice(-OFFER_LIMIT)))
  } catch {
    // 저장할 수 없으면 다음에 또 권할 뿐이다
  }
}

/**
 * 열린 PDF 에 다른 프로그램이 남긴 표시가 있어 가져오기를 권할 것인가: 표시가 있고, 이 문서에 이미 가져온 표시가
 * 없고, 아직 권한 적이 없을 때. 권할 때 보일 표시 수를 돌려준다(권하지 않으면 0).
 */
export function annotationOfferCount(
  docId: string,
  found: readonly ImportedPdfAnnotation[],
  existing: readonly PersistentPdfHighlight[],
  seen: boolean,
): number {
  if (seen || found.length === 0) return 0
  if (existing.some((highlight) => highlight.anchor.docId === docId && highlight.source === 'imported')) return 0
  return found.length
}
