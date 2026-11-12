import { allPaneTabs, tabsOf, type PanesState } from '../app/tabs'
import { channelOf, parseChannel, type PaneChannel, type PaneChannels } from '../app/workspaceChannels'
import { layoutForLegacyId, leaves, legacyPaneCount, newPaneId, paneNode, parseLayoutTree, renamePane, reservePaneIds, type LayoutNode } from './layoutTree'
import { newScreenId, reserveScreenIds, screenPaneIds, type FloatAnchor, type FloatingPane, type ScreensState } from '../app/screens'
import { isPdfSplitLayoutId, type PdfSplitLayoutId } from './pdfSplit'
import { isLegacyTranslatorTabId, type LegacyTranslatorFloat } from '../app/translatorPanelState'

/** 칸 하나가 저장하는 것: 탭 id 들(차례대로), 보던 탭, 색 채널 */
export interface PaneSnapshot {
  readonly tabIds: readonly string[]
  readonly activeId: string | null
  /** null 은 「연동 없음」 */
  readonly channel: PaneChannel
}

/** 화면 하나가 저장하는 것: 이름, 나누기 트리, 칸마다 탭·색, 「크게」로 키운 칸 */
export interface ScreenSnapshot {
  readonly id: string
  readonly name: string
  readonly layout: LayoutNode
  readonly paneState: Readonly<Record<string, PaneSnapshot>>
  readonly zoomed?: string | null
  /** 떠 있는 칸들(설계 5): 칸 자체(탭 · 색)는 paneState 에 칸 id 로 같이 적힌다. 없으면 없다 */
  readonly floats?: readonly FloatingPane[]
  /** toggle-floating 으로 모두 숨긴 상태 */
  readonly floatsHidden?: boolean
}

export interface SessionState {
  pdfTabIds: readonly string[]
  noteTabIds: readonly string[]
  /** 탭으로 연 메모 노트(.iwnote)들. 어느 칸에 있는지는 paneState 가 말한다. 없으면(예전 세션) 없다 */
  memoNoteTabIds?: readonly string[]
  /** 미리보기 탭(기울임 글씨, 다음 미리보기가 오면 갈아 끼운다)으로 열려 있던 탭들. 없으면 없다 */
  previewTabIds?: readonly string[]
  activePdfTabId: string | null
  activeNoteTabId: string | null
  sidebarCollapsed: boolean
  sidebarPx: number
  leftFrac: number
  /** 화면들(이름 · 순서 · 화면마다 트리와 칸 상태). 없으면(단계 1 이전·단계 1 세션) 아래 layout·paneState 가 「읽기」 화면 하나가 된다 */
  screens?: readonly ScreenSnapshot[]
  /** 번역기 탭을 담은 떠 있는 칸이 저장돼 있던 세션(2026-11-12): 그 칸의 자리 · 크기. 번역기는 이제 창 하나라서 칸 · 탭은 읽을 때 버리고 이 값으로 창을 연다. 읽기 전용 — 새로 저장하지 않는다 */
  legacyTranslator?: LegacyTranslatorFloat
  /** 보던 화면의 id · 바로 앞에 보던 화면의 id */
  activeScreen?: string
  lastScreen?: string | null
  /** 칸 나누기 트리(비율 포함). 화면이 있으면 보던 화면의 것(옛 앱으로 돌아가도 읽히게 같이 쓴다). 없으면(예전 세션) 예전 배치 id 로 만든다(workspaceFromSession) */
  layout?: LayoutNode
  /** 칸 id → 탭 · 보던 탭 · 색 채널. layout 의 칸과 같은 칸들이다 */
  paneState?: Readonly<Record<string, PaneSnapshot>>
  /** 예전 세션(칸 이름 left/right/third/fourth): 칸 id 가 없던 때의 탭 배치. 읽기 전용 — 새로 저장하지 않는다 */
  panes?: {
    left: readonly string[]
    right: readonly string[]
    activeLeft: string | null
    activeRight: string | null
    /** 3단의 맨 오른쪽 패널. 없으면 빈 패널 */
    third?: readonly string[]
    activeThird?: string | null
    /** 넷(2×2) 배치의 네 번째 패널 */
    fourth?: readonly string[]
    activeFourth?: string | null
  }
  /** 예전 세션: 칸 이름별 색 채널. 읽기 전용 */
  paneChannels?: Readonly<Record<'left' | 'right' | 'third' | 'fourth', PaneChannel>>
}

