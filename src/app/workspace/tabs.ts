import { t } from '../../i18n'
/**
 * 탭 목록의 상태 전이. DOM·React 를 모르는 순수 함수만 둔다 —
 * "활성 탭을 닫으면 무엇이 활성화되는가" 같은 규칙은 렌더와 무관하고,
 * 여기 있어야 테스트로 못박을 수 있다.
 *
 * 열기·닫기·전환과, 탭을 끌어 순서 바꾸기(reorderTab)를 둔다.
 */

/**
 * 탭의 종류. memoNote 는 메모 노트(.iwnote), canvas 는 YOLO 노트(캔버스, .canvas). 번역기는 탭이 아니라 창 전체에 떠 있는 창이다(translatorPanelState).
 * 예전에는 캔버스를 'note' 라고 불렀다 — 남아 있는 'note' 는 normalizeTabKind 가 'canvas' 로 옮긴다.
 */
export type TabKind = 'pdf' | 'markdown' | 'memoNote' | 'canvas'

/** 저장된 값·바깥(MCP)에서 온 탭 종류를 읽는다. 예전 'note' 는 'canvas'. 모르는 값이면 null */
export function normalizeTabKind(raw: unknown): TabKind | null {
  if (raw === 'note') return 'canvas'
  return raw === 'pdf' || raw === 'markdown' || raw === 'memoNote' || raw === 'canvas' ? raw : null
}

/** 문서(PDF·Markdown) 탭인가. 메모 노트·캔버스는 문서가 아니다 */
export function isDocumentKind(kind: TabKind): boolean {
  return kind === 'pdf' || kind === 'markdown'
}

/** 새 탭을 어느 패널에 열지 정하는 길: 문서는 'doc', 노트(메모 노트·캔버스)는 'note' */
export function paneRouteOf(kind: TabKind): 'doc' | 'note' {
  return isDocumentKind(kind) ? 'doc' : 'note'
}

export interface Tab {
  /** pdf 는 docId, memoNote·canvas 는 vault 상대 경로. 패널 안에서 유일하다. */
  id: string
  title: string
  kind: TabKind
  /** 미리보기 탭: 제목이 기울임으로 보이고, 다음 미리보기가 오면 그 자리를 갈아 끼운다. 고치거나 두 번 누르면 고정된다 */
  preview?: boolean
}

export interface TabsState {
  tabs: Tab[]
  activeId: string | null
}

export const emptyTabs: TabsState = { tabs: [], activeId: null }

export function openTab(state: TabsState, tab: Tab): TabsState {
  // 같은 문서를 사이드바에서 두 번 눌렀다고 탭이 둘이 되면 안 된다.
  if (state.tabs.some((t) => t.id === tab.id)) {
    return { tabs: state.tabs, activeId: tab.id }
  }
  return { tabs: [...state.tabs, tab], activeId: tab.id }
}

/**
 * 미리보기 탭으로 연다: 이미 열린 탭이면 그 탭을 활성화하고(고정 여부는 그대로), 아니면 이 줄의 미리보기 탭 자리를 갈아 끼운다(같은 자리).
 * 미리보기 탭이 없으면 맨 뒤에 붙인다. 열린 탭은 하나도 닫히지 않는다 — 갈아 끼우는 것은 이전 미리보기 탭뿐이다.
 */
export function openPreviewTab(state: TabsState, tab: Tab): TabsState {
  if (state.tabs.some((candidate) => candidate.id === tab.id)) return { tabs: state.tabs, activeId: tab.id }
  const preview: Tab = { ...tab, preview: true }
  const at = state.tabs.findIndex((candidate) => candidate.preview === true)
  if (at < 0) return { tabs: [...state.tabs, preview], activeId: preview.id }
  const tabs = state.tabs.slice()
  tabs[at] = preview
  return { tabs, activeId: preview.id }
}

/** 미리보기 탭을 보통 탭으로 고정한다(편집·두 번 누르기·다른 창으로 끌기). 미리보기가 아니면 같은 객체 */
export function pinTab(state: TabsState, id: string): TabsState {
  if (!state.tabs.some((tab) => tab.id === id && tab.preview === true)) return state
  return { tabs: state.tabs.map((tab) => tab.id === id ? unpinned(tab) : tab), activeId: state.activeId }
}

