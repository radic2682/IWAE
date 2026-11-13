import { leaves, type LayoutNode } from '../../core/layoutTree'
import { rightmostPane } from './noteBeside'
import { openTabBeside, type PaneSizer } from './tabDock'
import {
  activeTab,
  isDocumentKind,
  openPreviewTabInPanes,
  tabDocId,
  tabsOf,
  type PaneId,
  type PanesState,
  type Tab,
  type TabKind,
} from './tabs'
import { channelOf, type PaneChannel, type PaneChannels } from './workspaceChannels'
import { byRecency } from './paneRecency'

/**
 * 가리키기 신호를 받아 「필요한 탭이 어느 창에 어떻게 보이는가」를 정하는 순수 함수들.
 * DOM·React 를 모른다 — 같은 채널만 받는지, 활성화 → 미리보기 → 새 창 차례가 맞는지는 마우스 없이 시험한다.
 */

/** 보여 줘야 하는 것: 문서(doc) 또는 메모 노트(note). tab 은 어디에도 없을 때 열 탭, matches 는 이미 열린 탭이 그것인지 */
export interface ResolveNeed {
  readonly kind: 'doc' | 'note'
  readonly tab: Tab
  readonly matches: (tab: Tab) => boolean
}

export interface ResolveInput {
  readonly panes: PanesState
  readonly channels: PaneChannels
  readonly layout: LayoutNode
  /** 칸의 지금 크기(px). 주면 너무 작은 칸은 나누지 않는다 */
  readonly sizeOf?: PaneSizer
  /** 신호를 보낸 창과 그 채널 */
  readonly from: PaneId
  readonly channel: PaneChannel
  readonly need: ResolveNeed
  /** 설정 「다른 노트·문서를 미리보기 탭으로 열기」. 끄면 보통 탭으로 연다 */
  readonly preview: boolean
  /** 같은 채널에 맞는 창이 없을 때 보낸 창 옆에 새 창을 열어도 되는가 */
  readonly allowNewPane?: boolean
  /**
   * 칸을 만진 차례(가장 최근이 앞, paneRecency). 같은 색 칸이 여럿이면 내용을 바꿔야 할 때 가장 최근에 만진 칸 하나만 바뀐다 —
   * 이미 탭이 있는 칸이 여럿이면 그중 최근 칸에서 활성화하고, 미리보기 탭도 최근 칸에 연다. 없으면 화면 차례가 비김 규칙이다
   */
  readonly mru?: readonly PaneId[]
}

export type ResolveKind =
  /** 같은 채널 창에 이미 보인다 — 바꿀 것이 없다 */
  | 'visible'
  /** 같은 채널 창에 탭으로 있어 그 탭으로 바꿨다 */
  | 'activated'
  /** 맞는 종류의 같은 채널 창에 미리보기 탭으로 열었다 */
  | 'preview'
  /** 보낸 창 옆에 새 창을 열고 같은 채널을 줬다 */
  | 'beside'
  /** 새 창을 못 열어(칸이 상한·너무 작음) 가장 오른쪽 창에 탭으로 열었다(노트만; 그 창은 보낸 창의 색이 된다) */
  | 'rightmost'
  /** 새 창을 못 열어(칸이 상한·너무 작음) 보낸 창에 미리보기 탭으로 열었다 */
  | 'sender'
  /** 할 일 없음(채널 없음·새 창을 열지 않는 경우) */
  | 'none'

export interface ResolveOutcome {
  readonly kind: ResolveKind
  readonly panes: PanesState
  readonly channels: PaneChannels
  readonly layout: LayoutNode
  /** 그 탭이 보이게 된 창(none 이면 null) */
  readonly pane: PaneId | null
}

/**
 * 신호의 해석 차례(설계 3.3):
 * 1. 같은 채널 창에 그 문서·노트가 탭으로 있으면 그 탭으로 바꾼다(이미 보이면 그대로).
 * 2. 없으면 맞는 종류의 같은 채널 창(문서는 문서를 보는 창, 노트는 메모 노트를 보는 창)에 미리보기 탭으로 연다.
 * 3. 그런 창도 없으면 보낸 창 옆에 새 창을 열고 같은 채널을 준다. 칸이 가득이면 보낸 창에 미리보기 탭으로.
 * 보낸 창 자신은 1·2 의 후보가 아니다(누른 문서를 노트로 덮어 버리면 안 된다). 채널이 없으면 아무것도 하지 않는다.
 */
