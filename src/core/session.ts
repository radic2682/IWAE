import { allPaneTabs, tabsOf, type PanesState } from '../app/tabs'
import { channelOf, parseChannel, type PaneChannel, type PaneChannels } from '../app/workspaceChannels'
import { layoutForLegacyId, leaves, legacyPaneCount, newPaneId, paneNode, parseLayoutTree, type LayoutNode } from './layoutTree'
import { isPdfSplitLayoutId, type PdfSplitLayoutId } from './pdfSplit'

/** 칸 하나가 저장하는 것: 탭 id 들(차례대로), 보던 탭, 색 채널 */
export interface PaneSnapshot {
  readonly tabIds: readonly string[]
  readonly activeId: string | null
  /** null 은 「연동 없음」 */
  readonly channel: PaneChannel
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
  /** 칸 나누기 트리(비율 포함). 없으면(예전 세션) 예전 배치 id 로 만든다(workspaceFromSession) */
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

export function captureSession(
  workspace: { readonly panes: PanesState; readonly channels: PaneChannels; readonly layout: LayoutNode },
  layout: { sidebarCollapsed: boolean; sidebarPx: number; leftFrac: number },
): SessionState {
  const order = leaves(workspace.layout)
  const all = allPaneTabs(workspace.panes, order)
  const docTabs = all.filter((tab) => tab.kind === 'pdf' || tab.kind === 'markdown')
  const noteTabs = all.filter((tab) => tab.kind === 'canvas')
  const memoNoteTabs = all.filter((tab) => tab.kind === 'memoNote')
  const previewIds = all.filter((tab) => tab.preview === true).map((tab) => tab.id)
  const activeOf = (ids: readonly string[]) => order.map((pane) => tabsOf(workspace.panes, pane).activeId)
    .find((id) => id !== null && ids.includes(id)) ?? null
  const paneState = Object.fromEntries(order.map((pane): [string, PaneSnapshot] => {
    const state = tabsOf(workspace.panes, pane)
    return [pane, { tabIds: state.tabs.map((tab) => tab.id), activeId: state.activeId, channel: channelOf(workspace.channels, pane) }]
  }))
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
    layout: workspace.layout,
    paneState,
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

function parsePaneState(raw: unknown, tree: LayoutNode): Record<string, PaneSnapshot> | undefined {
  if (!isRecord(raw)) return undefined
  const out: Record<string, PaneSnapshot> = {}
  for (const pane of leaves(tree)) {
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