function unpinned(tab: Tab): Tab {
  const { preview: _preview, ...rest } = tab
  return rest
}

/** 모든 창에서 id 탭을 고정한다. 바뀐 것이 없으면 같은 객체 */
export function pinTabInPanes(panes: PanesState, id: string): PanesState {
  if (!allPaneTabs(panes).some((tab) => tab.id === id && tab.preview === true)) return panes
  return mapPanes(panes, (state) => pinTab(state, id))
}

/** 저장해 둔 미리보기 탭 표시를 되살린다. 바뀐 것이 없으면 같은 객체 */
export function markPreviewTabs(panes: PanesState, ids: readonly string[]): PanesState {
  if (ids.length === 0) return panes
  return mapPaneTabs(panes, (tab) => ids.includes(tab.id) ? { ...tab, preview: true } : tab)
}

export function closeTab(state: TabsState, id: string): TabsState {
  const index = state.tabs.findIndex((t) => t.id === id)
  if (index === -1) return state

  const tabs = state.tabs.filter((t) => t.id !== id)
  if (state.activeId !== id) return { tabs, activeId: state.activeId }

  // 활성 탭을 닫았다. 오른쪽 이웃을 잇고, 없으면 왼쪽으로 물러선다.
  // (닫은 자리에 있던 것이 오른쪽 이웃이므로 인덱스는 그대로 쓴다.)
  const next = tabs[index] ?? tabs[index - 1] ?? null
  return { tabs, activeId: next?.id ?? null }
}

/**
 * 지금 보이는 탭. 열린 탭이 없으면 null 이다.
 *
 * PaneShell 과 App 이 각자 `tabs.find(t => t.id === activeId)` 를 쓰고
 * 있었다. 같은 규칙이 두 군데 적히면 "활성 탭이 무엇인가"의 정의가
 * 둘로 갈라질 수 있는 상태가 된다 — 지금은 같지만 다음에 한쪽만 고쳐지는
 * 것이 이런 중복이 무너지는 방식이다. 정의는 상태를 소유한 모듈에 둔다.
 */
export function activeTab(state: TabsState): Tab | null {
  return state.tabs.find((t) => t.id === state.activeId) ?? null
}

export function activateTab(state: TabsState, id: string): TabsState {
  // 없는 id 로 바꾸면 패널이 빈 화면이 된다 — 조용히 무시한다.
  if (!state.tabs.some((t) => t.id === id)) return state
  return { tabs: state.tabs, activeId: id }
}

/**
 * 탭 안에서 문서(판)를 바꾼다: 같은 자리·같은 패널에서 oldId 탭이 newTab 으로 바뀌고 활성 여부도 그대로다.
 * 새 탭이 이미 어딘가에 열려 있으면 그 탭을 활성화하고(옛 탭은 그대로) 같은 객체들을 돌려준다.
 */
export function replaceTab(panes: PanesState, oldId: string, newTab: Tab): PanesState {
  const source = paneOfTab(panes, oldId)
  if (source === null || oldId === newTab.id) return panes
  const existing = paneOfTab(panes, newTab.id)
  if (existing !== null) return { ...panes, [existing]: activateTab(tabsOf(panes, existing), newTab.id) }
  const state = tabsOf(panes, source)
  return {
    ...panes,
    [source]: {
      tabs: state.tabs.map((tab) => tab.id === oldId ? newTab : tab),
      activeId: state.activeId === oldId ? newTab.id : state.activeId,
    },
  }
}

/** 탭을 같은 줄의 toIndex 자리로 옮긴다(끌어서 순서 바꾸기). 활성 탭은 그대로 */
export function reorderTab(state: TabsState, id: string, toIndex: number): TabsState {
  const from = state.tabs.findIndex((t) => t.id === id)
  if (from === -1) return state
  const to = Math.min(Math.max(Math.round(toIndex), 0), state.tabs.length - 1)
  if (to === from) return state
  const tabs = state.tabs.slice()
  const [moved] = tabs.splice(from, 1)
  tabs.splice(to, 0, moved!)
  return { tabs, activeId: state.activeId }
}

