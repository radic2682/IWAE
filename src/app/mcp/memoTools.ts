import { defaultHighlightColorId, highlightColorIdFromInput } from '../../core/highlightColors'
import { getHighlightColors } from '../highlightColorStyle'
import { pageTextIndex } from '../../bridge/pdf'
import { buildAnchor } from '../../core/anchor'
import { BOX_DEFAULT_WIDTH, clampBox, placeBoxMemo } from '../../core/boxMemo'
import { findTextRange, findTextRegion } from '../../core/canvasOps'
import { createRegionExcerptSelection } from '../../core/pdfExcerpt'
import { memoBlock, memoHighlightIds, removeHighlightBlocks, safeNoteTitle, setMemoTicket, type MemoNote, type MemoNoteBlock, type MemoTicket } from '../../core/memoNote'
import { sanitizeMemoHtml } from '../../pdf/memoRichText'
import {
  createPersistentPdfHighlight,
  updatePersistentPdfHighlight,
  type PdfHighlightColor,
  type PersistentPdfHighlight,
  type PersistentPdfHighlightPatch,
} from '../../pdf/persistentHighlight'
import { t } from '../../i18n'
import { insertBlocks, parsePosition, type BlockPosition } from './blockPlacement'
import { cleanTitle } from './noteAdapter'
import { op, type McpDeps, type OpContext, type OpDef } from './types'

/** memo_add 가 받는 메모 하나(note_build 의 memo 단계도 같은 모양) */
export interface MemoInput {
  readonly doc_id?: unknown
  readonly page?: unknown
  readonly kind?: unknown
  readonly style?: unknown
  readonly from_text?: unknown
  readonly to_text?: unknown
  readonly rect?: unknown
  readonly full_width?: unknown
  readonly padding?: unknown
  readonly note?: unknown
  readonly note_html?: unknown
  readonly topic?: unknown
  readonly note_title?: unknown
  readonly note_position?: unknown
  readonly ticket_id?: unknown
  readonly ticket_title?: unknown
  readonly color?: unknown
  readonly rating?: unknown
}

// ---- 방금 만들거나 지운 형광펜: 앱 상태가 다시 그려지기 전의 짧은 틈을 메운다 ----
const OVERLAY_MS = 3000
const createdRecently = new Map<string, { highlight: PersistentPdfHighlight; at: number }>()
const removedRecently = new Map<string, number>()

export function currentHighlights(deps: McpDeps, now: number = Date.now()): readonly PersistentPdfHighlight[] {
  const known = new Set(deps.highlights.map((highlight) => highlight.id))
  for (const [id, entry] of createdRecently) if (known.has(id) || now - entry.at > OVERLAY_MS) createdRecently.delete(id)
  for (const [id, at] of removedRecently) if (!known.has(id) || now - at > OVERLAY_MS) removedRecently.delete(id)
  return [
    ...deps.highlights.filter((highlight) => !removedRecently.has(highlight.id)),
    ...[...createdRecently.values()].map((entry) => entry.highlight).filter((highlight) => !removedRecently.has(highlight.id)),
  ]
}

function trackCreated(highlight: PersistentPdfHighlight): void {
  removedRecently.delete(highlight.id)
  createdRecently.set(highlight.id, { highlight, at: Date.now() })
}

function trackRemoved(id: string): void {
  createdRecently.delete(id)
  removedRecently.set(id, Date.now())
}

/** 시험용 */
export function resetHighlightOverlay(): void {
  createdRecently.clear()
  removedRecently.clear()
}

export function memoSummary(highlight: PersistentPdfHighlight) {
  return {
    id: highlight.id,
    doc_id: highlight.anchor.docId,
    page: highlight.anchor.page + 1,
    kind: highlight.kind === 'region' ? 'region' : 'text',
    quote: highlight.anchor.quote.replace(/\s+/gu, ' ').trim().slice(0, 300),
    note: highlight.note ?? '',
    ...(highlight.topic === undefined ? {} : { topic: highlight.topic }),
    color: highlight.color,
  }
}

function isRect(value: unknown): value is { x: number; y: number; w: number; h: number } {
  if (typeof value !== 'object' || value === null) return false
  const { x, y, w, h } = value as Record<string, unknown>
  return [x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n)) && (w as number) > 0 && (h as number) > 0
}

