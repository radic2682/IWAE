import { memoNoteTitleOf } from '../../core/memoNote'
import type { LayoutNode } from '../../core/layoutTree'
import { isDocumentKind } from '../workspace/tabs'
import { aiChangeCount, aiChanges, aiUndo } from './aiChangeLog'
import { op, type McpFloatState, type McpPaneState, type McpTab, type OpContext, type OpDef } from './types'

const SELECTION_LIMIT = 2000

/**
 * 칸 나누기 트리를 알리는 모양: 칸은 { pane: 칸 번호 }, 나누기는 { split: 'h' | 'v', ratio, a, b }.
 * 'h' 는 좌우로(a 가 왼쪽, b 가 오른쪽), 'v' 는 위아래로(a 가 위, b 가 아래) 나눈 것이고, ratio 는 a 가 차지하는 몫이다.
 */
export function treeShape(node: LayoutNode, order: readonly string[]): unknown {
  if (node.kind === 'pane') return { pane: order.indexOf(node.paneId) }
  return { split: node.dir, ratio: Math.round(node.ratio * 100) / 100, a: treeShape(node.a, order), b: treeShape(node.b, order) }
}

/** 화면에 대한 작은 요약. 문서 글(선택한 글·제목)은 믿을 수 없는 글이다 */
const appState = async (_args: Record<string, unknown>, ctx: OpContext) => {
  const app = ctx.deps.app
  const notes = ctx.notes.available ? ctx.notes.list() : []
  const docs = app?.docs ?? []
  const paneStates = app?.panes ?? []
  const tabJson = (tab: McpTab) => ({
    id: tab.id,
    kind: tab.kind,
    ...(tab.kind === 'memoNote' ? { note: memoNoteTitleOf(tab.id) } : tab.kind === 'canvas' ? { canvas: tab.id } : { doc_id: tab.id }),
    title: tab.title,
  })
  const paneJson = (pane: McpPaneState) => ({
    index: pane.index,
    id: pane.id,
    channel: pane.channel,
    tabs: pane.tabs.map(tabJson),
    active_tab: pane.activeId,
  })
  const panes = paneStates.map(paneJson)
  // 모든 화면: 보는 화면의 panes 는 위 panes 와 같다(예전 도구가 panes 만 읽어도 지금 보는 화면이 온다)
  const floatJson = (float: McpFloatState) => ({ id: float.id, active: float.id === app?.activePane, tabs: float.tabs.map(tabJson), active_tab: float.activeId })
  const screens = (app?.screens ?? []).map((screen) => ({ index: screen.index, name: screen.name, active: screen.active, panes: screen.panes.map(paneJson), floats: screen.floats.map(floatJson) }))
  const floats = (app?.floats ?? []).map(floatJson)
  const activePaneState = paneStates.find((pane) => pane.id === app?.activePane)
  const activeTab = activePaneState?.tabs.find((tab) => tab.id === activePaneState.activeId)
  // 지금 본 PDF: 만진 패널이 PDF 면 그것, 아니면 PDF 를 보는 다른 패널
  const viewPane = app === undefined
    ? undefined
    : activeTab !== undefined && isDocumentKind(activeTab.kind) && app.docViews[app.activePane] !== undefined
      ? app.activePane
      : paneStates.find((pane) => app.docViews[pane.id] !== undefined)?.id
  const view = viewPane === undefined ? undefined : app?.docViews[viewPane]
  const viewDoc = view === undefined ? undefined : docs.find((doc) => doc.docId === view.docId)
  const selection = app?.selection() ?? null
  const session = app === undefined ? null : await app.session()
  return {
    vault: { open: app?.vaultRoot != null || ctx.notes.available, documents: docs.length, notes: notes.length },
    layout: {
      pane_count: app?.paneCount ?? 0,
      active_pane: activePaneState?.index ?? 0,
      active_pane_id: app?.activePane ?? null,
      active_float: floats.find((float) => float.active)?.id ?? null,
      tree: app === undefined ? null : treeShape(app.layout, paneStates.map((pane) => pane.id)),
    },
    panes,
    floats,
    screens,
    session,
    clients: app?.clients() ?? [],
    active_doc: view === undefined
      ? null
      : {
          doc_id: view.docId,
          title: viewDoc?.title ?? paneStates.find((pane) => pane.id === viewPane)?.tabs.find((tab) => tab.id === view.docId)?.title ?? '',
          page: view.page,
          page_count: view.pageCount ?? viewDoc?.pageCount ?? null,
        },
    selection: selection === null || selection.text.trim() === '' ? null : { doc_id: selection.docId, page: selection.page, text: selection.text.slice(0, SELECTION_LIMIT) },
    open_notes: panes.flatMap((pane) => pane.tabs.flatMap((tab) => (tab.kind === 'memoNote' ? [memoNoteTitleOf(tab.id)] : []))),
    ai_session: { changes: aiChangeCount() },
  }
}

/** 비밀(API 키·토큰)은 돌려주지 않는다. 바꾸지도 못한다 */
const settingsGet = (_args: Record<string, unknown>, ctx: OpContext) => {
  const app = ctx.deps.app
  const settings = app?.settings() ?? { language: 'ko', theme: 'system' }
  return {
    language: settings.language,
    theme: settings.theme,
    translation_mode: app === undefined ? 'off' : !app.translation.enabled ? 'off' : app.translation.executionMode === 'external-api' ? 'external' : 'local',
  }
}

const aiChangesOp = (args: Record<string, unknown>) => aiChanges(typeof args.limit === 'number' ? args.limit : 50)

const aiUndoOp = (args: Record<string, unknown>) => aiUndo({
  ...(typeof args.steps === 'number' ? { steps: args.steps } : {}),
  ...(typeof args.seq === 'number' ? { seq: args.seq } : {}),
})

export const stateOps: Record<string, OpDef> = {
  app_state: op('read', appState),
  settings_get: op('read', settingsGet),
  ai_changes: op('read', aiChangesOp),
  ai_undo: op('write', aiUndoOp),
}
