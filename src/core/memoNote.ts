/**
 * 메모 노트. PDF 와 따로 열리는 노트 한 장에 블록을 차례로 쌓는다:
 * - memo: PDF 형광펜(+그 메모). 형광펜·메모 글·별점은 highlights.json 에 있고 노트는 id 로 가리킨다.
 *   여러 PDF 의 형광펜이 한 노트에 섞일 수 있다.
 * - text: 노트에 직접 쓴 글(서식 HTML + 같은 내용의 글)
 * - memo 블록의 ticket: 사용자가 자유롭게 붙이는 ID(REQ-01, TODO, Q1 …)와 제목. 둘 다 없으면 그냥 메모.
 *   차례는 늘 ID·제목 → 내 글 → 원문(출처).
 * - memo 블록의 refs: 한 메모가 가리키는 원문을 더 둘 때 그 형광펜 id 들(첫 원문은 highlightId)
 *   kind 는 memo 그대로라 형광펜 연결·지우기가 메모와 같고, 티켓을 모르는 판도 메모로 읽는다.
 *
 * 파일은 Vault 의 「노트」 폴더에 `<제목>.iwnote`(JSON)로 둔다.
 */

import { t } from '../i18n'

export const MEMO_NOTES_FOLDER = '노트'
export const MEMO_NOTE_EXTENSION = '.iwnote'

export type MemoNoteBlock =
  | { readonly id: string; readonly kind: 'memo'; readonly highlightId: string; readonly ticket?: MemoTicket; readonly refs?: readonly string[] }
  | { readonly id: string; readonly kind: 'text'; readonly text: string; readonly html?: string }
  /** 소제목(구역): 다음 소제목 앞까지의 블록을 묶는다. 접으면 묶인 블록을 숨기고, 옮기면 함께 옮긴다 */
  | { readonly id: string; readonly kind: 'section'; readonly title: string; readonly collapsed?: true }

/** 메모 블록의 머리: 자유 ID 와 제목(둘 중 하나만 있어도 된다) */
export interface MemoTicket {
  readonly id?: string
  readonly title?: string
}

/** 글 맨 앞의 ID 모양: 글자로 시작하고 「-숫자」로 끝나는 한 낱말(REQ-01, BUG-2, Q-1) */
const LEADING_TICKET_ID = /^([A-Za-z][A-Za-z0-9]*-\d+)[ \u00a0]+/u
const WHOLE_TICKET_ID = /^[A-Za-z][A-Za-z0-9]*-\d+$/u

/**
 * ID·제목을 다듬는다. 둘 다 비면 null(그냥 메모).
 * 예전 파일은 제목 하나에 「REQ-01 노트는 …」처럼 ID 가 붙어 있었다 — 앞의 ID 를 떼어 id 로 옮긴다.
 */
export function normalizeTicket(ticket: MemoTicket | null | undefined): MemoTicket | null {
  if (ticket === null || ticket === undefined) return null
  let id = (ticket.id ?? '').trim()
  let title = (ticket.title ?? '').replace(/\s+/gu, ' ').trim()
  if (id === '' && title !== '') {
    if (WHOLE_TICKET_ID.test(title)) {
      id = title
      title = ''
    } else {
      const leading = LEADING_TICKET_ID.exec(title)
      if (leading !== null) {
        id = leading[1] ?? ''
        title = title.slice(leading[0].length).trim()
      }
    }
  }
  if (id === '' && title === '') return null
  return { ...(id === '' ? {} : { id }), ...(title === '' ? {} : { title }) }
}

/** ID 와 제목을 한 줄로(검색·바깥 도구용) */
export function ticketLabel(ticket: MemoTicket | null | undefined): string {
  return [ticket?.id ?? '', ticket?.title ?? ''].filter((part) => part !== '').join(' ')
}

/** 글 맨 앞에 ID 모양이 있으면 그 ID 와 나머지 글. 없으면 null */
export function splitLeadingTicketId(text: string): { readonly id: string; readonly rest: string } | null {
  const leading = LEADING_TICKET_ID.exec(text.replace(/^\s+/u, ''))
  if (leading === null) return null
  return { id: leading[1] ?? '', rest: text.replace(/^\s+/u, '').slice(leading[0].length) }
}

/**
 * 다음에 쓸 ID 제안: 이 노트에서 쓴 앞부분(REQ, BUG …)마다 가장 큰 번호 + 1.
 * 자릿수는 쓰던 대로(REQ-03 다음은 REQ-04). 많이 쓴 앞부분이 먼저.
 */
