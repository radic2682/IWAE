import { t } from '../../i18n'
import { MAX_PANES } from '../../core/layoutTree'
import { paneIndexOfRef } from './appDeps'
import { op, type McpAppDeps, type OpContext, type OpDef, type PaneRef } from './types'

function needApp(ctx: OpContext): McpAppDeps {
  if (ctx.deps.app === undefined) throw new Error('app UI not available (화면을 다룰 수 없습니다).')
  return ctx.deps.app
}

/**
 * 칸 참조: 칸 번호('0'…'7', 숫자도 받는다), 예전 이름(left=0, right=1, third=2, fourth=3), active, other, 또는 app_state 가 알려 준 칸 id.
 * 그 칸이 아직 없으면 앱이 칸을 늘려서 만든다(resolvePane)
 */
function paneOf(value: unknown): PaneRef | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_PANES) return String(value)
  if (typeof value === 'string' && (value === 'active' || value === 'other' || paneIndexOfRef(value) !== null || /^p\d+$/u.test(value))) return value
  throw new Error('pane 은 칸 번호(0–7), left, right, third, fourth, active, other 또는 app_state 의 칸 id 입니다.')
}

/** 문서가 서재에 있는지, 쪽이 범위 안인지 본다. PDF 가 아니면 쪽 검사는 건너뛴다 */
async function checkDoc(ctx: OpContext, docId: string, page?: number): Promise<{ title: string }> {
  const app = needApp(ctx)
  const doc = app.docs.find((item) => item.docId === docId)
  if (doc === undefined) throw new Error(`doc_id not found: ${docId}. list_documents 로 doc_id 를 확인하세요.`)
  if (page !== undefined && doc.kind === 'pdf') {
    const { meta } = await ctx.deps.loadPdfById(docId)
    if (page < 1 || page > meta.pageCount) throw new Error(`쪽 번호가 범위를 벗어났습니다(page out of range 1–${meta.pageCount}).`)
  }
  return { title: doc.title }
}

function pageOf(value: unknown, required: boolean): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    if (required) throw new Error('page(1부터)가 필요합니다.')
    return undefined
  }
  return Math.floor(value)
}

const openDocument = async (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  if (typeof args.doc_id !== 'string') throw new Error('doc_id 가 필요합니다.')
  const page = pageOf(args.page, false)
  const { title } = await checkDoc(ctx, args.doc_id, page)
  const pane = paneOf(args.pane)
  const opened = await app.openDocument(args.doc_id, { ...(pane === undefined ? {} : { pane }), ...(page === undefined ? {} : { page }), activate: args.activate !== false })
  ctx.change.target = title
  return { opened: { doc_id: args.doc_id, pane: opened.pane, page: opened.page } }
}

const openNote = (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  if (typeof args.title !== 'string') throw new Error('title(노트 제목)이 필요합니다.')
  const ref = ctx.notes.require(args.title)
  const opened = app.openNote(ref.path, paneOf(args.pane))
  ctx.change.target = ref.title
  return { opened: { title: ref.title, pane: opened.pane } }
}

const setLayout = (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  const count = typeof args.pane_count === 'number' ? Math.floor(args.pane_count) : 0
  if (count < 1 || count > MAX_PANES) throw new Error('pane_count 는 1–' + MAX_PANES + ' 입니다.')
  const focusRef = args.focus === undefined ? undefined : paneOf(args.focus)
  const focus = focusRef === undefined ? undefined : paneIndexOfRef(focusRef)
  if (focusRef !== undefined && (focus === null || focus === undefined || focus >= count)) throw new Error('focus 칸이 pane_count 안에 없습니다.')
  const result = app.setLayout(count, focus ?? undefined)
  ctx.change.target = t('{count}단 보기', { count })
  return { pane_count: result.paneCount, active_pane: result.activePane }
}

const goto = async (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  if (typeof args.doc_id !== 'string') throw new Error('doc_id 가 필요합니다.')
  const page = pageOf(args.page, true)!
  const { title } = await checkDoc(ctx, args.doc_id, page)
  const quote = typeof args.quote === 'string' && args.quote.trim() !== '' ? args.quote : undefined
  const pane = paneOf(args.pane)
  const result = await app.goto({ docId: args.doc_id, page, flash: args.flash !== false, ...(quote === undefined ? {} : { quote }), ...(pane === undefined ? {} : { pane }) })
  ctx.change.target = `${title} p.${page}`
  return { went: { doc_id: args.doc_id, page, flashed: result.flashed } }
}

const closeTab = (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  if (typeof args.tab_id !== 'string') throw new Error('tab_id 가 필요합니다.')
  const tab = app.panes.flatMap((pane) => pane.tabs).find((item) => item.id === args.tab_id)
  if (tab === undefined) throw new Error(`tab not found: ${args.tab_id}. app_state 로 tab id 를 확인하세요.`)
  if (!app.closeTab(tab.id)) throw new Error('탭을 닫지 못했습니다(저장되지 않은 작업이 있을 수 있습니다).')
  ctx.change.target = tab.title
  return { closed: tab.id }
}

export const navigationOps: Record<string, OpDef> = {
  open_document: op('ui', openDocument),
  open_note: op('ui', openNote),
  set_layout: op('ui', setLayout),
  goto: op('ui', goto),
  close_tab: op('ui', closeTab),
}
