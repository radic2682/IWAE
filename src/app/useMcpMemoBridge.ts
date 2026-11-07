import { useEffect, useRef } from 'react'
import { pageTextIndex, type PdfDocMeta } from '../bridge/pdf'
import { isDesktop } from '../bridge/window'
import { buildAnchor } from '../core/anchor'
import { findTextRange, findTextRegion } from '../core/canvasOps'
import { createRegionExcerptSelection } from '../core/pdfExcerpt'
import { insertBlock, memoBlock, removeBlock, sectionBlock, setMemoTicket, textBlock, updateSection, updateTextBlock, ticketLabel, type MemoNote, type MemoNoteBlock } from '../core/memoNote'
import { markdownToMemoHtml, sanitizeMemoHtml } from '../pdf/memoRichText'
import { isValidSourceTarget, normalizeSourceTarget, type DocSource } from '../core/docSources'
import {
  createPersistentPdfHighlight,
  updatePersistentPdfHighlight,
  type PdfHighlightColor,
  type PersistentPdfHighlight,
  type PersistentPdfHighlightPatch,
} from '../pdf/persistentHighlight'

/** MCP memo_* 요청 하나 */
interface WebviewRequest {
  readonly requestId: string
  readonly op: string
  readonly args?: Record<string, unknown>
}

export interface McpMemoBridgeDeps {
  readonly highlights: readonly PersistentPdfHighlight[]
  readonly add: (highlight: PersistentPdfHighlight) => void
  readonly update: (id: string, patch: PersistentPdfHighlightPatch) => void
  readonly remove: (id: string) => void
  readonly loadPdfById: (docId: string) => Promise<{ meta: PdfDocMeta; title: string }>
  /** topic(=노트 제목)이 있으면 그 노트 끝에 메모를 붙인다(노트가 없으면 만든다) */
  readonly addToNote?: (title: string, highlightId: string) => void
  /** MCP note_*: 앱이 가진 노트를 읽고 고친다(켜져 있어도 .iwnote 를 밖에서 고치지 않게) */
  readonly notes?: {
    readonly list: () => { path: string; title: string; blocks: number }[]
    readonly find: (title: string) => { path: string; note: MemoNote } | null
    readonly edit: (title: string, change: (note: MemoNote) => MemoNote, create: boolean) => string
    /** 노트를 통째로 휴지통으로 */
    readonly trash: (path: string) => Promise<void>
  }
  /** MCP source_*: 문서 원본 출처 */
  readonly docSources?: {
    readonly all: () => Readonly<Record<string, readonly DocSource[]>>
    readonly add: (docId: string, input: { label?: string; target: string; note?: string }) => boolean
    readonly update: (docId: string, sourceId: string, patch: { label?: string; target?: string; note?: string }) => void
    readonly remove: (docId: string, sourceId: string) => void
  }
}

interface MemoInput {
  readonly doc_id?: unknown
  readonly page?: unknown
  readonly kind?: unknown
  readonly from_text?: unknown
  readonly to_text?: unknown
  readonly rect?: unknown
  readonly full_width?: unknown
  readonly padding?: unknown
  readonly note?: unknown
  readonly note_html?: unknown
  readonly topic?: unknown
  readonly color?: unknown
}

const COLORS: readonly PdfHighlightColor[] = ['yellow', 'green', 'blue', 'pink']

