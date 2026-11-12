import { PDF_SPLIT_LAYOUTS, closeSplitCell, pdfSplitLayout, type PdfSplitLayoutId } from '../core/pdfSplit'
import { PANE_IDS, closeTab, openTab, emptyTabs, paneOfTab, type PaneId, type PanesState, type TabsState } from './tabs'
import { DEFAULT_CHANNELS, remapChannelsByKeep, remapChannelsBySlots, type PaneChannels } from './workspaceChannels'

/**
 * 탭을 끌어 창(패널)을 나누는 규칙. DOM 을 모르는 순수 함수만 둔다 —
 * 어느 자리가 어느 구역인지, 어느 배치로 바뀌는지는 마우스 없이 시험한다.
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

/** 격자 위의 한 칸을 12×12 눈금에 올린 사각형 */
interface Rect {
  x0: number
  x1: number
  y0: number
  y1: number
}

const LATTICE = 12

export interface DockResult {
  /** 바뀐 배치 */
  readonly layout: PdfSplitLayoutId
  /** 새 배치의 칸 차례대로, 그 칸에 들어갈 옛 칸 번호(새로 생긴 칸이면 'new') */
  readonly slots: readonly (number | 'new')[]
}

/** 지금 배치에서 cellIndex 칸의 edge 쪽을 갈라 새 칸을 만들면 어떤 배치가 되는가. 만들 수 없으면(칸이 넷을 넘음·없는 모양) null */
export function dockSplit(layoutId: PdfSplitLayoutId, cellIndex: number, edge: DockEdge): DockResult | null {
  const layout = pdfSplitLayout(layoutId)
  if (cellIndex < 0 || cellIndex >= layout.cells.length || layout.cells.length >= PANE_IDS.length) return null
  const sx = LATTICE / layout.cols
  const sy = LATTICE / layout.rows
  const rects: (Rect & { from: number | 'new' })[] = layout.cells.map((cell, index) => ({
    x0: cell.col * sx,
    x1: (cell.col + cell.colSpan) * sx,
    y0: cell.row * sy,
    y1: (cell.row + cell.rowSpan) * sy,
    from: index,
  }))
  const target = rects[cellIndex]!
  const added: Rect & { from: 'new' } = { ...target, from: 'new' }
  const midX = (target.x0 + target.x1) / 2
  const midY = (target.y0 + target.y1) / 2
  if (edge === 'left') { added.x1 = midX; target.x0 = midX }
  else if (edge === 'right') { added.x0 = midX; target.x1 = midX }
  else if (edge === 'top') { added.y1 = midY; target.y0 = midY }
  else { added.y0 = midY; target.y1 = midY }
  const all = [...rects, added]
  // 선이 놓인 자리를 순서만 남겨 줄여 쓴다(칸 하나가 갈라져 생긴 새 선도 한 줄·한 열이 된다)
  const xs = [...new Set(all.flatMap((rect) => [rect.x0, rect.x1]))].sort((a, b) => a - b)
  const ys = [...new Set(all.flatMap((rect) => [rect.y0, rect.y1]))].sort((a, b) => a - b)
  const cols = xs.length - 1
  const rows = ys.length - 1
  const placed = all.map((rect) => ({
    col: xs.indexOf(rect.x0),
    row: ys.indexOf(rect.y0),
    colSpan: xs.indexOf(rect.x1) - xs.indexOf(rect.x0),
    rowSpan: ys.indexOf(rect.y1) - ys.indexOf(rect.y0),
    from: rect.from,
  }))
  for (const candidate of PDF_SPLIT_LAYOUTS) {
    if (candidate.cols !== cols || candidate.rows !== rows || candidate.cells.length !== placed.length) continue
    const slots: (number | 'new')[] = []
    const used = new Set<number>()
    let matched = true
    for (const cell of candidate.cells) {
      const at = placed.findIndex((rect, index) => !used.has(index) && rect.col === cell.col && rect.row === cell.row && rect.colSpan === cell.colSpan && rect.rowSpan === cell.rowSpan)
      if (at < 0) { matched = false; break }
      used.add(at)
      slots.push(placed[at]!.from)
    }
    if (matched) return { layout: candidate.id, slots }
  }
  return null
}

/** 이 칸에서 나눌 수 있는 가장자리들 */
export function dockableEdges(layoutId: PdfSplitLayoutId, cellIndex: number): DockEdge[] {
  return (['left', 'right', 'top', 'bottom'] as const).filter((edge) => dockSplit(layoutId, cellIndex, edge) !== null)
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
  const tab = panes[source].tabs.find((candidate) => candidate.id === id)!
  if (source === target) return { ...panes, [target]: insertTabAt(panes[target], tab, index) }
  // 다른 창으로 끌어 옮긴 미리보기 탭은 고정된다
  return {
    ...panes,
    [source]: closeTab(panes[source], id),
    [target]: insertTabAt(panes[target], pinned(tab), index),
  }
}