/**
 * 칸(패널)들. 칸 id 는 만들 때 붙이는 문자열이고(core/layoutTree 의 newPaneId), 칸 차례(번호)는 나누기 트리의 잎 차례다.
 * 이 객체의 키 차례는 의미가 없다 — 차례가 필요하면 트리(leaves)를 쓴다.
 *
 * 탭 id 는 모든 칸을 통틀어 하나뿐이다 — 같은 PDF 가 두 군데 열리면 읽던 쪽·형광펜
 * 초안이 어느 쪽 것인지 갈라지므로, 이미 열린 탭을 다시 열면 그 패널에서 활성화한다.
 */
export type PaneId = string

export type PanesState = Readonly<Record<PaneId, TabsState>>

/** 칸의 탭 줄. 없는 칸이면 빈 줄 */
export function tabsOf(panes: PanesState, pane: PaneId): TabsState {
  return panes[pane] ?? emptyTabs
}

/** 있는 칸들의 id(키 차례) */
export function paneIdsOf(panes: PanesState): PaneId[] {
  return Object.keys(panes)
}

/** 칸마다 같은 변환을 한 새 상태 */
export function mapPanes(panes: PanesState, map: (state: TabsState, pane: PaneId) => TabsState): PanesState {
  return Object.fromEntries(Object.entries(panes).map(([pane, state]) => [pane, map(state, pane)]))
}

/** 칸 번호(0 부터)를 사람에게 보일 이름으로: 「1번」 */
export function paneLabel(index: number): string {
  return t('{n}번', { n: index + 1 })
}

/** 칸 차례(order)에서 pane 의 다음 칸(끝이면 처음). 칸이 하나뿐이면 자기 자신 */
export function otherPane(order: readonly PaneId[], pane: PaneId): PaneId {
  const index = order.indexOf(pane)
  if (index < 0 || order.length === 0) return order[0] ?? pane
  return order[(index + 1) % order.length]!
}

export function paneOfTab(panes: PanesState, id: string): PaneId | null {
  return paneIdsOf(panes).find((pane) => tabsOf(panes, pane).tabs.some((tab) => tab.id === id)) ?? null
}

/** 모든 패널의 탭. order(칸 차례)를 주면 그 차례로 */
export function allPaneTabs(panes: PanesState, order?: readonly PaneId[]): Tab[] {
  return (order ?? paneIdsOf(panes)).flatMap((pane) => tabsOf(panes, pane).tabs)
}

/** 새 빈 칸을 더한다(이미 있으면 같은 객체) */
export function addEmptyPane(panes: PanesState, pane: PaneId): PanesState {
  return panes[pane] === undefined ? { ...panes, [pane]: emptyTabs } : panes
}

/** 칸을 지우고 그 탭을 into 칸의 뒤에 합친다(이미 있는 탭은 건너뛴다). into 에 보던 탭이 없었다면 닫은 칸의 보던 탭이 보인다 */
export function closePaneInto(panes: PanesState, pane: PaneId, into: PaneId): PanesState {
  const { [pane]: closed, ...rest } = panes
  const target = rest[into]
  if (closed === undefined || closed.tabs.length === 0 || pane === into || target === undefined) return rest
  const have = new Set(target.tabs.map((tab) => tab.id))
  const extra = closed.tabs.filter((tab) => !have.has(tab.id))
  return { ...rest, [into]: { tabs: [...target.tabs, ...extra], activeId: target.activeId ?? closed.activeId } }
}

/** 열려 있으면 그 패널에서 활성화하고, 없으면 preferred 패널에 새로 연다. */
export function openTabInPanes(panes: PanesState, tab: Tab, preferred: PaneId): PanesState {
  const existing = paneOfTab(panes, tab.id)
  if (existing !== null) return { ...panes, [existing]: activateTab(tabsOf(panes, existing), tab.id) }
  return { ...panes, [preferred]: openTab(tabsOf(panes, preferred), tab) }
}

/**
 * 가리키기 신호가 연 탭: 열려 있으면 그 패널에서 활성화하고, 없으면 preferred 패널에 **미리보기 탭**으로 연다(그 패널의 이전 미리보기 탭을 갈아 끼운다).
 * preview 가 false(설정에서 끔)면 보통 탭으로 연다.
 */
export function openPreviewTabInPanes(panes: PanesState, tab: Tab, preferred: PaneId, preview = true): PanesState {
  const existing = paneOfTab(panes, tab.id)
  if (existing !== null) return { ...panes, [existing]: activateTab(tabsOf(panes, existing), tab.id) }
  const state = tabsOf(panes, preferred)
  return { ...panes, [preferred]: preview ? openPreviewTab(state, tab) : openTab(state, tab) }
}