export function suggestTicketIds(used: readonly string[]): string[] {
  const groups = new Map<string, { count: number; max: number; width: number; label: string }>()
  for (const id of used) {
    const match = /^(.*?)(\d+)$/u.exec(id.trim())
    if (match === null) continue
    const prefix = match[1] ?? ''
    const digits = match[2] ?? ''
    const key = prefix.toLowerCase()
    const group = groups.get(key) ?? { count: 0, max: 0, width: 0, label: prefix }
    group.count += 1
    group.max = Math.max(group.max, Number(digits))
    group.width = Math.max(group.width, digits.length)
    groups.set(key, group)
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .map((group) => `${group.label}${String(group.max + 1).padStart(group.width, '0')}`)
}

export interface MemoNote {
  readonly version: 1
  readonly blocks: readonly MemoNoteBlock[]
  /** 이 노트를 가진 PDF 의 문서 id(형광펜이 쓰는 id). 없으면 어느 PDF 에도 속하지 않은 일반 노트 */
  readonly docId?: string
}

/** 노트 목록에 보일 것: Vault 안 상대 경로(=열쇠)와 제목. docId 는 노트가 속한 PDF */
export interface MemoNoteEntry {
  readonly path: string
  readonly title: string
  readonly docId?: string
}

/**
 * 노트를 PDF 별로 나눈다. owner(docId) 가 줄 열쇠(문서 id, 버전 묶음이면 대표 문서 id)를 돌려주면 그 PDF 의 노트,
 * null 이면(PDF 가 지워졌거나 모르는 문서) 노트가 사라지지 않게 일반 노트로 둔다. 차례는 받은 차례 그대로.
 */
export function groupMemoNotesByDoc<T extends MemoNoteEntry>(
  entries: readonly T[],
  owner: ((docId: string) => string | null) | undefined,
): { readonly byDoc: ReadonlyMap<string, readonly T[]>; readonly general: readonly T[] } {
  const byDoc = new Map<string, T[]>()
  const general: T[] = []
  for (const entry of entries) {
    const key = entry.docId === undefined || owner === undefined ? null : owner(entry.docId)
    if (key === null) general.push(entry)
    else byDoc.set(key, [...(byDoc.get(key) ?? []), entry])
  }
  return { byDoc, general }
}

export const EMPTY_MEMO_NOTE: MemoNote = { version: 1, blocks: [] }

/**
 * 사람이 정한 차례(경로 목록)대로 노트를 놓는다. 차례에 없는 노트(새로 만든 것 등)는
 * 받은 차례(이름순) 그대로 뒤에 붙고, 이제 없는 경로는 건너뛴다.
 */
export function orderMemoNoteEntries<T extends MemoNoteEntry>(entries: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((path, index) => [path, index]))
  const ranked = entries.filter((entry) => rank.has(entry.path)).sort((a, b) => (rank.get(a.path) ?? 0) - (rank.get(b.path) ?? 0))
  return [...ranked, ...entries.filter((entry) => !rank.has(entry.path))]
}

/** `from` 자리의 노트를 `to` 자리(옮기기 전 목록 기준, 그 앞)로 옮긴 경로 차례 */
export function moveMemoNote(paths: readonly string[], from: number, to: number): string[] {
  const next = [...paths]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return next
  next.splice(to > from ? to - 1 : to, 0, moved)
  return next
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseMemoNote(value: unknown): MemoNote {
  if (!isRecord(value) || !Array.isArray(value.blocks)) return EMPTY_MEMO_NOTE
  const seen = new Set<string>()
  const blocks = value.blocks.flatMap((item: unknown): MemoNoteBlock[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || seen.has(item.id)) return []
    seen.add(item.id)
    if (item.kind === 'memo' && typeof item.highlightId === 'string') {
      const parsed = isRecord(item.ticket)
        ? normalizeTicket({
          ...(typeof item.ticket.id === 'string' ? { id: item.ticket.id } : {}),
          ...(typeof item.ticket.title === 'string' ? { title: item.ticket.title } : {}),
        })
        : null
      const ticket = parsed === null ? {} : { ticket: parsed }
      const refs = Array.isArray(item.refs) ? [...new Set(item.refs.filter((ref): ref is string => typeof ref === 'string' && ref !== item.highlightId))] : []
      return [{ id: item.id, kind: 'memo', highlightId: item.highlightId, ...ticket, ...(refs.length > 0 ? { refs } : {}) }]
    }
    if (item.kind === 'section' && typeof item.title === 'string') {
      return [{ id: item.id, kind: 'section', title: item.title, ...(item.collapsed === true ? { collapsed: true as const } : {}) }]
    }
    if (item.kind === 'text' && typeof item.text === 'string') {
      return [{ id: item.id, kind: 'text', text: item.text, ...(typeof item.html === 'string' && item.html !== '' ? { html: item.html } : {}) }]
    }
    return []
  })
  const docId = typeof value.docId === 'string' && value.docId.trim() !== '' ? value.docId : undefined
  return { version: 1, blocks, ...(docId === undefined ? {} : { docId }) }
}

