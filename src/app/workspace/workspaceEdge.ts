import { MAX_PANES, MIN_PANE_HEIGHT, MIN_PANE_WIDTH, minSize, newPaneId, newSplitId, paneCount, removeLeaf, type LayoutNode, type Size, type SplitNode, type SplitRefusal } from '../../core/layoutTree'
import { closeTab, emptyTabs, openTab, paneIdsOf, paneOfTab, tabsOf, type PaneId } from './tabs'
import { collapseEmptyPane, edgeSplit, type Box, type DockEdge, type DockOutcome, type TreeWorkspace } from './tabDock'
import { inheritChannel } from './workspaceChannels'

/**
 * 작업 영역 가장자리로 탭 끌기: 칸 트리 전체의 맨 바깥 띠에 놓으면 트리 뿌리를 새 나누기로 감싸 키 전체(또는 폭 전체)를 쓰는 새 칸을 만든다.
 * DOM 을 모르는 순수 함수만 둔다. 한 칸의 가장자리(tabDock.dockTab)는 그 칸만 가르지만, 여기는 모든 칸 바깥에 새 줄을 더한다.
 */

/** 바깥 띠의 두께(px): 트리 상자 안쪽으로 이만큼(왼쪽 · 오른쪽 · 아래). 위쪽은 칸 머리(탭 줄)가 있어 TOP_BAND_PX 로 얇게 둔다 */
export const WORKSPACE_EDGE_BAND_PX = 24
/** 위쪽 띠: 맨 윗 칸의 머리가 바로 아래라 머리 위에서 탭 줄에 놓는 길을 가리지 않게 얇게 둔다(트리 위쪽 바깥 틈도 같이 친다) */
export const WORKSPACE_TOP_BAND_PX = 8
/** 트리 상자 밖으로 이만큼 벗어나도 그 쪽 띠로 친다(마우스가 창 끝이나 칸 사이 틈에 닿는 경우) */
export const WORKSPACE_EDGE_REACH_PX = 12
/** 새 줄이 차지하는 몫(트리 폭 · 높이의 이만큼). 칸 최소 크기보다 작아지면 최소 크기로 */
export const WORKSPACE_EDGE_SHARE = 1 / 3

/**
 * 트리 상자(box) 안 한 점이 어느 바깥 띠인가. 모서리는 더 가까운 쪽. 띠 밖이면 null.
 * allowed 에 없는 쪽은 친 것으로 안 본다(그 쪽은 못 가르는 배치)
 */
export function workspaceEdgeAt(box: Box, x: number, y: number, allowed: readonly DockEdge[]): DockEdge | null {
  if (box.width <= 0 || box.height <= 0) return null
  const left = x - box.left
  const right = box.left + box.width - x
  const top = y - box.top
  const bottom = box.top + box.height - y
  // 상자 밖으로 REACH 넘게 벗어났으면 이 띠가 아니다
  if (left < -WORKSPACE_EDGE_REACH_PX || right < -WORKSPACE_EDGE_REACH_PX || top < -WORKSPACE_EDGE_REACH_PX || bottom < -WORKSPACE_EDGE_REACH_PX) return null
  const candidates: readonly (readonly [DockEdge, number, number])[] = [
    ['left', left, WORKSPACE_EDGE_BAND_PX],
    ['right', right, WORKSPACE_EDGE_BAND_PX],
    ['top', top, WORKSPACE_TOP_BAND_PX],
    ['bottom', bottom, WORKSPACE_EDGE_BAND_PX],
  ]
  let best: DockEdge | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const [edge, distance, band] of candidates) {
    if (distance < band && distance < bestDistance && allowed.includes(edge)) {
      best = edge
      bestDistance = distance
    }
  }
  return best
}

/** 새 줄을 더할 수 있는가: 가능하면 새 줄이 차지할 몫(트리 폭 · 높이에 대한 비율), 못 하면 까닭 */
export type RootDockPlan = { readonly share: number } | { readonly refused: SplitRefusal }

