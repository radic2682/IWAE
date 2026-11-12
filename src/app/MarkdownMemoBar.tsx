import { useRef, useState, type PointerEvent as ReactPointerEvent, type CSSProperties } from 'react'
import { NoteBarHeader } from '../pdf/NoteBarHeader'
import { NoteOutline, useExpandQuotesWhileWide } from '../pdf/NoteOutline'
import { NoteFlow } from '../pdf/NoteFlow'
import { useNoteFlowController } from '../pdf/useNoteFlowController'
import { MemoFormatBar, MemoFormatSlotContext, type MemoContent } from '../pdf/MemoColumn'
import { useMemoNoteApi } from '../pdf/memoNoteContext'
import { useBarZoom, useBarZoomWheel } from './useBarZoom'
import { t } from '../i18n'
import { insertBlock, memoBlock, updateSection, type MemoTicket } from '../core/memoNote'
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
  /** 닫히는 전환 중(바를 지우기 전에 서서히 사라지게 한다) */
  readonly exiting?: boolean
  /** 메모만 보기에서 바가 문서 창까지 덮을 때, 노트 바 칸 왼쪽 기준 왼쪽 끝(음수) */
  readonly wideLeft?: number
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
export function MarkdownMemoBar({ docId, title, highlights, draft, onDraftDone, onHighlightCreated, onHighlightUpdated, onHighlightRemoved, onJump, docTitles, attachingKey = null, onAddRef, memoOnly = false, exiting = false, wideLeft = 0, onMemoOnlyChange, width, onResizeStart, onResizeReset }: MarkdownMemoBarProps) {
  const noteApi = useMemoNoteApi()
  // 오른쪽 바 안쪽 확대(Ctrl+휠): 메모만 보기(넓은 화면)에서는 쓰지 않는다
  const rightZoom = useBarZoom('right')
  const [barEl, setBarEl] = useState<HTMLElement | null>(null)
  useBarZoomWheel(barEl, 'right', !memoOnly)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // 카드 목록·블록 편집은 노트 탭과 같은 컨트롤러가 한다(열린 노트 하나를 다룬다)
  const flow = useNoteFlowController({
    api: noteApi,
    path: noteApi?.openPath ?? null,
    highlights,
    docId,
    title,
    docTitles,
    otherLabel: t('다른 문서'),
    draft,
    onHighlightUpdated,
    onHighlightRemoved,
    onJump: (highlight) => {
      // 메모만 보기에서 원문을 누르면 문서와 같이 보기로 돌아가 그 자리로 간다
      if (!memoOnly) { onJump(highlight); return }
      onMemoOnlyChange?.(false)
      window.setTimeout(() => onJump(highlight), 0)
    },
  })
  const { items, noteMemos, anyQuoteOpen, editingKey, setEditingKey, activeKey, setActiveKey, openQuotes, setOpenQuotes, updateNote } = flow

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
  // 메모만 보기에서는 원문을 모두 펼쳐 보인다(나오면 전 상태로)
  useExpandQuotesWhileWide(memoOnly, openQuotes, setOpenQuotes, noteMemos)
  const query = flow.query

  // PDF 메모 바와 같은 머리·같은 구조(맨 위 서식 줄 고정, 왼쪽 손잡이 자리)
  return (
    <aside
      ref={setBarEl}
      className={`pdf-memo-bar markdown-memo-bar${memoOnly ? ' markdown-memo-bar-full' : ''}${exiting ? ' note-bar-exiting' : ''}`}
      aria-label={t('메모 바')}
      style={memoOnly ? { left: `${wideLeft}px` } : { ...(width === undefined ? {} : { width: `${width}px` }), '--bar-zoom': rightZoom } as CSSProperties}
    >
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
        onQueryChange={flow.setQuery}
        onPickResult={onJump}
        onAddText={noteApi === null ? undefined : flow.appendText}
        anyQuoteOpen={noteMemos.length === 0 ? undefined : anyQuoteOpen}
        onToggleQuotes={flow.toggleQuotes}
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
      ) : (
        <div className={`markdown-memo-bar-body${memoOnly ? ' note-wide' : ''}`}>
          <div className="note-format-dock">
            <div className="note-format-slot" ref={flow.setFormatSlot} />
            {draft === null && editingKey === null ? <MemoFormatBar onCommand={() => undefined} disabled /> : null}
          </div>
          <div ref={scrollRef} className="pdf-memo-bar-scroll" style={memoOnly ? undefined : { paddingLeft: 12 }}>
          {items.length === 0 ? <p className="note-empty-hint">{t('Markdown 에서 글을 고르면 이 노트에 메모가 생깁니다.')}</p> : null}
          <MemoFormatSlotContext.Provider value={flow.formatSlot}>
            <NoteFlow
              {...flow.flowProps}
              attachingKey={attachingKey}
              onAddRef={onAddRef}
              editingKey={draft !== null ? 'draft' : editingKey}
              onSaveMemo={saveMemo}
              onCancelDraft={onDraftDone}
            />
          </MemoFormatSlotContext.Provider>
          </div>
          {memoOnly ? (
            <NoteOutline items={items} query={query} scrollerRef={scrollRef} onToggleSection={(key, collapsed) => updateNote((note) => updateSection(note, key, { collapsed }))} />
          ) : null}
        </div>
      )}
    </aside>
  )
}