export function resolvePointSignal(input: ResolveInput): ResolveOutcome {
  const { panes, channels, layout, from, channel, need, preview, allowNewPane = true } = input
  const visible = leaves(layout)
  const none: ResolveOutcome = { kind: 'none', panes, channels, layout, pane: null }
  if (channel === null) return none
  // 같은 색 칸은 최근에 만진 순서로: 보이는 칸은 모두 반응하지만(받는 쪽이 스스로), 바꿀 칸은 하나만 — 맨 앞이 그 칸이다
  const peers = byRecency(visible.filter((pane) => pane !== from && channelOf(channels, pane) === channel), input.mru)

  // 0. 이미 보인다(보낸 창 자신이 보고 있어도 마찬가지)
  const own = activeTab(tabsOf(panes, from))
  if (own !== null && need.matches(own)) return { kind: 'visible', panes, channels, layout, pane: from }
  const showing = peers.find((pane) => { const tab = activeTab(tabsOf(panes, pane)); return tab !== null && need.matches(tab) })
  if (showing !== undefined) return { kind: 'visible', panes, channels, layout, pane: showing }

  // 1. 같은 채널 창에 탭으로 있다
  const holder = peers.find((pane) => tabsOf(panes, pane).tabs.some(need.matches))
  if (holder !== undefined) {
    const state = tabsOf(panes, holder)
    const held = state.tabs.find(need.matches)!
    return { kind: 'activated', panes: { ...panes, [holder]: { tabs: state.tabs, activeId: held.id } }, channels, layout, pane: holder }
  }

  // 2. 맞는 종류의 같은 채널 창에 미리보기 탭으로(이미 미리보기 탭이 있는 창을 먼저 — 새 탭을 늘리지 않고 갈아 끼운다)
  const fits = (pane: PaneId) => {
    const tab = activeTab(tabsOf(panes, pane))
    return tab !== null && (need.kind === 'doc' ? isDocumentKind(tab.kind) : tab.kind === 'memoNote')
  }
  // 가장 최근에 만진 칸이 이긴다. 만진 기록이 없는 칸끼리일 때만 미리보기 탭이 이미 있는 칸을 먼저(탭을 늘리지 않고 갈아 끼운다)
  const hasPreview = (pane: PaneId) => tabsOf(panes, pane).tabs.some((tab) => tab.preview === true)
  const fitting = peers.filter(fits)
  const host = byRecency([...fitting.filter(hasPreview), ...fitting.filter((pane) => !hasPreview(pane))], input.mru)[0]
  if (host !== undefined) {
    return { kind: 'preview', panes: openPreviewTabInPanes(panes, need.tab, host, preview), channels, layout, pane: host }
  }

  // 3. 보낸 창 옆에 새 창(같은 채널). 칸이 가득이면 보낸 창에 미리보기 탭
  if (!allowNewPane) return none
  const beside = openTabBeside(panes, layout, from, preview ? { ...need.tab, preview: true } : need.tab, channels, input.sizeOf)
  if (beside !== null) return { kind: 'beside', panes: beside.panes, channels: beside.channels, layout: beside.layout, pane: beside.newPane }
  // 칸이 가득이면: 노트는 가장 오른쪽 창에 탭으로(그 창이 같은 색이 된다), 문서는 보낸 창에 미리보기 탭으로
  if (need.kind === 'note') {
    const target = rightmostPane(layout)
    return { kind: 'rightmost', panes: openPreviewTabInPanes(panes, need.tab, target, preview), channels: target === from ? channels : { ...channels, [target]: channel }, layout, pane: target }
  }
  return { kind: 'sender', panes: openPreviewTabInPanes(panes, need.tab, from, preview), channels, layout, pane: from }
}

/**
 * 메모 신호가 보여 줘야 하는 것. 문서 화면에서 보낸 신호면 그 메모를 담은 노트(이미 같은 채널에 보이는 노트를 먼저),
 * 노트 화면에서 보낸 신호면 그 메모의 문서. 알 수 없으면 null.
 */
export function needForMemo(args: {
  readonly memoId: string
  /** 어느 노트인지 정해진 신호(티켓의 다른 자리): 그 노트를 보인다 */
  readonly notePath?: string
  /** 보낸 쪽이 노트 화면인가 */
  readonly fromNote: boolean
  readonly notesOf: (highlightId: string) => readonly string[]
  /** 같은 채널 창에 지금 보이는 노트 경로들 */
  readonly visibleNotes: readonly string[]
  /** 형광펜 id → 그 문서 id */
  readonly docIdOf: (highlightId: string) => string | null
  readonly docTab: (docId: string) => Tab | null
  readonly noteTab: (path: string) => Tab
}): ResolveNeed | null {
  const { memoId, notePath, fromNote, notesOf, visibleNotes, docIdOf, docTab, noteTab } = args
  if (notePath !== undefined) {
    return { kind: 'note', tab: noteTab(notePath), matches: (candidate) => candidate.kind === 'memoNote' && candidate.id === notePath }
  }
  if (fromNote) {
    const docId = docIdOf(memoId)
    if (docId === null) return null
    const tab = docTab(docId)
    if (tab === null) return null
    return { kind: 'doc', tab, matches: (candidate) => isDocumentKind(candidate.kind) && tabDocId(candidate) === docId }
  }
  const paths = notesOf(memoId)
  const path = paths.find((candidate) => visibleNotes.includes(candidate)) ?? paths[0]
  if (path === undefined) return null
  return { kind: 'note', tab: noteTab(path), matches: (candidate) => candidate.kind === 'memoNote' && candidate.id === path }
}