function noteTitleOf(input: MemoInput): string | undefined {
  const raw = typeof input.topic === 'string' ? input.topic : typeof input.note_title === 'string' ? input.note_title : ''
  const title = cleanTitle(raw)
  return title === '' ? undefined : safeNoteTitle(title)
}

function ticketOf(input: MemoInput): MemoTicket | undefined {
  const id = typeof input.ticket_id === 'string' ? input.ticket_id.trim() : ''
  const title = typeof input.ticket_title === 'string' ? input.ticket_title.trim() : ''
  return id === '' && title === '' ? undefined : { ...(id === '' ? {} : { id }), ...(title === '' ? {} : { title }) }
}

interface BuiltMemo {
  readonly highlight: PersistentPdfHighlight
  readonly style: 'card' | 'box'
  readonly warnings: readonly string[]
}

/** 메모 하나를 형광펜으로 만든다: 글이면 그 글자 범위, 표·그림이면 그 네모, style:'box' 면 쪽 위에 뜨는 박스 */
async function buildHighlight(input: MemoInput, ctx: OpContext): Promise<BuiltMemo> {
  const { deps } = ctx
  if (typeof input.doc_id !== 'string' || typeof input.page !== 'number') throw new Error('doc_id와 page(1부터)가 필요합니다.')
  if (typeof input.note !== 'string' || input.note.trim() === '') throw new Error('note(메모 내용)가 필요합니다.')
  const style = input.style === 'box' ? 'box' : 'card'
  if (style === 'box' && input.kind === 'region') throw new Error('style:"box"는 글 메모에만 됩니다(region은 card).')
  const { meta } = await deps.loadPdfById(input.doc_id)
  const page = Math.floor(input.page) - 1
  if (page < 0 || page >= meta.pageCount) throw new Error(`쪽 번호가 범위를 벗어났습니다(1–${meta.pageCount}).`)
  const pageSize = meta.pageSizes[page]
  if (pageSize === undefined) throw new Error('쪽 크기를 알 수 없습니다.')
  const index = await pageTextIndex(meta.docId, page)
  const colors = getHighlightColors()
  const warnings: string[] = []
  let color: PdfHighlightColor | undefined = highlightColorIdFromInput(colors, input.color)
  if (color === undefined) {
    if (typeof input.color === 'string' && input.color.trim() !== '') warnings.push(`unknown color "${input.color}": used the default (see highlight_colors)`)
    color = defaultHighlightColorId(colors)
  }
  const extras = { createdAt: new Date().toISOString(), source: 'iwae' as const }
  let highlight: PersistentPdfHighlight
  if (input.kind === 'region') {
    const rect = isRect(input.rect)
      ? input.rect
      : typeof input.from_text === 'string'
        ? findTextRegion(index, input.from_text, typeof input.to_text === 'string' ? input.to_text : undefined, {
            padding: typeof input.padding === 'number' ? input.padding : undefined,
            fullWidth: input.full_width === true,
            pageSize,
          })
        : undefined
    if (rect === undefined) throw new Error('표·그림(region) 메모에는 rect 또는 from_text가 필요합니다.')
    const selection = createRegionExcerptSelection({ docId: meta.docId, page, rect, index, pageSize })
    highlight = createPersistentPdfHighlight(selection.anchor, color, { ...extras, kind: 'region', pageSize })
  } else {
    if (typeof input.from_text !== 'string') throw new Error('글 메모에는 from_text(칠할 글의 처음)가 필요합니다.')
    const [start, end] = findTextRange(index, input.from_text, typeof input.to_text === 'string' ? input.to_text : undefined)
    highlight = createPersistentPdfHighlight(buildAnchor(meta.docId, page, index, start, end), color, extras)
  }
  const rating = typeof input.rating === 'number' && Number.isFinite(input.rating) ? Math.round(input.rating) : undefined
  const topic = noteTitleOf(input)
  const patch: PersistentPdfHighlightPatch = {
    note: input.note,
    ...(typeof input.note_html === 'string' && input.note_html.trim() !== '' ? { noteHtml: sanitizeMemoHtml(input.note_html) } : {}),
    ...(topic === undefined ? {} : { topic }),
    ...(rating === undefined || rating < 1 || rating > 5 ? {} : { rating }),
  }
  let built = updatePersistentPdfHighlight(highlight, patch)
  if (style === 'box') {
    const overlapping = currentHighlights(deps).find((item) => item.anchor.docId === meta.docId && item.anchor.page === page && item.kind !== 'region'
      && item.id !== built.id && item.anchor.charRange[0] < built.anchor.charRange[1] && built.anchor.charRange[0] < item.anchor.charRange[1])
    if (overlapping !== undefined) throw new Error('이미 메모를 단 글입니다(박스 메모는 칠하지 않은 글에 만듭니다).')
    const textRects = index.chars.filter((char) => char.w > 0 && char.h > 0).map((char) => ({ x: char.x, y: char.y, w: char.w, h: char.h }))
    const box = clampBox(placeBoxMemo(pageSize, built.anchor.rects, textRects, BOX_DEFAULT_WIDTH), pageSize)
    built = updatePersistentPdfHighlight(built, { box })
  }
  return { highlight: built, style, warnings }
}

