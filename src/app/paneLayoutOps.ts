import {
  MAX_PANES,
  layoutForLegacyId,
  leaves,
  legacyPaneCount,
  newPaneId,
  paneCount,
  relayout,
  removeLeaf,
  splitLeaf,
  splitRefusal,
  swapChildren,
  type LayoutNode,
  type RelayoutKind,
  type SplitDir,
  type SplitRefusal,
} from '../core/layoutTree'
import type { PdfSplitLayoutId } from '../core/pdfSplit'
import { edgeSplit, type DockEdge, type PaneSizer, type TreeWorkspace } from './tabDock'
import { addEmptyPane, closePaneInto, closeTab, emptyTabs, openTab, paneIdsOf, tabsOf, type PaneId, type Tab } from './tabs'
import { inheritChannel, pruneChannels } from './workspaceChannels'

/**
 * 칸 나누기 트리를 다루는 앱 동작(순수 함수): 「창 나누기」 목록의 예전 배치, 칸 수 바꾸기, split-window, select-layout, 칸 자리 바꾸기.
 * 칸의 탭·색은 칸 id 에 붙어 있어, 자리가 바뀌어도 칸과 함께 따라간다.
 */

/** 예전 배치(10가지 그림)를 지금 칸들에 적용한다: 칸 차례를 이어 쓰고, 모자라면 빈 칸을 더하고, 남으면 마지막 칸 뒤에 탭을 합친다 */
export function applyLegacyLayout(input: TreeWorkspace, id: PdfSplitLayoutId): TreeWorkspace & { readonly kept: readonly PaneId[] } {
  const order = leaves(input.layout)
  const count = legacyPaneCount(id)
  const kept = order.slice(0, count)
  let panes = input.panes
  let channels = input.channels
  const last = kept[kept.length - 1]!
  for (const extra of order.slice(count)) panes = closePaneInto(panes, extra, last)
  const used = new Set(paneIdsOf(panes))
  while (kept.length < count) {
    const created = newPaneId(used)
    used.add(created)
    kept.push(created)
    panes = addEmptyPane(panes, created)
    channels = inheritChannel(channels, last, created)
  }
  const layout = layoutForLegacyId(id, kept)
  return { panes, channels: pruneChannels(channels, kept), layout, kept }
}

export interface SplitOutcome extends TreeWorkspace {
  readonly newPane: PaneId
}

/** 칸 pane 을 dir 로 나눈다(split-window). 새 칸은 비어 있고 pane 의 색을 받는다. 못 하면 { refused } */
export function splitPane(input: TreeWorkspace, pane: PaneId, dir: SplitDir, sizeOf?: PaneSizer, before = false): SplitOutcome | { readonly refused: SplitRefusal } {
  const refused = splitRefusal(input.layout, pane, dir, sizeOf?.(pane) ?? null)
  if (refused !== null) return { refused }
  const created = newPaneId(paneIdsOf(input.panes))
  return {
    layout: splitLeaf(input.layout, pane, dir, created, { before }),
    panes: addEmptyPane(input.panes, created),
    channels: inheritChannel(input.channels, pane, created),
    newPane: created,
  }
}

/**
 * 탭을 pane 의 edge 쪽에 새 칸을 만들어 옮긴다. dockTab 과 달리 하나뿐인 탭도 옮긴다(원래 칸은 빈 채 남는다) —
 * 탭 메뉴 「새 오른쪽 패널로 옮기기」가 쓴다. 못 하면 { refused }
 */
export function moveTabToNewPane(input: TreeWorkspace, tabId: string, source: PaneId, edge: DockEdge, sizeOf?: PaneSizer): SplitOutcome | { readonly refused: SplitRefusal } | null {
  const tab: Tab | undefined = tabsOf(input.panes, source).tabs.find((candidate) => candidate.id === tabId)
  if (tab === undefined) return null
  const { dir, before } = edgeSplit(edge)
  const split = splitPane(input, source, dir, sizeOf, before)
  if ('refused' in split) return split
  const { preview: _preview, ...pinned } = tab
  return {
    ...split,
    panes: { ...split.panes, [source]: closeTab(tabsOf(split.panes, source), tabId), [split.newPane]: openTab(emptyTabs, pinned) },
  }
}

/**
 * 칸 수를 바꾼다(MCP set_layout, Ctrl+\): 줄이면 뒤쪽 칸부터 닫고 그 탭은 남는 마지막 칸 뒤에 합친다.
 * 늘리면 마지막 칸을 좌우로 나눈다(모두 좌우 나누기뿐이면 같은 폭으로 다시 짠다). 크기·상한으로 못 늘리면 늘린 만큼만 되고 refused 가 붙는다.
 */
export function setPaneCountTree(input: TreeWorkspace, target: number, sizeOf?: PaneSizer): TreeWorkspace & { readonly refused: SplitRefusal | null } {
  const wanted = Math.min(Math.max(Math.round(target), 1), MAX_PANES)
  let current = input
  let refused: SplitRefusal | null = null
  while (paneCount(current.layout) > wanted) {
    const order = leaves(current.layout)
    const closing = order[order.length - 1]!
    const into = order[order.length - 2]!
    const next = removeLeaf(current.layout, closing)
    if (next === null) break
    current = { layout: next, panes: closePaneInto(current.panes, closing, into), channels: pruneChannels(current.channels, leaves(next)) }
  }
  let grown = false
  while (paneCount(current.layout) < wanted) {
    const order = leaves(current.layout)
    const result = splitPane(current, order[order.length - 1]!, 'h', sizeOf)
    if ('refused' in result) { refused = result.refused; break }
    current = result
    grown = true
  }
  if (grown && onlyHorizontal(current.layout)) current = { ...current, layout: relayout(current.layout, 'even-horizontal') }
  return { ...current, refused }
}

function onlyHorizontal(node: LayoutNode): boolean {
  return node.kind === 'pane' || (node.dir === 'h' && onlyHorizontal(node.a) && onlyHorizontal(node.b))
}

/** select-layout: 칸 차례를 지키며 트리를 다시 짠다 */
export function selectLayout(input: TreeWorkspace, kind: RelayoutKind): TreeWorkspace {
  const layout = relayout(input.layout, kind)
  return layout === input.layout ? input : { ...input, layout }
}

/** 나누기 하나의 양쪽을 맞바꾼다(칸막이 「양쪽 바꾸기」) */
export function swapSplitSides(input: TreeWorkspace, splitId: string): TreeWorkspace {
  const layout = swapChildren(input.layout, splitId)
  return layout === input.layout ? input : { ...input, layout }
}

/** 칸 번호(0 부터)로 칸을 찾는다. 범위 밖이면 null */
export function paneByIndex(layout: LayoutNode, index: number): PaneId | null {
  return leaves(layout)[index] ?? null
}
