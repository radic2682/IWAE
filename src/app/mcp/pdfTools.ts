import { t } from '../../i18n'
import { op, type McpAppDeps, type OpContext, type OpDef } from './types'

/** 「1-3,7」 → [1,2,3,7]. 쪽은 1부터, 범위 밖이면 오류 */
export function parsePageSpec(spec: string, pageCount: number): number[] {
  const pages = new Set<number>()
  const parts = spec.split(',').map((part) => part.trim()).filter((part) => part !== '')
  if (parts.length === 0) throw new Error('pages가 비었습니다(예: "1-3,7").')
  for (const part of parts) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/u.exec(part)
    if (match === null) throw new Error(`pages 형식이 올바르지 않습니다: "${part}" (예: "1-3,7")`)
    const from = Number(match[1])
    const to = match[2] === undefined ? from : Number(match[2])
    if (from < 1 || to < from || to > pageCount) throw new Error(`pages가 범위를 벗어났습니다(1–${pageCount}): "${part}"`)
    for (let page = from; page <= to; page += 1) pages.add(page)
  }
  return [...pages].sort((a, b) => a - b)
}

/** 파일 이름 줄기: 경로 글자를 걷고, 점만인 이름은 버리고, 80자까지 */
export function safeOutputName(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined
  const cleaned = name.replace(/\.pdf$/iu, '').replace(/[\\/:*?"<>|\u0000-\u001f]/gu, ' ').replace(/\s+/gu, ' ').trim().replace(/[. ]+$/u, '').slice(0, 80).trim()
  return cleaned === '' || /^\.+$/u.test(cleaned) ? undefined : cleaned
}

function needApp(ctx: OpContext): McpAppDeps {
  if (ctx.deps.app === undefined) throw new Error('app UI not available (PDF 도구를 쓸 수 없습니다).')
  return ctx.deps.app
}

async function pdfOf(ctx: OpContext, docId: unknown): Promise<{ docId: string; title: string; pageCount: number }> {
  const app = needApp(ctx)
  if (typeof docId !== 'string') throw new Error('doc_id가 필요합니다.')
  const doc = app.docs.find((item) => item.docId === docId)
  if (doc === undefined || doc.kind !== 'pdf') throw new Error(`doc_id not found (PDF only): ${docId}. list_documents로 doc_id를 확인하세요.`)
  const { meta } = await ctx.deps.loadPdfById(docId)
  return { docId, title: doc.title, pageCount: meta.pageCount }
}

function finish(ctx: OpContext, title: string, result: { path: string; docId: string | null; pageCount: number | null }) {
  ctx.change.target = title
  ctx.change.count += 1
  ctx.change.summary = t('새 PDF 만듦: {path}', { path: result.path })
  return { doc_id: result.docId, path: result.path, page_count: result.pageCount, note: 'A new file was created; delete it from the library if unwanted.' }
}

const extractPages = async (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  const doc = await pdfOf(ctx, args.doc_id)
  if (typeof args.pages !== 'string') throw new Error('pages가 필요합니다(예: "1-3,7").')
  const pages = parsePageSpec(args.pages, doc.pageCount)
  const outputName = safeOutputName(args.output_name)
  const result = await app.runPdfTool(doc.docId, { kind: 'extract', pages: pages.join(','), ...(outputName === undefined ? {} : { outputName }) })
  return finish(ctx, doc.title, result)
}

const POSITIONS = ['bottom-center', 'bottom-right', 'bottom-left', 'top-center', 'top-right', 'top-left']

const addPageNumbers = async (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  const doc = await pdfOf(ctx, args.doc_id)
  const pages = typeof args.pages === 'string' && args.pages.trim() !== '' ? parsePageSpec(args.pages, doc.pageCount).join(',') : undefined
  if (args.position !== undefined && !POSITIONS.includes(args.position as string)) throw new Error(`position은 ${POSITIONS.join(', ')} 중 하나입니다.`)
  const startAt = typeof args.start_at === 'number' && Number.isFinite(args.start_at) ? Math.floor(args.start_at) : undefined
  const outputName = safeOutputName(args.output_name)
  const result = await app.runPdfTool(doc.docId, {
    kind: 'pageNumbers',
    ...(pages === undefined ? {} : { pages }),
    ...(typeof args.position === 'string' ? { position: args.position } : {}),
    ...(startAt === undefined ? {} : { startAt }),
    ...(outputName === undefined ? {} : { outputName }),
  })
  return finish(ctx, doc.title, result)
}

export const pdfToolOps: Record<string, OpDef> = {
  pdf_extract_pages: op('write', extractPages),
  pdf_add_page_numbers: op('write', addPageNumbers),
}