function summary(highlight: PersistentPdfHighlight) {
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

/** 메모 하나를 형광펜으로 만든다: 글이면 그 글자 범위, 표·그림이면 그 네모 */
async function createMemo(input: MemoInput, deps: McpMemoBridgeDeps): Promise<PersistentPdfHighlight> {
  if (typeof input.doc_id !== 'string' || typeof input.page !== 'number') throw new Error('doc_id 와 page(1부터)가 필요합니다.')
  if (typeof input.note !== 'string' || input.note.trim() === '') throw new Error('note(메모 내용)가 필요합니다.')
  const { meta } = await deps.loadPdfById(input.doc_id)
  const page = Math.floor(input.page) - 1
  if (page < 0 || page >= meta.pageCount) throw new Error(`쪽 번호가 범위를 벗어났습니다(1–${meta.pageCount}).`)
  const pageSize = meta.pageSizes[page]
  if (pageSize === undefined) throw new Error('쪽 크기를 알 수 없습니다.')
  const index = await pageTextIndex(meta.docId, page)
  const color = COLORS.includes(input.color as PdfHighlightColor) ? input.color as PdfHighlightColor : 'yellow'
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
    if (rect === undefined) throw new Error('표·그림(region) 메모에는 rect 또는 from_text 가 필요합니다.')
    const selection = createRegionExcerptSelection({ docId: meta.docId, page, rect, index, pageSize })
    highlight = createPersistentPdfHighlight(selection.anchor, color, { ...extras, kind: 'region', pageSize })
  } else {
    if (typeof input.from_text !== 'string') throw new Error('글 메모에는 from_text(칠할 글의 처음)가 필요합니다.')
    const [start, end] = findTextRange(index, input.from_text, typeof input.to_text === 'string' ? input.to_text : undefined)
    highlight = createPersistentPdfHighlight(buildAnchor(meta.docId, page, index, start, end), color, extras)
  }
  return updatePersistentPdfHighlight(highlight, {
    note: input.note,
    ...(typeof input.note_html === 'string' && input.note_html.trim() !== '' ? { noteHtml: sanitizeMemoHtml(input.note_html) } : {}),
    ...(typeof input.topic === 'string' ? { topic: input.topic } : {}),
  })
}

function requireNotes(deps: McpMemoBridgeDeps): NonNullable<McpMemoBridgeDeps['notes']> {
  if (deps.notes === undefined) throw new Error('노트를 다룰 수 없습니다(Vault 가 열려 있지 않습니다).')
  return deps.notes
}

function requireSources(deps: McpMemoBridgeDeps): NonNullable<McpMemoBridgeDeps['docSources']> {
  if (deps.docSources === undefined) throw new Error('문서 출처를 다룰 수 없습니다(Vault 가 열려 있지 않습니다).')
  return deps.docSources
}

