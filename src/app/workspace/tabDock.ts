import { MAX_PANES, hasPane, leaves, newPaneId, paneCount, removeLeaf, splitLeaf, splitRefusal, type LayoutNode, type Size, type SplitDir, type SplitRefusal } from '../../core/layoutTree'
import { closeTab, closePaneInto, openTab, emptyTabs, paneIdsOf, paneOfTab, tabsOf, type PaneId, type PanesState, type Tab, type TabsState } from './tabs'
import { inheritChannel, pruneChannels, type PaneChannels } from './workspaceChannels'

/**
 * 탭을 끌어 창(패널)을 나누는 규칙. DOM 을 모르는 순수 함수만 둔다 —
 * 어느 자리가 어느 구역인지, 어떻게 나뉘는지는 마우스 없이 시험한다.
 */

export type DockEdge = 'left' | 'right' | 'top' | 'bottom'
export type DockZone = DockEdge | 'center'

export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** 창 가장자리에서 이 비율 안쪽이 「나누기」 구역이다(가운데는 그 창으로 옮기기) */
export const DOCK_EDGE_BAND = 0.28

/**
 * 창 안의 한 점이 어느 구역인가. 가장자리 띠(DOCK_EDGE_BAND) 안이면 가장 가까운 가장자리,
 * 아니면 가운데. 허락되지 않은 가장자리(더 못 나누는 배치)는 가운데로 본다 — 구역을 아예 안 보이는 것이 아니라
 * 「이 창으로 옮기기」로 남는다. 창 밖이면 null.
 */
export function dockZoneAt(box: Box, x: number, y: number, allowed: readonly DockEdge[] = ['left', 'right', 'top', 'bottom']): DockZone | null {
  if (box.width <= 0 || box.height <= 0) return null
  const fx = (x - box.left) / box.width
  const fy = (y - box.top) / box.height
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null
  const distances: readonly (readonly [DockEdge, number])[] = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy],
  ]
  let best: DockEdge | null = null
  let bestDistance = DOCK_EDGE_BAND
  for (const [edge, distance] of distances) {
    if (distance < bestDistance && allowed.includes(edge)) {
      best = edge
      bestDistance = distance
    }
  }
  return best ?? 'center'
}

/** 구역의 미리보기 칸: 가장자리는 그쪽 절반, 가운데는 창 전체 */
export function dockZoneBox(box: Box, zone: DockZone): Box {
  switch (zone) {
    case 'left': return { left: box.left, top: box.top, width: box.width / 2, height: box.height }
    case 'right': return { left: box.left + box.width / 2, top: box.top, width: box.width / 2, height: box.height }
    case 'top': return { left: box.left, top: box.top, width: box.width, height: box.height / 2 }
    case 'bottom': return { left: box.left, top: box.top + box.height / 2, width: box.width, height: box.height / 2 }
    case 'center': return box
  }
}

/**
 * 탭 줄에서 끄는 손이 x 일 때 탭이 들어갈 자리(0 = 맨 앞 … n = 맨 뒤).
 * rects 는 끄는 탭을 뺀 나머지 탭들의 왼쪽·너비다. 이웃 탭의 가운데를 넘으면 그 뒤로 간다.
 */
export function insertionIndexAt(rects: readonly { readonly left: number; readonly width: number }[], x: number): number {
  let index = 0
  for (const rect of rects) {
    if (x > rect.left + rect.width / 2) index += 1
    else break
  }
  return index
}


/** 가장자리 → 나누는 방향과 새 칸이 앞(왼쪽·위)에 놓이는지 */
export function edgeSplit(edge: DockEdge): { readonly dir: SplitDir; readonly before: boolean } {
  switch (edge) {
    case 'left': return { dir: 'h', before: true }
    case 'right': return { dir: 'h', before: false }
    case 'top': return { dir: 'v', before: true }
    case 'bottom': return { dir: 'v', before: false }
  }
}

/** 그 칸의 지금 크기(px)를 아는 함수. 모르면(재지 못함) null — 크기는 따지지 않는다 */
export type PaneSizer = (pane: PaneId) => Size | null

/** 칸 pane 의 edge 쪽을 나눌 수 있는가. 못 하면 까닭(칸이 상한 · 너무 작아진다) */
export function dockRefusal(layout: LayoutNode, pane: PaneId, edge: DockEdge, sizeOf?: PaneSizer): SplitRefusal | null {
  return splitRefusal(layout, pane, edgeSplit(edge).dir, sizeOf?.(pane) ?? null)
}