export const emptySession: SessionState = {
  pdfTabIds: [],
  noteTabIds: [],
  activePdfTabId: null,
  activeNoteTabId: null,
  sidebarCollapsed: false,
  sidebarPx: 260,
  leftFrac: 0.5,
}

type CaptureWorkspace = { readonly panes: PanesState; readonly channels: PaneChannels; readonly layout: LayoutNode }

/** 칸마다의 저장 모양. ids 는 저장할 칸들(트리의 칸 + 떠 있는 칸) */
function snapshotPanes(workspace: CaptureWorkspace, ids: readonly string[] = leaves(workspace.layout)): Record<string, PaneSnapshot> {
  return Object.fromEntries(ids.map((pane): [string, PaneSnapshot] => {
    const state = tabsOf(workspace.panes, pane)
    return [pane, { tabIds: state.tabs.map((tab) => tab.id), activeId: state.activeId, channel: channelOf(workspace.channels, pane) }]
  }))
}

/**
 * 지금 상태를 저장 모양으로. 화면 묶음(ScreensState)이면 모든 화면을 싣고(탭 id 목록은 모든 화면의 탭을 한 번씩),
 * 한 칸 배치(TreeWorkspace)면 예전처럼 layout·paneState 만 쓴다.
 */
export function captureSession(
  input: CaptureWorkspace | ScreensState,
  layout: { sidebarCollapsed: boolean; sidebarPx: number; leftFrac: number },
): SessionState {
  const screens = 'screens' in input ? input : null
  const active: CaptureWorkspace = screens === null ? (input as CaptureWorkspace) : (screens.screens.find((screen) => screen.id === screens.activeScreen) ?? screens.screens[0]!)
  const order = leaves(active.layout)
  // 떠 있는 칸의 탭도 센다(떠 있는 칸에 문서를 열어 두었으면 다음에 켤 때 다시 열려야 한다)
  const everything = screens === null
    ? allPaneTabs((input as CaptureWorkspace).panes, leaves((input as CaptureWorkspace).layout))
    : screens.screens.flatMap((screen) => allPaneTabs(screen.panes, screenPaneIds(screen)))
  const seen = new Set<string>()
  const all = everything.filter((tab) => (seen.has(tab.id) ? false : (seen.add(tab.id), true)))
  const docTabs = all.filter((tab) => tab.kind === 'pdf' || tab.kind === 'markdown')
  const noteTabs = all.filter((tab) => tab.kind === 'canvas')
  const memoNoteTabs = all.filter((tab) => tab.kind === 'memoNote')
  const previewIds = [...new Set(everything.filter((tab) => tab.preview === true).map((tab) => tab.id))]
  const activeOf = (ids: readonly string[]) => order.map((pane) => tabsOf(active.panes, pane).activeId)
    .find((id) => id !== null && ids.includes(id)) ?? null
  return {
    pdfTabIds: docTabs.map((tab) => tab.id),
    noteTabIds: noteTabs.map((tab) => tab.id),
    ...(memoNoteTabs.length === 0 ? {} : { memoNoteTabIds: memoNoteTabs.map((tab) => tab.id) }),
    ...(previewIds.length === 0 ? {} : { previewTabIds: previewIds }),
    activePdfTabId: activeOf(docTabs.map((tab) => tab.id)),
    activeNoteTabId: activeOf(noteTabs.map((tab) => tab.id)),
    sidebarCollapsed: layout.sidebarCollapsed,
    sidebarPx: layout.sidebarPx,
    leftFrac: layout.leftFrac,
    ...(screens === null ? {} : {
      screens: screens.screens.map((screen): ScreenSnapshot => ({
        id: screen.id,
        name: screen.name,
        layout: screen.layout,
        paneState: snapshotPanes(screen, screenPaneIds(screen)),
        ...(screen.zoomed === null ? {} : { zoomed: screen.zoomed }),
        ...(screen.floats.length === 0 ? {} : { floats: screen.floats, ...(screen.floatsHidden === true ? { floatsHidden: true } : {}) }),
      })),
      activeScreen: screens.activeScreen,
      lastScreen: screens.lastScreen,
    }),
    layout: active.layout,
    paneState: snapshotPanes(active),
  }
}

