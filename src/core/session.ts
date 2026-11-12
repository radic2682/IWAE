import type { TabsState } from '../app/tabs'
import { parsePaneChannels, type PaneChannels } from '../app/workspaceChannels'

export interface SessionState {
  pdfTabIds: readonly string[]
  noteTabIds: readonly string[]
  /** 탭으로 연 메모 노트(.iwnote)들. 어느 패널에 있는지는 panes 가 말한다. 없으면(예전 세션) 없다 */
  memoNoteTabIds?: readonly string[]
  /** 미리보기 탭(기울임 글씨, 다음 미리보기가 오면 갈아 끼운다)으로 열려 있던 탭들. 없으면 없다 */
  previewTabIds?: readonly string[]
  /** 창마다 색 채널(같은 색끼리 연동). 없으면(예전 세션) 모두 파랑 */
  paneChannels?: PaneChannels
  activePdfTabId: string | null
  activeNoteTabId: string | null
  sidebarCollapsed: boolean
  sidebarPx: number
  leftFrac: number
  /**
   * 탭이 놓인 패널과 패널마다 활성 탭. 두 패널에 아무 탭이나 열 수 있게 된 뒤에 더했다.
   * 없으면(예전 세션) 문서는 왼쪽, 캔버스는 오른쪽으로 되돌린다.
   */
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
  leftTabs: TabsState,
  rightTabs: TabsState,
  layout: { sidebarCollapsed: boolean; sidebarPx: number; leftFrac: number },
  thirdTabs: TabsState = { tabs: [], activeId: null },
  fourthTabs: TabsState = { tabs: [], activeId: null },
  channels?: PaneChannels,
): SessionState {
  const all = [...leftTabs.tabs, ...rightTabs.tabs, ...thirdTabs.tabs, ...fourthTabs.tabs]
  const docTabs = all.filter((tab) => tab.kind === 'pdf' || tab.kind === 'markdown')
  const noteTabs = all.filter((tab) => tab.kind === 'canvas')
  const memoNoteTabs = all.filter((tab) => tab.kind === 'memoNote')
  const previewIds = all.filter((tab) => tab.preview === true).map((tab) => tab.id)
  const activeOf = (ids: readonly string[]) => [leftTabs.activeId, rightTabs.activeId, thirdTabs.activeId, fourthTabs.activeId]
    .find((id) => id !== null && ids.includes(id)) ?? null
  return {
    pdfTabIds: docTabs.map((tab) => tab.id),
    noteTabIds: noteTabs.map((tab) => tab.id),
    ...(memoNoteTabs.length === 0 ? {} : { memoNoteTabIds: memoNoteTabs.map((tab) => tab.id) }),
    ...(previewIds.length === 0 ? {} : { previewTabIds: previewIds }),
    ...(channels === undefined ? {} : { paneChannels: channels }),
    activePdfTabId: activeOf(docTabs.map((tab) => tab.id)),
    activeNoteTabId: activeOf(noteTabs.map((tab) => tab.id)),
    sidebarCollapsed: layout.sidebarCollapsed,
    sidebarPx: layout.sidebarPx,
    leftFrac: layout.leftFrac,
    panes: {
      left: leftTabs.tabs.map((tab) => tab.id),
      right: rightTabs.tabs.map((tab) => tab.id),
      activeLeft: leftTabs.activeId,
      activeRight: rightTabs.activeId,
      ...(thirdTabs.tabs.length === 0 ? {} : { third: thirdTabs.tabs.map((tab) => tab.id), activeThird: thirdTabs.activeId }),
      ...(fourthTabs.tabs.length === 0 ? {} : { fourth: fourthTabs.tabs.map((tab) => tab.id), activeFourth: fourthTabs.activeId }),
    },
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

  return {
    pdfTabIds: raw.pdfTabIds,
    noteTabIds: raw.noteTabIds,
    ...(isStringArray(raw.memoNoteTabIds) && raw.memoNoteTabIds.length > 0 ? { memoNoteTabIds: raw.memoNoteTabIds } : {}),
    ...(isStringArray(raw.previewTabIds) && raw.previewTabIds.length > 0 ? { previewTabIds: raw.previewTabIds } : {}),
    ...(raw.paneChannels === undefined ? {} : { paneChannels: parsePaneChannels(raw.paneChannels) }),
    activePdfTabId: raw.activePdfTabId,
    activeNoteTabId: raw.activeNoteTabId,
    sidebarCollapsed: raw.sidebarCollapsed,
    sidebarPx: raw.sidebarPx,
    leftFrac: raw.leftFrac,
    panes: parsePanes(raw.panes),
  }
}
