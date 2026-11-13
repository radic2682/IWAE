import type { Anchor } from '../../core/anchor'
import type { CanvasBlockData } from '../../core/canvasDocument'
import type { PointTarget } from '../workspace/workspaceSignal'
import { activeTab, tabsOf, type PaneId, type PanesState } from '../workspace/tabs'
import { channelOf, type PaneChannels } from '../workspace/workspaceChannels'
import { SOURCE_LINK_PREFIX, type LinkItem, type LinkRect } from '../workspace/workspaceLinks'

/**
 * 캔버스(YOLO 노트)가 작업 공간과 주고받는 것의 순수한 규칙(설계 3.3·3.5): 블록의 출처 → 가리키기 신호,
 * 신호 → 가운데로 가져올 블록, 보이는 블록의 연결선 재료. DOM·React 를 모른다 — 마우스 없이 시험한다.
 *
 * 블록은 메모 id 를 따로 들고 있지 않다. 「메모에 이어진 블록」은 블록의 출처 자리(문서·쪽·글자 범위)와
 * 겹치는 형광펜(메모)이 있는 블록이다.
 */

/** 가리킬 수 있는 형광펜(메모)의 최소한 */
export interface PointableHighlight {
  readonly id: string
  readonly anchor: Pick<Anchor, 'docId' | 'page' | 'charRange'>
  readonly kind?: 'region'
}

/** 블록이 가진 출처의 자리 */
export interface BlockSource {
  readonly kind: 'pdf' | 'markdown'
  /** PDF 는 문서 id, Markdown 은 파일 경로 */
  readonly docId: string
  /** PDF 쪽(0부터). Markdown 은 0 */
  readonly page: number
  /** 글자 범위 [시작, 끝). 없으면 null */
  readonly range: readonly [number, number] | null
}

function pdfSource(anchor: Anchor): BlockSource {
  return { kind: 'pdf', docId: anchor.docId, page: anchor.page, range: anchor.charRange }
}

/** 블록의 출처. 출처가 없는 블록(글·도형·그림, 출처 없는 번역)은 null */
export function blockSource(block: CanvasBlockData): BlockSource | null {
  if (block.kind === 'pdfExcerpt') return pdfSource(block.source.anchor)
  if (block.kind === 'translation') return block.source.anchor === undefined ? null : pdfSource(block.source.anchor)
  if (block.kind === 'markdownExcerpt') {
    const { path, startOffset, endOffset } = block.source.selection
    return { kind: 'markdown', docId: path, page: 0, range: [startOffset, endOffset] }
  }
  return null
}

/** 두 글자 범위가 겹치는가. 한쪽이라도 범위를 모르면(null) 겹친다고 본다 */
export function rangesOverlap(a: readonly [number, number] | null, b: readonly [number, number] | null): boolean {
  if (a === null || b === null) return true
  return (a[0] < b[1] && b[0] < a[1]) || a[0] === b[0]
}

/** 출처와 같은 자리에 있는 글 형광펜(메모)들. 영역 메모는 글 자리가 없어 잇지 않는다 */
export function highlightsAtSource(source: BlockSource, highlights: readonly PointableHighlight[]): PointableHighlight[] {
  return highlights.filter((highlight) => highlight.kind !== 'region'
    && highlight.anchor.docId === source.docId
    && (source.kind === 'markdown' || highlight.anchor.page === source.page)
    && rangesOverlap(highlight.anchor.charRange, source.range))
}

/**
 * 블록을 누르면 보낼 가리키기 신호의 대상.
 * 메모(형광펜)에 이어진 블록은 memo, 출처만 있는 블록은 place(문서·쪽·글자 범위). 출처가 없으면 null.
 * place 의 쪽은 화면 쪽 번호(1부터)다. Markdown 은 쪽이 없어 1.
 */
export function pointTargetForBlock(block: CanvasBlockData, highlights: readonly PointableHighlight[]): PointTarget | null {
  const source = blockSource(block)
  if (source === null) return null
  const linked = highlightsAtSource(source, highlights)[0]
  if (linked !== undefined) return { kind: 'memo', memoId: linked.id }
  return { kind: 'place', docId: source.docId, page: source.kind === 'pdf' ? source.page + 1 : 1, ...(source.range === null ? {} : { range: source.range }) }
}

/** 캔버스 블록 한 칸(위치·크기는 캔버스 좌표) */
export interface CanvasNodeLike {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number }
  readonly data: { readonly block: CanvasBlockData }
  readonly measured?: { readonly width?: number; readonly height?: number }
}

/**
 * 신호가 가리키는 블록들(문서 차례). memo 신호는 그 메모와 같은 자리에서 온 블록,
 * place 신호는 문서·쪽이 같고 글자 범위가 겹치는 블록(신호에 범위가 없으면 그 쪽의 블록).
 * 알 수 없는 메모(highlights 에 없음)면 빈 목록.
 */