export const ALL_DOCK_EDGES: readonly DockEdge[] = ['left', 'right', 'top', 'bottom']

/**
 * 칸 pane 에서 실제로 나눌 수 있는 가장자리들(칸 상한 · 너무 작음을 뺀다). 못 나누는 쪽은 미리보기 없이 「가운데」로 본다 —
 * 미리보기가 보이면 놓았을 때 꼭 된다. closingSource: 이 끌기로 비어 닫힐 칸(하나뿐인 탭을 다른 칸으로 끌 때), 아니면 null
 */
export function allowedDockEdges(layout: LayoutNode, pane: PaneId, closingSource: PaneId | null, sizeOf?: PaneSizer): readonly DockEdge[] {
  const base = closingSource !== null && paneCount(layout) >= MAX_PANES ? removeLeaf(layout, closingSource) ?? layout : layout
  return ALL_DOCK_EDGES.filter((edge) => dockRefusal(base, pane, edge, sizeOf) === null)
}

/** 끌어 온 탭(들)이 칸 pane 의 가장자리로 나눌 수 있는 쪽을 묻는 입력 */
export interface DragDockEdgesInput {
  /** 나누기 자체가 켜져 있는가(분할 기능 · 앱 창 · 칸 모양 보기 · 라이브러리가 접혀 있음) */
  readonly enabled: boolean
  readonly layout: LayoutNode
  readonly panes: PanesState
  /** 화면에 보이는 트리 칸들(떠 있는 칸은 나누지 않는다) */
  readonly visible: readonly PaneId[]
  readonly pane: PaneId
  /** 끌어 온 탭의 id 후보들: 하나라도 이미 열려 있으면 그 탭이 나온 칸이 원래 칸이다(탭 줄의 탭은 하나, 왼쪽 바 Markdown 은 둘일 수 있다) */
  readonly ids: readonly string[]
  /** 탭이 하나도 없는 칸에도 나눌 것인가(탭 끌기는 예, 왼쪽 바 끌기는 아니오: 열 곳이 가운데뿐이다) */
  readonly splitEmptyPane: boolean
  readonly sizeOf?: PaneSizer
}

/**
 * 탭 끌기와 왼쪽 바 끌기가 같이 쓰는 「이 칸에서 나눌 수 있는 가장자리」. 자기 칸의 하나뿐인 탭은 나눌 수 없고,
 * 하나뿐인 탭이 다른 칸에서 오면 그 칸이 닫히므로 칸 수 상한은 닫힌 뒤로 센다.
 */
export function dragDockEdges(input: DragDockEdgesInput): readonly DockEdge[] {
  const { enabled, layout, panes, visible, pane, ids, splitEmptyPane, sizeOf } = input
  if (!enabled || !visible.includes(pane)) return []
  if (!splitEmptyPane && tabsOf(panes, pane).tabs.length === 0) return []
  const source = ids.map((id) => paneOfTab(panes, id)).find((found) => found !== null) ?? null
  if (source === pane && tabsOf(panes, pane).tabs.length <= 1) return []
  const closing = source !== null && source !== pane && tabsOf(panes, source).tabs.length <= 1 ? source : null
  return allowedDockEdges(layout, pane, closing, sizeOf)
}

/** 미리보기 표시를 뗀 탭(다른 창으로 끌린 탭은 보통 탭이 된다) */
function pinned(tab: TabsState['tabs'][number]): TabsState['tabs'][number] {
  if (tab.preview !== true) return tab
  const { preview: _preview, ...rest } = tab
  return rest
}

/** 탭을 같은 줄의 index 자리에 넣는다(이미 있으면 옮긴다). 활성 탭이 된다 */
export function insertTabAt(state: TabsState, tab: TabsState['tabs'][number], index: number): TabsState {
  const rest = state.tabs.filter((candidate) => candidate.id !== tab.id)
  const at = Math.min(Math.max(Math.round(index), 0), rest.length)
  const tabs = [...rest.slice(0, at), tab, ...rest.slice(at)]
  return { tabs, activeId: tab.id }
}

