import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { NoteBarHeader } from '../pdf/NoteBarHeader'
import { MemoListView } from '../pdf/MemoListView'
import { NoteFlow, type NoteFlowItem } from '../pdf/NoteFlow'
import { MemoFormatBar, MemoFormatSlotContext, type MemoContent } from '../pdf/MemoColumn'
import { useMemoNoteApi } from '../pdf/memoNoteContext'
import { t } from '../i18n'
import { insertBlock, memoBlock, memoHighlightIds, moveBlockBefore, removeBlock, removeMemoRef, sectionBlock, setMemoTicket, textBlock, updateSection, updateTextBlock, type MemoNote, type MemoNoteBlock, type MemoTicket } from '../core/memoNote'
import { updatePersistentPdfHighlight, type PersistentPdfHighlight, type PersistentPdfHighlightPatch } from '../pdf/persistentHighlight'
import '../ui/pdf-memo.css'

interface MarkdownMemoBarProps {
  /** 이 Markdown 의 문서 id(= 경로) */
  readonly docId: string
  readonly title: string
  readonly highlights: readonly PersistentPdfHighlight[]
  /** 고른 글로 막 만든 새 메모(아직 저장 전). 글을 써야 남는다 */
  readonly draft: PersistentPdfHighlight | null
  readonly onDraftDone: () => void
  readonly onHighlightCreated?: (highlight: PersistentPdfHighlight) => void
  readonly onHighlightUpdated?: (id: string, patch: PersistentPdfHighlightPatch) => void
  readonly onHighlightRemoved?: (id: string) => void
  /** 카드의 「원문으로」: 이 문서면 그 자리로, 다른 문서면 그 문서를 연다 */
  readonly onJump: (highlight: PersistentPdfHighlight) => void
  readonly docTitles?: Readonly<Record<string, string>>
  /** 원문을 더하는 중인 블록(MarkdownPane 이 다음에 고른 글을 그 블록의 원문으로 단다). null 이면 그만둔다 */
  readonly attachingKey?: string | null
  readonly onAddRef?: (key: string | null) => void
  /** 메모만 보기(바가 문서 자리를 덮는다) */
  readonly memoOnly?: boolean
  readonly onMemoOnlyChange?: (memoOnly: boolean) => void
  /** 바 폭(px)과 왼쪽 가장자리 끌기·두 번 누르기(PDF 메모 바와 같은 폭을 쓴다) */
  readonly width?: number
  readonly onResizeStart?: (event: ReactPointerEvent<HTMLElement>) => void
  readonly onResizeReset?: () => void
}

/**
 * Markdown 의 메모 바(PDF 메모 바와 같은 노트 카드): 열린 노트의 블록을 그대로 보이고, 고른 글로 만든 새 메모는
 * 노트 끝에 들어간다. 노트가 없으면 만들기 단추.
 */
