import { memoNoteTitleOf } from '../../core/memoNote'
import { PANE_IDS } from '../tabs'
import { aiChangeCount, aiChanges, aiUndo } from './aiChangeLog'
import { op, type OpContext, type OpDef } from './types'

const SELECTION_LIMIT = 2000

/** 화면에 대한 작은 요약. 문서 글(선택한 글·제목)은 믿을 수 없는 글이다 */
const appState = (_args: Record<string, unknown>, ctx: OpContext) => {
  const app = ctx.deps.app
  const notes = ctx.notes.available ? ctx.notes.list() : []
  const docs = app?.docs ?? []
  const visible = app?.paneCount ?? 0
  const panes = app === undefined
    ? []
    : PANE_IDS.flatMap((id, index) => {
        const pane = app.panes[id]
        if (index >= visible && pane.tabs.length === 0) return []
        return [{
          id,
          tabs: pane.tabs.map((tab) => ({
            id: tab.id,
            kind: tab.kind,
            ...(tab.kind === 'note' ? { note: memoNoteTitleOf(tab.id) } : { doc_id: tab.id }),
            title: tab.title,
          })),
          active_tab: pane.activeId,
        }]
      })
  const activePaneState = app?.panes[app.activePane]
  const activeTab = activePaneState?.tabs.find((tab) => tab.id === activePaneState.activeId)
  // 지금 본 PDF: 만진 패널이 PDF 면 그것, 아니면 PDF 를 보는 다른 패널
  const viewPane = app === undefined
    ? undefined
    : activeTab !== undefined && activeTab.kind !== 'note' && app.docViews[app.activePane] !== undefined
      ? app.activePane
      : PANE_IDS.find((id) => app.docViews[id] !== undefined)
  const view = viewPane === undefined ? undefined : app?.docViews[viewPane]
  const viewDoc = view === undefined ? undefined : docs.find((doc) => doc.docId === view.docId)
  const selection = app?.selection() ?? null
  return {
    vault: { open: app?.vaultRoot != null || ctx.notes.available, documents: docs.length, notes: notes.length },
    layout: { pane_count: app?.paneCount ?? 0, active_pane: app?.activePane ?? 'left' },
    panes,
    active_doc: view === undefined
      ? null
      : {
          doc_id: view.docId,
          title: viewDoc?.title ?? app?.panes[viewPane!]?.tabs.find((tab) => tab.id === view.docId)?.title ?? '',
          page: view.page,
          page_count: view.pageCount ?? viewDoc?.pageCount ?? null,
        },
    selection: selection === null || selection.text.trim() === '' ? null : { doc_id: selection.docId, page: selection.page, text: selection.text.slice(0, SELECTION_LIMIT) },
    open_notes: panes.flatMap((pane) => pane.tabs.flatMap((tab) => (tab.kind === 'note' ? [memoNoteTitleOf(tab.id)] : []))),
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