function parsePanes(raw: unknown): SessionState['panes'] {
  if (
    !isRecord(raw)
    || !isStringArray(raw.left)
    || !isStringArray(raw.right)
    || !isNullableString(raw.activeLeft)
    || !isNullableString(raw.activeRight)
  ) return undefined
  const third = isStringArray(raw.third) ? { third: raw.third, activeThird: isNullableString(raw.activeThird) ? raw.activeThird : null } : {}
  const fourth = isStringArray(raw.fourth) ? { fourth: raw.fourth, activeFourth: isNullableString(raw.activeFourth) ? raw.activeFourth : null } : {}
  return { left: raw.left, right: raw.right, activeLeft: raw.activeLeft, activeRight: raw.activeRight, ...third, ...fourth }
}

const LEGACY_PANES = ['left', 'right', 'third', 'fourth'] as const

/** 예전 세션의 칸 이름별 채널. 없는 칸·모르는 값은 기본(파랑), 저장된 null(없음)은 그대로 */
function parseLegacyChannels(raw: unknown): SessionState['paneChannels'] {
  if (!isRecord(raw)) return undefined
  const pick = (pane: typeof LEGACY_PANES[number]): PaneChannel => channelOrBlue(raw[pane])
  return { left: pick('left'), right: pick('right'), third: pick('third'), fourth: pick('fourth') }
}

function parsePaneState(raw: unknown, tree: LayoutNode, extraIds: readonly string[] = []): Record<string, PaneSnapshot> | undefined {
  if (!isRecord(raw)) return undefined
  const out: Record<string, PaneSnapshot> = {}
  for (const pane of [...leaves(tree), ...extraIds]) {
    const value = raw[pane]
    if (value === undefined) {
      out[pane] = { tabIds: [], activeId: null, channel: 'blue' }
      continue
    }
    if (!isRecord(value) || !isStringArray(value.tabIds)) return undefined
    out[pane] = {
      tabIds: value.tabIds,
      activeId: isNullableString(value.activeId) ? value.activeId : null,
      channel: channelOrBlue(value.channel),
    }
  }
  return out
}

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** 저장된 떠 있는 칸들을 읽는다: 칸 id 가 문자열이 아니거나 겹치면 건너뛰고, 자리는 0–1, 크기는 최소 크기 이상으로 바로잡는다 */
function parseFloats(raw: unknown, treeIds: ReadonlySet<string>): FloatingPane[] {
  if (!Array.isArray(raw)) return []
  const out: FloatingPane[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!isRecord(item) || typeof item.paneId !== 'string' || item.paneId === '' || seen.has(item.paneId) || treeIds.has(item.paneId)) continue
    seen.add(item.paneId)
    const anchorRaw = item.anchor
    const anchor: FloatAnchor = isRecord(anchorRaw) && anchorRaw.kind === 'pane' && typeof anchorRaw.paneId === 'string' && treeIds.has(anchorRaw.paneId)
      ? { kind: 'pane', paneId: anchorRaw.paneId }
      : { kind: 'screen' }
    out.push({
      paneId: item.paneId,
      anchor,
      x: finiteNumber(item.x) ? Math.min(Math.max(item.x, 0), 1) : 0.1,
      y: finiteNumber(item.y) ? Math.min(Math.max(item.y, 0), 1) : 0.1,
      w: finiteNumber(item.w) ? Math.max(item.w, 120) : 380,
      h: finiteNumber(item.h) ? Math.max(item.h, 80) : 300,
      collapsed: item.collapsed === true,
    })
  }
  return out
}

/**
 * 번역기는 한때 떠 있는 칸의 탭이었다(탭 id `translator:칸 id`). 지금은 창 하나라서 그 탭은 버리고,
 * 번역기 탭만 담았던 떠 있는 칸은 칸 · 상태째 없앤다. 처음 만난 번역기 칸의 자리 · 크기는 found 에 남겨 창으로 옮기게 한다(순수: 입력은 바꾸지 않는다).
 */
