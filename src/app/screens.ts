import { leaves, paneNode, newPaneId, removeLeaf, type LayoutNode } from '../core/layoutTree'
import { emptyTabs, tabsOf, type PanesState } from './tabs'
import { channelOf, pruneChannels, type PaneChannels } from './workspaceChannels'
import type { TreeWorkspace } from './tabDock'

/**
 * 화면(tmux 의 window, docs/design/workspace-tmux.md 2). 칸을 모은 파티션이다: 화면마다 자기 나누기 트리 · 칸의 탭 · 색 채널 ·
 * 「크게」로 키운 칸을 가진다. 칸은 한 화면에만 속한다. DOM·React 를 모르는 순수 함수만 둔다.
 */
export interface Screen {
  readonly id: string
  readonly name: string
  readonly layout: LayoutNode
  readonly panes: PanesState
  readonly channels: PaneChannels
  /** 「크게」로 화면 전체를 차지한 칸(없으면 null) */
  readonly zoomed: string | null
}

export interface ScreensState {
  readonly screens: readonly Screen[]
  /** 보는 화면의 id */
  readonly activeScreen: string
  /** 바로 앞에 보던 화면의 id(tmux 의 last-window). 없으면 null */
  readonly lastScreen: string | null
}

let screenSequence = 0

/** 쓰지 않은 화면 id */
export function newScreenId(used: Iterable<string> = []): string {
  const taken = new Set(used)
  let id: string
  do { screenSequence += 1; id = `w${screenSequence}` } while (taken.has(id))
  return id
}

/** 저장에서 되살린 화면 id 를 비켜 둔다(`w<번호>`) */
export function reserveScreenIds(ids: Iterable<string>): void {
  for (const id of ids) {
    const match = /^w(\d+)$/u.exec(id)
    if (match !== null) screenSequence = Math.max(screenSequence, Number(match[1]))
  }
}

/** 한 화면에서 TreeWorkspace(탭·색·배치)만 꺼낸다 */
export function workspaceOf(screen: Screen): TreeWorkspace {
  return { panes: screen.panes, channels: screen.channels, layout: screen.layout }
}

/** 모든 화면의 칸 id(새 칸 id 가 다른 화면의 칸과 겹치지 않게) */
export function allScreenPaneIds(state: ScreensState): string[] {
  return state.screens.flatMap((screen) => leaves(screen.layout))
}

export function activeScreenOf(state: ScreensState): Screen {
  return state.screens.find((screen) => screen.id === state.activeScreen) ?? state.screens[0]!
}

export function screenIndexOf(state: ScreensState, id: string): number {
  return state.screens.findIndex((screen) => screen.id === id)
}

/** 보는 화면의 탭·색·배치를 바꾼다(zoom 은 그대로. 크게 보던 칸이 없어졌으면 푼다) */
export function withActiveWorkspace(state: ScreensState, next: TreeWorkspace): ScreensState {
  const active = activeScreenOf(state)
  if (next.panes === active.panes && next.channels === active.channels && next.layout === active.layout) return state
  const order = leaves(next.layout)
  const zoomed = active.zoomed !== null && order.includes(active.zoomed) ? active.zoomed : null
  return replaceScreen(state, { ...active, ...next, zoomed })
}

function replaceScreen(state: ScreensState, screen: Screen): ScreensState {
  return { ...state, screens: state.screens.map((candidate) => (candidate.id === screen.id ? screen : candidate)) }
}

/** 보는 화면의 「크게」 칸을 정한다(null 이면 푼다). 그 화면에 없는 칸이면 그대로 */
export function setZoomed(state: ScreensState, pane: string | null): ScreensState {
  const active = activeScreenOf(state)
  if (pane !== null && !leaves(active.layout).includes(pane)) return state
  return active.zoomed === pane ? state : replaceScreen(state, { ...active, zoomed: pane })
}

/** 빈 화면: 빈 칸 하나 */
export function blankScreen(name: string, used: Iterable<string> = []): Screen {
  const pane = newPaneId(used)
  return { id: newScreenId(), name, layout: paneNode(pane), panes: { [pane]: emptyTabs }, channels: { [pane]: 'blue' }, zoomed: null }
}

/** 새 화면의 id 를 붙여 맨 뒤에 더한다. activate 면 그 화면으로 옮겨 간다(바로 앞 화면은 lastScreen 이 된다) */
export function addScreen(state: ScreensState, screen: Omit<Screen, 'id'> & { readonly id?: string }, activate = true): ScreensState {
  const id = screen.id ?? newScreenId(state.screens.map((candidate) => candidate.id))
  const added: Screen = { ...screen, id }
  const screens = [...state.screens, added]
  return activate
    ? { screens, activeScreen: id, lastScreen: state.activeScreen }
    : { ...state, screens }
}