/** 탭을 다른(또는 같은) 패널의 index 자리로 옮긴다. 옮긴 패널에서 활성 탭이 된다 */
export function moveTabToPaneAt(panes: PanesState, id: string, target: PaneId, index: number): PanesState {
  const source = paneOfTab(panes, id)
  if (source === null) return panes
  const tab = tabsOf(panes, source).tabs.find((candidate) => candidate.id === id)!
  if (source === target) return { ...panes, [target]: insertTabAt(tabsOf(panes, target), tab, index) }
  // 다른 창으로 끌어 옮긴 미리보기 탭은 고정된다
  return {
    ...panes,
    [source]: closeTab(tabsOf(panes, source), id),
    [target]: insertTabAt(tabsOf(panes, target), pinned(tab), index),
  }
}

/** 창(칸)·색·배치의 한 장면 */
export interface TreeWorkspace {
  readonly panes: PanesState
  readonly channels: PaneChannels
  readonly layout: LayoutNode
}

export interface DockOutcome extends TreeWorkspace {
  /** 새로 생긴 칸 */
  readonly newPane: PaneId
  /** 탭이 떠난 칸(비어서 닫혔으면 collapsed 가 true) */
  readonly sourcePane: PaneId
  /** 탭이 떠난 칸이 비어서 칸이 닫혔는가 */
  readonly collapsed: boolean
}

/**
 * 탭을 패널(targetPane)의 edge 쪽을 갈라 새 패널에 넣는다. 새 패널은 탭이 떠난 패널의 색 채널을 받는다.
 * 하나뿐인 탭을 자기 패널에서 갈라내려 하면 null(할 일 없음). 칸이 상한이거나 너무 작아지면 { refused }.
 * 탭이 떠난 칸이 비면(다른 칸에서 왔을 때) 그 칸은 닫힌다.
 */
export function dockTab(input: TreeWorkspace, id: string, targetPane: PaneId, edge: DockEdge, sizeOf?: PaneSizer): DockOutcome | { readonly refused: SplitRefusal } | null {
  const { panes, layout, channels } = input
  const source = paneOfTab(panes, id)
  if (source === null || panes[targetPane] === undefined) return null
  if (source === targetPane && tabsOf(panes, source).tabs.length <= 1) return null
  // 하나뿐인 탭을 다른 칸의 가장자리에 끌면 그 칸은 곧 닫히므로, 칸 수 상한은 닫힌 뒤로 본다
  const closesSource = source !== targetPane && tabsOf(panes, source).tabs.length <= 1
  const refused = closesSource && paneCount(layout) >= MAX_PANES
    ? dockRefusal(removeLeaf(layout, source) ?? layout, targetPane, edge, sizeOf)
    : dockRefusal(layout, targetPane, edge, sizeOf)
  if (refused !== null) return { refused }
  const tab = tabsOf(panes, source).tabs.find((candidate) => candidate.id === id)!
  const created = newPaneId(paneIdsOf(panes))
  const { dir, before } = edgeSplit(edge)
  const next: TreeWorkspace = {
    layout: splitLeaf(layout, targetPane, dir, created, { before }),
    panes: { ...panes, [source]: closeTab(tabsOf(panes, source), id), [created]: openTab(emptyTabs, pinned(tab)) },
    channels: inheritChannel(channels, source, created),
  }
  const collapsed = collapseEmptyPane(next, source)
  return { ...(collapsed ?? next), newPane: created, sourcePane: source, collapsed: collapsed !== null }
}

/**
 * 탭을 senderPane 옆에 새 패널로 연다(가리키기 신호의 3 단계: 맞는 창이 없을 때 보낸 창 옆에 새 창, 옆에 노트 열기).
 * 오른쪽 → 아래 → 왼쪽 → 위 차례로 갈라 보고, 어느 쪽도 못 가르면(칸이 상한·너무 작음) null.
 * 새 패널은 보낸 창의 색 채널을 받는다.
 */
export function openTabBeside(panes: PanesState, layout: LayoutNode, senderPane: PaneId, tab: TabsState['tabs'][number], channels: PaneChannels, sizeOf?: PaneSizer): (TreeWorkspace & { readonly newPane: PaneId }) | null {
  if (panes[senderPane] === undefined) return null
  for (const edge of ['right', 'bottom', 'left', 'top'] as const) {
    if (dockRefusal(layout, senderPane, edge, sizeOf) !== null) continue
    const created = newPaneId(paneIdsOf(panes))
    const { dir, before } = edgeSplit(edge)
    return {
      layout: splitLeaf(layout, senderPane, dir, created, { before }),
      panes: { ...panes, [created]: openTab(emptyTabs, tab) },
      channels: inheritChannel(channels, senderPane, created),
      newPane: created,
    }
  }
  return null
}