/**
 * 트리 뿌리의 edge 쪽에 새 줄을 더할 수 있는가. total 은 트리 상자의 지금 크기(px) — 모르면 null(크기는 따지지 않고 1/3).
 * closingSource: 이 끌기로 비어 닫힐 칸(다른 칸의 하나뿐인 탭을 끌 때). 닫힌 뒤의 칸 수 · 남는 트리 크기로 센다.
 * 새 줄은 최소 크기(240×160)를 지키고, 남는 트리도 자기 최소 크기를 지킬 수 있을 때만 된다
 */
export function rootDockPlan(layout: LayoutNode, edge: DockEdge, total: Size | null, closingSource: PaneId | null = null): RootDockPlan {
  const base = closingSource !== null ? removeLeaf(layout, closingSource) ?? layout : layout
  if (paneCount(base) >= MAX_PANES) return { refused: 'max' }
  if (total === null || total.width <= 0 || total.height <= 0) return { share: WORKSPACE_EDGE_SHARE }
  const horizontal = edgeSplit(edge).dir === 'h'
  const extent = horizontal ? total.width : total.height
  const minNew = horizontal ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT
  const minRest = horizontal ? minSize(base).width : minSize(base).height
  const taken = Math.max(extent * WORKSPACE_EDGE_SHARE, minNew)
  if (extent - taken < minRest) return { refused: 'small' }
  return { share: taken / extent }
}

/** 미리보기 상자: 트리 상자(box)의 edge 쪽에 키 전체(또는 폭 전체)로 share 만큼 */
export function rootDockBox(box: Box, edge: DockEdge, share: number): Box {
  switch (edge) {
    case 'left': return { left: box.left, top: box.top, width: box.width * share, height: box.height }
    case 'right': return { left: box.left + box.width * (1 - share), top: box.top, width: box.width * share, height: box.height }
    case 'top': return { left: box.left, top: box.top, width: box.width, height: box.height * share }
    case 'bottom': return { left: box.left, top: box.top + box.height * (1 - share), width: box.width, height: box.height * share }
  }
}

/** 트리 뿌리를 새 나누기로 감싼다: 새 칸이 edge 쪽 맨 바깥에 놓이고 share 만큼 차지한다. 기존 트리는 그대로 한 덩어리로 남는다 */
export function splitRoot(root: LayoutNode, newPane: PaneId, edge: DockEdge, share: number): LayoutNode {
  const { dir, before } = edgeSplit(edge)
  const fresh: LayoutNode = { kind: 'pane', paneId: newPane }
  const ratio = before ? share : 1 - share
  const split: SplitNode = { kind: 'split', id: newSplitId(root), dir, ratio, a: before ? fresh : root, b: before ? root : fresh }
  return split
}

/**
 * 탭을 작업 영역의 edge 쪽 맨 바깥 새 칸으로 옮긴다(dockTab 의 뿌리판). 새 칸은 탭이 떠난 칸의 색을 받고,
 * 탭이 떠나 빈 칸은 닫힌다(칸 하나뿐인 탭을 그 칸 하나뿐인 화면에서 끌면 할 일이 없어 null).
 * 못 하면 { refused }, 탭을 못 찾으면 null
 */
export function dockTabAtRoot(input: TreeWorkspace, id: string, edge: DockEdge, total: Size | null): DockOutcome | { readonly refused: SplitRefusal } | null {
  const { panes, layout, channels } = input
  const source = paneOfTab(panes, id)
  if (source === null) return null
  const sourceTabs = tabsOf(panes, source).tabs
  const closesSource = sourceTabs.length <= 1
  if (closesSource && paneCount(layout) <= 1) return null
  const plan = rootDockPlan(layout, edge, total, closesSource ? source : null)
  if ('refused' in plan) return { refused: plan.refused }
  const tab = sourceTabs.find((candidate) => candidate.id === id)!
  const created = newPaneId(paneIdsOf(panes))
  const { preview: _preview, ...pinnedTab } = tab
  const next: TreeWorkspace = {
    layout: splitRoot(layout, created, edge, plan.share),
    panes: { ...panes, [source]: closeTab(tabsOf(panes, source), id), [created]: openTab(emptyTabs, pinnedTab) },
    channels: inheritChannel(channels, source, created),
  }
  const collapsed = collapseEmptyPane(next, source)
  return { ...(collapsed ?? next), newPane: created, sourcePane: source, collapsed: collapsed !== null }
}
