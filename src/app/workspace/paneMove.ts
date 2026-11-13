import { findParent, hasPane, removeLeaf, splitLeaf, splitRefusal, swapLeaves, type LayoutNode, type Size, type SplitRefusal } from '../../core/layoutTree'
import { ALL_DOCK_EDGES, edgeSplit, type DockEdge, type PaneSizer, type TreeWorkspace } from './tabDock'
import type { PaneId } from './tabs'

/**
 * 칸 머리를 잡고 칸 통째로 끌어 옮기는 규칙(순수 함수). 칸의 탭 · 색 채널 · 칸마다의 상태는 칸 id 에 붙어 있어,
 * 트리에서 칸 id 의 자리만 바꾸면 모두 칸과 함께 따라간다.
 * - 가장자리에 놓기 = 칸을 원래 자리에서 빼서 대상 칸의 그쪽을 나누어 넣는다(movePaneToEdge)
 * - 가운데에 놓기 = 두 칸의 자리를 맞바꾼다(swapPanes)
 */

/**
 * 칸 pane 을 빼고 난 뒤의 대상 칸 크기. pane 이 대상의 바로 옆 칸이면 그 자리까지 대상이 차지하므로 두 칸을 더한다
 * (옆 칸을 대상의 가장자리로 옮기는 것은 흔한 쓰임인데, 지금 크기로만 따지면 작은 칸이라 막히는 일이 없게).
 * 크기를 모르면 null — 크기는 따지지 않는다.
 */
function sizeAfterRemoval(layout: LayoutNode, pane: PaneId, target: PaneId, sizeOf: PaneSizer | undefined): Size | null {
  const size = sizeOf?.(target) ?? null
  if (size === null) return null
  const found = findParent(layout, pane)
  if (found === null) return size
  const sibling = found.side === 'a' ? found.parent.b : found.parent.a
  if (sibling.kind !== 'pane' || sibling.paneId !== target) return size
  const other = sizeOf?.(pane) ?? null
  if (other === null) return size
  return found.parent.dir === 'h'
    ? { width: size.width + other.width, height: size.height }
    : { width: size.width, height: size.height + other.height }
}

/** pane 을 target 의 edge 쪽으로 옮길 수 없는 까닭. 옮길 수 있으면 null */
export function paneMoveRefusal(layout: LayoutNode, pane: PaneId, target: PaneId, edge: DockEdge, sizeOf?: PaneSizer): SplitRefusal | 'invalid' | null {
  if (pane === target || !hasPane(layout, pane) || !hasPane(layout, target)) return 'invalid'
  const rest = removeLeaf(layout, pane)
  if (rest === null) return 'invalid'
  return splitRefusal(rest, target, edgeSplit(edge).dir, sizeAfterRemoval(layout, pane, target, sizeOf))
}

/**
 * pane 을 끌어 target 칸 위에 놓을 때 나눌 수 있는 가장자리들. 칸을 빼고 다시 끼우니 칸 수는 그대로라 상한은 걸리지 않고,
 * 대상이 너무 작아지는 쪽만 뺀다(그런 쪽은 미리보기 없이 「가운데(맞바꾸기)」로 본다 — 보이는 미리보기는 놓으면 꼭 된다)
 */
export function paneMoveEdges(layout: LayoutNode, pane: PaneId, target: PaneId, sizeOf?: PaneSizer): readonly DockEdge[] {
  return ALL_DOCK_EDGES.filter((edge) => paneMoveRefusal(layout, pane, target, edge, sizeOf) === null)
}

/**
 * 칸 pane 을 target 칸의 edge 쪽에 나누어 넣는다(원래 자리에서는 빠지고 그 형제가 자리를 채운다). 칸 id 는 그대로라 탭 · 색이 따라간다.
 * 자기 자신 · 없는 칸 · 하나뿐인 화면이면 null, 대상이 너무 작아지면 { refused }.
 */
export function movePaneToEdge(input: TreeWorkspace, pane: PaneId, target: PaneId, edge: DockEdge, sizeOf?: PaneSizer): TreeWorkspace | { readonly refused: SplitRefusal } | null {
  const refusal = paneMoveRefusal(input.layout, pane, target, edge, sizeOf)
  if (refusal === 'invalid') return null
  if (refusal !== null) return { refused: refusal }
  const rest = removeLeaf(input.layout, pane)!
  const { dir, before } = edgeSplit(edge)
  return { ...input, layout: splitLeaf(rest, target, dir, pane, { before }) }
}

/** 두 칸의 자리를 맞바꾼다(내용 · 색은 칸과 함께 간다). 같은 칸이거나 없는 칸이면 null */
export function swapPanes(input: TreeWorkspace, a: PaneId, b: PaneId): TreeWorkspace | null {
  const layout = swapLeaves(input.layout, a, b)
  return layout === input.layout ? null : { ...input, layout }
}