/** 탭을 반대편(또는 지정한) 패널로 옮긴다. 옮긴 패널에서 활성 탭이 된다. */
export function moveTabToPane(panes: PanesState, id: string, target: PaneId): PanesState {
  const source = paneOfTab(panes, id)
  if (source === null || source === target) return panes
  const tab = tabsOf(panes, source).tabs.find((candidate) => candidate.id === id)!
  return {
    ...panes,
    [source]: closeTab(tabsOf(panes, source), id),
    // 다른 창으로 옮긴 미리보기 탭은 고정된다
    [target]: openTab(tabsOf(panes, target), unpinned(tab)),
  }
}

export function closeTabEverywhere(panes: PanesState, id: string): PanesState {
  return mapPanes(panes, (state) => closeTab(state, id))
}

/**
 * 메모 노트가 옮겨졌다(이름 바꾸기·폴더 이동: 옛 경로 → 새 경로). 그 노트의 탭이 새 경로와 새 이름으로 따라간다.
 * 활성 탭도 같이 옮긴다. 바뀐 것이 없으면 같은 객체.
 */
export function moveMemoNoteTabs(panes: PanesState, moved: ReadonlyMap<string, string>, titleOf: (path: string) => string): PanesState {
  const touches = (tab: Tab) => tab.kind === 'memoNote' && moved.has(tab.id)
  if (!allPaneTabs(panes).some(touches)) return panes
  const next: Record<PaneId, TabsState> = { ...panes }
  for (const pane of paneIdsOf(panes)) {
    const state = tabsOf(panes, pane)
    if (!state.tabs.some(touches)) continue
    const activeMoved = state.tabs.find((tab) => tab.id === state.activeId && touches(tab))
    next[pane] = {
      tabs: state.tabs.map((tab) => touches(tab) ? { ...tab, id: moved.get(tab.id)!, title: titleOf(moved.get(tab.id)!) } : tab),
      activeId: activeMoved === undefined ? state.activeId : moved.get(activeMoved.id)!,
    }
  }
  return next
}

/**
 * 메모 노트 목록(경로 → 이름)에 탭을 맞춘다: 목록에 없는 노트(휴지통·밖에서 지움)의 탭은 닫고, 이름이 바뀐 탭은 새 이름으로.
 * 바뀐 것이 없으면 같은 객체.
 */
export function syncMemoNoteTabs(panes: PanesState, titles: ReadonlyMap<string, string>): PanesState {
  const stale = (tab: Tab) => tab.kind === 'memoNote' && (!titles.has(tab.id) || titles.get(tab.id) !== tab.title)
  if (!allPaneTabs(panes).some(stale)) return panes
  let next = panes
  for (const tab of allPaneTabs(panes)) {
    if (!stale(tab)) continue
    next = titles.has(tab.id)
      ? mapPaneTabs(next, (candidate) => candidate.id === tab.id && candidate.kind === 'memoNote' ? { ...candidate, title: titles.get(tab.id)! } : candidate)
      : closeTabEverywhere(next, tab.id)
  }
  return next
}

export function mapPaneTabs(panes: PanesState, map: (tab: Tab) => Tab): PanesState {
  return mapPanes(panes, (state) => ({ ...state, tabs: state.tabs.map(map) }))
}

/**
 * 탭이 보여 주는 PDF 의 docId. 같은 PDF 를 두 군데 열면 두 번째 탭 id 가 "docId#2" 가 된다
 * (탭 id 는 패널을 통틀어 하나뿐이어야 해서). PDF 가 아니면 탭 id 그대로.
 */
export function tabDocId(tab: Tab): string {
  return tab.kind === 'pdf' ? tab.id.replace(/#\d+$/u, '') : tab.id
}

/** 같은 PDF 의 다음 보기 탭 id. 이미 열린 #2, #3 … 을 건너뛴다 */
export function nextViewTabId(panes: PanesState, docId: string): string {
  const used = new Set(allPaneTabs(panes).map((tab) => tab.id))
  let index = 2
  while (used.has(`${docId}#${index}`)) index += 1
  return `${docId}#${index}`
}
