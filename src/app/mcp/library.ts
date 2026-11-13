import { pdfMetadata, pdfOutline } from '../../bridge/pdf'
import { t } from '../../i18n'
import { recordUndo } from '../undoStack'
import { op, type McpAppDeps, type McpLibraryDoc, type OpContext, type OpDef } from './types'

const LIST_CAP = 200
const RECENT_LIMIT = 30
const collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' })

function needApp(ctx: OpContext): McpAppDeps {
  if (ctx.deps.app === undefined) throw new Error('app UI not available (서재를 다룰 수 없습니다).')
  return ctx.deps.app
}

function docOf(app: McpAppDeps, docId: string): McpLibraryDoc {
  const doc = app.docs.find((item) => item.docId === docId)
  if (doc === undefined) throw new Error(`doc_id not found: ${docId}. list_documents로 doc_id를 확인하세요.`)
  return doc
}

const byDateDesc = (a: string | null, b: string | null) => (b ?? '').localeCompare(a ?? '')

const libraryList = (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  const collection = typeof args.collection === 'string' ? args.collection : 'all'
  if (!['all', 'favorites', 'recent', 'folder'].includes(collection)) throw new Error('collection은 all, favorites, recent, folder 중 하나입니다.')
  const folder = typeof args.folder === 'string' ? args.folder.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '') : ''
  if (collection === 'folder' && folder === '') throw new Error('collection:"folder" 에는 folder가 필요합니다.')
  const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
  let docs = app.docs.filter((doc) => args.kind === undefined || doc.kind === args.kind)
  if (collection === 'favorites') docs = docs.filter((doc) => doc.favorite)
  if (collection === 'folder') docs = docs.filter((doc) => doc.folder.replaceAll('\\', '/') === folder || doc.folder.replaceAll('\\', '/').startsWith(`${folder}/`))
  if (collection === 'recent') docs = docs.filter((doc) => doc.lastOpenedAt !== null).sort((a, b) => byDateDesc(a.lastOpenedAt, b.lastOpenedAt)).slice(0, RECENT_LIMIT)
  if (query !== '') docs = docs.filter((doc) => doc.title.toLowerCase().includes(query))
  const sort = typeof args.sort === 'string' ? args.sort : collection === 'recent' ? 'recent' : 'title'
  const sorted = [...docs]
  if (sort === 'title') sorted.sort((a, b) => collator.compare(a.title, b.title))
  else if (sort === 'recent') sorted.sort((a, b) => byDateDesc(a.lastOpenedAt, b.lastOpenedAt))
  else if (sort === 'added') sorted.sort((a, b) => byDateDesc(a.addedAt, b.addedAt))
  else if (sort === 'pages') sorted.sort((a, b) => (b.pageCount ?? 0) - (a.pageCount ?? 0))
  else throw new Error('sort는 title, recent, added, pages 중 하나입니다.')
  return {
    items: sorted.slice(0, LIST_CAP).map((doc) => ({
      doc_id: doc.docId,
      title: doc.title,
      kind: doc.kind,
      folder: doc.folder,
      favorite: doc.favorite,
      page_count: doc.pageCount,
      last_opened: doc.lastOpenedAt,
    })),
    ...(sorted.length > LIST_CAP ? { truncated: true, total: sorted.length } : {}),
  }
}

const librarySetFavorite = (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  if (!Array.isArray(args.doc_ids) || typeof args.favorite !== 'boolean') throw new Error('doc_ids 배열과 favorite이 필요합니다.')
  const favorite = args.favorite
  const updated: { doc_id: string; favorite: boolean }[] = []
  for (const id of (args.doc_ids as unknown[]).filter((value): value is string => typeof value === 'string')) {
    const doc = docOf(app, id)
    if (updated.some((item) => item.doc_id === id)) continue
    const before = doc.favorite
    if (before !== favorite) {
      app.setFavorite(id, favorite)
      recordUndo({ key: `favorite:${id}`, undo: () => app.setFavorite(id, before), redo: () => app.setFavorite(id, favorite) })
    }
    updated.push({ doc_id: id, favorite })
  }
  ctx.change.target = updated.length === 1 ? docOf(app, updated[0]!.doc_id).title : ''
  ctx.change.count += updated.length
  ctx.change.summary = favorite ? t('즐겨찾기 {count}개 추가', { count: updated.length }) : t('즐겨찾기 {count}개 해제', { count: updated.length })
  return { updated }
}

