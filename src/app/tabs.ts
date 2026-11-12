import { t } from '../i18n'
/**
 * 탭 목록의 상태 전이. DOM·React 를 모르는 순수 함수만 둔다 —
 * "활성 탭을 닫으면 무엇이 활성화되는가" 같은 규칙은 렌더와 무관하고,
 * 여기 있어야 테스트로 못박을 수 있다.
 *
 * 열기·닫기·전환과, 탭을 끌어 순서 바꾸기(reorderTab)를 둔다.
 */

/**
 * 탭의 종류. memoNote 는 메모 노트(.iwnote), canvas 는 YOLO 노트(캔버스, .canvas).
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
  if (existing !== null) return { ...panes, [existing]: activateTab(panes[existing], newTab.id) }
  const state = panes[source]
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
 * 좌우 두 패널. 패널마다 PDF·Markdown·캔버스 탭을 섞어 담는다.
 *
 * 탭 id 는 두 패널을 통틀어 하나뿐이다 — 같은 PDF 가 양쪽에 열리면 읽던 쪽·형광펜
 * 초안이 어느 쪽 것인지 갈라지므로, 이미 열린 탭을 다시 열면 그 패널에서 활성화한다.
 */
export type PaneId = 'left' | 'right' | 'third' | 'fourth'

/**
 * 패널은 화면 차례로 left → right → third 다(이름은 2단 시절 그대로 둔다 — 세션·단축키가 이 이름을 쓴다).
 * 3단이면 right 가 가운데에 온다. 사람에게 보일 이름은 paneLabel 로 만든다.
 */
export interface PanesState {
  left: TabsState
  right: TabsState
  third: TabsState
  /** 넷(2×2) 배치의 네 번째 패널 */
  fourth: TabsState
}

export const PANE_IDS: readonly PaneId[] = ['left', 'right', 'third', 'fourth']

export type PaneCount = 1 | 2 | 3 | 4

/** 지금 단 수에서 보이는 패널들(화면 차례) */
export function visiblePanes(count: PaneCount): readonly PaneId[] {
  return PANE_IDS.slice(0, count)
}

/** 화면에 보일 패널 이름. 2단이면 왼쪽·오른쪽, 3단이면 왼쪽·가운데·오른쪽 */
export function paneLabel(pane: PaneId, count: PaneCount): string {
  if (count === 4) return t('{n}번', { n: PANE_IDS.indexOf(pane) + 1 })
  if (pane === 'left') return t('왼쪽')
  if (pane === 'third' || pane === 'fourth') return t('오른쪽')
  return count === 3 ? t('가운데') : t('오른쪽')
}

/** 반대편 패널(2단 기준). 3단의 맨 오른쪽 패널은 가운데를 반대편으로 본다 */
export function otherPane(pane: PaneId): PaneId {
  return pane === 'left' ? 'right' : 'left'
}

export function paneOfTab(panes: PanesState, id: string): PaneId | null {
  return PANE_IDS.find((pane) => panes[pane].tabs.some((tab) => tab.id === id)) ?? null
}

/** 모든 패널의 탭(화면 차례) */
export function allPaneTabs(panes: PanesState): Tab[] {
  return PANE_IDS.flatMap((pane) => panes[pane].tabs)
}

/**
 * 단 수를 줄이면 숨는 패널의 탭을 남는 맨 끝 패널로 합친다. 보던 패널의 활성 탭을 그대로 보인다.
 * 바뀐 것이 없으면 같은 객체를 돌려준다.
 */
export function mergeHiddenPanes(panes: PanesState, count: PaneCount, focused: PaneId): PanesState {
  const shown = visiblePanes(count)
  const hidden = PANE_IDS.filter((pane) => !shown.includes(pane))
  if (hidden.every((pane) => panes[pane].tabs.length === 0)) return panes
  const target = shown[shown.length - 1]!
  const ids = new Set(panes[target].tabs.map((tab) => tab.id))
  const extra = hidden.flatMap((pane) => panes[pane].tabs).filter((tab) => !ids.has(tab.id))
  const focusedHidden = hidden.includes(focused) ? panes[focused].activeId : null
  const next: PanesState = { ...panes, [target]: { tabs: [...panes[target].tabs, ...extra], activeId: focusedHidden ?? panes[target].activeId ?? extra[0]?.id ?? null } }
  for (const pane of hidden) next[pane] = emptyTabs
  return next
}

/** 열려 있으면 그 패널에서 활성화하고, 없으면 preferred 패널에 새로 연다. */
export function openTabInPanes(panes: PanesState, tab: Tab, preferred: PaneId): PanesState {
  const existing = paneOfTab(panes, tab.id)
  if (existing !== null) return { ...panes, [existing]: activateTab(panes[existing], tab.id) }
  return { ...panes, [preferred]: openTab(panes[preferred], tab) }
}

/** 탭을 반대편(또는 지정한) 패널로 옮긴다. 옮긴 패널에서 활성 탭이 된다. */
export function moveTabToPane(panes: PanesState, id: string, target: PaneId): PanesState {
  const source = paneOfTab(panes, id)
  if (source === null || source === target) return panes
  const tab = panes[source].tabs.find((candidate) => candidate.id === id)!
  return {
    ...panes,
    [source]: closeTab(panes[source], id),
    [target]: openTab(panes[target], tab),
  }
}

export function closeTabEverywhere(panes: PanesState, id: string): PanesState {
  return { left: closeTab(panes.left, id), right: closeTab(panes.right, id), third: closeTab(panes.third, id), fourth: closeTab(panes.fourth, id) }
}

export function mapPaneTabs(panes: PanesState, map: (tab: Tab) => Tab): PanesState {
  return {
    left: { ...panes.left, tabs: panes.left.tabs.map(map) },
    right: { ...panes.right, tabs: panes.right.tabs.map(map) },
    third: { ...panes.third, tabs: panes.third.tabs.map(map) },
    fourth: { ...panes.fourth, tabs: panes.fourth.tabs.map(map) },
  }
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