export interface MemoPlan {
  readonly highlight: PersistentPdfHighlight
  readonly style: 'card' | 'box'
  readonly noteTitle: string | undefined
  readonly position: BlockPosition | undefined
  readonly ticket: MemoTicket | undefined
  readonly warnings: readonly string[]
  readonly existing: boolean
  /** 노트에 넣은 뒤의 블록 id */
  blockId?: string
}

export interface CreateMemosOptions {
  readonly dryRun?: boolean
  /** 메모가 노트를 따로 정하지 않았을 때 쓸 노트 제목 */
  readonly defaultNoteTitle?: string
}

/** 메모들을 형광펜으로 저장한다(노트에는 넣지 않는다). 못 만든 것은 skipped 로 */
export async function createMemoHighlights(inputs: readonly MemoInput[], ctx: OpContext, options: CreateMemosOptions = {}): Promise<{ plans: MemoPlan[]; skipped: { index: number; reason: string }[] }> {
  const plans: MemoPlan[] = []
  const skipped: { index: number; reason: string }[] = []
  for (const [index, input] of inputs.entries()) {
    try {
      const built = await buildHighlight(input, ctx)
      const { highlight } = built
      const existing = currentHighlights(ctx.deps).some(({ id }) => id === highlight.id) || plans.some((plan) => plan.highlight.id === highlight.id)
      if (options.dryRun !== true) {
        if (existing) {
          // 같은 자리에 이미 형광펜이 있으면 메모·카테고리·색만 고친다
          ctx.deps.update(highlight.id, {
            note: highlight.note ?? '',
            ...(highlight.topic === undefined ? {} : { topic: highlight.topic }),
            color: highlight.color,
            ...(highlight.rating === undefined ? {} : { rating: highlight.rating }),
            ...(highlight.box === undefined ? {} : { box: highlight.box }),
          })
        } else {
          ctx.deps.add(highlight)
          trackCreated(highlight)
        }
      }
      const noteTitle = noteTitleOf(input) ?? options.defaultNoteTitle
      const warnings = [...built.warnings]
      const ticket = ticketOf(input)
      if (built.style === 'box' && noteTitle !== undefined) warnings.push('box memos float over the page and are not added to a note')
      if (ticket !== undefined && (noteTitle === undefined || built.style === 'box')) warnings.push('ticket_id/ticket_title need a note (note_title) and style card: ignored')
      plans.push({ highlight, style: built.style, noteTitle: built.style === 'box' ? undefined : noteTitle, position: parsePosition(input.note_position), ticket: built.style === 'box' ? undefined : ticket, warnings, existing })
    } catch (cause) {
      skipped.push({ index, reason: cause instanceof Error ? cause.message : String(cause) })
    }
  }
  return { plans, skipped }
}

