import { layoutRects, leaves, type LayoutNode } from '../../core/layoutTree'
import { groupMemoNotesByDoc, memoNoteTitleOf, type MemoNoteEntry } from '../../core/memoNote'
import { openTabBeside, collapseEmptyPane, type PaneSizer } from './tabDock'
import {
  activeTab,
  openPreviewTab,
  openTab,
  tabsOf,
  type PaneId,
  type PanesState,
  type Tab,
  type TabsState,
} from './tabs'
import { CHANNELS, channelOf, type Channel, type PaneChannel, type PaneChannels } from './workspaceChannels'
import { byRecency } from './paneRecency'

/**
 * 「옆에 노트 열기」의 규칙. DOM·React 를 모르는 순수 함수만 둔다 —
 * 어느 노트를 열지, 어느 창에 어떻게 놓을지, 칸이 가득이면 어떻게 하는지, 닫을 때 무엇이 닫히는지를 마우스 없이 시험한다.
 */

/** 어느 노트를 옆에 열지: 마지막으로 만진 노트 → 이 문서의 노트 → 없음(null: 새로 만든다) */
export function pickNotePath(args: {
  /** 마지막으로 만진 메모 노트(useMemoNotes.openPath) */
  readonly lastTouched: string | null
  /** 노트를 붙일 문서 */
  readonly docId: string | null
  readonly entries: readonly MemoNoteEntry[]
  readonly docOwner?: (docId: string) => string | null
}): string | null {
  const { lastTouched, docId, entries, docOwner } = args
  if (lastTouched !== null && entries.some((entry) => entry.path === lastTouched)) return lastTouched
  if (docId === null || docOwner === undefined) return null
  const owner = docOwner(docId)
  if (owner === null) return null
  return groupMemoNotesByDoc(entries, docOwner).byDoc.get(owner)?.[0]?.path ?? null
}

/** 보이는 창들이 아직 쓰지 않은 색(모두 썼으면 첫 색) */
export function pickFreeChannel(channels: PaneChannels, visible: readonly PaneId[]): Channel {
  const used = new Set(visible.map((pane) => channelOf(channels, pane)))
  return CHANNELS.find((channel) => !used.has(channel)) ?? CHANNELS[0]!
}

/** 배치에서 가장 오른쪽(같으면 가장 위) 창 */
export function rightmostPane(layout: LayoutNode): PaneId {
  const { panes } = layoutRects(layout)
  let best: PaneId = leaves(layout)[0]!
  let bestRight = -1
  let bestTop = Number.POSITIVE_INFINITY
  for (const [pane, rect] of panes) {
    const right = rect.x + rect.w
    // 부동소수점 오차는 같은 값으로 본다
    if (right > bestRight + 1e-9 || (Math.abs(right - bestRight) <= 1e-9 && rect.y < bestTop - 1e-9)) {
      best = pane
      bestRight = right
      bestTop = rect.y
    }
  }
  return best
}

export type PlaceNoteKind =
  /** 같은 창 어딘가에 이미 그 노트가 보인다 */
  | 'visible'
  /** 이미 탭으로 있어 그 탭으로 바꿨다 */
  | 'activated'
  /** 같은 색 노트 창(또는 노트를 보는 창)에 탭으로 넣었다 */
  | 'tab'
  /** 문서 창 옆에 새 창을 열었다 */
  | 'beside'
  /** 칸이 가득이라 가장 오른쪽 창에 탭으로 넣었다 */
  | 'rightmost'

export interface PlaceNoteInput {
  readonly panes: PanesState
  readonly channels: PaneChannels
  readonly layout: LayoutNode
  /** 칸의 지금 크기(px). 주면 너무 작은 칸은 나누지 않는다 */
  readonly sizeOf?: PaneSizer
  /** 노트를 옆에 붙일 창(보통 지금 보는 문서 창). 이 창이 이미 노트를 보이면 거기에 탭으로 더한다 */
  readonly anchor: PaneId
  readonly tab: Tab
  /** 미리보기 탭으로 열기(설정 「미리보기 탭」이 켜져 있고 신호가 연 경우) */
  readonly preview?: boolean
  /** 칸을 만진 차례(가장 최근이 앞, paneRecency). 같은 색 칸이 여럿이면 가장 최근에 만진 칸 하나에만 놓는다 */
  readonly mru?: readonly PaneId[]
}

