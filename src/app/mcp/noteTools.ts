import {
  docNoteTitle,
  memoBlock,
  memoHighlightIds,
  memoNotesFolder,
  moveBlockBefore,
  normalizeTicket,
  removeBlock,
  safeNoteTitle,
  sectionBlock,
  sectionRange,
  setMemoTicket,
  suggestTicketIds,
  textBlock,
  ticketLabel,
  updateSection,
  updateTextBlock,
  type MemoNote,
  type MemoNoteBlock,
  type MemoTicket,
} from '../../core/memoNote'
import { buildMarkdownBlocks, renderNoteMarkdown } from '../../core/markdownExport'
import { markdownToMemoHtml, sanitizeMemoHtml } from '../../pdf/memoRichText'
import type { PersistentPdfHighlight } from '../../pdf/persistentHighlight'
import { t } from '../../i18n'
import { insertBlocks, parsePosition, sectionIdOf } from './blockPlacement'
import { createMemoHighlights, currentHighlights, memoSummary, type MemoInput } from './memoTools'
import { cleanTitle, NoteNotFoundError } from './noteAdapter'
import { op, type OpContext, type OpDef } from './types'

function requireTitle(args: Record<string, unknown>): string {
  const title = typeof args.title === 'string' ? args.title : typeof args.topic === 'string' ? args.topic : ''
  if (cleanTitle(title) === '') throw new Error('title(노트 제목)이 필요합니다.')
  return cleanTitle(title)
}

/** 글 블록 내용: markdown(또는 text) → 서식 HTML, html 이 오면 그것을 거른다. 평문은 서식 HTML 의 글자만 */
export function textContent(input: Record<string, unknown>): { text: string; html: string } {
  const markdown = typeof input.markdown === 'string' ? input.markdown : typeof input.text === 'string' ? input.text : typeof input.content === 'string' ? input.content : null
  const html = typeof input.html === 'string' ? sanitizeMemoHtml(input.html) : markdown !== null ? markdownToMemoHtml(markdown) : ''
  if (html.trim() === '' && (markdown ?? '').trim() === '') throw new Error('글 블록에는 markdown 또는 html 이 필요합니다.')
  const box = document.createElement('div')
  box.innerHTML = html
  // 칸·목록 사이에 빈칸을 두고 글자만 뽑는다(검색·미리보기용)
  box.querySelectorAll('td, th, li, p, div, h2, h3, h4, pre, blockquote, br').forEach((element) => element.append(' '))
  const text = (box.textContent ?? markdown ?? '').replace(/[ \t]+/gu, ' ').trim()
  return { text, html }
}

function ticketFrom(input: Record<string, unknown>): MemoTicket | undefined {
  const id = typeof input.ticket_id === 'string' ? input.ticket_id.trim() : ''
  const title = typeof input.ticket_title === 'string' ? input.ticket_title.trim() : ''
  return id === '' && title === '' ? undefined : { ...(id === '' ? {} : { id }), ...(title === '' ? {} : { title }) }
}

function blockFromInput(input: Record<string, unknown>, index: number, highlights: readonly PersistentPdfHighlight[]): MemoNoteBlock {
  const kind = typeof input.kind === 'string'
    ? input.kind
    : typeof input.highlight_id === 'string' ? 'memo' : input.markdown === undefined && input.html === undefined && typeof input.title === 'string' ? 'section' : 'text'
  if (kind === 'section') {
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    if (title === '') throw new Error(`blocks[${index}]: 소제목에는 title 이 필요합니다.`)
    return sectionBlock(title)
  }
  if (kind === 'memo' || kind === 'ticket') {
    const id = typeof input.highlight_id === 'string' ? input.highlight_id : typeof input.id === 'string' ? input.id : ''
    if (!highlights.some((highlight) => highlight.id === id)) throw new Error(`blocks[${index}]: 없는 메모입니다: ${id}`)
    const ticket = ticketFrom(input) ?? (kind === 'ticket' && typeof input.title === 'string' && input.title.trim() !== '' ? { title: input.title.trim() } : undefined)
    if (kind === 'ticket' && ticket === undefined) throw new Error(`blocks[${index}]: 티켓에는 title(또는 ticket_id/ticket_title)이 필요합니다.`)
    return memoBlock(id, ticket)
  }
  if (kind !== 'text') throw new Error(`blocks[${index}]: kind 는 section, text, memo, ticket 중 하나입니다.`)
  const { text, html } = textContent(input)
  return textBlock(text, html)
}