/** 카드 메모를 노트마다 한 번의 edit 로 끼운다. 블록 id 를 plan.blockId 에 적는다 */
async function attachPlans(plans: readonly MemoPlan[], ctx: OpContext): Promise<void> {
  const titles = [...new Set(plans.flatMap((plan) => plan.noteTitle === undefined || plan.style === 'box' ? [] : [plan.noteTitle]))]
  for (const title of titles) {
    const mine = plans.filter((plan) => plan.noteTitle === title)
    const blocks = new Map<string, MemoNoteBlock>(mine.map((plan) => [plan.highlight.id, memoBlock(plan.highlight.id, plan.ticket)]))
    // 같은 노트·같은 자리 요청은 한 줄로 이어 끼운다(입력 차례 = 노트 차례)
    const batches: { position: BlockPosition | undefined; ids: string[] }[] = []
    for (const plan of mine) {
      const last = batches.at(-1)
      if (last !== undefined && JSON.stringify(last.position ?? null) === JSON.stringify(plan.position ?? null)) last.ids.push(plan.highlight.id)
      else batches.push({ position: plan.position, ids: [plan.highlight.id] })
    }
    const { ref } = await ctx.notes.edit(title, (note) => {
      let next: MemoNote = note
      for (const batch of batches) next = insertBlocks(next, batch.ids.map((id) => blocks.get(id)!), batch.position).note
      return next
    }, { create: true, docId: mine[0]!.highlight.anchor.docId })
    for (const plan of mine) {
      const found = ref.note.blocks.find((block) => block.kind === 'memo' && block.highlightId === plan.highlight.id)
      if (found !== undefined) plan.blockId = found.id
    }
  }
}

function createdView(plan: MemoPlan) {
  return {
    ...memoSummary(plan.highlight),
    style: plan.style,
    ...(plan.highlight.rating === undefined ? {} : { rating: plan.highlight.rating }),
    ...(plan.noteTitle === undefined ? {} : { note_title: plan.noteTitle }),
    ...(plan.blockId === undefined ? {} : { block_id: plan.blockId }),
    ...(plan.warnings.length === 0 ? {} : { warnings: plan.warnings }),
  }
}

/** 노트들 중 이 형광펜을 가리키는 메모 블록이 있는 것 */
function notesHolding(ctx: OpContext, highlightId: string) {
  return ctx.notes.available
    ? ctx.notes.list().flatMap((ref) => {
        const block = ref.note.blocks.find((item) => item.kind === 'memo' && memoHighlightIds(item).includes(highlightId))
        return block === undefined ? [] : [{ ref, block }]
      })
    : []
}

function ticketView(block: MemoNoteBlock | undefined) {
  return block !== undefined && block.kind === 'memo' && block.ticket !== undefined ? block.ticket : null
}

const memoAdd = async (args: Record<string, unknown>, ctx: OpContext) => {
  if (!Array.isArray(args.memos)) throw new Error('memos 배열이 필요합니다.')
  const dryRun = args.dry_run === true
  const { plans, skipped } = await createMemoHighlights(args.memos as MemoInput[], ctx, { dryRun })
  if (!dryRun) await attachPlans(plans, ctx)
  ctx.change.count += plans.length
  ctx.change.target = plans.find((plan) => plan.noteTitle !== undefined)?.noteTitle ?? plans[0]?.highlight.anchor.docId ?? ''
  ctx.change.summary = t('메모 {count}개 추가', { count: plans.length })
  return {
    ...(dryRun ? { dry_run: true } : {}),
    created: plans.map(createdView),
    ...(skipped.length > 0 ? { skipped } : {}),
  }
}