export interface PlaceNoteOutcome {
  readonly kind: PlaceNoteKind
  readonly panes: PanesState
  readonly channels: PaneChannels
  readonly layout: LayoutNode
  /** 그 노트가 보이게 된 창 */
  readonly pane: PaneId
}

const isNoteTab = (tab: Tab | null): boolean => tab !== null && tab.kind === 'memoNote'

/**
 * 메모 노트 탭(또는 캔버스 탭 — 같은 종류의 탭끼리 한 창에 모인다)을 문서 창(anchor) 옆에 놓는다(설계 3.4·3.6):
 * 1. 이미 어느 창에 탭으로 있으면 그 탭으로 바꾼다.
 * 2. anchor 가 노트를 보이고 있거나, 같은 색의 이웃 창이 노트를 보이고 있으면 그 창에 탭으로 더한다.
 * 3. 없으면 anchor 의 오른쪽(안 되면 아래·왼쪽·위)에 새 창을 열고 anchor 의 색을 준다. anchor 에 색이 없으면 비어 있는 색을 둘 다에 준다.
 * 4. 칸이 가득(상한)이거나 너무 작아 나눌 수 없으면 가장 오른쪽 창에 탭으로 넣고 그 창이 anchor 와 같은 색이 되게 한다.
 * 열린 탭은 하나도 닫지 않는다.
 */
export function placeNoteTab(input: PlaceNoteInput): PlaceNoteOutcome {
  const { panes, layout, anchor, tab, preview = false } = input
  const visible = leaves(layout)
  const withTab = (state: TabsState, target: Tab) => (preview ? openPreviewTab(state, target) : openTab(state, target))

  // 1. 이미 보이는 창에 탭으로 있다
  // 여러 칸이 같은 탭을 갖고 있으면 가장 최근에 만진 칸에서 활성화한다(두 칸을 한꺼번에 바꾸지 않는다)
  // 이미 그 탭을 보이는 칸이 있으면 그 칸이 먼저다(배경 탭으로만 가진 칸을 바꾸면 다른 칸에 보이는 노트를 이 칸에도 끌어오게 된다 — 노트 사이 옮기기 뒤 원래 칸이 받는 노트로 바뀌던 것)
  const holders = byRecency(visible, input.mru).filter((pane) => tabsOf(panes, pane).tabs.some((candidate) => candidate.id === tab.id))
  const holder = holders.find((pane) => tabsOf(panes, pane).activeId === tab.id) ?? holders[0]
  if (holder !== undefined) {
    const held = tabsOf(panes, holder)
    if (held.activeId === tab.id) return { kind: 'visible', panes, channels: input.channels, layout, pane: holder }
    return { kind: 'activated', panes: { ...panes, [holder]: { tabs: held.tabs, activeId: tab.id } }, channels: input.channels, layout, pane: holder }
  }

  // 색이 없는 문서 창이면 비어 있는 색을 골라 둘 다에 준다(노트 창이 같은 색이어야 연동된다)
  const anchorChannel = channelOf(input.channels, anchor)
  const channel: PaneChannel = anchorChannel ?? pickFreeChannel(input.channels, visible)
  const channels: PaneChannels = anchorChannel === null ? { ...input.channels, [anchor]: channel } : input.channels

  // 2. 노트를 보이는 창(anchor 자신 → 같은 색 이웃)
  const showsNote = (pane: PaneId) => { const shown = activeTab(tabsOf(panes, pane)); return shown !== null && shown.kind === tab.kind }
  // 최근에 만진 칸이 이긴다. 기록이 없는 칸끼리일 때만 미리보기 탭이 이미 있는 칸이 먼저다
  const hasPreview = (pane: PaneId) => tabsOf(panes, pane).tabs.some((candidate) => candidate.preview === true)
  const peers = visible.filter((pane) => pane !== anchor && channelOf(channels, pane) === channel && showsNote(pane))
  const host = showsNote(anchor) ? anchor : byRecency([...peers.filter(hasPreview), ...peers.filter((pane) => !hasPreview(pane))], input.mru)[0]
  if (host !== undefined) {
    return { kind: 'tab', panes: { ...panes, [host]: withTab(tabsOf(panes, host), tab) }, channels, layout, pane: host }
  }

  // 3. anchor 옆에 새 창
  const beside = openTabBeside(panes, layout, anchor, preview ? { ...tab, preview: true } : tab, channels, input.sizeOf)
  if (beside !== null) return { kind: 'beside', panes: beside.panes, channels: beside.channels, layout: beside.layout, pane: beside.newPane }

  // 4. 칸이 가득: 가장 오른쪽 창에 탭으로
  const target = rightmostPane(layout)
  return {
    kind: 'rightmost',
    panes: { ...panes, [target]: withTab(tabsOf(panes, target), tab) },
    channels: target === anchor ? channels : { ...channels, [target]: channel },
    layout,
    pane: target,
  }
}