function describeBlock(note: MemoNote, at: number, ctx: OpContext, includeText: boolean): Record<string, unknown> {
  const block = note.blocks[at]!
  if (block.kind === 'section') return { id: block.id, kind: 'section', title: block.title, ...(block.collapsed === true ? { collapsed: true } : {}) }
  const sectionId = sectionIdOf(note, at)
  if (block.kind === 'text') {
    return { id: block.id, kind: 'text', section_id: sectionId, ...(includeText ? { text: block.text, ...(block.html === undefined ? {} : { html: block.html }) } : { chars: block.text.length }) }
  }
  const highlight = currentHighlights(ctx.deps).find((item) => item.id === block.highlightId)
  if (highlight === undefined) return { id: block.id, kind: 'memo', section_id: sectionId, highlight_id: block.highlightId, missing: true }
  const summary = memoSummary(highlight)
  return {
    ...summary,
    ...(includeText ? {} : { quote: summary.quote.slice(0, 60), note: summary.note.slice(0, 60) }),
    id: block.id,
    kind: block.ticket === undefined ? 'memo' : 'ticket',
    section_id: sectionId,
    highlight_id: block.highlightId,
    memo_kind: summary.kind,
    ...(block.ticket === undefined ? {} : { ticket: block.ticket, ticket_title: ticketLabel(block.ticket), ...(block.ticket.id === undefined ? {} : { ticket_id: block.ticket.id }) }),
    ...(highlight.box === undefined ? {} : { style: 'box' }),
  }
}

function usedTicketIds(note: MemoNote): string[] {
  return note.blocks.flatMap((block) => (block.kind === 'memo' && block.ticket?.id !== undefined ? [block.ticket.id] : []))
}

// ---- 읽기 ----

const noteList = (args: Record<string, unknown>, ctx: OpContext) => {
  const docId = typeof args.doc_id === 'string' ? args.doc_id : undefined
  const owner = (id: string | undefined): string | null => id === undefined ? null : ctx.deps.noteOwner?.(id) ?? id
  const wantedOwner = owner(docId)
  const notes = ctx.notes.list()
    .filter((ref) => docId === undefined || ref.note.docId === docId || (wantedOwner !== null && owner(ref.note.docId) === wantedOwner))
    .map((ref) => ({
      title: ref.title,
      doc_id: ref.note.docId ?? null,
      owner_doc_id: owner(ref.note.docId),
      block_count: ref.note.blocks.length,
      memo_count: ref.note.blocks.filter((block) => block.kind === 'memo').length,
      section_count: ref.note.blocks.filter((block) => block.kind === 'section').length,
      path: ref.path,
    }))
  return { notes }
}

const noteRead = (args: Record<string, unknown>, ctx: OpContext) => {
  const title = requireTitle(args)
  const ref = ctx.notes.require(title)
  const includeText = args.include_text !== false
  const from = typeof args.from === 'number' ? Math.max(0, Math.floor(args.from)) : 0
  const limit = typeof args.limit === 'number' ? Math.min(200, Math.max(1, Math.floor(args.limit))) : 100
  const indices = ref.note.blocks.map((_, at) => at).slice(from, from + limit)
  return {
    title: ref.title,
    doc_id: ref.note.docId ?? null,
    path: ref.path,
    blocks: indices.map((at) => describeBlock(ref.note, at, ctx, includeText)),
    suggested_next_ids: suggestTicketIds(usedTicketIds(ref.note)),
    total: ref.note.blocks.length,
    ...(from + limit < ref.note.blocks.length ? { next_from: from + limit } : {}),
  }
}

