import type { PdfBookmark } from '../../core/pdfBookmarks'
import { t } from '../../i18n'
import { recordUndo } from '../undoStack'
import { op, type McpAppDeps, type OpContext, type OpDef } from './types'

// 저장된 책갈피의 page 는 0부터다. MCP 는 1부터 주고받고, app.addBookmark/updateBookmark 에는 0부터 넘긴다.
function needApp(ctx: OpContext): McpAppDeps {
  if (ctx.deps.app === undefined) throw new Error('app UI not available (화면을 다룰 수 없습니다).')
  return ctx.deps.app
}

const view = (bookmark: PdfBookmark) => ({
  id: bookmark.id,
  doc_id: bookmark.docId,
  page: bookmark.page + 1,
  title: bookmark.title,
  y: bookmark.y ?? null,
  emoji: bookmark.emoji ?? null,
})

/** y: 0–1 이면 쪽 안 비율, 1 보다 크면 위에서 잰 points(쪽 높이로 나눈다) */
async function ratioOf(ctx: OpContext, docId: string, page: number, y: unknown): Promise<number | undefined> {
  if (typeof y !== 'number' || !Number.isFinite(y) || y <= 0) return undefined
  if (y <= 1) return y
  const { meta } = await ctx.deps.loadPdfById(docId)
  const height = meta.pageSizes[page]?.[1]
  return height === undefined ? undefined : Math.min(y / height, 1)
}

async function checkPage(ctx: OpContext, docId: string, page: number): Promise<number> {
  const { meta } = await ctx.deps.loadPdfById(docId).catch(() => { throw new Error(`doc_id not found: ${docId}. list_documents로 doc_id를 확인하세요.`) })
  if (!Number.isInteger(page) || page < 1 || page > meta.pageCount) throw new Error(`쪽 번호가 범위를 벗어났습니다(page out of range 1–${meta.pageCount}).`)
  return page - 1
}

const bookmarkList = (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  const docId = typeof args.doc_id === 'string' ? args.doc_id : undefined
  return { bookmarks: app.bookmarks.filter((item) => docId === undefined || item.docId === docId).map(view) }
}

const bookmarkAdd = async (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  if (typeof args.doc_id !== 'string' || typeof args.page !== 'number' || typeof args.title !== 'string') throw new Error('doc_id, page, title 값이 필요합니다.')
  const docId = args.doc_id
  const title = args.title
  const page = await checkPage(ctx, docId, args.page)
  const y = await ratioOf(ctx, docId, page, args.y)
  const emoji = typeof args.emoji === 'string' && args.emoji !== '' ? args.emoji : undefined
  const options = { ...(y === undefined ? {} : { y }), ...(emoji === undefined ? {} : { emoji }) }
  let id = app.addBookmark(docId, page, title, options)
  recordUndo({
    key: `bookmark:${id}`,
    undo: () => app.removeBookmark(id),
    redo: () => { id = app.addBookmark(docId, page, title, options) },
  })
  ctx.change.target = title
  ctx.change.count += 1
  ctx.change.summary = t('책갈피 「{title}」 추가', { title })
  return { id }
}

const bookmarkUpdate = async (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  if (typeof args.id !== 'string') throw new Error('id가 필요합니다.')
  const id = args.id
  const before = app.bookmarks.find((item) => item.id === id)
  if (before === undefined) throw new Error(`bookmark not found: ${id}. bookmark_list로 id를 확인하세요.`)
  const page = typeof args.page === 'number' ? await checkPage(ctx, before.docId, args.page) : undefined
  const y = await ratioOf(ctx, before.docId, page ?? before.page, args.y)
  const patch = {
    ...(page === undefined ? {} : { page }),
    ...(typeof args.title === 'string' ? { title: args.title } : {}),
    ...(y === undefined ? {} : { y }),
    ...(typeof args.emoji === 'string' ? { emoji: args.emoji } : {}),
  }
  const nextId = app.updateBookmark(id, patch)
  let current = nextId
  recordUndo({
    key: `bookmark:${id}`,
    undo: () => { app.removeBookmark(current); app.restoreBookmarks([before]) },
    redo: () => { current = app.updateBookmark(before.id, patch) },
  })
  ctx.change.target = before.title
  ctx.change.count += 1
  ctx.change.summary = t('책갈피 「{title}」 고침', { title: before.title })
  return { updated: nextId }
}

const bookmarkRemove = (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  if (!Array.isArray(args.ids)) throw new Error('ids 배열이 필요합니다.')
  const snapshots = (args.ids as unknown[]).flatMap((id) => app.bookmarks.filter((item) => item.id === id))
  for (const bookmark of snapshots) app.removeBookmark(bookmark.id)
  if (snapshots.length > 0) {
    recordUndo({
      key: `bookmark:remove:${snapshots[0]!.id}`,
      undo: () => app.restoreBookmarks(snapshots),
      redo: () => { for (const bookmark of snapshots) app.removeBookmark(bookmark.id) },
    })
  }
  ctx.change.target = snapshots[0]?.title ?? ''
  ctx.change.count += snapshots.length
  ctx.change.summary = t('책갈피 {count}개 삭제', { count: snapshots.length })
  return { removed: snapshots.map((item) => item.id) }
}

export const bookmarkOps: Record<string, OpDef> = {
  bookmark_list: op('read', bookmarkList),
  bookmark_add: op('write', bookmarkAdd),
  bookmark_update: op('write', bookmarkUpdate),
  bookmark_remove: op('write', bookmarkRemove),
}
