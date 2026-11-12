import { useMemo, useState, type ComponentProps } from 'react'
import { useEvent } from '../ui/useEvent'
import {
  insertBlock,
  memoHighlightIds,
  memoNoteTitleOf,
  moveBlockBefore,
  removeBlock,
  removeMemoRef,
  sectionBlock,
  setMemoTicket,
  textBlock,
  updateSection,
  updateTextBlock,
  type MemoNote,
  type MemoNoteBlock,
  type MemoTicket,
} from '../core/memoNote'
import type { MemoContent } from './MemoEditor'
import type { NoteFlow, NoteFlowItem } from './NoteFlow'
import { buildNoteFlowItems } from './noteFlowItems'
import type { MemoNoteApi } from './memoNoteContext'
import type { PdfHighlightColor, PersistentPdfHighlight, PersistentPdfHighlightPatch } from './persistentHighlight'

const NO_BLOCKS: readonly MemoNoteBlock[] = []
const noop = () => undefined
/** 노트 탭·Markdown 노트 바: 형광펜에 적어 둔 쪽 크기 그대로(원문 그림 크기) */
const pageSizeOf = (highlight: PersistentPdfHighlight) => highlight.pageSize

export interface NoteFlowControllerInput {
  /** 노트 기능(없으면 빈 노트). 노트 바와 노트 탭이 같은 저장소(useMemoNotes)를 이 손잡이로 쓴다 */
  readonly api: MemoNoteApi | null
  /** 다룰 노트(Vault 상대 경로). 노트 바는 열린 노트, 노트 탭은 그 탭의 노트 */
  readonly path: string | null
  /** 카드가 쓰는 형광펜(모든 문서) */
  readonly highlights: readonly PersistentPdfHighlight[]
  /** 이 화면이 보는 문서(노트 바 쪽). 없으면 모든 메모가 자기 문서 이름을 단다 */
  readonly docId?: string
  readonly title?: string
  readonly docTitles?: Readonly<Record<string, string>>
  readonly otherLabel: string
  /** 만드는 중인 새 메모와 그 자리(노트 바 쪽) */
  readonly draft?: PersistentPdfHighlight | null
  readonly draftIndex?: number
  /** 메모 글·색·별점을 형광펜 저장소에 쓴다(노트 바와 같은 길) */
  readonly onHighlightUpdated?: (id: string, patch: PersistentPdfHighlightPatch) => void
  /** 형광펜(과 그 메모)을 지운다 */
  readonly onHighlightRemoved?: (id: string) => void
  /** 카드의 출처·쪽을 눌렀다 */
  readonly onJump: (highlight: PersistentPdfHighlight) => void
}

type NoteFlowProps = ComponentProps<typeof NoteFlow>

/**
 * 노트 하나를 카드 목록(NoteFlow)으로 보이고 고치는 데 필요한 상태와 동작을 한곳에 둔다.
 * 노트 바(Markdown)와 노트 탭이 같이 쓴다 — 블록 넣기·지우기·옮기기·소제목·ID 달기가 한 벌이다.
 * flowProps 를 NoteFlow 에 펼쳐 주고, 노트 바처럼 다른 점(새 메모 초안, 원문 더하기 …)만 덮어쓴다.
 */