export function MarkdownMemoBar({ docId, title, highlights, draft, onDraftDone, onHighlightCreated, onHighlightUpdated, onHighlightRemoved, onJump, docTitles, attachingKey = null, onAddRef, memoOnly = false, onMemoOnlyChange, width, onResizeStart, onResizeReset }: MarkdownMemoBarProps) {
  const noteApi = useMemoNoteApi()
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [openQuotes, setOpenQuotes] = useState<ReadonlySet<string>>(() => new Set())
  const [formatSlot, setFormatSlot] = useState<HTMLDivElement | null>(null)
  const [query, setQuery] = useState('')
  const highlightById = useMemo(() => new Map(highlights.map((item) => [item.id, item])), [highlights])
  const blocks: readonly MemoNoteBlock[] = noteApi?.openNote?.blocks ?? []
  const updateNote = (change: (note: MemoNote) => MemoNote) => noteApi?.updateOpen(change)

  const items: NoteFlowItem[] = []
  let hidden = false
  blocks.forEach((block, index) => {
    if (block.kind === 'section') {
      hidden = block.collapsed === true
      const next = blocks.findIndex((item, at) => at > index && item.kind === 'section')
      items.push({ kind: 'section', key: block.id, title: block.title, collapsed: hidden, count: (next < 0 ? blocks.length : next) - index - 1 })
      return
    }
    if (hidden) return
    if (block.kind === 'text') {
      items.push({ kind: 'text', key: block.id, text: block.text, ...(block.html === undefined ? {} : { html: block.html }) })
      return
    }
    const highlight = highlightById.get(block.highlightId)
    if (highlight === undefined) return
    items.push({
      kind: 'memo',
      key: block.id,
      highlight,
      ...(highlight.anchor.docId === docId ? {} : { docLabel: (docTitles?.[highlight.anchor.docId] ?? t('다른 문서')).split(' · ')[0]! }),
      sourceLabel: docTitles?.[highlight.anchor.docId] ?? (highlight.anchor.docId === docId ? title : t('다른 문서')),
      ...(block.ticket === undefined ? {} : { ticket: block.ticket }),
      ...((block.refs ?? []).length === 0 ? {} : { extraHighlights: (block.refs ?? []).flatMap((ref) => { const found = highlightById.get(ref); return found === undefined ? [] : [found] }) }),
    })
  })
  if (draft !== null) items.push({ kind: 'memo', key: 'draft', highlight: draft, draft: true })

  const saveMemo = (id: string, content: MemoContent, ticket?: MemoTicket) => {
    const patch = { note: content.text, noteHtml: content.html }
    if (draft !== null && id === draft.id) {
      onDraftDone()
      if (content.text.trim() === '' && draft.kind !== 'region') return
      onHighlightCreated?.(updatePersistentPdfHighlight(draft, patch))
      updateNote((note) => insertBlock(note, memoBlock(draft.id, ticket), note.blocks.length))
      return
    }
    onHighlightUpdated?.(id, patch)
  }
  const insertNear = (key: string, block: MemoNoteBlock, after: boolean) => {
    updateNote((note) => {
      const at = note.blocks.findIndex((item) => item.id === key)
      return insertBlock(note, block, at < 0 ? note.blocks.length : at + (after ? 1 : 0))
    })
    setEditingKey(block.id)
  }

  const noteMemos = items.flatMap((item) => (item.kind === 'memo' && item.draft !== true ? [item.highlight] : []))
  const anyQuoteOpen = noteMemos.some((highlight) => openQuotes.has(highlight.id))
  const appendText = () => {
    const block = textBlock()
    updateNote((note) => insertBlock(note, block, note.blocks.length))
    setEditingKey(block.id)
  }

  // PDF 메모 바와 같은 머리·같은 구조(맨 위 서식 줄 고정, 왼쪽 손잡이 자리)
  return (
    <aside className={`pdf-memo-bar markdown-memo-bar${memoOnly ? ' markdown-memo-bar-full' : ''}`} aria-label={t('메모 바')} style={memoOnly || width === undefined ? undefined : { width: `${width}px` }}>
      {memoOnly || onResizeStart === undefined ? null : (
        <div
          className="pdf-memo-bar-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('메모 바 너비 조절')}
          title={t('끌어서 너비 조절')}
          onPointerDown={onResizeStart}
          onDoubleClick={onResizeReset}
        />
      )}
      <NoteBarHeader
        api={noteApi}
        className="pdf-memo-header markdown-memo-bar-head"
        fallbackTitle={t('노트 없음')}
        highlights={highlights}
        currentDocId={docId}
        docTitles={docTitles}
        onQueryChange={setQuery}
        onPickResult={onJump}
        onAddText={noteApi === null ? undefined : appendText}
        anyQuoteOpen={noteMemos.length === 0 ? undefined : anyQuoteOpen}
        onToggleQuotes={() => {
          setEditingKey(null)
          setOpenQuotes(anyQuoteOpen ? new Set() : new Set(noteMemos.filter((highlight) => highlight.kind !== 'region').map((highlight) => highlight.id)))
        }}
        memoOnly={memoOnly}
        onToggleMemoOnly={onMemoOnlyChange === undefined ? undefined : () => {
          setEditingKey(null)
          onMemoOnlyChange(!memoOnly)
        }}
        onClose={noteApi?.close === undefined ? undefined : () => {
          setEditingKey(null)
          onMemoOnlyChange?.(false)
          noteApi.close?.()
        }}
      />
      {noteApi === null || noteApi.openPath === null ? (
        <div className="note-empty">
          <p>{t('열린 노트가 없습니다.')}</p>
          {noteApi === null ? null : <button type="button" onClick={() => void noteApi.create()}>{t('새 노트 만들기')}</button>}
        </div>
      ) : memoOnly ? (
        <div className="markdown-memo-only">
          <MemoListView
            title={noteApi.openTitle ?? t('노트 없음')}
            items={items}
            currentDocId={docId}
            query={query}
            docTitle={(id) => docTitles?.[id] ?? ''}
            pageSizeOf={(highlight) => highlight.pageSize}
            onSave={(id, content) => onHighlightUpdated?.(id, { note: content.text, noteHtml: content.html })}
            onSaveText={(key, content) => updateNote((note) => content.text.trim() === '' ? removeBlock(note, key) : updateTextBlock(note, key, content.text, content.html))}
            onOpen={(highlight) => {
              onMemoOnlyChange?.(false)
              window.setTimeout(() => onJump(highlight), 0)
            }}
          />
        </div>
      ) : (
        <div className="markdown-memo-bar-body">
          <div className="note-format-dock">
            <div className="note-format-slot" ref={setFormatSlot} />
            {draft === null && editingKey === null ? <MemoFormatBar onCommand={() => undefined} disabled /> : null}
          </div>
          <div className="pdf-memo-bar-scroll" style={{ paddingLeft: 12 }}>
          {items.length === 0 ? <p className="note-empty-hint">{t('Markdown 에서 글을 고르면 이 노트에 메모가 생깁니다.')}</p> : null}
          <MemoFormatSlotContext.Provider value={formatSlot}>
            <NoteFlow
              items={items}
              query={query}
              attachingKey={attachingKey}
              onAddRef={onAddRef}
              editingKey={draft !== null ? 'draft' : editingKey}
              activeKey={activeKey}
              pageSizeOf={(highlight) => highlight.pageSize}
              onEdit={setEditingKey}
              onActivate={setActiveKey}
              onSaveMemo={saveMemo}
              onCancelDraft={onDraftDone}
              onSaveText={(key, content) => updateNote((note) => content.text.trim() === '' ? removeBlock(note, key) : updateTextBlock(note, key, content.text, content.html))}
              onRemoveText={(key) => updateNote((note) => removeBlock(note, key))}
              onRecolor={(id, color) => onHighlightUpdated?.(id, { color })}
              onDeleteMemo={(id) => {
                setEditingKey(null)
                onHighlightRemoved?.(id)
              }}
              onRemoveRef={(key, highlightId) => updateNote((note) => removeMemoRef(note, key, highlightId))}
              onDeleteBlocks={(keys) => {
                const wanted = new Set(keys)
                setEditingKey(null)
                for (const block of blocks) {
                  if (wanted.has(block.id)) for (const id of memoHighlightIds(block)) onHighlightRemoved?.(id)
                }
                updateNote((note) => ({ ...note, blocks: note.blocks.filter((block) => !wanted.has(block.id)) }))
              }}
              onToggleCollapse={(id, collapsed) => setOpenQuotes((current) => {
                const next = new Set(current)
                if (collapsed) next.delete(id)
                else next.add(id)
                return next
              })}
              openQuotes={openQuotes}
              onRate={(id, rating) => onHighlightUpdated?.(id, { rating })}
              onMove={(key, beforeKey) => updateNote((note) => moveBlockBefore(note, key, beforeKey))}
              onJump={onJump}
              onCardLayout={() => undefined}
              onRenameSection={(key, sectionTitle) => updateNote((note) => updateSection(note, key, { title: sectionTitle }))}
              onToggleSection={(key, collapsed) => updateNote((note) => updateSection(note, key, { collapsed }))}
              onSetTicket={(key, ticket) => updateNote((note) => setMemoTicket(note, key, ticket))}
              onRemoveSection={(key) => updateNote((note) => removeBlock(note, key))}
              onInsertSection={(key) => insertNear(key, sectionBlock(), false)}
              onInsertText={(key) => insertNear(key, textBlock(), true)}
              onAppendText={() => {
                const block = textBlock()
                updateNote((note) => insertBlock(note, block, note.blocks.length))
                setEditingKey(block.id)
              }}
            />
          </MemoFormatSlotContext.Provider>
          </div>
        </div>
      )}
    </aside>
  )
}