export function withoutTranslatorFloats(
  floats: readonly FloatingPane[],
  state: Readonly<Record<string, PaneSnapshot>>,
  found: { translator?: LegacyTranslatorFloat } = {},
): { floats: FloatingPane[]; state: Record<string, PaneSnapshot> } {
  const kept: FloatingPane[] = []
  const next: Record<string, PaneSnapshot> = { ...state }
  for (const float of floats) {
    const saved = state[float.paneId]
    const ids = saved?.tabIds ?? []
    if (ids.length > 0 && ids.every(isLegacyTranslatorTabId)) {
      found.translator ??= { x: float.x, y: float.y, w: float.w, h: float.h }
      delete next[float.paneId]
      continue
    }
    kept.push(float)
    if (saved !== undefined && ids.some(isLegacyTranslatorTabId)) {
      const tabIds = ids.filter((id) => !isLegacyTranslatorTabId(id))
      next[float.paneId] = { ...saved, tabIds, activeId: saved.activeId !== null && tabIds.includes(saved.activeId) ? saved.activeId : null }
    }
  }
  return { floats: kept, state: next }
}

/** 저장된 채널 하나: 모르는 값·없는 값은 기본(파랑), 저장된 null(연동 없음)은 그대로 */
function channelOrBlue(value: unknown): PaneChannel {
  const parsed = parseChannel(value)
  return parsed === undefined ? 'blue' : parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

/**
 * 저장된 화면들을 읽는다. 하나도 못 읽으면 undefined(옛 모양으로 본다). 화면 id · 칸 id 가 겹치면(손으로 고친 파일) 뒤의 것에 새 id 를 준다 —
 * 칸 id 는 모든 화면에서 한 번씩만 나와야 칸별 보기 상태가 섞이지 않는다.
 */
function parseScreens(raw: unknown, found: { translator?: LegacyTranslatorFloat } = {}): ScreenSnapshot[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: ScreenSnapshot[] = []
  const usedScreens = new Set<string>()
  const usedPanes = new Set<string>()
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id === '' || typeof item.name !== 'string') continue
    const tree = parseLayoutTree(item.layout)
    if (tree === null) continue
    const allFloats = parseFloats(item.floats, new Set(leaves(tree)))
    const parsedState = parsePaneState(item.paneState, tree, allFloats.map((float) => float.paneId))
    if (parsedState === undefined) continue
    const { floats, state } = withoutTranslatorFloats(allFloats, parsedState, found)
    let layout = tree
    const paneState: Record<string, PaneSnapshot> = {}
    let zoomed = typeof item.zoomed === 'string' ? item.zoomed : null
    const renamed = new Map<string, string>()
    const screenIds = [...leaves(tree), ...floats.map((float) => float.paneId)]
    for (const pane of screenIds) {
      let id = pane
      if (usedPanes.has(id)) {
        id = newPaneId([...usedPanes, ...screenIds])
        layout = renamePane(layout, pane, id)
        if (zoomed === pane) zoomed = id
        renamed.set(pane, id)
      }
      usedPanes.add(id)
      paneState[id] = state[pane]!
    }
    // 겹쳐서 새 id 를 받은 칸을 따라가게 떠 있는 칸의 id · 붙은 칸도 바꾼다
    const keptFloats = floats.map((float): FloatingPane => ({
      ...float,
      paneId: renamed.get(float.paneId) ?? float.paneId,
      anchor: float.anchor.kind === 'pane' && renamed.has(float.anchor.paneId) ? { kind: 'pane', paneId: renamed.get(float.anchor.paneId)! } : float.anchor,
    }))
    if (zoomed !== null && !leaves(layout).includes(zoomed)) zoomed = null
    const id = usedScreens.has(item.id) ? newScreenId(usedScreens) : item.id
    usedScreens.add(id)
    out.push({ id, name: item.name, layout, paneState, ...(zoomed === null ? {} : { zoomed }), ...(keptFloats.length === 0 ? {} : { floats: keptFloats, ...(item.floatsHidden === true ? { floatsHidden: true } : {}) }) })
  }
  return out.length === 0 ? undefined : out
}