export interface CloseNoteInput {
  readonly panes: PanesState
  readonly channels: PaneChannels
  readonly layout: LayoutNode
  readonly anchor: PaneId
  /** 칸을 만진 차례. 같은 색에 노트 창이 여럿이면 가장 최근에 만진 칸의 노트만 거둔다 */
  readonly mru?: readonly PaneId[]
}

export interface CloseNoteOutcome {
  readonly panes: PanesState
  readonly channels: PaneChannels
  readonly layout: LayoutNode
  /** 노트를 거둔 창(닫힌 칸이면 닫힌 칸의 id) */
  readonly pane: PaneId
  /** 닫힌 노트 탭 id 들 */
  readonly closed: readonly string[]
  /** 칸 자체가 닫혔는가 */
  readonly collapsed: boolean
}

/** anchor 와 같은 색 창(anchor 제외)에서 지금 노트를 보이는 창들 */
export function visibleNotePanes(panes: PanesState, channels: PaneChannels, visible: readonly PaneId[], anchor: PaneId, mru?: readonly PaneId[]): PaneId[] {
  const channel = channelOf(channels, anchor)
  if (channel === null) return []
  return byRecency(visible, mru).filter((pane) => pane !== anchor && channelOf(channels, pane) === channel && isNoteTab(activeTab(tabsOf(panes, pane))))
}

/**
 * 「옆에 노트 닫기」: anchor 와 같은 색에서 노트를 보이는 창의 메모 노트 탭을 거둔다. 그 창에 다른 탭(문서 …)이 있으면 창은 그대로 두고,
 * 노트 탭만 있었으면 창(칸)도 닫는다. 노트 파일은 지우지 않는다(다시 누르면 같은 노트가 다시 열린다).
 * 보이는 노트가 없으면 null
 */
export function closeNoteBeside(input: CloseNoteInput): CloseNoteOutcome | null {
  const { panes, channels, layout, anchor } = input
  const pane = visibleNotePanes(panes, channels, leaves(layout), anchor, input.mru)[0]
  if (pane === undefined) return null
  const state = tabsOf(panes, pane)
  const closed = state.tabs.filter((tab) => tab.kind === 'memoNote')
  const remaining = state.tabs.filter((tab) => tab.kind !== 'memoNote')
  // 보이던 노트 탭 자리에 가장 가까운 남은 탭이 보인다
  const previousIndex = Math.max(state.tabs.findIndex((tab) => tab.id === state.activeId), 0)
  const nextActive = remaining[Math.min(previousIndex, remaining.length - 1)]?.id ?? null
  const trimmed: PanesState = { ...panes, [pane]: { tabs: remaining, activeId: nextActive } }
  const collapsed = remaining.length === 0 ? collapseEmptyPane({ panes: trimmed, channels, layout }, pane) : null
  if (collapsed !== null) {
    return { panes: collapsed.panes, channels: collapsed.channels, layout: collapsed.layout, pane, closed: closed.map((tab) => tab.id), collapsed: true }
  }
  return { panes: trimmed, channels, layout, pane, closed: closed.map((tab) => tab.id), collapsed: false }
}

/** 지금 작업 공간(창·색·배치)의 한 장면 */
export interface WorkspaceSnapshot {
  readonly panes: PanesState
  readonly channels: PaneChannels
  readonly layout: LayoutNode
}

