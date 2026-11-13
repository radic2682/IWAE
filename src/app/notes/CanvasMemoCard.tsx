import { useEffect, useMemo, useRef, useState } from 'react'
import type { TextCanvasBlock } from '../../core/canvasDocument'
import type { CanvasMemoSource } from '../../core/canvasMemo'
import { normalizeTicket, type MemoTicket } from '../../core/memoNote'
import { NoteFlow, type NoteFlowItem } from '../../pdf/NoteFlow'
import type { MemoContent } from '../../pdf/MemoEditor'
import type { PersistentPdfHighlight } from '../../pdf/persistentHighlight'
import { useEvent } from '../../ui/useEvent'
import { useCanvasBlockRuntime } from './CanvasBlockShell'
import '../../ui/pdf-memo.css'
import '../../ui/canvas-memo.css'

const noop = () => undefined
/** 캔버스 메모에는 표·그림(영역) 메모가 없다: 쪽 크기를 물을 일이 없다 */
const noPageSize = () => undefined

/**
 * 형광펜에 이은 캔버스 글 블록을 노트의 메모 카드(NoteFlow)로 그린다 — 모양(글 → 원문 줄 · 색 점 · 쪽 칩 · 번역 단추 ·
 * 호버 탭의 ID·제목·메뉴)도 쓰는 법(눌러 고치기 · 서식 줄 · Esc/바깥 누르기로 저장 · 빈 새 메모는 사라짐)도 노트와 한 벌이다.
 * 캔버스만의 것(블록을 끌고 크기 바꾸고 선 잇기)은 바깥의 CanvasBlockShell 이 맡고, 카드는 그 안의 한 장짜리 NoteFlow 다.
 * 글·ID·제목은 블록(text · noteHtml · ticket)에 저장하고, 원문(색 · 인용 · 쪽)은 이은 형광펜에서 온다.
 */
export function CanvasMemoCard({ id, block, selected, sources }: {
  readonly id: string
  readonly block: TextCanvasBlock
  readonly selected: boolean
  readonly sources: readonly CanvasMemoSource[]
}) {
  const runtime = useCanvasBlockRuntime()
  const [editing, setEditing] = useState(false)
  /** 막 만든 메모: 쓰지 않고 떠나면 사라진다(노트의 새 메모와 같다) */
  const [draft, setDraft] = useState(false)
  const [active, setActive] = useState(false)
  const [openQuotes, setOpenQuotes] = useState<ReadonlySet<string>>(() => new Set())
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources

  // 형광펜에서 막 만든 메모는 바로 글을 쓸 수 있게 연다
  useEffect(() => {
    if (runtime.autoEditBlockId !== id || !selected) return
    setEditing(true)
    setDraft(true)
    runtime.onAutoEditStarted?.(id)
  }, [id, runtime, selected])

  // 원문 값(색·인용·쪽)이 그대로면 카드를 다시 그리지 않는다(블록을 끄는 동안 sources 는 프레임마다 새로 만들어진다)
  const sourcesKey = sources.map((source) => [source.excerptId, source.highlightId, source.highlight.color, source.highlight.anchor.quote, source.highlight.anchor.page, source.title].join('\u0001')).join('\u0002')
  const item = useMemo<NoteFlowItem | null>(() => {
    const [first, ...rest] = sourcesRef.current
    if (first === undefined) return null
    const text = block.text
    const highlight: PersistentPdfHighlight = {
      ...first.highlight,
      ...(text === '' ? {} : { note: text }),
      ...(block.noteHtml === undefined ? {} : { noteHtml: block.noteHtml }),
    }
    return {
      kind: 'memo',
      key: draft ? 'draft' : id,
      highlight,
      ...(draft ? { draft: true as const } : {}),
      sourceLabel: first.title,
      ...(block.ticket === undefined ? {} : { ticket: block.ticket }),
      ...(rest.length === 0 ? {} : { extraHighlights: rest.map((source) => source.highlight) }),
    }
    // sourcesKey 가 sources 의 값을 대신한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.noteHtml, block.text, block.ticket, draft, id, sourcesKey])
  const items = useMemo(() => (item === null ? [] : [item]), [item])

  const sourceOf = (highlightId: string) => sourcesRef.current.find((source) => source.highlightId === highlightId)

  const onEdit = useEvent((key: string | null) => {
    setEditing(key !== null)
    if (key !== null) runtime.onSelectBlock?.(id)
  })
  const onActivate = useEvent((key: string | null) => setActive(key !== null))
  const onSaveMemo = useEvent((_highlightId: string, content: MemoContent, ticket?: MemoTicket) => {
    setDraft(false)
    runtime.onMemoSave?.(id, content, ticket)
  })
  const onCancelDraft = useEvent(() => {
    setDraft(false)
    runtime.onMemoDiscard?.(id)
  })
  const onDeleteMemo = useEvent((highlightId: string) => {
    const source = sourceOf(highlightId)
    setEditing(false)
    if (source !== undefined) runtime.onMemoDelete?.(id, source.excerptId, source.highlightId)
  })
  const onJump = useEvent((highlight: PersistentPdfHighlight) => {
    const source = sourceOf(highlight.id)
    if (source !== undefined) runtime.onOpenSource?.(source.jump)
  })
  const onToggleCollapse = useEvent((highlightId: string, collapsed: boolean) => setOpenQuotes((current) => {
    const next = new Set(current)
    if (collapsed) next.delete(highlightId)
    else next.add(highlightId)
    return next
  }))
  const onSetTicket = useEvent((_key: string, ticket: MemoTicket | null) => runtime.onMemoTicket?.(id, normalizeTicket(ticket)))
  const onAddRef = useEvent((key: string | null) => runtime.onMemoAttachStart?.(key === null ? null : id))
  const onRemoveRef = useEvent((_key: string, highlightId: string) => {
    const source = sourceOf(highlightId)
    if (source !== undefined) runtime.onMemoDetach?.(id, source.excerptId, source.highlightId)
  })

  if (item === null) return null
  const key = draft ? 'draft' : id
  return (
    <div
      className={`canvas-memo-card${editing ? ' nodrag nowheel' : ' drag-handle'}`}
      data-canvas-auto-grow="true"
      data-canvas-memo={id}
      onClickCapture={() => { if (!selected) runtime.onSelectBlock?.(id) }}
      // 카드의 우클릭 메뉴가 열리면 캔버스의 블록 메뉴는 열지 않는다(두 메뉴가 겹친다)
      onContextMenu={(event) => event.stopPropagation()}
    >
      <NoteFlow
        items={items}
        embedded
        editingKey={editing ? key : null}
        activeKey={active || editing ? key : null}
        pageSizeOf={noPageSize}
        onEdit={onEdit}
        onActivate={onActivate}
        onSaveMemo={onSaveMemo}
        onCancelDraft={onCancelDraft}
        onSaveText={noop}
        onRemoveText={noop}
        onRecolor={noop}
        onDeleteMemo={onDeleteMemo}
        onToggleCollapse={onToggleCollapse}
        openQuotes={openQuotes}
        onMove={noop}
        onJump={onJump}
        onCardLayout={noop}
        onSetTicket={onSetTicket}
        onAddRef={onAddRef}
        onRemoveRef={onRemoveRef}
        attachingKey={runtime.attachingMemoId === id ? key : null}
      />
    </div>
  )
}