// ---- 만들기·고치기 ----

/** 노트 폴더 안으로만: 「..」·절대 경로를 거절하고, 노트 폴더 밖이면 그 아래로 둔다 */
function safeFolder(folder: string): string {
  const parts = folder.replaceAll('\\', '/').split('/').map((part) => part.trim()).filter((part) => part !== '')
  if (parts.some((part) => part === '..' || part === '.' || /^[A-Za-z]:$/u.test(part))) throw new Error('folder 가 올바르지 않습니다(노트 폴더 안의 하위 폴더 이름만).')
  const root = memoNotesFolder()
  const rest = parts[0] === root ? parts.slice(1) : parts
  return [root, ...rest].join('/')
}

const noteCreate = async (args: Record<string, unknown>, ctx: OpContext) => {
  const docId = typeof args.doc_id === 'string' && args.doc_id !== '' ? args.doc_id : undefined
  let title = typeof args.title === 'string' ? cleanTitle(args.title) : ''
  let docTitle = ''
  if (docId !== undefined) {
    const loaded = await ctx.deps.loadPdfById(docId).catch(() => null)
    if (loaded === null) throw new Error(`없는 문서입니다(doc_id not found): ${docId}. list_documents 로 doc_id 를 확인하세요.`)
    docTitle = loaded.title
  }
  if (title === '') {
    if (docId === undefined) throw new Error('title 또는 doc_id 가 필요합니다.')
    // 제목이 없으면 그 PDF 의 노트 제목. 이미 있으면 그 노트를 다시 쓰고(unique 가 아니면), 아니면 겹치지 않는 제목
    const taken = args.unique === true ? ctx.notes.list().map((ref) => ref.title) : []
    title = docNoteTitle(docTitle, taken)
  }
  title = safeNoteTitle(title)
  const folder = typeof args.folder === 'string' && args.folder.trim() !== '' ? safeFolder(args.folder) : undefined
  const { ref, created } = await ctx.notes.create({ title, ...(docId === undefined ? {} : { docId }), ...(folder === undefined ? {} : { folder }), unique: args.unique === true })
  ctx.change.target = ref.title
  ctx.change.count += created ? 1 : 0
  ctx.change.summary = t('노트 「{title}」 만듦', { title: ref.title })
  return {
    title: ref.title,
    doc_id: ref.note.docId ?? null,
    created,
    path: ref.path,
    ...(!created && docId !== undefined && ref.note.docId !== docId ? { warning: 'A note with this title already exists and is not attached to this doc_id; use another title or unique:true.' } : {}),
  }
}

const noteAppend = async (args: Record<string, unknown>, ctx: OpContext) => {
  const title = requireTitle(args)
  if (!Array.isArray(args.blocks) || args.blocks.length === 0) throw new Error('blocks 배열이 필요합니다.')
  const highlights = currentHighlights(ctx.deps)
  const made = (args.blocks as Record<string, unknown>[]).map((input, index) => blockFromInput(input, index, highlights))
  const position = parsePosition({ before: args.before, after: args.after, index: args.index, section_id: args.section_id })
  const { ref } = await ctx.notes.edit(title, (note) => insertBlocks(note, made, position).note, { create: true })
  const added = made.filter((block) => ref.note.blocks.some((item) => item.id === block.id))
  ctx.change.target = ref.title
  ctx.change.count += added.length
  ctx.change.summary = t('「{title}」 노트에 블록 {count}개 추가', { title: ref.title, count: added.length })
  return {
    title: ref.title,
    path: ref.path,
    added: added.map((block) => ({ id: block.id, kind: block.kind === 'memo' && block.ticket !== undefined ? 'ticket' : block.kind })),
    ...(added.length < made.length ? { skipped: made.length - added.length, note: 'Some memo blocks were already in this note.' } : {}),
  }
}