function requireTitle(args: Record<string, unknown>): string {
  const title = typeof args.title === 'string' ? args.title : typeof args.topic === 'string' ? args.topic : ''
  if (title.trim() === '') throw new Error('title(노트 제목)이 필요합니다.')
  return title.replace(/^#/u, '').trim()
}

/** 글 블록 내용: markdown(또는 text) → 서식 HTML, html 이 오면 그것을 거른다. 평문은 서식 HTML 의 글자만 */
function textContent(input: Record<string, unknown>): { text: string; html: string } {
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

function blockFromInput(input: Record<string, unknown>, index: number, deps: McpMemoBridgeDeps): MemoNoteBlock {
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
    if (!deps.highlights.some((highlight) => highlight.id === id)) throw new Error(`blocks[${index}]: 없는 메모입니다: ${id}`)
    if (kind === 'memo') return memoBlock(id)
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    if (title === '') throw new Error(`blocks[${index}]: 티켓에는 title 이 필요합니다.`)
    return memoBlock(id, { title })
  }
  if (kind !== 'text') throw new Error(`blocks[${index}]: kind 는 section, text, memo, ticket 중 하나입니다.`)
  const { text, html } = textContent(input)
  return textBlock(text, html)
}

function describeBlock(block: MemoNoteBlock, deps: McpMemoBridgeDeps): Record<string, unknown> {
  if (block.kind === 'section') return { id: block.id, kind: 'section', title: block.title }
  if (block.kind === 'text') return { id: block.id, kind: 'text', text: block.text, ...(block.html === undefined ? {} : { html: block.html }) }
  const highlight = deps.highlights.find((item) => item.id === block.highlightId)
  return highlight === undefined
    ? { id: block.id, kind: 'memo', highlight_id: block.highlightId, missing: true }
    : {
        ...summary(highlight),
        id: block.id,
        kind: block.ticket === undefined ? 'memo' : 'ticket',
        highlight_id: block.highlightId,
        memo_kind: highlight.kind === 'region' ? 'region' : 'text',
        ...(block.ticket === undefined ? {} : { ticket_title: ticketLabel(block.ticket), ...(block.ticket.id === undefined ? {} : { ticket_id: block.ticket.id }) }),
      }
}

export async function handleMcpMemoRequest(op: string, args: Record<string, unknown>, deps: McpMemoBridgeDeps): Promise<unknown> {
  switch (op) {
    case 'memo_list': {
      const docId = typeof args.doc_id === 'string' ? args.doc_id : undefined
      const topic = typeof args.topic === 'string' ? args.topic.replace(/^#/u, '').trim() : undefined
      // 메모 글이 없는 형광펜도 보인다(only_with_note 면 뺀다)
      const memos = deps.highlights
        .filter((highlight) => args.only_with_note !== true || (highlight.note ?? '').trim() !== '')
        .filter((highlight) => docId === undefined || highlight.anchor.docId === docId)
        .filter((highlight) => topic === undefined || highlight.topic === topic)
        .sort((a, b) => a.anchor.docId.localeCompare(b.anchor.docId) || a.anchor.page - b.anchor.page
          || Math.min(...a.anchor.rects.map((rect) => rect.y)) - Math.min(...b.anchor.rects.map((rect) => rect.y)))
      const topics = [...new Set(deps.highlights.filter((highlight) => docId === undefined || highlight.anchor.docId === docId)
        .flatMap((highlight) => highlight.topic === undefined ? [] : [highlight.topic]))].sort()
      return { memos: memos.map(summary), topics }
    }
    case 'memo_add': {
      if (!Array.isArray(args.memos)) throw new Error('memos 배열이 필요합니다.')
      const created: ReturnType<typeof summary>[] = []
      const skipped: { index: number; reason: string }[] = []
      for (const [index, input] of (args.memos as MemoInput[]).entries()) {
        try {
          const highlight = await createMemo(input, deps)
          if (deps.highlights.some(({ id }) => id === highlight.id) || created.some(({ id }) => id === highlight.id)) {
            // 같은 자리에 이미 형광펜이 있으면 메모·카테고리만 고친다
            deps.update(highlight.id, { note: highlight.note, ...(highlight.topic === undefined ? {} : { topic: highlight.topic }), color: highlight.color })
          } else {
            deps.add(highlight)
          }
          if (highlight.topic !== undefined) deps.addToNote?.(highlight.topic, highlight.id)
          created.push(summary(highlight))
        } catch (cause) {
          skipped.push({ index, reason: cause instanceof Error ? cause.message : String(cause) })
        }
      }
      return { created, ...(skipped.length > 0 ? { skipped } : {}) }
    }
    case 'memo_update': {
      if (!Array.isArray(args.updates)) throw new Error('updates 배열이 필요합니다.')
      const updated: string[] = []
      for (const item of args.updates as Record<string, unknown>[]) {
        if (typeof item.id !== 'string' || !deps.highlights.some(({ id }) => id === item.id)) throw new Error(`없는 메모입니다: ${String(item.id)}`)
        deps.update(item.id, {
          // note:"" 은 메모 글을 지운다(서식도 함께). note_html 이 오면 그 서식을 쓴다
          ...(typeof item.note === 'string' ? { note: item.note, noteHtml: typeof item.note_html === 'string' ? sanitizeMemoHtml(item.note_html) : '' } : {}),
          ...(typeof item.topic === 'string' ? { topic: item.topic } : {}),
          ...(COLORS.includes(item.color as PdfHighlightColor) ? { color: item.color as PdfHighlightColor } : {}),
        })
        updated.push(item.id)
      }
      return { updated }
    }
    case 'memo_delete': {
      if (!Array.isArray(args.ids)) throw new Error('ids 배열이 필요합니다.')
      const deleted = (args.ids as unknown[]).filter((id): id is string => typeof id === 'string' && deps.highlights.some((highlight) => highlight.id === id))
      for (const id of deleted) deps.remove(id)
      return { deleted }
    }
    case 'source_list': {
      const store = requireSources(deps)
      const docId = typeof args.doc_id === 'string' ? args.doc_id : undefined
      const entries = Object.entries(store.all()).filter(([id]) => docId === undefined || id === docId)
      return { documents: entries.map(([id, list]) => ({ doc_id: id, sources: list })) }
    }
    case 'source_add': {
      const store = requireSources(deps)
      if (typeof args.doc_id !== 'string') throw new Error('doc_id 가 필요합니다.')
      if (!Array.isArray(args.sources) || args.sources.length === 0) throw new Error('sources 배열이 필요합니다.')
      const added: string[] = []
      const skipped: { target: string; reason: string }[] = []
      for (const input of args.sources as Record<string, unknown>[]) {
        const target = typeof input.target === 'string' ? normalizeSourceTarget(input.target) : ''
        if (!isValidSourceTarget(target)) { skipped.push({ target, reason: '주소(https://…)나 경로가 올바르지 않습니다.' }); continue }
        const ok = store.add(args.doc_id, { target, label: typeof input.label === 'string' ? input.label : '', note: typeof input.note === 'string' ? input.note : '' })
        if (ok) added.push(target)
        else skipped.push({ target, reason: '이미 있습니다.' })
      }
      return { added, ...(skipped.length > 0 ? { skipped } : {}) }
    }
    case 'source_update': {
      const store = requireSources(deps)
      if (typeof args.doc_id !== 'string' || typeof args.id !== 'string') throw new Error('doc_id 와 id 가 필요합니다.')
      if (!(store.all()[args.doc_id] ?? []).some((item) => item.id === args.id)) throw new Error(`없는 출처입니다: ${args.id}`)
      const target = typeof args.target === 'string' ? normalizeSourceTarget(args.target) : undefined
      if (target !== undefined && !isValidSourceTarget(target)) throw new Error('target 이 올바르지 않습니다.')
      store.update(args.doc_id, args.id, {
        ...(target === undefined ? {} : { target }),
        ...(typeof args.label === 'string' ? { label: args.label } : {}),
        ...(typeof args.note === 'string' ? { note: args.note } : {}),
      })
      return { updated: args.id }
    }
    case 'source_remove': {
      const store = requireSources(deps)
      if (typeof args.doc_id !== 'string' || !Array.isArray(args.ids)) throw new Error('doc_id 와 ids 배열이 필요합니다.')
      const have = new Set((store.all()[args.doc_id] ?? []).map((item) => item.id))
      const removed = (args.ids as unknown[]).filter((id): id is string => typeof id === 'string' && have.has(id))
      for (const id of removed) store.remove(args.doc_id, id)
      return { removed }
    }
    case 'note_list':
      return { notes: requireNotes(deps).list() }
    case 'note_read': {
      const title = requireTitle(args)
      const found = requireNotes(deps).find(title)
      if (found === null) throw new Error(`「${title}」 노트가 없습니다. note_list 로 제목을 확인하세요.`)
      return { title, path: found.path, blocks: found.note.blocks.map((block) => describeBlock(block, deps)) }
    }
    case 'note_append': {
      const title = requireTitle(args)
      if (!Array.isArray(args.blocks) || args.blocks.length === 0) throw new Error('blocks 배열이 필요합니다.')
      const made = (args.blocks as Record<string, unknown>[]).map((input, index) => blockFromInput(input, index, deps))
      const after = typeof args.after === 'string' ? args.after : null
      const path = requireNotes(deps).edit(title, (note) => {
        let at = after === null ? note.blocks.length : note.blocks.findIndex((block) => block.id === after) + 1
        if (after !== null && at === 0) throw new Error(`after 블록을 찾지 못했습니다: ${after}`)
        let next = note
        for (const block of made) {
          const before = next
          next = insertBlock(next, block, at)
          if (next !== before) at += 1
        }
        return next
      }, true)
      return { title, path, added: made.map((block) => ({ id: block.id, kind: block.kind === 'memo' && block.ticket !== undefined ? 'ticket' : block.kind })) }
    }
    case 'note_update_block': {
      const title = requireTitle(args)
      if (typeof args.id !== 'string') throw new Error('id(블록)가 필요합니다.')
      const id = args.id
      requireNotes(deps).edit(title, (note) => {
        const block = note.blocks.find((item) => item.id === id)
        if (block === undefined) throw new Error(`없는 블록입니다: ${id}`)
        if (block.kind === 'section') {
          if (typeof args.section_title !== 'string') throw new Error('소제목은 section_title 로 바꿉니다.')
          return updateSection(note, id, { title: args.section_title })
        }
        if (block.kind === 'text') {
          const { text, html } = textContent(args)
          return updateTextBlock(note, id, text, html)
        }
        if (typeof args.ticket_title === 'string' || typeof args.ticket_id === 'string') {
          // ticket_title 만 오면 예전처럼 「REQ-01 제목」 한 줄로 보고 앞의 ID 를 뗀다. ticket_id 만 오면 제목은 그대로
          const keepTitle = typeof args.ticket_title !== 'string' ? block.ticket?.title : undefined
          return setMemoTicket(note, id, {
            ...(typeof args.ticket_id === 'string' ? { id: args.ticket_id } : {}),
            ...(typeof args.ticket_title === 'string' ? { title: args.ticket_title } : keepTitle === undefined ? {} : { title: keepTitle }),
          })
        }
        throw new Error('메모·티켓 블록의 글은 memo_update 로 고칩니다(ID 는 ticket_id, 제목은 ticket_title. 둘 다 비우면 그냥 메모).')
      }, false)
      return { updated: id }
    }
    case 'note_delete': {
      const title = requireTitle(args)
      const notes = requireNotes(deps)
      const found = notes.find(title)
      if (found === null) throw new Error(`「${title}」 노트가 없습니다. note_list 로 제목을 확인하세요.`)
      await notes.trash(found.path)
      return { deleted: title, path: found.path, note: 'Vault 휴지통으로 옮겼습니다(되살릴 수 있습니다). 안의 PDF 메모는 그대로입니다.' }
    }
    case 'note_delete_blocks': {
      const title = requireTitle(args)
      if (!Array.isArray(args.ids)) throw new Error('ids 배열이 필요합니다.')
      const ids = (args.ids as unknown[]).filter((id): id is string => typeof id === 'string')
      const removed: string[] = []
      requireNotes(deps).edit(title, (note) => {
        let next = note
        for (const id of ids) {
          if (!next.blocks.some((block) => block.id === id)) continue
          next = removeBlock(next, id)
          removed.push(id)
        }
        return next
      }, false)
      return { deleted: removed }
    }
    default:
      throw new Error(`모르는 요청입니다: ${op}`)
  }
}

/** MCP memo_* 도구: PDF 의 형광펜 메모를 읽고 만들고 고친다. 데스크톱 앱에서만 돈다 */
export function useMcpMemoBridge(deps: McpMemoBridgeDeps): void {
  const depsRef = useRef(deps)
  depsRef.current = deps

  useEffect(() => {
    if (!isDesktop()) return
    let alive = true
    let unlisten: (() => void) | null = null
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event')
      const { invoke } = await import('@tauri-apps/api/core')
      const stop = await listen<WebviewRequest>('mcp-webview-request', (event) => {
        const { requestId, op, args } = event.payload
        if (!op.startsWith('memo_') && !op.startsWith('note_') && !op.startsWith('source_')) return
        void handleMcpMemoRequest(op, args ?? {}, depsRef.current)
          .then((result) => invoke('mcp_webview_reply', { requestId, ok: true, result, error: null }))
          .catch((cause: unknown) => invoke('mcp_webview_reply', {
            requestId,
            ok: false,
            result: null,
            error: cause instanceof Error ? cause.message : String(cause),
          }))
      })
      if (alive) unlisten = stop
      else stop()
    })()
    return () => {
      alive = false
      unlisten?.()
    }
  }, [])
}