export function renameScreen(state: ScreensState, id: string, name: string): ScreensState {
  const trimmed = name.trim()
  const screen = state.screens.find((candidate) => candidate.id === id)
  if (screen === undefined || trimmed === '' || screen.name === trimmed) return state
  return replaceScreen(state, { ...screen, name: trimmed })
}

/** 화면을 toIndex 자리로 옮긴다(끌어 순서 바꾸기) */
export function reorderScreen(state: ScreensState, id: string, toIndex: number): ScreensState {
  const from = screenIndexOf(state, id)
  if (from < 0) return state
  const at = Math.min(Math.max(Math.round(toIndex), 0), state.screens.length - 1)
  if (at === from) return state
  const rest = state.screens.filter((screen) => screen.id !== id)
  const moved = state.screens[from]!
  return { ...state, screens: [...rest.slice(0, at), moved, ...rest.slice(at)] }
}

/** 화면을 보러 간다. 같은 화면이거나 없는 화면이면 그대로 */
export function switchScreen(state: ScreensState, id: string): ScreensState {
  if (id === state.activeScreen || screenIndexOf(state, id) < 0) return state
  return { ...state, activeScreen: id, lastScreen: state.activeScreen }
}

/** 번호(0 부터)로 보러 간다 */
export function switchScreenAt(state: ScreensState, index: number): ScreensState {
  const screen = state.screens[index]
  return screen === undefined ? state : switchScreen(state, screen.id)
}

/** 다음(step 1) · 이전(step -1) 화면. 끝에서는 돌아 나간다 */
export function stepScreen(state: ScreensState, step: number): ScreensState {
  const count = state.screens.length
  if (count <= 1) return state
  const at = screenIndexOf(state, state.activeScreen)
  return switchScreen(state, state.screens[(at + step + count) % count]!.id)
}

/** 바로 앞에 보던 화면으로(last-window) */
export function lastScreenOf(state: ScreensState): ScreensState {
  return state.lastScreen === null ? state : switchScreen(state, state.lastScreen)
}

/**
 * 화면을 닫는다(kill-window). 하나뿐이면 null. 보던 화면을 닫으면 바로 앞에 보던 화면(없으면 이웃)으로 간다.
 * 닫힌 화면의 탭은 호출한 쪽이 처리한다 — 여기서는 화면만 뺀다.
 */
export function closeScreen(state: ScreensState, id: string): ScreensState | null {
  const index = screenIndexOf(state, id)
  if (index < 0 || state.screens.length <= 1) return null
  const screens = state.screens.filter((screen) => screen.id !== id)
  const lastScreen = state.lastScreen === id ? null : state.lastScreen
  if (id !== state.activeScreen) return { screens, activeScreen: state.activeScreen, lastScreen }
  const next = lastScreen !== null && screens.some((screen) => screen.id === lastScreen)
    ? lastScreen
    : (screens[index] ?? screens[index - 1]!).id
  return { screens, activeScreen: next, lastScreen: null }
}

/**
 * 칸 하나를 새 화면으로 뗀다(break-pane): 그 칸의 탭 · 색을 그대로 가진 새 화면을 맨 뒤에 더하고 그리로 간다.
 * 칸이 하나뿐이거나 이 화면의 칸이 아니면 null.
 */
export function breakPane(state: ScreensState, pane: string, name: string): ScreensState | null {
  const active = activeScreenOf(state)
  if (leaves(active.layout).length <= 1 || !leaves(active.layout).includes(pane)) return null
  const layout = removeLeaf(active.layout, pane)
  if (layout === null) return null
  const { [pane]: moved, ...rest } = active.panes
  const shrunk: Screen = {
    ...active,
    layout,
    panes: rest,
    channels: pruneChannels(active.channels, leaves(layout)),
    zoomed: active.zoomed === pane ? null : active.zoomed,
  }
  const id = newScreenId(state.screens.map((screen) => screen.id))
  const created: Screen = { id, name, layout: paneNode(pane), panes: { [pane]: moved ?? tabsOf(active.panes, pane) }, channels: { [pane]: channelOf(active.channels, pane) }, zoomed: null }
  return { screens: [...state.screens.map((screen) => (screen.id === active.id ? shrunk : screen)), created], activeScreen: id, lastScreen: active.id }
}

/** 화면 이름이 비었을 때 쓸 이름(번호만) */
export function screenLabel(screen: Screen, index: number): string {
  return screen.name.trim() === '' ? String(index) : screen.name
}

/**
 * 상태 줄 왼쪽의 화면 목록: `0:읽기* 1:비교-` (* 보는 화면, - 바로 앞에 보던 화면).
 */
export function statusScreens(state: ScreensState): string {
  return state.screens
    .map((screen, index) => `${index}:${screen.name}${screen.id === state.activeScreen ? '*' : screen.id === state.lastScreen ? '-' : ''}`)
    .join(' ')
}
