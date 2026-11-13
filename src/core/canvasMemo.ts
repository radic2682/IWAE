import type { Anchor } from './anchor'
import type { CanvasBlockData } from './canvasDocument'
import { highlightIdFromHandle, type ExcerptHighlight } from './excerptHighlights'
import { createSourceJumpRequest, type SourceJumpRequest } from './pdfExcerpt'
import type { PersistentPdfHighlight } from '../pdf/persistentHighlight'

/**
 * 캔버스 메모 = 형광펜에 선으로 이은 글 블록. 노트의 메모 카드와 같은 모양으로 그리려고
 * 이은 형광펜(원문)을 노트 카드가 쓰는 PersistentPdfHighlight 로 바꿔 건네준다.
 * 이은 관계는 선(edge)이 정한다 — 블록을 옮기거나 선을 다시 이어도 그대로 따라온다.
 */
export interface CanvasMemoSource {
  /** 형광펜이 칠해진 발췌 블록 */
  readonly excerptId: string
  readonly highlightId: string
  /** 노트 카드의 원문 줄에 그대로 쓰는 값(색 점 · 인용 · 쪽) */
  readonly highlight: PersistentPdfHighlight
  /** 출처 문서 이름(카드 위 탭에 쪽 번호와 함께 보인다) */
  readonly title: string
  /** 원문에서 보기 */
  readonly jump: SourceJumpRequest
}

interface MemoNodeLike {
  readonly id: string
  readonly data: { readonly block?: unknown }
}

interface MemoEdgeLike {
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

function isMemoBlock(block: unknown): boolean {
  return typeof block === 'object' && block !== null && (block as { kind?: unknown }).kind === 'paragraph'
}

/**
 * 형광펜이 덮은 글자. 발췌의 글자 상자(glyphs) 중 형광펜 칸 안에 가운데가 있는 것을 읽는 차례대로 잇는다.
 * 글자가 없는 곳(그림·선)이면 발췌 전체의 인용을 쓴다.
 */
export function highlightQuote(block: Extract<CanvasBlockData, { kind: 'pdfExcerpt' }>, highlight: ExcerptHighlight): string {
  const { glyphs, anchor } = block.excerpt.selection
  const inside = glyphs.filter((glyph) => {
    const x = glyph.x + glyph.w / 2
    const y = glyph.y + glyph.h / 2
    return highlight.rects.some((rect) => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h)
  })
  // 글자 상자에 띄어쓰기 글자가 없는 PDF 도 있다: 이웃 글자와 벌어진 틈이 글자 높이의 3할을 넘거나 줄이 바뀌면 띄어 쓴다
  const text = inside.map((glyph, at) => {
    const before = inside[at - 1]
    const gap = before === undefined ? 0 : glyph.x - (before.x + before.w)
    const newLine = before !== undefined && glyph.y > before.y + before.h * 0.6
    return (gap > glyph.h * 0.3 || newLine ? ' ' : '') + glyph.c
  }).join('').replace(/\s+/gu, ' ').trim()
  return text === '' ? anchor.quote.replace(/\s+/gu, ' ').trim() : text
}

function sourceOf(excerptId: string, block: Extract<CanvasBlockData, { kind: 'pdfExcerpt' }>, highlight: ExcerptHighlight): CanvasMemoSource {
  const base: Anchor = block.excerpt.selection.anchor
  const anchor: Anchor = { ...base, quote: highlightQuote(block, highlight), rects: highlight.rects.map(({ x, y, w, h }) => ({ x, y, w, h })) }
  return {
    excerptId,
    highlightId: highlight.id,
    highlight: { id: highlight.id, anchor, color: highlight.color },
    title: block.excerpt.sourceTitle,
    jump: createSourceJumpRequest(block.excerpt),
  }
}

/**
 * 메모 블록(글 블록)마다, 그 블록에 이어진 형광펜들(선이 이어진 차례). 이은 형광펜이 없는 글 블록은 맵에 없다.
 * 선은 어느 쪽으로 그어졌든(형광펜 → 메모, 메모 → 형광펜) 같게 본다.
 */
export function canvasMemoSources(
  nodes: readonly MemoNodeLike[],
  edges: readonly MemoEdgeLike[],
): ReadonlyMap<string, readonly CanvasMemoSource[]> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const result = new Map<string, CanvasMemoSource[]>()
  const link = (excerptId: string, handle: string | null | undefined, memoId: string) => {
    const highlightId = highlightIdFromHandle(handle)
    if (highlightId === null) return
    const memo = byId.get(memoId)
    const excerpt = byId.get(excerptId)
    const excerptBlock = excerpt?.data.block as CanvasBlockData | undefined
    if (memo === undefined || !isMemoBlock(memo.data.block) || excerptBlock?.kind !== 'pdfExcerpt') return
    const highlight = excerptBlock.highlights?.find(({ id }) => id === highlightId)
    if (highlight === undefined) return
    const list = result.get(memoId) ?? []
    if (list.some((source) => source.excerptId === excerptId && source.highlightId === highlightId)) return
    list.push(sourceOf(excerptId, excerptBlock, highlight))
    result.set(memoId, list)
  }
  for (const edge of edges) {
    link(edge.source, edge.sourceHandle, edge.target)
    link(edge.target, edge.targetHandle, edge.source)
  }
  return result
}