/**
 * 탭을 패널(targetPane)의 edge 쪽을 갈라 새 패널에 넣는다. 결과: 바뀐 배치와 패널 내용.
 * 자리가 없거나(칸이 넷) 모양이 없으면, 또는 그 패널의 하나뿐인 탭을 자기 패널에서 갈라내려 하면 null.
 * 새 패널은 탭이 떠난 패널의 색 채널을 받고, 나머지 패널의 채널은 새 칸 차례에 맞춰 따라간다(channels).
 */
export function dockTab(panes: PanesState, layoutId: PdfSplitLayoutId, id: string, targetPane: PaneId, edge: DockEdge, channels: PaneChannels = DEFAULT_CHANNELS): { readonly layout: PdfSplitLayoutId; readonly panes: PanesState; readonly newPane: PaneId; readonly sourcePane: PaneId; readonly channels: PaneChannels } | null {
  const source = paneOfTab(panes, id)
  const cellIndex = PANE_IDS.indexOf(targetPane)
  if (source === null) return null
  if (source === targetPane && panes[source].tabs.length <= 1) return null
  const result = dockSplit(layoutId, cellIndex, edge)
  if (result === null) return null
  const tab = panes[source].tabs.find((candidate) => candidate.id === id)!
  const without: PanesState = { ...panes, [source]: closeTab(panes[source], id) }
  const next: PanesState = { left: emptyTabs, right: emptyTabs, third: emptyTabs, fourth: emptyTabs }
  let newPane: PaneId = PANE_IDS[0]!
  result.slots.forEach((slot, index) => {
    const pane = PANE_IDS[index]!
    if (slot === 'new') {
      next[pane] = openTab(emptyTabs, pinned(tab))
      newPane = pane
    } else {
      next[pane] = without[PANE_IDS[slot]!]
    }
  })
  // 탭이 떠난 패널의 새 이름(새 칸이 앞에 끼면 한 칸씩 밀린다)
  const sourcePane = PANE_IDS[result.slots.indexOf(PANE_IDS.indexOf(source))]!
  return { layout: result.layout, panes: next, newPane, sourcePane, channels: remapChannelsBySlots(channels, result.slots, source) }
}

/**
 * 탭을 senderPane 옆에 새 패널로 연다(가리키기 신호의 3 단계: 맞는 창이 없을 때 보낸 창 옆에 새 창).
 * 오른쪽 → 아래 → 왼쪽 → 위 차례로 갈라 보고, 어느 쪽도 못 가르면(칸이 이미 넷) null.
 * 새 패널은 보낸 창의 색 채널을 받는다.
 */
export function openTabBeside(panes: PanesState, layoutId: PdfSplitLayoutId, senderPane: PaneId, tab: TabsState['tabs'][number], channels: PaneChannels = DEFAULT_CHANNELS): { readonly layout: PdfSplitLayoutId; readonly panes: PanesState; readonly newPane: PaneId; readonly channels: PaneChannels } | null {
  const cellIndex = PANE_IDS.indexOf(senderPane)
  for (const edge of ['right', 'bottom', 'left', 'top'] as const) {
    const result = dockSplit(layoutId, cellIndex, edge)
    if (result === null) continue
    const next: PanesState = { left: emptyTabs, right: emptyTabs, third: emptyTabs, fourth: emptyTabs }
    let newPane: PaneId = PANE_IDS[0]!
    result.slots.forEach((slot, index) => {
      const pane = PANE_IDS[index]!
      if (slot === 'new') {
        next[pane] = openTab(emptyTabs, tab)
        newPane = pane
      } else {
        next[pane] = panes[PANE_IDS[slot]!]
      }
    })
    return { layout: result.layout, panes: next, newPane, channels: remapChannelsBySlots(channels, result.slots, senderPane) }
  }
  return null
}

/**
 * 탭을 다 옮겨 비어 버린 패널의 칸을 닫는다(크롬에서 탭을 다 끌어내면 그 창이 닫히듯). 남은 칸들이 그 자리를 채우고,
 * 칸이 하나뿐이거나 비어 있지 않으면 null. remap 은 닫기 전 패널 이름이 닫은 뒤에 무엇이 되는지
 */
export function collapseEmptyPane(panes: PanesState, layoutId: PdfSplitLayoutId, pane: PaneId, channels: PaneChannels = DEFAULT_CHANNELS): { readonly layout: PdfSplitLayoutId; readonly panes: PanesState; readonly remap: (pane: PaneId) => PaneId; readonly channels: PaneChannels } | null {
  const index = PANE_IDS.indexOf(pane)
  if (pdfSplitLayout(layoutId).cells.length <= 1 || index >= pdfSplitLayout(layoutId).cells.length || panes[pane].tabs.length > 0) return null
  const { layout, keep } = closeSplitCell(layoutId, index)
  const next: PanesState = { left: emptyTabs, right: emptyTabs, third: emptyTabs, fourth: emptyTabs }
  keep.forEach((from, slot) => { next[PANE_IDS[slot]!] = panes[PANE_IDS[from]!] })
  const remap = (from: PaneId): PaneId => PANE_IDS[Math.max(keep.indexOf(PANE_IDS.indexOf(from)), 0)]!
  // 창의 색 채널도 창을 따라 옮겨 간다
  return { layout, panes: next, remap, channels: remapChannelsByKeep(channels, keep) }
}
