import { layoutRects, leaves, paneNode, newPaneId, removeLeaf, type LayoutNode } from '../../core/layoutTree'
import { emptyTabs, tabsOf, type PanesState } from './tabs'
import { channelOf, pruneChannels, type PaneChannels } from './workspaceChannels'
import type { TreeWorkspace } from './tabDock'

/**
 * 화면(tmux 의 window, docs/design/workspace-tmux.md 2). 칸을 모은 파티션이다: 화면마다 자기 나누기 트리 · 칸의 탭 · 색 채널 ·
 * 「크게」로 키운 칸을 가진다. 칸은 한 화면에만 속한다. DOM·React 를 모르는 순수 함수만 둔다.
 */
/**
 * 떠 있는 칸이 붙는 곳(설계 5): 화면 전체이거나 나누기 트리의 한 칸.
 * 칸에 붙으면 그 칸을 따라 움직이고, 그 칸이 닫히면 화면에 붙는다.
 */
export type FloatAnchor = { readonly kind: 'screen' } | { readonly kind: 'pane'; readonly paneId: string }

/**
 * 떠 있는 칸 하나. 칸 자체(탭 · 색 채널)는 보통 칸처럼 Screen.panes · Screen.channels 에 paneId 로 있고, 여기는 놓인 자리와 크기만 적는다.
 * 자리(x · y)는 붙은 곳의 사각형에 대한 왼쪽 위 모서리의 비율(0–1)이고, 크기(w · h)는 px 이다.
 */
export interface FloatingPane {
  readonly paneId: string
  readonly anchor: FloatAnchor
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** 접힘: 머리만 남긴다(h 는 펼쳤을 때의 높이로 그대로 둔다) */
  readonly collapsed: boolean
}

export interface Screen {
  readonly id: string
  readonly name: string
  readonly layout: LayoutNode
  readonly panes: PanesState
  readonly channels: PaneChannels
  /** 「크게」로 화면 전체를 차지한 칸(없으면 null) */
  readonly zoomed: string | null
  /** 이 화면의 떠 있는 칸들(나누기 트리 밖). 뒤에 있을수록 위에 그려진다 */
  readonly floats: readonly FloatingPane[]
  /** toggle-floating 으로 떠 있는 칸을 모두 숨긴 상태(없으면 보임) */
  readonly floatsHidden?: boolean
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

/** 한 화면의 칸 id 들: 나누기 트리의 칸 + 떠 있는 칸 */
export function screenPaneIds(screen: Screen): string[] {
  return [...leaves(screen.layout), ...screen.floats.map((float) => float.paneId)]
}

/** 모든 화면의 칸 id(새 칸 id 가 다른 화면의 칸과 겹치지 않게). 떠 있는 칸도 센다 */
export function allScreenPaneIds(state: ScreensState): string[] {
  return state.screens.flatMap(screenPaneIds)
}

/**
 * 떠 있는 칸이 붙은 칸이 트리에서 없어졌으면 화면에 붙인다(칸이 닫히거나 다른 화면으로 떼어졌을 때).
 * previousLayout 을 알면 그 칸이 있던 자리를 화면 비율로 바꿔 놓아 떠 있는 칸이 눈에 띄게 튀지 않게 한다.
 * 바뀐 것이 없으면 같은 객체.
 */
export function normalizeFloats(screen: Screen, previousLayout?: LayoutNode): Screen {
  if (screen.floats.length === 0) return screen
  const alive = new Set(leaves(screen.layout))
  const before = previousLayout === undefined ? null : layoutRects(previousLayout).panes
  let changed = false
  const floats = screen.floats.map((float) => {
    if (float.anchor.kind === 'screen' || alive.has(float.anchor.paneId)) return float
    changed = true
    const rect = before?.get(float.anchor.paneId)
    return rect === undefined
      ? { ...float, anchor: { kind: 'screen' as const } }
      : { ...float, anchor: { kind: 'screen' as const }, x: rect.x + float.x * rect.w, y: rect.y + float.y * rect.h }
  })
  return changed ? { ...screen, floats } : screen
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
  // 나누기 트리 동작(칸 닫기 · 나누기 …)은 떠 있는 칸의 색 채널을 모른다: 지워졌으면 이전 값을 되살린다
  let channels = next.channels
  for (const float of active.floats) {
    if (channels[float.paneId] === undefined && active.channels[float.paneId] !== undefined) channels = { ...channels, [float.paneId]: active.channels[float.paneId]! }
  }
  return replaceScreen(state, normalizeFloats({ ...active, ...next, channels, zoomed }, active.layout))
}

export function replaceScreen(state: ScreensState, screen: Screen): ScreensState {
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
  return { id: newScreenId(), name, layout: paneNode(pane), panes: { [pane]: emptyTabs }, channels: { [pane]: 'blue' }, zoomed: null, floats: [] }
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
  const floatIds = active.floats.map((float) => float.paneId)
  const shrunk: Screen = normalizeFloats({
    ...active,
    layout,
    panes: rest,
    channels: pruneChannels(active.channels, [...leaves(layout), ...floatIds]),
    zoomed: active.zoomed === pane ? null : active.zoomed,
  }, active.layout)
  const id = newScreenId(state.screens.map((screen) => screen.id))
  const created: Screen = { id, name, layout: paneNode(pane), panes: { [pane]: moved ?? tabsOf(active.panes, pane) }, channels: { [pane]: channelOf(active.channels, pane) }, zoomed: null, floats: [] }
  return { screens: [...state.screens.map((screen) => (screen.id === active.id ? shrunk : screen)), created], activeScreen: id, lastScreen: active.id }
}

/** 화면 이름이 비었을 때 쓸 이름(번호만) */
export function screenLabel(screen: Screen, index: number): string {
  return screen.name.trim() === '' ? String(index) : screen.name
}