export function useNoteFlowController(input: NoteFlowControllerInput) {
  const { api, path, highlights, docId, title, docTitles, otherLabel, draft = null, draftIndex, onHighlightUpdated, onHighlightRemoved, onJump } = input
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  /** 원문을 펼쳐 둔 형광펜(나머지는 한 줄 출처 칩으로 접혀 있다). 화면에서만 기억한다 */
  const [openQuotes, setOpenQuotes] = useState<ReadonlySet<string>>(() => new Set())
  const [query, setQuery] = useState('')
  /** 서식 도구 자리(쓰는 칸의 서식 단추가 이리로 온다) */
  const [formatSlot, setFormatSlot] = useState<HTMLDivElement | null>(null)

  const note: MemoNote | null = api === null || path === null ? null : path === api.openPath ? api.openNote : api.noteAt(path)
  const blocks = note?.blocks ?? NO_BLOCKS
  const highlightById = useMemo(() => new Map(highlights.map((highlight) => [highlight.id, highlight])), [highlights])
  const items = useMemo<NoteFlowItem[]>(
    () => buildNoteFlowItems(blocks, { highlightById, docId, title, docTitles, otherLabel, draft, draftIndex }),
    [blocks, highlightById, docId, title, docTitles, otherLabel, draft, draftIndex],
  )
  const noteMemos = useMemo(() => items.flatMap((item) => (item.kind === 'memo' && item.draft !== true ? [item.highlight] : [])), [items])
  const anyQuoteOpen = noteMemos.some((highlight) => openQuotes.has(highlight.id))

  /**
   * 이 노트를 고친다. 열린 노트면 updateOpen(노트 바와 같은 길), 아니면 updateNoteAt — 어느 쪽이든 저장소는 하나다.
   * 노트가 없으면 아무 일도 하지 않는다
   */
  const updateNote = useEvent((change: (current: MemoNote) => MemoNote) => {
    if (api === null || path === null) return
    if (path === api.openPath) api.updateOpen(change)
    else api.updateNoteAt(path, change)
  })

  /**
   * NoteFlow 가 (열린 노트 = 이 노트)라고 믿고 쓰게 하는 노트 기능. 카드 안의 ID 고르기·블록으로 가기가 노트 바의 노트가 아니라
   * 이 노트를 향한다. 노트 바가 보는 노트와 같으면 원래 값 그대로다
   */
  const scopedApi = useMemo<MemoNoteApi | null>(() => {
    if (api === null || path === null || path === api.openPath) return api
    return {
      ...api,
      openPath: path,
      openTitle: memoNoteTitleOf(path),
      openNote: note,
      updateOpen: (change) => api.updateNoteAt(path, change),
      ...(api.setTicket === undefined ? {} : { setTicket: (blockId: string, ticket: MemoTicket | null) => api.setTicket?.(blockId, ticket, path) }),
    }
  }, [api, note, path])

  const insertNear = (key: string, block: MemoNoteBlock, after: boolean) => {
    updateNote((current) => {
      const at = current.blocks.findIndex((item) => item.id === key)
      return insertBlock(current, block, at < 0 ? current.blocks.length : at + (after ? 1 : 0))
    })
    setEditingKey(block.id)
  }
  /** 노트 맨 끝에 글 블록을 넣고 바로 쓴다. 끝 블록이 이미 빈 글이면 그것을 고친다 */
  const appendText = () => {
    const last = blocks.at(-1)
    if (last?.kind === 'text' && last.text.trim() === '') {
      setEditingKey(last.id)
      return
    }
    const block = textBlock()
    updateNote((current) => insertBlock(current, block, current.blocks.length))
    setEditingKey(block.id)
  }
  /** 원문을 하나라도 펼쳐 두었으면 모두 접고, 다 접혀 있으면 모두 편다(쓴 메모는 늘 보인다) */
  const toggleQuotes = () => {
    setEditingKey(null)
    setOpenQuotes(anyQuoteOpen ? new Set() : new Set(noteMemos.filter((highlight) => highlight.kind !== 'region').map((highlight) => highlight.id)))
  }

  // NoteFlow 에 넘기는 동작: 늘 같은 함수라서 다시 그려져도 카드가 다시 그려지지 않는다. 부를 때는 가장 새 값을 쓴다
  const onEdit = useEvent((key: string | null) => setEditingKey(key))
  const onActivate = useEvent((key: string | null) => setActiveKey(key))
  const onSaveMemo = useEvent((highlightId: string, content: MemoContent) => onHighlightUpdated?.(highlightId, { note: content.text, noteHtml: content.html }))
  const onSaveText = useEvent((key: string, content: MemoContent) => updateNote((current) => content.text.trim() === '' ? removeBlock(current, key) : updateTextBlock(current, key, content.text, content.html)))
  const onRemoveText = useEvent((key: string) => updateNote((current) => removeBlock(current, key)))
  const onRecolor = useEvent((id: string, color: PdfHighlightColor) => onHighlightUpdated?.(id, { color }))
  const onDeleteMemo = useEvent((id: string) => {
    setEditingKey(null)
    onHighlightRemoved?.(id)
  })
  const onRemoveRef = useEvent((key: string, highlightId: string) => updateNote((current) => removeMemoRef(current, key, highlightId)))
  const onDeleteBlocks = useEvent((keys: readonly string[]) => {
    const wanted = new Set(keys)
    setEditingKey(null)
    // 메모는 형광펜과 함께, 글·소제목은 블록만
    for (const block of blocks) {
      if (wanted.has(block.id)) for (const id of memoHighlightIds(block)) onHighlightRemoved?.(id)
    }
    updateNote((current) => ({ ...current, blocks: current.blocks.filter((block) => !wanted.has(block.id)) }))
  })
  const onToggleCollapse = useEvent((id: string, collapsed: boolean) => setOpenQuotes((current) => {
    const next = new Set(current)
    if (collapsed) next.delete(id)
    else next.add(id)
    return next
  }))
  const onRate = useEvent((id: string, rating: number) => onHighlightUpdated?.(id, { rating }))
  const onMove = useEvent((keys: string | readonly string[], beforeKey: string | null) => updateNote((current) => (typeof keys === 'string' ? [keys] : keys).reduce((acc, key) => moveBlockBefore(acc, key, beforeKey), current)))
  const onJumpEvent = useEvent((highlight: PersistentPdfHighlight) => onJump(highlight))
  const onRenameSection = useEvent((key: string, sectionTitle: string) => updateNote((current) => updateSection(current, key, { title: sectionTitle })))
  const onToggleSection = useEvent((key: string, collapsed: boolean) => updateNote((current) => updateSection(current, key, { collapsed })))
  // 같은 ID 의 다른 블록(다른 노트 포함)도 함께 맞춘다(setTicket). 없으면 이 블록만
  const onSetTicket = useEvent((key: string, ticket: MemoTicket | null) => {
    if (api?.setTicket !== undefined && path !== null) api.setTicket(key, ticket, path)
    else updateNote((current) => setMemoTicket(current, key, ticket))
  })
  const onRemoveSection = useEvent((key: string) => updateNote((current) => removeBlock(current, key)))
  const onInsertSection = useEvent((key: string) => insertNear(key, sectionBlock(), false))
  const onInsertText = useEvent((key: string) => insertNear(key, textBlock(), true))
  const onAppendText = useEvent(() => appendText())
  const flowProps: NoteFlowProps = {
    items,
    query,
    editingKey,
    activeKey,
    pageSizeOf,
    onEdit,
    onActivate,
    onSaveMemo,
    onCancelDraft: noop,
    onSaveText,
    onRemoveText,
    onRecolor,
    onDeleteMemo,
    onRemoveRef,
    onDeleteBlocks,
    onToggleCollapse,
    openQuotes,
    onRate,
    onMove,
    onJump: onJumpEvent,
    onCardLayout: noop,
    onRenameSection,
    onToggleSection,
    onSetTicket,
    onRemoveSection,
    onInsertSection,
    onInsertText,
    onAppendText,
  }

  return {
    note,
    blocks,
    items,
    noteMemos,
    anyQuoteOpen,
    scopedApi,
    updateNote,
    editingKey,
    setEditingKey,
    activeKey,
    setActiveKey,
    openQuotes,
    setOpenQuotes,
    query,
    setQuery,
    formatSlot,
    setFormatSlot,
    insertNear,
    appendText,
    toggleQuotes,
    flowProps,
  }
}