const memoList = (args: Record<string, unknown>, ctx: OpContext) => {
  const docId = typeof args.doc_id === 'string' ? args.doc_id : undefined
  const topic = typeof args.topic === 'string' ? cleanTitle(args.topic) : undefined
  const page = typeof args.page === 'number' ? Math.floor(args.page) - 1 : undefined
  const colors = getHighlightColors()
  const color = typeof args.color === 'string' ? highlightColorIdFromInput(colors, args.color) ?? args.color : undefined
  const all = currentHighlights(ctx.deps)
  const holders = new Map<string, { titles: string[]; ticket: MemoTicket | null }>()
  if (ctx.notes.available) {
    for (const ref of ctx.notes.list()) {
      for (const block of ref.note.blocks) {
        for (const id of memoHighlightIds(block)) {
          const entry = holders.get(id) ?? { titles: [], ticket: null }
          entry.titles.push(ref.title)
          entry.ticket ??= ticketView(block)
          holders.set(id, entry)
        }
      }
    }
  }
  const memos = all
    .filter((highlight) => args.only_with_note !== true || (highlight.note ?? '').trim() !== '')
    .filter((highlight) => docId === undefined || highlight.anchor.docId === docId)
    .filter((highlight) => topic === undefined || highlight.topic === topic)
    .filter((highlight) => page === undefined || highlight.anchor.page === page)
    .filter((highlight) => color === undefined || highlight.color === color)
    .filter((highlight) => typeof args.rating !== 'number' || (highlight.rating ?? 0) >= Math.round(args.rating))
    .filter((highlight) => typeof args.box !== 'boolean' || (highlight.box !== undefined) === args.box)
    .filter((highlight) => typeof args.in_notes !== 'boolean' || (holders.has(highlight.id)) === args.in_notes)
    .filter((highlight) => typeof args.ticket !== 'boolean' || (holders.get(highlight.id)?.ticket != null) === args.ticket)
    .sort((a, b) => a.anchor.docId.localeCompare(b.anchor.docId) || a.anchor.page - b.anchor.page
      || Math.min(...a.anchor.rects.map((rect) => rect.y)) - Math.min(...b.anchor.rects.map((rect) => rect.y)))
  const topics = [...new Set(all.filter((highlight) => docId === undefined || highlight.anchor.docId === docId)
    .flatMap((highlight) => highlight.topic === undefined ? [] : [highlight.topic]))].sort()
  return {
    memos: memos.map((highlight) => ({
      ...memoSummary(highlight),
      note_titles: holders.get(highlight.id)?.titles ?? [],
      ticket: holders.get(highlight.id)?.ticket ?? null,
      rating: highlight.rating ?? null,
      box: highlight.box ?? null,
    })),
    topics,
  }
}

const memoUpdate = async (args: Record<string, unknown>, ctx: OpContext) => {
  if (!Array.isArray(args.updates)) throw new Error('updates 배열이 필요합니다.')
  const updated: string[] = []
  const skipped: { id: string; reason: string }[] = []
  const colors = getHighlightColors()
  const all = currentHighlights(ctx.deps)
  for (const item of args.updates as Record<string, unknown>[]) {
    if (typeof item.id !== 'string' || !all.some(({ id }) => id === item.id)) {
      skipped.push({ id: String(item.id), reason: `없는 메모입니다: ${String(item.id)}` })
      continue
    }
    const color = highlightColorIdFromInput(colors, item.color)
    const rating = typeof item.rating === 'number' ? Math.round(item.rating) : undefined
    ctx.deps.update(item.id, {
      // note:"" 은 메모 글을 지운다(서식도 함께). note_html 이 오면 그 서식을 쓴다
      ...(typeof item.note === 'string' ? { note: item.note, noteHtml: typeof item.note_html === 'string' ? sanitizeMemoHtml(item.note_html) : '' } : {}),
      ...(typeof item.topic === 'string' ? { topic: item.topic } : {}),
      ...(color === undefined ? {} : { color }),
      ...(rating === undefined ? {} : { rating: rating >= 1 && rating <= 5 ? rating : 0 }),
      ...(typeof item.collapsed === 'boolean' ? { collapsed: item.collapsed } : {}),
    })
    if (typeof item.ticket_id === 'string' || typeof item.ticket_title === 'string') {
      const id = item.id
      for (const { ref, block } of notesHolding(ctx, id)) {
        if (block.kind !== 'memo') continue
        const next: MemoTicket = {
          ...(typeof item.ticket_id === 'string' ? (item.ticket_id.trim() === '' ? {} : { id: item.ticket_id }) : block.ticket?.id === undefined ? {} : { id: block.ticket.id }),
          ...(typeof item.ticket_title === 'string' ? (item.ticket_title.trim() === '' ? {} : { title: item.ticket_title }) : block.ticket?.title === undefined ? {} : { title: block.ticket.title }),
        }
        await ctx.notes.edit(ref.title, (note) => setMemoTicket(note, block.id, next), {})
      }
    }
    updated.push(item.id)
  }
  ctx.change.count += updated.length
  ctx.change.target = updated.length === 1 ? (all.find(({ id }) => id === updated[0])?.anchor.quote.slice(0, 30) ?? '') : ''
  ctx.change.summary = t('메모 {count}개 고침', { count: updated.length })
  return { updated, ...(skipped.length > 0 ? { skipped } : {}) }
}

