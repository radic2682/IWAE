import type { Anchor, AnchorRect } from './anchor'
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