/** 문서가 가진 노트 제목들: docId 가 같거나 같은 PDF(버전 묶음 대표)에 속한 노트 */
function noteTitlesOf(ctx: OpContext, docId: string): string[] {
  if (!ctx.notes.available) return []
  const owner = (id: string | undefined): string | null => (id === undefined ? null : ctx.deps.noteOwner?.(id) ?? id)
  const wanted = owner(docId)
  return ctx.notes.list()
    .filter((ref) => ref.note.docId === docId || (wanted !== null && owner(ref.note.docId) === wanted))
    .map((ref) => ref.title)
}

const docFlags = (_args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  const docs: Record<string, { has_note: boolean; note_titles: string[]; favorite: boolean; folder: string; ocr: string | null }> = {}
  for (const doc of app.docs) {
    const titles = noteTitlesOf(ctx, doc.docId)
    docs[doc.docId] = { has_note: titles.length > 0, note_titles: titles, favorite: doc.favorite, folder: doc.folder, ocr: doc.ocr }
  }
  return { docs }
}

const docInfo = async (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  if (typeof args.doc_id !== 'string') throw new Error('doc_id가 필요합니다.')
  const docId = args.doc_id
  const doc = docOf(app, docId)
  const { meta, title } = await ctx.deps.loadPdfById(docId).catch(() => { throw new Error(`PDF를 열 수 없습니다(doc_id: ${docId}). Markdown 문서는 doc_info를 지원하지 않습니다.`) })
  const [metadata, outline] = await Promise.all([pdfMetadata(docId).catch(() => ({})), pdfOutline(docId).catch(() => [])])
  return {
    doc_id: docId,
    title: doc.title || title,
    page_count: meta.pageCount,
    metadata,
    outline_count: outline.length,
    bookmarks: app.bookmarks.filter((item) => item.docId === docId).length,
    memo_count: ctx.highlights().filter((highlight) => highlight.anchor.docId === docId).length,
    notes: noteTitlesOf(ctx, docId),
    sources: ctx.deps.docSources?.all()[docId] ?? [],
    scanned: !meta.hasText,
    ocr: doc.ocr,
  }
}

const docOutline = async (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  if (typeof args.doc_id !== 'string') throw new Error('doc_id가 필요합니다.')
  docOf(app, args.doc_id)
  const outline = await pdfOutline(args.doc_id).catch(() => [])
  return { items: outline.map((entry) => ({ title: entry.title, page: entry.page === null ? null : entry.page + 1, level: entry.depth + 1 })) }
}

const ocrStatus = async (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  if (typeof args.doc_id !== 'string') throw new Error('doc_id가 필요합니다.')
  const doc = docOf(app, args.doc_id)
  let scanned = doc.scanned
  if (scanned === null) scanned = !(await ctx.deps.loadPdfById(args.doc_id).catch(() => null))?.meta.hasText
  return { doc_id: args.doc_id, scanned: scanned === true, ocr: doc.ocr ?? 'none', pages_with_text: doc.pagesWithText }
}

export const libraryOps: Record<string, OpDef> = {
  library_list: op('read', libraryList),
  library_set_favorite: op('write', librarySetFavorite),
  doc_flags: op('read', docFlags),
  doc_info: op('read', docInfo),
  doc_outline: op('read', docOutline),
  ocr_status: op('read', ocrStatus),
}