/**
 * 노트 블록의 「다른 자리」로 가기(티켓 배지의 곳 목록): 같은 색 창에 메모 노트가 보이면 신호로 그 창에 보이고('signal'),
 * 아니면 이 화면에서 그 노트를 탭으로 열어(옆에 노트 열기와 같다) 보인다('local'). 이 화면이 이미 그 노트를 보고 있으면(openPath) 늘 'local'.
 */
export function placementRevealMode(args: {
  readonly path: string
  /** 이 화면(노트 탭의 노트) */
  readonly openPath: string | null
  readonly pane: PaneId | null
  readonly channel: PaneChannel
  /** 이 창과 같은 색 창에서 지금 보이는 메모 노트들 */
  readonly channelNotes: readonly string[]
}): 'signal' | 'local' {
  if (args.path === args.openPath || args.pane === null || args.channel === null) return 'local'
  return args.channelNotes.length > 0 ? 'signal' : 'local'
}

/** 문서(위치) 신호가 보여 줘야 하는 문서 */
export function needForPlace(docId: string, docTab: (docId: string) => Tab | null): ResolveNeed | null {
  const tab = docTab(docId)
  if (tab === null) return null
  return { kind: 'doc', tab, matches: (candidate) => isDocumentKind(candidate.kind) && tabDocId(candidate) === docId }
}

/** pane 과 같은 채널의, pane 이 아닌 창들 중 보이는 창 */
export function channelPeers(channels: PaneChannels, visible: readonly PaneId[], pane: PaneId): PaneId[] {
  const channel = channelOf(channels, pane)
  return channel === null ? [] : visible.filter((other) => other !== pane && channelOf(channels, other) === channel)
}

/** channel 의 창들에서 지금 보이는(활성 탭인) 메모 노트 경로들(mru 가 있으면 최근에 만진 칸의 노트가 먼저, 없으면 화면 차례) */
export function visibleNotePathsIn(panes: PanesState, channels: PaneChannels, visible: readonly PaneId[], channel: PaneChannel, mru?: readonly PaneId[]): string[] {
  if (channel === null) return []
  return byRecency(visible, mru).flatMap((pane) => {
    const tab = activeTab(tabsOf(panes, pane))
    return channelOf(channels, pane) === channel && tab?.kind === 'memoNote' ? [tab.id] : []
  })
}

/**
 * pane(문서 창)에서 새 메모가 갈 노트: 같은 채널 창에서 지금 보이는 메모 노트 탭 중 가장 최근에 만진 칸의 것(mru 가 없으면 화면 차례 첫째).
 * 없으면 null — 문서 창이 옆에 노트를 연다. 채널이 없는 창은 어느 노트 탭과도 잇지 않는다. 같은 색 칸이 여럿이어도 노트는 늘 하나만 고른다.
 */
export function memoNoteTargetFor(panes: PanesState, channels: PaneChannels, visible: readonly PaneId[], pane: PaneId, mru?: readonly PaneId[]): string | null {
  return visibleNotePathsIn(panes, channels, visible.filter((other) => other !== pane), channelOf(channels, pane), mru)[0] ?? null
}

/** memoNoteTargetFor 가 고른 노트가 보이는 칸(칩을 누르면 그 칸이 깜빡인다). 없으면 null */
export function memoNoteTargetPaneFor(panes: PanesState, channels: PaneChannels, visible: readonly PaneId[], pane: PaneId, mru?: readonly PaneId[]): PaneId | null {
  const channel = channelOf(channels, pane)
  if (channel === null) return null
  return byRecency(visible.filter((other) => other !== pane), mru).find((other) => channelOf(channels, other) === channel && activeTab(tabsOf(panes, other))?.kind === 'memoNote') ?? null
}

/** 탭 종류 → 노트 화면인가(메모 노트·캔버스) */
export function isNoteSurface(kind: TabKind | null | undefined): boolean {
  return kind === 'memoNote' || kind === 'canvas'
}

/** 신호를 보낸 창의 보이는 탭 종류 */
export function activeKindOf(panes: PanesState, pane: PaneId): TabKind | null {
  return activeTab(tabsOf(panes, pane))?.kind ?? null
}