export function serializeMemoNote(note: MemoNote): string {
  return `${JSON.stringify({ version: 1, ...(note.docId === undefined ? {} : { docId: note.docId }), blocks: note.blocks }, null, 2)}\n`
}

let blockCounter = 0
export function newBlockId(): string {
  blockCounter += 1
  return `b${Date.now().toString(36)}${blockCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function memoBlock(highlightId: string, ticket?: MemoTicket): MemoNoteBlock {
  const normalized = normalizeTicket(ticket)
  return { id: newBlockId(), kind: 'memo', highlightId, ...(normalized === null ? {} : { ticket: normalized }) }
}

/** 메모 블록의 ID·제목을 바꾼다. 둘 다 비거나 null 이면 그냥 메모로 */
export function setMemoTicket(note: MemoNote, blockId: string, ticket: MemoTicket | null): MemoNote {
  const normalized = normalizeTicket(ticket)
  return {
    ...note,
    blocks: note.blocks.map((block) => {
      if (block.id !== blockId || block.kind !== 'memo') return block
      const { ticket: _old, ...rest } = block
      return normalized === null ? rest : { ...rest, ticket: normalized }
    }),
  }
}

/** 메모 블록이 가리키는 형광펜 모두(첫 원문 + 더한 원문) */
export function memoHighlightIds(block: MemoNoteBlock): readonly string[] {
  return block.kind === 'memo' ? [block.highlightId, ...(block.refs ?? [])] : []
}

/** 메모 블록에 원문(형광펜)을 하나 더 단다. 이미 있으면 그대로 */
export function addMemoRef(note: MemoNote, blockId: string, highlightId: string): MemoNote {
  return {
    ...note,
    blocks: note.blocks.map((block) => {
      if (block.id !== blockId || block.kind !== 'memo' || memoHighlightIds(block).includes(highlightId)) return block
      return { ...block, refs: [...(block.refs ?? []), highlightId] }
    }),
  }
}

/** 더한 원문 하나를 뗀다(첫 원문은 떼지 않는다) */
export function removeMemoRef(note: MemoNote, blockId: string, highlightId: string): MemoNote {
  return {
    ...note,
    blocks: note.blocks.map((block) => {
      if (block.id !== blockId || block.kind !== 'memo' || !(block.refs ?? []).includes(highlightId)) return block
      const refs = (block.refs ?? []).filter((ref) => ref !== highlightId)
      const { refs: _old, ...rest } = block
      return refs.length > 0 ? { ...rest, refs } : rest
    }),
  }
}

export function sectionBlock(title = t('새 소제목')): MemoNoteBlock {
  return { id: newBlockId(), kind: 'section', title }
}

/** 소제목이 묶는 블록의 범위 [소제목 자리, 다음 소제목 자리) */
export function sectionRange(note: MemoNote, sectionId: string): readonly [number, number] | null {
  const start = note.blocks.findIndex((block) => block.id === sectionId && block.kind === 'section')
  if (start < 0) return null
  const next = note.blocks.findIndex((block, index) => index > start && block.kind === 'section')
  return [start, next < 0 ? note.blocks.length : next]
}

export function updateSection(note: MemoNote, sectionId: string, change: { readonly title?: string; readonly collapsed?: boolean }): MemoNote {
  return {
    ...note,
    blocks: note.blocks.map((block) => {
      if (block.id !== sectionId || block.kind !== 'section') return block
      const title = change.title === undefined ? block.title : change.title.trim() || block.title
      const collapsed = change.collapsed === undefined ? block.collapsed === true : change.collapsed
      return { id: block.id, kind: 'section', title, ...(collapsed ? { collapsed: true as const } : {}) }
    }),
  }
}

export function textBlock(text = '', html?: string): MemoNoteBlock {
  return { id: newBlockId(), kind: 'text', text, ...(html === undefined || html === '' ? {} : { html }) }
}

/** index 자리에 끼운다(범위 밖이면 끝). 같은 형광펜이 이미 있으면 그대로 */
export function insertBlock(note: MemoNote, block: MemoNoteBlock, index: number): MemoNote {
  if (block.kind === 'memo' && note.blocks.some((item) => item.kind === 'memo' && item.highlightId === block.highlightId)) return note
  const at = Math.min(Math.max(Math.trunc(index), 0), note.blocks.length)
  return { ...note, blocks: [...note.blocks.slice(0, at), block, ...note.blocks.slice(at)] }
}

/** from 의 블록을 to 자리(빼기 전 기준, 그 앞에 끼운다)로 옮긴다 */
export function moveBlock(note: MemoNote, blockId: string, beforeIndex: number): MemoNote {
  const from = note.blocks.findIndex((block) => block.id === blockId)
  if (from < 0) return note
  const to = beforeIndex > from ? beforeIndex - 1 : beforeIndex
  if (to === from) return note
  const blocks = [...note.blocks]
  const [moved] = blocks.splice(from, 1)
  blocks.splice(Math.min(Math.max(to, 0), blocks.length), 0, moved!)
  return { ...note, blocks }
}

/**
 * blockId 블록을 beforeId 블록 앞으로(null 이면 맨 끝). 소제목이면 묶인 블록까지 함께 옮긴다
 * (자기 묶음 안으로는 못 옮긴다)
 */
export function moveBlockBefore(note: MemoNote, blockId: string, beforeId: string | null): MemoNote {
  if (blockId === beforeId) return note
  const from = note.blocks.findIndex((block) => block.id === blockId)
  if (from < 0) return note
  const range = note.blocks[from]!.kind === 'section' ? sectionRange(note, blockId)! : [from, from + 1] as const
  const moving = note.blocks.slice(range[0], range[1])
  if (beforeId !== null && moving.some((block) => block.id === beforeId)) return note
  const rest = [...note.blocks.slice(0, range[0]), ...note.blocks.slice(range[1])]
  const at = beforeId === null ? rest.length : rest.findIndex((block) => block.id === beforeId)
  if (at < 0) return note
  return { ...note, blocks: [...rest.slice(0, at), ...moving, ...rest.slice(at)] }
}

export function removeBlock(note: MemoNote, blockId: string): MemoNote {
  return { ...note, blocks: note.blocks.filter((block) => block.id !== blockId) }
}

/** 지운 형광펜을 가리키는 블록을 뺀다 */
export function removeHighlightBlocks(note: MemoNote, highlightId: string): MemoNote {
  let changed = false
  const blocks = note.blocks.flatMap((block): MemoNoteBlock[] => {
    if (block.kind !== 'memo') return [block]
    if (block.highlightId === highlightId) {
      changed = true
      // 첫 원문이 지워지면 더한 원문 중 첫째가 그 자리를 잇는다(없으면 블록이 빠진다)
      const [next, ...rest] = block.refs ?? []
      if (next === undefined) return []
      const { refs: _old, ...base } = block
      return [{ ...base, highlightId: next, ...(rest.length > 0 ? { refs: rest } : {}) }]
    }
    if ((block.refs ?? []).includes(highlightId)) {
      changed = true
      const refs = (block.refs ?? []).filter((ref) => ref !== highlightId)
      const { refs: _old, ...base } = block
      return [refs.length > 0 ? { ...base, refs } : base]
    }
    return [block]
  })
  return changed ? { ...note, blocks } : note
}

export function updateTextBlock(note: MemoNote, blockId: string, text: string, html: string): MemoNote {
  return {
    ...note,
    blocks: note.blocks.map((block) => block.id === blockId && block.kind === 'text'
      ? { id: block.id, kind: 'text', text, ...(html === '' ? {} : { html }) }
      : block),
  }
}

/** 파일 이름으로 쓸 수 없는 글자를 바꾸고 다듬는다 */
export function safeNoteTitle(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 80)
  return cleaned === '' ? t('새 노트') : cleaned
}

/** 노트 파일 경로. folder 는 「노트」 또는 그 아래 하위 폴더(Vault 상대 경로) */
export function memoNotePath(title: string, folder: string = MEMO_NOTES_FOLDER): string {
  return `${folder}/${safeNoteTitle(title)}${MEMO_NOTE_EXTENSION}`
}

/** 노트(또는 폴더)가 든 폴더. 「노트/회의/A.iwnote」 → 「노트/회의」 */
export function memoParentOf(path: string): string {
  const parts = path.replaceAll('\\', '/').split('/')
  return parts.slice(0, -1).join('/')
}

/** path 가 folder 안(하위 폴더 포함)에 있는가 */
export function isInsideMemoFolder(path: string, folder: string): boolean {
  return path.startsWith(`${folder}/`)
}

/**
 * 폴더를 옮기거나 이름을 바꿀 때 바뀌는 경로들(폴더 자신, 안의 폴더·노트). 옛 경로 → 새 경로.
 */
export function movedMemoPaths(from: string, to: string, paths: readonly string[]): Map<string, string> {
  const moved = new Map<string, string>()
  for (const path of paths) {
    if (path === from) moved.set(path, to)
    else if (isInsideMemoFolder(path, from)) moved.set(path, `${to}${path.slice(from.length)}`)
  }
  return moved
}

export function memoNoteTitleOf(path: string): string {
  const name = path.replaceAll('\\', '/').split('/').at(-1) ?? path
  return name.endsWith(MEMO_NOTE_EXTENSION) ? name.slice(0, -MEMO_NOTE_EXTENSION.length) : name
}

/** 이미 있는 제목과 겹치지 않게: 「TODO」, 「TODO 2」… */
export function uniqueNoteTitle(title: string, taken: readonly string[]): string {
  const base = safeNoteTitle(title)
  const lower = new Set(taken.map((item) => item.toLowerCase()))
  if (!lower.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`
    if (!lower.has(candidate.toLowerCase())) return candidate
  }
}