export function parseSession(raw: unknown): SessionState {
  if (
    !isRecord(raw) ||
    !isStringArray(raw.pdfTabIds) ||
    !isStringArray(raw.noteTabIds) ||
    !isNullableString(raw.activePdfTabId) ||
    !isNullableString(raw.activeNoteTabId) ||
    typeof raw.sidebarCollapsed !== 'boolean' ||
    typeof raw.sidebarPx !== 'number' ||
    !Number.isFinite(raw.sidebarPx) ||
    raw.sidebarPx <= 0 ||
    typeof raw.leftFrac !== 'number' ||
    !Number.isFinite(raw.leftFrac) ||
    raw.leftFrac <= 0 ||
    raw.leftFrac >= 1
  ) {
    return emptySession
  }

  if (
    (raw.activePdfTabId !== null && !raw.pdfTabIds.includes(raw.activePdfTabId)) ||
    (raw.activeNoteTabId !== null && !raw.noteTabIds.includes(raw.activeNoteTabId))
  ) {
    return emptySession
  }

  const tree = raw.layout === undefined ? null : parseLayoutTree(raw.layout)
  const paneState = tree === null ? undefined : parsePaneState(raw.paneState, tree)
  const workspace = tree !== null && paneState !== undefined ? { layout: tree, paneState } : {}
  const legacyTranslator: { translator?: LegacyTranslatorFloat } = {}
  const screens = parseScreens(raw.screens, legacyTranslator)
  const activeScreen = screens !== undefined && typeof raw.activeScreen === 'string' && screens.some((screen) => screen.id === raw.activeScreen) ? raw.activeScreen : screens?.[0]?.id
  const lastScreen = screens !== undefined && typeof raw.lastScreen === 'string' && raw.lastScreen !== activeScreen && screens.some((screen) => screen.id === raw.lastScreen) ? raw.lastScreen : null
  const legacyChannels = raw.paneChannels === undefined ? undefined : parseLegacyChannels(raw.paneChannels)
  return {
    pdfTabIds: raw.pdfTabIds,
    noteTabIds: raw.noteTabIds,
    ...(isStringArray(raw.memoNoteTabIds) && raw.memoNoteTabIds.length > 0 ? { memoNoteTabIds: raw.memoNoteTabIds } : {}),
    ...(isStringArray(raw.previewTabIds) && raw.previewTabIds.length > 0 ? { previewTabIds: raw.previewTabIds } : {}),
    activePdfTabId: raw.activePdfTabId,
    activeNoteTabId: raw.activeNoteTabId,
    sidebarCollapsed: raw.sidebarCollapsed,
    sidebarPx: raw.sidebarPx,
    leftFrac: raw.leftFrac,
    ...workspace,
    ...(screens === undefined || activeScreen === undefined ? {} : { screens, activeScreen, lastScreen }),
    ...(legacyTranslator.translator === undefined ? {} : { legacyTranslator: legacyTranslator.translator }),
    ...(legacyChannels === undefined ? {} : { paneChannels: legacyChannels }),
    ...(raw.panes === undefined || parsePanes(raw.panes) === undefined ? {} : { panes: parsePanes(raw.panes) }),
  }
}

// ── 예전 세션(배치 id + 칸 이름)을 트리로 ───────────────────────────────────────

/** 예전에 localStorage 에 따로 적던 배치 id(iwae:pane-layout:v1). 예전 단 수 값(1·2·3)도 좌우 배치로 읽는다. 없으면 null */
export function readLegacyLayoutId(storage: Pick<Storage, 'getItem'> | null): PdfSplitLayoutId | null {
  if (storage === null) return null
  try {
    const saved = storage.getItem('iwae:pane-layout:v1')
    if (isPdfSplitLayoutId(saved)) return saved
    const count = storage.getItem('iwae:pane-count:v1')
    if (count === '2') return 'cols2'
    if (count === '3') return 'cols3'
    if (count === null && storage.getItem('iwae:single-pane:v2') === '0') return 'cols2'
  } catch { /* 없는 것으로 본다 */ }
  return null
}

export interface WorkspaceSnapshot {
  readonly layout: LayoutNode
  readonly paneState: Readonly<Record<string, PaneSnapshot>>
}

/**
 * 세션에서 칸 배치를 읽는다. 새 세션(layout·paneState)은 그대로, 예전 세션은 배치 id(legacyLayout, 없으면 한 칸)와
 * panes.left/right/third/fourth·paneChannels 를 같은 모양의 트리와 칸 id 로 옮긴다(칸 id 는 새로 만든다).
 * 예전 배치에서 보이지 않던 칸(예: 한 칸 배치인데 right 에 탭이 남음)의 탭은 마지막으로 보이던 칸 뒤에 합친다.
 * 칸 id 는 그 칸이 놓인 차례(예전 left → right → third → fourth)대로 만들어지므로, 낡은 값으로 시험해도 같은 결과다.
 */