/** 앱이 옆에 노트 열기에 내주는 손잡이들. App 이 채우고, 시험은 가짜로 채운다 */
export interface NoteBesideHost {
  /** 지금 장면(부를 때마다 최신) */
  readonly snapshot: () => WorkspaceSnapshot
  /** 새 장면을 앱에 반영한다. fresh: 새로 생긴 창(자라듯 나타나게 한다) */
  readonly apply: (next: { readonly panes: PanesState; readonly channels: PaneChannels; readonly layout: LayoutNode }, fresh?: PaneId) => void
  /** 칸의 지금 크기(px). 모르면 null(크기는 따지지 않는다) */
  readonly sizeOf?: PaneSizer
  /** 칸을 만진 차례(가장 최근이 앞). 같은 색 칸이 여럿일 때 하나를 고르는 기준 */
  readonly mru?: () => readonly PaneId[]
  /** 마지막으로 만진 메모 노트 */
  readonly lastTouched: () => string | null
  readonly entries: () => readonly MemoNoteEntry[]
  readonly docOwner: (docId: string) => string | null
  /** 이 문서의 새 노트(만든 경로, 못 만들면 null) */
  readonly createForDoc: (docId: string) => Promise<string | null>
  /** 문서에 속하지 않은 새 노트 */
  readonly createGeneral: () => Promise<string | null>
  /** path 를 「마지막으로 만진 노트」로 삼는다 */
  readonly touch: (path: string) => void
  /** Vault 가 열려 있는가(없으면 노트를 열 수 없다) */
  readonly available: () => boolean
  /** 문서 탭의 문서 id(문서가 아니면 null) */
  readonly docIdOf: (tab: Tab | null) => string | null
}

const noteTab = (path: string): Tab => ({ id: path, title: memoNoteTitleOf(path), kind: 'memoNote' })

export interface NoteBesideOpener {
  /**
   * 「옆에 노트 열기」: anchor 문서 창 옆에 노트를 연다. notePath 가 없으면 마지막으로 만진 노트 → 이 문서의 노트 → 새 노트.
   * 열린 노트 경로(못 열면 null). 같은 때 들어온 만들기 요청은 하나의 새 노트로 모은다
   */
  readonly open: (anchor: PaneId, notePath?: string, preview?: boolean) => Promise<string | null>
  /** 「옆에 노트 열기 / 닫기」: 같은 색 창에 노트가 보이면 그 노트 창을 닫고(closed), 아니면 연다(opening) */
  readonly toggle: (anchor: PaneId) => { readonly kind: 'closed'; readonly outcome: CloseNoteOutcome } | { readonly kind: 'opening'; readonly opened: Promise<string | null> }
  /** 이미 놓인 노트 탭을 anchor 옆에 둔다(열기 메뉴·사이드바·MCP): 놓은 결과 */
  readonly place: (anchor: PaneId, path: string, preview?: boolean) => PlaceNoteOutcome
}

/** 옆에 노트 열기의 흐름: 어느 노트를 열지(고르거나 만들고) → 어디에 놓을지(placeNoteTab) → 앱에 반영 */
export function createNoteBesideOpener(host: NoteBesideHost): NoteBesideOpener {
  let creating: Promise<string | null> | null = null

  const place: NoteBesideOpener['place'] = (anchor, path, preview = false) => {
    const now = host.snapshot()
    const outcome = placeNoteTab({ panes: now.panes, channels: now.channels, layout: now.layout, anchor, tab: noteTab(path), preview, ...(host.sizeOf === undefined ? {} : { sizeOf: host.sizeOf }), ...(host.mru === undefined ? {} : { mru: host.mru() }) })
    host.apply({ panes: outcome.panes, channels: outcome.channels, layout: outcome.layout }, outcome.kind === 'beside' ? outcome.pane : undefined)
    host.touch(path)
    return outcome
  }

  const open: NoteBesideOpener['open'] = async (anchor, notePath, preview = false) => {
    if (!host.available()) return null
    const first = host.snapshot()
    const docId = host.docIdOf(activeTab(tabsOf(first.panes, anchor)))
    let path = notePath ?? pickNotePath({ lastTouched: host.lastTouched(), docId, entries: host.entries(), docOwner: host.docOwner })
    if (path === null) {
      creating ??= (docId === null ? host.createGeneral() : host.createForDoc(docId)).finally(() => { creating = null })
      path = await creating
      if (path === null) return null
    }
    place(anchor, path, preview)
    return path
  }

  const toggle: NoteBesideOpener['toggle'] = (anchor) => {
    const now = host.snapshot()
    const closed = closeNoteBeside({ panes: now.panes, channels: now.channels, layout: now.layout, anchor, ...(host.mru === undefined ? {} : { mru: host.mru() }) })
    if (closed === null) return { kind: 'opening', opened: open(anchor) }
    host.apply({ panes: closed.panes, channels: closed.channels, layout: closed.layout })
    return { kind: 'closed', outcome: closed }
  }

  return { open, toggle, place }
}