/**
 * 예전 「카테고리」를 노트로: 카테고리마다 노트 하나(여러 PDF 의 메모가 함께), 카테고리 없는 메모는 PDF 이름 노트.
 * 메모 글이 있는 형광펜만 옮긴다. 노트 안 차례는 PDF 별로 모은 뒤 사용자가 정한 순서(없으면 문서 순서).
 */
export function notesFromCategories<T extends {
  readonly id: string
  readonly note?: string
  readonly topic?: string
  readonly order?: number
  readonly anchor: { readonly docId: string; readonly page: number; readonly rects: readonly { readonly y: number }[] }
}>(highlights: readonly T[], docTitle: (docId: string) => string): { title: string; note: MemoNote }[] {
  const groups = new Map<string, T[]>()
  for (const highlight of highlights) {
    if ((highlight.note ?? '').trim() === '') continue
    const title = highlight.topic ?? (docTitle(highlight.anchor.docId) || t('메모'))
    groups.set(title, [...(groups.get(title) ?? []), highlight])
  }
  const top = (highlight: T) => Math.min(...highlight.anchor.rects.map((rect) => rect.y), Number.POSITIVE_INFINITY)
  return [...groups].map(([title, items]) => {
    const docs = [...new Set(items.map((item) => item.anchor.docId))]
    const ordered = docs.flatMap((docId) => {
      const inDoc = items.filter((item) => item.anchor.docId === docId)
        .sort((a, b) => a.anchor.page - b.anchor.page || top(a) - top(b))
      let previous = -1
      return inDoc
        .map((item, index) => {
          const key = item.order ?? previous + 0.001
          previous = key
          return { item, key, index }
        })
        .sort((a, b) => a.key - b.key || a.index - b.index)
        .map(({ item }) => item)
    })
    return { title, note: { version: 1 as const, blocks: ordered.map((item) => memoBlock(item.id)) } }
  })
}

/**
 * 문서 id 가 노트를 가지는 줄의 열쇠. 알려진 PDF(known)면 자기 자신, 버전 묶음의 한 버전이면 묶음의 대표 문서
 * (대표가 알려진 PDF 일 때). 그 밖(지워졌거나 PDF 가 아닌 문서)이면 null — 그 노트는 일반 노트로 보인다.
 */
export function memoNoteOwner(
  docId: string,
  known: ReadonlySet<string>,
  groups: Iterable<{ readonly anchorDocId: string; readonly versions: readonly { readonly docId: string }[] }>,
): string | null {
  for (const group of groups) {
    if (group.versions.some((version) => version.docId === docId)) return known.has(group.anchorDocId) ? group.anchorDocId : null
  }
  return known.has(docId) ? docId : null
}

/** 이 PDF 에 만들 새 노트의 기본 제목: 「<문서 이름> 노트」(겹치면 「… 노트 2」) */
export function docNoteTitle(docLabel: string, taken: readonly string[]): string {
  return uniqueNoteTitle(t('{title} 노트', { title: docLabel === '' ? t('PDF') : docLabel }), taken)
}