export function workspaceFromSession(session: SessionState, legacyLayout: PdfSplitLayoutId | null): WorkspaceSnapshot {
  if (session.layout !== undefined && session.paneState !== undefined) return { layout: session.layout, paneState: session.paneState }
  const layoutId = legacyLayout ?? 'single'
  const count = legacyPaneCount(layoutId)
  const ids: string[] = []
  for (let index = 0; index < count; index += 1) ids.push(newPaneId(ids))
  const legacy = session.panes
  const names = [
    { ids: legacy?.left ?? [], active: legacy?.activeLeft ?? null },
    { ids: legacy?.right ?? [], active: legacy?.activeRight ?? null },
    { ids: legacy?.third ?? [], active: legacy?.activeThird ?? null },
    { ids: legacy?.fourth ?? [], active: legacy?.activeFourth ?? null },
  ] as const
  const channels = LEGACY_PANES.map((name): PaneChannel => { const saved = session.paneChannels?.[name]; return saved === undefined ? 'blue' : saved })
  const state: Record<string, { tabIds: string[]; activeId: string | null; channel: PaneChannel }> = {}
  ids.forEach((id, index) => {
    state[id] = { tabIds: [...names[index]!.ids], activeId: names[index]!.active, channel: channels[index]! }
  })
  // 보이지 않던 칸의 탭은 마지막으로 보이던 칸 뒤에 합친다(보던 칸의 보던 탭이 우선)
  const last = state[ids[ids.length - 1]!]!
  for (let index = ids.length; index < names.length; index += 1) {
    const hidden = names[index]!
    for (const tabId of hidden.ids) if (!last.tabIds.includes(tabId)) last.tabIds.push(tabId)
    if (last.activeId === null) last.activeId = hidden.active
  }
  return { layout: layoutForLegacyId(layoutId, ids, session.leftFrac), paneState: state }
}

/** 한 칸짜리 배치(떼어 낸 창·새 창·분할을 끈 때): 탭은 모두 그 칸으로 */
export function singlePaneWorkspace(): WorkspaceSnapshot {
  const id = newPaneId()
  return { layout: paneNode(id), paneState: { [id]: { tabIds: [], activeId: null, channel: 'blue' } } }
}

export interface ScreensSnapshot {
  readonly screens: readonly ScreenSnapshot[]
  readonly activeScreen: string
  readonly lastScreen: string | null
}

/**
 * 세션에서 화면들을 읽는다. 화면이 적혀 있으면 그대로, 단계 1 의 세션(layout·paneState 하나)이나 그 이전의 세션은
 * 칸 배치 하나를 defaultName(「읽기」) 화면 하나로 옮긴다. 읽은 칸 id · 화면 id 는 이번 실행의 새 id 와 겹치지 않게 비켜 둔다.
 */
export function screensFromSession(session: SessionState, legacyLayout: PdfSplitLayoutId | null, defaultName: string): ScreensSnapshot {
  if (session.screens !== undefined && session.screens.length > 0 && session.activeScreen !== undefined) {
    reserveScreenIds(session.screens.map((screen) => screen.id))
    reservePaneIds(session.screens.flatMap((screen) => [...leaves(screen.layout), ...(screen.floats ?? []).map((float) => float.paneId)]))
    return { screens: session.screens, activeScreen: session.activeScreen, lastScreen: session.lastScreen ?? null }
  }
  if (session.layout !== undefined) reservePaneIds(leaves(session.layout))
  const workspace = workspaceFromSession(session, legacyLayout)
  const id = newScreenId()
  return { screens: [{ id, name: defaultName, ...workspace }], activeScreen: id, lastScreen: null }
}

/** 한 화면짜리 첫 상태(떼어 낸 창·새 창·분할을 끈 때) */
export function singleScreenSnapshot(name: string): ScreensSnapshot {
  const workspace = singlePaneWorkspace()
  const id = newScreenId()
  return { screens: [{ id, name, ...workspace }], activeScreen: id, lastScreen: null }
}