export function blocksForTarget(nodes: readonly CanvasNodeLike[], target: PointTarget, highlights: readonly PointableHighlight[]): string[] {
  if (target.kind === 'memo') {
    const memo = highlights.find((highlight) => highlight.id === target.memoId)
    if (memo === undefined || memo.kind === 'region') return []
    return nodes.flatMap((node) => {
      const source = blockSource(node.data.block)
      if (source === null || source.docId !== memo.anchor.docId) return []
      if (source.kind === 'pdf' && source.page !== memo.anchor.page) return []
      return rangesOverlap(source.range, memo.anchor.charRange) ? [node.id] : []
    })
  }
  return nodes.flatMap((node) => {
    const source = blockSource(node.data.block)
    if (source === null || source.docId !== target.docId) return []
    if (source.kind === 'pdf' && source.page + 1 !== target.page) return []
    return rangesOverlap(source.range, target.range ?? null) ? [node.id] : []
  })
}

/** 캔버스 화면 상태(react-flow 의 viewport): 화면 = 틀 왼쪽 위 + (x, y) + 캔버스 좌표 × zoom */
export interface CanvasViewportLike {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

function nodeSize(node: CanvasNodeLike): { readonly width: number; readonly height: number } {
  return { width: node.measured?.width ?? node.data.block.width, height: node.measured?.height ?? node.data.block.height }
}

/** 블록이 화면에서 차지하는 사각형(화면 좌표). 확대·이동을 따른다 */
export function blockScreenRect(node: CanvasNodeLike, viewport: CanvasViewportLike, frame: LinkRect): LinkRect {
  const { width, height } = nodeSize(node)
  const left = frame.left + viewport.x + node.position.x * viewport.zoom
  const top = frame.top + viewport.y + node.position.y * viewport.zoom
  return { left, top, right: left + width * viewport.zoom, bottom: top + height * viewport.zoom }
}

/** 한 블록이 연결선에서 쓰는 id 들: 이어진 메모(형광펜)가 있으면 그 id 들(최대 3), 없으면 출처 자리(src:블록) */
export function linkIdsOfBlock(nodeId: string, block: CanvasBlockData, highlights: readonly PointableHighlight[]): string[] {
  const source = blockSource(block)
  if (source === null) return []
  const linked = highlightsAtSource(source, highlights).slice(0, 3)
  return linked.length > 0 ? linked.map((highlight) => highlight.id) : [`${SOURCE_LINK_PREFIX}${nodeId}`]
}

/**
 * 캔버스가 연결선 층에 내놓는 것: 지금 화면에 보이는 블록(틀 안에 걸친 것)만, 출처가 있는 블록만.
 * 사각형은 틀 안으로 잘라 가까운 가장자리가 늘 보이게 하고, 선이 들어가는 높이는 보이는 부분의 한가운데다.
 */
export function visibleBlockLinkItems(
  nodes: readonly CanvasNodeLike[],
  viewport: CanvasViewportLike,
  body: LinkRect,
  highlights: readonly PointableHighlight[],
): LinkItem[] {
  const items: LinkItem[] = []
  for (const node of nodes) {
    const ids = linkIdsOfBlock(node.id, node.data.block, highlights)
    if (ids.length === 0) continue
    const rect = blockScreenRect(node, viewport, body)
    if (rect.right <= body.left || rect.left >= body.right || rect.bottom <= body.top || rect.top >= body.bottom) continue
    const clipped: LinkRect = {
      left: Math.max(rect.left, body.left),
      top: Math.max(rect.top, body.top),
      right: Math.min(rect.right, body.right),
      bottom: Math.min(rect.bottom, body.bottom),
    }
    const y = (clipped.top + clipped.bottom) / 2
    for (const id of ids) items.push({ id, rect: clipped, y })
  }
  return items
}

/** 블록이 틀 한가운데 오는 viewport(확대는 그대로) */
export function viewportCenteredOn(node: CanvasNodeLike, zoom: number, frame: { readonly width: number; readonly height: number }): CanvasViewportLike {
  const { width, height } = nodeSize(node)
  return {
    x: frame.width / 2 - (node.position.x + width / 2) * zoom,
    y: frame.height / 2 - (node.position.y + height / 2) * zoom,
    zoom,
  }
}

/** 지금 화면에 보이는(활성 탭이 캔버스인) 창들(화면 차례) */
export function visibleCanvasPanes(panes: PanesState, visible: readonly PaneId[]): PaneId[] {
  return visible.filter((pane) => activeTab(tabsOf(panes, pane))?.kind === 'canvas')
}

/**
 * 발췌·번역을 받을 캔버스의 창(설계 5 단계 「캔버스로 보내기」):
 * 1. from(보내는 문서 창)과 같은 색 창에 보이는 캔버스. 색이 없으면 이 단계는 건너뛴다.
 * 2. 지금 만진 창이 캔버스면 그 창.
 * 3. 그 밖에 보이는 캔버스 — 만진 창과 같은 색을 먼저.
 * 없으면 null(캔버스가 안 보이면 보내지 않는다).
 */
export function pickCanvasPane(args: {
  readonly panes: PanesState
  readonly channels: PaneChannels
  readonly visible: readonly PaneId[]
  readonly active: PaneId
  readonly from?: PaneId | null
}): PaneId | null {
  const { panes, channels, visible, active, from = null } = args
  const canvases = visibleCanvasPanes(panes, visible)
  if (from !== null && channelOf(channels, from) !== null) {
    const peer = canvases.find((pane) => pane !== from && channelOf(channels, pane) === channelOf(channels, from))
    if (peer !== undefined) return peer
  }
  if (canvases.includes(active)) return active
  return canvases.find((pane) => channelOf(channels, pane) === channelOf(channels, active)) ?? canvases[0] ?? null
}