const memoDelete = (args: Record<string, unknown>, ctx: OpContext) => {
  if (!Array.isArray(args.ids)) throw new Error('ids 배열이 필요합니다.')
  const all = currentHighlights(ctx.deps)
  const wanted = (args.ids as unknown[]).filter((id): id is string => typeof id === 'string')
  const found = wanted.filter((id, at) => wanted.indexOf(id) === at && all.some((highlight) => highlight.id === id))
  const snapshots = found.map((id) => all.find((highlight) => highlight.id === id)!)
  // 되돌리기(형광펜 목록과 노트 블록)가 지우기 전 모습을 갖고 있다. 여기서는 요약에 남긴다
  for (const id of found) {
    ctx.deps.remove(id)
    trackRemoved(id)
  }
  ctx.change.count += found.length
  ctx.change.target = snapshots[0]?.anchor.quote.replace(/\s+/gu, ' ').slice(0, 30) ?? ''
  ctx.change.summary = t('메모 {count}개 삭제', { count: found.length })
  return { deleted: found, note: 'Moved out of the document; ai_undo restores them.' }
}

const memoMoveToNote = async (args: Record<string, unknown>, ctx: OpContext) => {
  if (!Array.isArray(args.ids)) throw new Error('ids 배열이 필요합니다.')
  const title = safeNoteTitle(cleanTitle(typeof args.note_title === 'string' ? args.note_title : ''))
  if (typeof args.note_title !== 'string' || cleanTitle(args.note_title) === '') throw new Error('note_title 값이 필요합니다.')
  const position = parsePosition(args.position)
  const all = currentHighlights(ctx.deps)
  const skipped: { id: string; reason: string }[] = []
  const movable: { highlight: PersistentPdfHighlight; ticket: MemoTicket | undefined }[] = []
  for (const id of (args.ids as unknown[]).filter((value): value is string => typeof value === 'string')) {
    const highlight = all.find((item) => item.id === id)
    if (highlight === undefined) { skipped.push({ id, reason: `없는 메모입니다: ${id}` }); continue }
    const holder = notesHolding(ctx, id).find(({ ref }) => ref.title.toLowerCase() !== title.toLowerCase())
    const ticket = holder !== undefined && holder.block.kind === 'memo' ? holder.block.ticket : undefined
    movable.push({ highlight, ticket })
  }
  // 다른 노트에서는 뺀다(옮기기)
  for (const { highlight } of movable) {
    for (const { ref } of notesHolding(ctx, highlight.id)) {
      if (ref.title.toLowerCase() === title.toLowerCase()) continue
      await ctx.notes.edit(ref.title, (note) => removeHighlightBlocks(note, highlight.id), {})
    }
  }
  const blocks = movable.map(({ highlight, ticket }) => memoBlock(highlight.id, ticket))
  const { ref } = movable.length === 0
    ? { ref: null }
    : await ctx.notes.edit(title, (note) => insertBlocks(note, blocks, position).note, { create: true, docId: movable[0]!.highlight.anchor.docId })
  const moved = movable.map(({ highlight }) => ({
    id: highlight.id,
    block_id: ref?.note.blocks.find((block) => block.kind === 'memo' && block.highlightId === highlight.id)?.id,
  }))
  ctx.change.count += moved.length
  ctx.change.target = title
  ctx.change.summary = t('메모 {count}개를 「{title}」 노트로 옮김', { count: moved.length, title })
  return { moved, ...(skipped.length > 0 ? { skipped } : {}) }
}

const highlightColors = () => ({
  colors: getHighlightColors().map((color) => ({ id: color.id, name: color.name, fill: color.fill })),
})

export const memoOps: Record<string, OpDef> = {
  memo_list: op('read', memoList),
  memo_add: op('write', memoAdd),
  memo_update: op('write', memoUpdate),
  memo_delete: op('write', memoDelete),
  memo_move_to_note: op('write', memoMoveToNote),
  highlight_colors: op('read', highlightColors),
}

export { attachPlans }