/**
 * 탭을 다 옮겨 비어 버린 패널의 칸을 닫는다(크롬에서 탭을 다 끌어내면 그 창이 닫히듯). 남은 칸들이 그 자리를 채운다.
 * 칸이 하나뿐이거나 비어 있지 않으면 null.
 */
export function collapseEmptyPane(input: TreeWorkspace, pane: PaneId): TreeWorkspace | null {
  const { panes, layout, channels } = input
  if (paneCount(layout) <= 1 || tabsOf(panes, pane).tabs.length > 0 || !hasPane(layout, pane)) return null
  const next = removeLeaf(layout, pane)
  if (next === null) return null
  const { [pane]: _closed, ...rest } = panes
  return { layout: next, panes: rest, channels: pruneChannels(channels, leaves(next)) }
}

/**
 * 칸 하나를 닫는다(kill-pane): 그 탭은 다음 칸(없으면 앞 칸)의 뒤에 합친다. 하나뿐인 칸이면 null.
 * 다음에 만질 칸(landed)도 돌려준다.
 */
export function closePaneTree(input: TreeWorkspace, pane: PaneId): (TreeWorkspace & { readonly landed: PaneId }) | null {
  const { panes, layout, channels } = input
  const order = leaves(layout)
  const index = order.indexOf(pane)
  if (index < 0 || order.length <= 1) return null
  const next = removeLeaf(layout, pane)
  if (next === null) return null
  const landed = order[index + 1] ?? order[index - 1]!
  return { layout: next, panes: closePaneInto(panes, pane, landed), channels: pruneChannels(channels, leaves(next)), landed }
}

/** 탭을 놓을 자리: 칸 탭 줄의 index 번째, 또는 칸 본문의 구역(가운데 · 가장자리) */
export type TabDropTarget =
  | { readonly kind: 'strip'; readonly pane: PaneId; readonly index: number }
  | { readonly kind: 'body'; readonly pane: PaneId; readonly zone: DockZone }

export interface TabDropOutcome extends TreeWorkspace {
  /** 탭이 앉은 칸(활성 칸이 된다) */
  readonly landed: PaneId
  /** 새로 생긴 칸(나눴을 때) */
  readonly created: PaneId | null
}

/**
 * 왼쪽 바에서 끌어 온 문서·노트 탭을 target 에 연다(보통 탭이다 — 미리보기 아님). 이미 어디 열려 있으면 그 탭을 옮긴다(탭 끌기와 같다).
 * 가장자리가 상한·크기로 안 나뉘면 { refused }, 놓을 칸이 없으면 null.
 */
export function dropTabAt(input: TreeWorkspace, tab: Tab, target: TabDropTarget, sizeOf?: PaneSizer): TabDropOutcome | { readonly refused: SplitRefusal } | null {
  const { panes, layout, channels } = input
  if (panes[target.pane] === undefined) return null
  const source = paneOfTab(panes, tab.id)
  const zone: DockZone = target.kind === 'strip' ? 'center' : target.zone
  if (zone === 'center') {
    const index = target.kind === 'strip' ? target.index : Number.MAX_SAFE_INTEGER
    if (source !== null) {
      const moved = moveTabToPaneAt(panes, tab.id, target.pane, index)
      const next = source !== target.pane ? collapseEmptyPane({ panes: moved, channels, layout }, source) : null
      return { ...(next ?? { panes: moved, channels, layout }), landed: target.pane, created: null }
    }
    return { panes: { ...panes, [target.pane]: insertTabAt(tabsOf(panes, target.pane), pinned(tab), index) }, channels, layout, landed: target.pane, created: null }
  }
  if (source !== null) {
    const outcome = dockTab(input, tab.id, target.pane, zone, sizeOf)
    if (outcome === null) return null
    if ('refused' in outcome) return outcome
    return { panes: outcome.panes, channels: outcome.channels, layout: outcome.layout, landed: outcome.newPane, created: outcome.newPane }
  }
  const refused = dockRefusal(layout, target.pane, zone, sizeOf)
  if (refused !== null) return { refused }
  const created = newPaneId(paneIdsOf(panes))
  const { dir, before } = edgeSplit(zone)
  return {
    layout: splitLeaf(layout, target.pane, dir, created, { before }),
    panes: { ...panes, [created]: openTab(emptyTabs, pinned(tab)) },
    channels: inheritChannel(channels, target.pane, created),
    landed: created,
    created,
  }
}
