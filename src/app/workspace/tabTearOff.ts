import { paneNode, newPaneId } from '../../core/layoutTree'
import { allScreenPaneIds, closeScreen, newScreenId, replaceScreen, screenPaneIds, type Screen, type ScreensState } from './screens'
import { insertTabAt } from './tabDock'
import { closeTab, emptyTabs, openTab, paneOfTab, tabsOf, type PaneId, type Tab } from './tabs'
import { channelOf } from './workspaceChannels'

/**
 * 노트 · Markdown 탭 떼어 내기(tmux 식, docs/design/workspace-tmux.md §12 손질 6차): 탭을 같은 세션의 새 화면(칸 하나)에 담고,
 * 그 화면을 보는 새 앱 창을 연다. 여기는 화면 상태만 다루는 순수 함수다 — 창을 여는 것은 App.
 */

/** 미리보기 표시를 뗀 탭(다른 화면으로 옮겨 간 탭은 보통 탭이 된다) */
function pinned(tab: Tab): Tab {
  if (tab.preview !== true) return tab
  const { preview: _preview, ...rest } = tab
  return rest
}

/**
 * 탭이 들어 있는 화면과 칸(떠 있는 칸 포함). 같은 노트 · Markdown 탭이 여러 칸 · 여러 화면에 열려 있을 수 있어서, 어느 칸의 탭인지 알면
 * (pane) 그 칸에서만 찾고 첫 번째 것으로 대신하지 않는다. 없으면 null
 */
function screenOfTab(state: ScreensState, tabId: string, pane?: PaneId): { readonly screen: Screen; readonly pane: PaneId } | null {
  for (const screen of state.screens) {
    if (pane !== undefined) {
      if (screenPaneIds(screen).includes(pane) && tabsOf(screen.panes, pane).tabs.some((tab) => tab.id === tabId)) return { screen, pane }
      continue
    }
    const found = paneOfTab(screen.panes, tabId)
    if (found !== null) return { screen, pane: found }
  }
  return null
}

export interface TearOutcome {
  readonly screens: ScreensState
  /** 새로 생긴 화면의 id */
  readonly screenId: string
  /** 새 화면의 칸 */
  readonly pane: PaneId
}

/**
 * 탭 하나를 새 화면(맨 뒤, 칸 하나)으로 옮긴다. 보는 화면은 그대로다(새 화면은 새 앱 창이 본다).
 * 원래 칸은 탭이 비어도 닫지 않는다(하나뿐인 칸의 마지막 탭이면 빈 칸이 남는다). 새 칸은 원래 칸의 색 채널을 받는다.
 * screenId: 미리 정해 둔 새 화면 id(창을 열 때 주소에 실어야 해서 먼저 정한다). fromPane: 끈 탭이 있는 칸(같은 탭이 여러 칸에 있어도 그 칸에서만 뗀다). 탭이 없으면 null.
 */
export function tearTabToScreen(state: ScreensState, tabId: string, name: string, screenId?: string, fromPane?: PaneId): TearOutcome | null {
  const found = screenOfTab(state, tabId, fromPane)
  if (found === null) return null
  const { screen, pane } = found
  const tab = tabsOf(screen.panes, pane).tabs.find((candidate) => candidate.id === tabId)
  if (tab === undefined) return null
  const id = screenId ?? newScreenId(state.screens.map((candidate) => candidate.id))
  if (state.screens.some((candidate) => candidate.id === id)) return null
  const created = newPaneId(allScreenPaneIds(state))
  const shrunk: Screen = { ...screen, panes: { ...screen.panes, [pane]: closeTab(tabsOf(screen.panes, pane), tabId) } }
  const added: Screen = {
    id,
    name,
    layout: paneNode(created),
    panes: { [created]: openTab(emptyTabs, pinned(tab)) },
    channels: { [created]: channelOf(screen.channels, pane) },
    zoomed: null,
    floats: [],
  }
  const replaced = replaceScreen(state, shrunk)
  return { screens: { ...replaced, screens: [...replaced.screens, added] }, screenId: id, pane: created }
}

/**
 * 탭을 칸 pane(어느 화면의 칸이든)의 index 자리에 붙인다. 떼어 낸 창을 다른 앱 창의 탭 줄에 놓았을 때 쓴다 —
 * 탭이 있던 화면이 칸 하나에 빈 칸만 남으면(떼어 낼 때 만든 화면) 그 화면은 닫는다. 탭이나 칸이 없으면 null.
 */
export function attachTabToPane(state: ScreensState, tabId: string, target: PaneId, index: number, fromScreen?: string): ScreensState | null {
  // fromScreen: 떼어 낸 탭이 담긴 화면. 알면 그 화면에서만 찾는다(같은 탭이 다른 화면에도 열려 있어도 엉뚱한 것을 옮기지 않는다)
  const found = fromScreen === undefined
    ? screenOfTab(state, tabId)
    : (() => {
      const screen = state.screens.find((candidate) => candidate.id === fromScreen)
      const pane = screen === undefined ? null : paneOfTab(screen.panes, tabId)
      return screen === undefined || pane === null ? null : { screen, pane }
    })()
  const targetScreen = state.screens.find((screen) => screenPaneIds(screen).includes(target))
  if (found === null || targetScreen === undefined) return null
  const { screen: source, pane: sourcePane } = found
  const tab = tabsOf(source.panes, sourcePane).tabs.find((candidate) => candidate.id === tabId)
  if (tab === undefined) return null
  if (source.id === targetScreen.id) {
    // 같은 화면: 칸 안에서 자리를 옮기거나 다른 칸으로 옮긴다
    const closed = sourcePane === target ? source.panes : { ...source.panes, [sourcePane]: closeTab(tabsOf(source.panes, sourcePane), tabId) }
    return replaceScreen(state, { ...source, panes: { ...closed, [target]: insertTabAt(tabsOf(closed, target), pinned(tab), index) } })
  }
  const shrunk: Screen = { ...source, panes: { ...source.panes, [sourcePane]: closeTab(tabsOf(source.panes, sourcePane), tabId) } }
  const grown: Screen = { ...targetScreen, panes: { ...targetScreen.panes, [target]: insertTabAt(tabsOf(targetScreen.panes, target), pinned(tab), index) } }
  const moved: ScreensState = { ...state, screens: state.screens.map((screen) => (screen.id === shrunk.id ? shrunk : screen.id === grown.id ? grown : screen)) }
  const leftover = screenPaneIds(shrunk).length === 1 && tabsOf(shrunk.panes, screenPaneIds(shrunk)[0]!).tabs.length === 0
  return leftover ? closeScreen(moved, shrunk.id) ?? moved : moved
}