interface BuildStep {
  readonly section?: unknown
  readonly text?: unknown
  readonly html?: unknown
  readonly memo?: unknown
  readonly block_ref?: unknown
}

const noteBuild = async (args: Record<string, unknown>, ctx: OpContext) => {
  const title = requireTitle(args)
  if (!Array.isArray(args.steps) || args.steps.length === 0) throw new Error('steps 배열이 필요합니다.')
  const steps = args.steps as BuildStep[]
  const docId = typeof args.doc_id === 'string' && args.doc_id !== '' ? args.doc_id : undefined
  const existing = ctx.notes.find(title)
  if (existing === null && args.create === false) throw new NoteNotFoundError(title)
  ctx.change.target = existing?.title ?? safeNoteTitle(title)
  if (existing === null) {
    if (docId !== undefined && (await ctx.deps.loadPdfById(docId).catch(() => null)) === null) throw new Error(`없는 문서입니다(doc_id not found): ${docId}.`)
    await ctx.notes.create({ title, ...(docId === undefined ? {} : { docId }) })
  }
  const noteTitle = ctx.notes.require(title).title
  ctx.change.target = noteTitle
  const skipped: { index: number; reason: string }[] = []

  // 1) 메모를 모두 먼저 만든다(형광펜). 노트 블록은 아직 넣지 않는다
  const memoSteps = steps.flatMap((step, index) => (step.memo !== undefined && typeof step.memo === 'object' && step.memo !== null ? [{ index, input: { ...(step.memo as MemoInput), ...(docId !== undefined && (step.memo as MemoInput).doc_id === undefined ? { doc_id: docId } : {}), topic: noteTitle } as MemoInput }] : []))
  const { plans, skipped: memoSkipped } = await createMemoHighlights(memoSteps.map((entry) => entry.input), ctx, { defaultNoteTitle: noteTitle })
  for (const entry of memoSkipped) skipped.push({ index: memoSteps[entry.index]!.index, reason: entry.reason })
  const planByStep = new Map<number, (typeof plans)[number]>()
  // plans 는 성공한 메모만(입력 차례). 실패한 입력 번호를 건너뛰며 짝을 맞춘다
  const failed = new Set(memoSkipped.map((entry) => entry.index))
  let cursor = 0
  for (const [memoIndex, entry] of memoSteps.entries()) {
    if (failed.has(memoIndex)) continue
    const plan = plans[cursor]
    cursor += 1
    if (plan !== undefined) planByStep.set(entry.index, plan)
  }

  // 2) 단계 차례대로 블록을 만든다(차례 = 노트 안 차례)
  const highlights = currentHighlights(ctx.deps)
  const blocks: MemoNoteBlock[] = []
  const stepOfBlock = new Map<string, number>()
  const push = (block: MemoNoteBlock, index: number) => { blocks.push(block); stepOfBlock.set(block.id, index) }
  for (const [index, step] of steps.entries()) {
    try {
      const kinds = ['section', 'text', 'html', 'memo', 'block_ref'].filter((key) => (step as Record<string, unknown>)[key] !== undefined)
      if (kinds.length !== 1) throw new Error(`steps[${index}]: section, text, html, memo, block_ref 중 정확히 하나가 필요합니다.`)
      if (step.section !== undefined) {
        const sectionTitle = typeof step.section === 'string' ? step.section : typeof (step.section as { title?: unknown }).title === 'string' ? (step.section as { title: string }).title : ''
        if (sectionTitle.trim() === '') throw new Error(`steps[${index}]: 소제목 글이 비었습니다.`)
        push(sectionBlock(sectionTitle.trim()), index)
      } else if (step.text !== undefined || step.html !== undefined) {
        const { text, html } = textContent(step.html !== undefined ? { html: step.html } : { markdown: step.text })
        push(textBlock(text, html), index)
      } else if (step.memo !== undefined) {
        const plan = planByStep.get(index)
        if (plan === undefined) continue
        if (plan.style === 'box') continue
        push(memoBlock(plan.highlight.id, plan.ticket), index)
      } else {
        const ref = step.block_ref as Record<string, unknown>
        const id = typeof ref?.highlight_id === 'string' ? ref.highlight_id : ''
        if (!highlights.some((highlight) => highlight.id === id)) throw new Error(`steps[${index}]: 없는 메모입니다(block_ref.highlight_id): ${id}`)
        push(memoBlock(id, ticketFrom(ref)), index)
      }
    } catch (cause) {
      skipped.push({ index, reason: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  // 3) 모든 블록을 한 번의 edit 로 끼운다
  const position = parsePosition(args.position)
  let inserted: MemoNoteBlock[] = []
  const { ref } = await ctx.notes.edit(noteTitle, (note) => {
    const result = insertBlocks(note, blocks, position)
    inserted = result.inserted
    return result.note
  }, {})
  const blockIdOf = (highlightId: string): string | undefined => ref.note.blocks.find((block) => block.kind === 'memo' && block.highlightId === highlightId)?.id
  const created = [...planByStep.entries()].sort((a, b) => a[0] - b[0]).map(([step, plan]) => ({
    ...memoSummary(plan.highlight),
    step,
    style: plan.style,
    ...(plan.style === 'box' ? {} : { block_id: blockIdOf(plan.highlight.id) }),
    ...(plan.warnings.length === 0 ? {} : { warnings: plan.warnings }),
  }))
  ctx.change.count += inserted.length
  ctx.change.summary = t('「{title}」 노트 만듦: 메모 {memos}개, 블록 {blocks}개', { title: noteTitle, memos: created.length, blocks: inserted.length })
  return { title: noteTitle, doc_id: ref.note.docId ?? null, created, ...(skipped.length > 0 ? { skipped: skipped.sort((a, b) => a.index - b.index) } : {}), blocks_added: inserted.length }
}

const noteUpdateBlock = async (args: Record<string, unknown>, ctx: OpContext) => {
  const title = requireTitle(args)
  if (typeof args.id !== 'string') throw new Error('id(블록)가 필요합니다.')
  const id = args.id
  let kind = ''
  const { ref } = await ctx.notes.edit(title, (note) => {
    const block = note.blocks.find((item) => item.id === id)
    if (block === undefined) throw new Error(`없는 블록입니다(block not found): ${id}. note_read 로 블록 id 를 확인하세요.`)
    kind = block.kind
    if (block.kind === 'section') {
      if (typeof args.section_title !== 'string' && typeof args.collapsed !== 'boolean') throw new Error('소제목은 section_title 또는 collapsed 로 바꿉니다.')
      return updateSection(note, id, {
        ...(typeof args.section_title === 'string' ? { title: args.section_title } : {}),
        ...(typeof args.collapsed === 'boolean' ? { collapsed: args.collapsed } : {}),
      })
    }
    if (block.kind === 'text') {
      const { text, html } = textContent(args)
      return updateTextBlock(note, id, text, html)
    }
    if (typeof args.ticket_title === 'string' || typeof args.ticket_id === 'string') {
      // 비운 칸은 지운다. 오지 않은 칸은 그대로
      const keep = block.ticket
      const nextId = typeof args.ticket_id === 'string' ? args.ticket_id.trim() : keep?.id ?? ''
      const nextTitle = typeof args.ticket_title === 'string' ? args.ticket_title.trim() : keep?.title ?? ''
      return setMemoTicket(note, id, normalizeTicket({ id: nextId, title: nextTitle }))
    }
    if (typeof args.collapsed === 'boolean') return note
    throw new Error('메모·티켓 블록의 글은 memo_update 로 고칩니다(ID 는 ticket_id, 제목은 ticket_title. 둘 다 비우면 그냥 메모).')
  }, {})
  if (kind === 'memo' && typeof args.collapsed === 'boolean') {
    const block = ref.note.blocks.find((item) => item.id === id)
    if (block?.kind === 'memo') ctx.deps.update(block.highlightId, { collapsed: args.collapsed })
  }
  ctx.change.target = ref.title
  ctx.change.count += 1
  ctx.change.summary = t('「{title}」 노트의 블록 고침', { title: ref.title })
  return { updated: { id, kind } }
}

type MoveSpec = { mode: 'before'; id: string } | { mode: 'after'; id: string } | { mode: 'end' } | { mode: 'section'; id: string }

function moveSpecOf(args: Record<string, unknown>): MoveSpec {
  const given = [
    typeof args.before === 'string' && args.before !== '' ? 1 : 0,
    typeof args.after === 'string' && args.after !== '' ? 1 : 0,
    args.to_end === true ? 1 : 0,
    typeof args.section_id === 'string' && args.section_id !== '' ? 1 : 0,
  ].reduce((sum: number, n) => sum + n, 0)
  if (given !== 1) throw new Error('before, after, to_end, section_id 중 정확히 하나를 주세요.')
  if (typeof args.before === 'string' && args.before !== '') return { mode: 'before', id: args.before }
  if (typeof args.after === 'string' && args.after !== '') return { mode: 'after', id: args.after }
  if (typeof args.section_id === 'string' && args.section_id !== '') return { mode: 'section', id: args.section_id }
  return { mode: 'end' }
}

/** ids 를 주어진 차례로 한 자리에 모은다 */
function moveBlocks(note: MemoNote, ids: readonly string[], spec: MoveSpec): MemoNote {
  const known = new Set(note.blocks.map((block) => block.id))
  for (const id of ids) if (!known.has(id)) throw new Error(`없는 블록입니다(block not found): ${id}. note_read 로 블록 id 를 확인하세요.`)
  if ((spec.mode === 'before' || spec.mode === 'after' || spec.mode === 'section') && !known.has(spec.id)) throw new Error(`기준 블록을 찾지 못했습니다(block not found): ${spec.id}`)
  if ((spec.mode === 'before' || spec.mode === 'after') && ids.includes(spec.id)) throw new Error('기준 블록이 옮길 블록에 들어 있습니다.')
  if (spec.mode === 'section' && sectionRange(note, spec.id) === null) throw new Error(`section_id 가 소제목이 아닙니다(not a section): ${spec.id}`)
  let next = note
  let last = spec.mode === 'after' ? spec.id : ''
  for (const id of ids) {
    if (spec.mode === 'before') {
      next = moveBlockBefore(next, id, spec.id)
    } else if (spec.mode === 'end') {
      next = moveBlockBefore(next, id, null)
    } else if (spec.mode === 'section') {
      if (next.blocks.find((block) => block.id === id)?.kind === 'section') throw new Error('소제목은 다른 소제목 안으로 옮길 수 없습니다.')
      const range = sectionRange(next, spec.id)!
      next = moveBlockBefore(next, id, next.blocks[range[1]]?.id ?? null)
    } else {
      const at = next.blocks.findIndex((block) => block.id === last)
      const following = next.blocks[at + 1]
      if (following?.id !== id) next = moveBlockBefore(next, id, following?.id ?? null)
      const moved = next.blocks.findIndex((block) => block.id === id)
      const range = next.blocks[moved]?.kind === 'section' ? sectionRange(next, id) : null
      last = range === null ? id : next.blocks[range[1] - 1]!.id
    }
  }
  return next
}

const noteMoveBlocks = async (args: Record<string, unknown>, ctx: OpContext) => {
  const title = requireTitle(args)
  if (!Array.isArray(args.ids) || args.ids.length === 0) throw new Error('ids 배열이 필요합니다.')
  const ids = (args.ids as unknown[]).filter((id): id is string => typeof id === 'string')
  const spec = moveSpecOf(args)
  const { ref } = await ctx.notes.edit(title, (note) => moveBlocks(note, ids, spec), {})
  ctx.change.target = ref.title
  ctx.change.count += ids.length
  ctx.change.summary = t('「{title}」 노트의 블록 {count}개 옮김', { title: ref.title, count: ids.length })
  return { moved: ids }
}

const noteRename = async (args: Record<string, unknown>, ctx: OpContext) => {
  const title = requireTitle(args)
  const newTitle = typeof args.new_title === 'string' ? cleanTitle(args.new_title) : ''
  if (newTitle === '') throw new Error('new_title 이 필요합니다.')
  const current = ctx.notes.require(title)
  const clash = ctx.notes.find(newTitle)
  if (clash !== null && clash.path !== current.path) throw new Error(`이미 있는 노트 제목입니다(already exists): ${clash.title}`)
  const renamed = await ctx.notes.rename(title, newTitle)
  ctx.change.target = renamed.title
  ctx.change.count += 1
  ctx.change.summary = t('노트 이름을 「{title}」(으)로 바꿈', { title: renamed.title })
  return { title: current.title, new_title: renamed.title }
}

const noteDeleteBlocks = async (args: Record<string, unknown>, ctx: OpContext) => {
  const title = requireTitle(args)
  if (!Array.isArray(args.ids)) throw new Error('ids 배열이 필요합니다.')
  const ids = (args.ids as unknown[]).filter((id): id is string => typeof id === 'string')
  const removed: string[] = []
  const { ref } = await ctx.notes.edit(title, (note) => {
    let next = note
    for (const id of ids) {
      if (!next.blocks.some((block) => block.id === id)) continue
      next = removeBlock(next, id)
      removed.push(id)
    }
    return next
  }, {})
  ctx.change.target = ref.title
  ctx.change.count += removed.length
  ctx.change.summary = t('「{title}」 노트에서 블록 {count}개 뺌', { title: ref.title, count: removed.length })
  return { deleted: removed }
}

const noteDelete = async (args: Record<string, unknown>, ctx: OpContext) => {
  const title = requireTitle(args)
  const found = await ctx.notes.trash(title)
  ctx.change.target = found.title
  ctx.change.count += 1
  ctx.change.summary = t('노트 「{title}」 휴지통으로', { title: found.title })
  return { deleted: found.title, path: found.path, note: 'Moved to the Vault trash (restorable); ai_undo brings it back. The PDF memos in it stay.' }
}

const noteExportMarkdown = async (args: Record<string, unknown>, ctx: OpContext) => {
  const title = requireTitle(args)
  const ref = ctx.notes.require(title)
  if (args.to === 'file') {
    const exporter = ctx.deps.app?.exportNoteMarkdownFile
    if (exporter === undefined) throw new Error('이 앱에서는 파일로 내보낼 수 없습니다.')
    const path = await exporter(ref.path)
    ctx.change.target = ref.title
    ctx.change.count += 1
    ctx.change.summary = t('「{title}」 노트를 Markdown 파일로 내보냄', { title: ref.title })
    return { path }
  }
  const byId = new Map(currentHighlights(ctx.deps).map((highlight) => [highlight.id, highlight]))
  const docs = new Map((ctx.deps.app?.docs ?? []).map((doc) => [doc.docId, doc.title]))
  const blocks = buildMarkdownBlocks(ref.note, {
    highlights: byId,
    docTitle: (docId) => docs.get(docId) ?? 'PDF',
    link: () => undefined,
    translation: () => undefined,
    image: () => undefined,
  })
  const now = new Date()
  const exportedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return { title: ref.title, markdown: renderNoteMarkdown({ title: ref.title, blocks, exportedAt }) }
}

export const noteOps: Record<string, OpDef> = {
  note_list: op('read', noteList),
  note_read: op('read', noteRead),
  note_create: op('write', noteCreate),
  note_append: op('write', noteAppend),
  note_build: op('write', noteBuild),
  note_update_block: op('write', noteUpdateBlock),
  note_move_blocks: op('write', noteMoveBlocks),
  note_rename: op('write', noteRename),
  note_delete_blocks: op('write', noteDeleteBlocks),
  note_delete: op('destructive', noteDelete),
  note_export_markdown: op('read', noteExportMarkdown),
}

export { memoHighlightIds }
