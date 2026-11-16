import type { Anchor, AnchorRect } from './anchor'
import { quoteLooselyMatchesAt, verifiedRange } from './flowAnchorCheck'
import { createPersistentPdfHighlight, type HighlightExtras, type PdfHighlightColor, type PersistentPdfHighlight } from '../pdf/persistentHighlight'

/** 흐르는 글(Markdown·텍스트)은 쪽이 없어서 한 쪽(0)짜리 종이 좌표로 자리를 적는다. 글 범위는 글자 위치다 */
export interface FlowAnchorParts {
  readonly rects: readonly AnchorRect[]
  readonly charRange: readonly [number, number]
  readonly quote: string
  readonly prefix?: string
  readonly suffix?: string
}

export function flowAnchor(docId: string, parts: FlowAnchorParts): Anchor {
  return {
    docId,
    page: 0,
    coordSpace: 'pdfium-page',
    rects: parts.rects,
    charRange: [parts.charRange[0], parts.charRange[1]],
    quote: parts.quote,
    prefix: parts.prefix ?? '',
    suffix: parts.suffix ?? '',
  }
}

/** 흐르는 글의 자리로 메모·형광펜을 만든다. 만든 때와 출처(이 앱)는 따로 주지 않으면 지금·iwae 다 */
export function createFlowHighlight(
  docId: string,
  parts: FlowAnchorParts,
  color: PdfHighlightColor,
  extras: HighlightExtras = {},
): PersistentPdfHighlight {
  return createPersistentPdfHighlight(
    flowAnchor(docId, parts),
    color,
    { createdAt: new Date().toISOString(), source: 'iwae', ...extras },
  )
}

/**
 * 지금 본문 글(plainText)에서 저장된 글자 위치가 인용문과 맞는 메모·형광펜만 돌려준다.
 * 맞으면 같은 객체, 틀리면 인용문·앞뒤 글로 찾은 새 위치를 넣은 복사본(저장은 건드리지 않는다),
 * 못 찾으면 뺀다. 영역 메모(글이 아니라 네모)와 인용문이 없는 것은 그대로 둔다. 맞는 것은 글을 다시 훑지 않는다
 */
export function verifiedFlowHighlights(plainText: string, highlights: readonly PersistentPdfHighlight[]): readonly PersistentPdfHighlight[] {
  let out: PersistentPdfHighlight[] | null = null
  highlights.forEach((highlight, index) => {
    const { anchor } = highlight
    let replacement: PersistentPdfHighlight | null
    if (highlight.kind === 'region' || anchor.quote.trim() === '') replacement = highlight
    else {
      const range = verifiedRange(plainText, anchor.charRange, anchor)
      // 새 자리를 못 찾아도 저장된 자리의 글이 인용문을 (공백·숨은 글을 빼고) 담고 있으면 둔다. 아니면 칠하지 않는다
      if (range === null) replacement = quoteLooselyMatchesAt(plainText, anchor.charRange[0], anchor.charRange[1], anchor.quote) ? highlight : null
      else if (range[0] === anchor.charRange[0] && range[1] === anchor.charRange[1]) replacement = highlight
      else replacement = { ...highlight, anchor: { ...anchor, charRange: range } }
    }
    if (replacement === highlight && out === null) return
    if (out === null) out = highlights.slice(0, index)
    if (replacement !== null) out.push(replacement)
  })
  return out ?? highlights
}
