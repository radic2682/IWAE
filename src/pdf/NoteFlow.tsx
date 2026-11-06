import { Fragment, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { CaretDown, CaretRight, DotsSixVertical, DotsThree, Plus, Star, Ticket, X } from '@phosphor-icons/react'
import { MemoEditor, MemoNoteView, type MemoContent } from './MemoColumn'
import { RegionCrop } from './RegionCrop'
import { t } from '../i18n'
import type { PdfHighlightColor, PersistentPdfHighlight } from './persistentHighlight'

/** 노트 한 장의 카드: PDF 형광펜 메모, 노트에 직접 쓴 글, 소제목 */
export type NoteFlowItem =
  | {
      readonly kind: 'memo'
      /** 노트 블록 id. 아직 저장 전인 새 메모는 'draft' */
      readonly key: string
      readonly highlight: PersistentPdfHighlight
      readonly draft?: boolean
      /** 다른 PDF 의 메모면 그 PDF 이름 */
      readonly docLabel?: string
      /** 출처 PDF 의 이름(마우스를 올리면 쪽 번호와 함께 보인다) */
      readonly sourceLabel?: string
      /** 티켓 블록이면 그 제목. 제목(H2) · 내 글 · 원문(Req 문구) 차례로 보인다 */
      readonly ticketTitle?: string
      /** 이 메모에 더 단 원문(형광펜). 첫 원문은 highlight */
      readonly extraHighlights?: readonly PersistentPdfHighlight[]
    }
  | { readonly kind: 'text'; readonly key: string; readonly text: string; readonly html?: string }
  /** 소제목: 다음 소제목까지 묶는다. count = 묶인 블록 수 */
  | { readonly kind: 'section'; readonly key: string; readonly title: string; readonly collapsed: boolean; readonly count: number }


/**
 * 노트 한 장을 한 편의 글처럼 잇는다(메모 바가 PDF 와 따로 스크롤한다). 블록은 바탕·테두리 없이 이어지고,
 * 마우스를 올린 블록만 테두리와 왼쪽 손잡이(⋮⋮), 오른쪽 위 메뉴(…)가 보인다.
 * - 메모 블록: 내 메모가 먼저, 원문은 형광펜 색 한 줄 출처 칩으로 접혀 있다가 펼친다. 표·그림 메모는 그림을 폭에 맞춰 크게.
 * - 블록 사이에 마우스를 올리면 + (그 자리에 글 넣기), 맨 아래 빈 곳을 누르면 끝에 새 글.
 * - 글 블록 끝에서 Enter 두 번(또는 Ctrl+Enter)이면 그 아래 새 글 블록.
 * - 블록 어디든(또는 손잡이를) 잡고 끌어 차례를 바꾼다(소제목은 묶인 블록과 함께).
 * 카드마다의 자리를 onCardLayout 으로 알린다(형광펜 → 카드 선은 바깥에서 그린다).
 */
export function NoteFlow({
  items,
  editingKey,
  activeKey,
  query = '',
  pageSizeOf,
  onEdit,
  onActivate,
  onSaveMemo,
  onCancelDraft,
  onSaveText,
  onRemoveText,
  onRecolor,
  onDeleteMemo,
  onToggleCollapse,
  onRate,
  onMove,
  onJump,
  onCardLayout,
  onRenameSection,
  onToggleSection,
  onRemoveSection,
  onInsertSection,
  onInsertText,
  onAppendText,
  onSetTicket,
  onAddRef,
  onRemoveRef,
  attachingKey = null,
  onDeleteBlocks,
  openQuotes,
}: {
  readonly items: readonly NoteFlowItem[]
  /** 쓰는 중인 카드(item.key) */
  readonly editingKey: string | null
  readonly activeKey: string | null
  readonly query?: string
  readonly pageSizeOf: (highlight: PersistentPdfHighlight) => readonly [number, number] | undefined
  readonly onEdit: (key: string | null) => void
  readonly onActivate: (key: string | null) => void
  /** 메모 글 저장. 새 메모(draft)를 티켓으로 저장할 때는 ticketTitle 도 준다 */
  readonly onSaveMemo: (highlightId: string, content: MemoContent, ticketTitle?: string) => void
  readonly onCancelDraft: () => void
  readonly onSaveText: (key: string, content: MemoContent) => void
  readonly onRemoveText: (key: string) => void
  readonly onRecolor: (highlightId: string, color: PdfHighlightColor) => void
  readonly onDeleteMemo: (highlightId: string) => void
  readonly onToggleCollapse: (highlightId: string, collapsed: boolean) => void
  readonly onRate: (highlightId: string, rating: number) => void
  /** key 의 카드를 beforeKey 카드 앞으로(null 이면 맨 끝) */
  readonly onMove: (key: string, beforeKey: string | null) => void
  readonly onJump: (highlight: PersistentPdfHighlight) => void
  readonly onCardLayout: (layout: ReadonlyMap<string, { top: number; height: number }>) => void
  readonly onRenameSection?: (key: string, title: string) => void
  readonly onToggleSection?: (key: string, collapsed: boolean) => void
  /** 소제목만 지운다(묶였던 블록은 앞 묶음으로 간다) */
  readonly onRemoveSection?: (key: string) => void
  /** key 블록 위에 소제목을 넣는다 */
  readonly onInsertSection?: (key: string) => void
  /** key 블록 아래에 글 블록을 넣는다 */
  readonly onInsertText?: (key: string) => void
  /** 노트 맨 끝에 글 블록을 넣는다(맨 아래 빈 곳을 눌렀을 때) */
  readonly onAppendText?: () => void
  /** 메모 블록을 티켓으로(제목) 바꾸거나 제목을 고친다. null 이면 다시 메모로 */
  readonly onSetTicket?: (key: string, title: string | null) => void
  /** key 메모 블록에 원문을 더하기 시작한다(다음에 PDF 에서 고른 글이 그 블록의 원문이 된다). null 이면 그만둔다 */
  readonly onAddRef?: (key: string | null) => void
  /** 더한 원문 하나를 뗀다 */
  readonly onRemoveRef?: (key: string, highlightId: string) => void
  /** 원문을 더하는 중인 블록 */
  readonly attachingKey?: string | null
  /** 고른 블록들을 한꺼번에 지운다(메모는 형광펜과 함께, 소제목은 소제목만) */
  readonly onDeleteBlocks?: (keys: readonly string[]) => void
  /** 원문을 펼쳐 둔 형광펜 id. 나머지는 한 줄 출처 칩으로 접혀 있다 */
  readonly openQuotes?: ReadonlySet<string>
}) {
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const reportedRef = useRef('')
  const needle = query.trim().toLowerCase()

  useLayoutEffect(() => {
    const layout = new Map<string, { top: number; height: number }>()
    for (const [key, element] of cardRefs.current) layout.set(key, { top: element.offsetTop, height: element.offsetHeight })
    const signature = [...layout].map(([key, box]) => `${key}:${box.top}:${box.height}`).join('|')
    if (signature !== reportedRef.current) {
      reportedRef.current = signature
      onCardLayout(layout)
    }
  })

  // ---------- 끌어 차례 바꾸기 ----------
  const [dragging, setDragging] = useState<{ key: string; drop: number } | null>(null)
  const draggingRef = useRef<{ key: string; drop: number } | null>(null)
  const dropIndexAt = (clientY: number) => {
    const index = items.findIndex((item) => {
      const rect = cardRefs.current.get(item.key)?.getBoundingClientRect()
      return rect !== undefined && clientY < rect.top + rect.height / 2
    })
    return index < 0 ? items.length : index
  }
  /** 소제목이면 그 묶음(소제목 ~ 다음 소제목 앞)의 key 들 */
  const groupOf = (key: string): readonly string[] => {
    const at = items.findIndex((item) => item.key === key)
    if (at < 0 || items[at]!.kind !== 'section') return [key]
    const next = items.findIndex((item, index) => index > at && item.kind === 'section')
    return items.slice(at, next < 0 ? items.length : next).map((item) => item.key)
  }
  // 블록 어디든 잡고 조금(5px) 움직이면 끌기. 단추·입력칸·쓰는 중인 편집기에서는 시작하지 않는다
  const startBlockDrag = (key: string) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || key === 'draft') return
    if ((event.target as Element).closest('button, input, textarea, select, a, [contenteditable="true"], .pdf-memo-editor, .pdf-memo-format-bar') !== null) return
    const startX = event.clientX
    const startY = event.clientY
    const scroller = event.currentTarget.closest('.pdf-memo-bar-scroll')
    let started = false
    const move = (moveEvent: PointerEvent) => {
      if (!started) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return
        started = true
        window.getSelection()?.removeAllRanges()
        document.body.classList.add('note-block-dragging')
      }
      moveEvent.preventDefault()
      const next = { key, drop: dropIndexAt(moveEvent.clientY) }
      if (draggingRef.current?.drop !== next.drop) {
        draggingRef.current = next
        setDragging(next)
      }
      if (scroller !== null) {
        const rect = scroller.getBoundingClientRect()
        if (moveEvent.clientY < rect.top + 30) scroller.scrollTop -= 12
        else if (moveEvent.clientY > rect.bottom - 30) scroller.scrollTop += 12
      }
    }
    const finish = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      document.body.classList.remove('note-block-dragging')
      const state = draggingRef.current
      draggingRef.current = null
      setDragging(null)
      if (!started || state === null) return
      // 끈 뒤에 따라오는 click(고치기 열기·원문 접기)은 삼킨다
      window.addEventListener('click', (clickEvent) => clickEvent.stopPropagation(), { capture: true, once: true })
      const moving = items.find((item) => item.key === state.key)
      if (moving === undefined) return
      const group = groupOf(state.key)
      const after = items.slice(state.drop).filter((item) => !group.includes(item.key) && item.key !== 'draft')
      // 소제목은 다른 묶음 한가운데로 들어가지 않게 다음 소제목 앞(또는 맨 끝)으로 놓는다
      const before = moving.kind === 'section' ? after.find((item) => item.kind === 'section') : after[0]
      onMove(state.key, before?.key ?? null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }
  const draggedGroup = dragging === null ? [] : groupOf(dragging.key)
  const shellClass = (key: string, index: number) => [
    draggedGroup.includes(key) ? 'pdf-memo-card-dragging' : '',
    dragging !== null && !draggedGroup.includes(key) && dragging.drop === index ? 'pdf-memo-card-drop-before' : '',
    dragging !== null && !draggedGroup.includes(key) && dragging.drop === items.length && index === items.length - 1 ? 'pdf-memo-card-drop-after' : '',
  ]
  const register = (key: string) => (element: HTMLDivElement | null) => {
    if (element === null) cardRefs.current.delete(key)
    else cardRefs.current.set(key, element)
  }

  // ---------- 우클릭 메뉴 ----------
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  useEffect(() => {
    if (menu === null) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [menu])
  const openMenu = (key: string) => (event: ReactMouseEvent) => {
    if (key === 'draft') return
    if ((event.target as Element).closest('[contenteditable="true"], input, textarea') !== null) return
    event.preventDefault()
    setMenu({ key, x: event.clientX, y: event.clientY })
  }
  const menuButton = (key: string) => key === 'draft' ? null : (
    <button
      type="button"
      className="note-block-menu"
      aria-label={t('블록 메뉴')}
      title={t('메뉴')}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        setMenu({ key, x: rect.right - 190, y: rect.bottom + 4 })
      }}
    >
      <DotsThree size={16} weight="bold" aria-hidden="true" />
    </button>
  )
  const grip = (key: string) => key === 'draft' ? null : (
    <span className="note-block-grip" aria-hidden="true" title={t('끌어 옮기기')}><DotsSixVertical size={14} weight="bold" /></span>
  )
  /** 블록 사이: 마우스를 올리면 + 가 나타나 그 자리(key 블록 아래)에 글을 넣는다 */
  const gapAfter = (key: string) => key === 'draft' || onInsertText === undefined ? <div className="note-gap" aria-hidden="true" /> : (
    <div className="note-gap">
      <button type="button" className="note-gap-add" aria-label={t('여기에 글 넣기')} title={t('여기에 글 넣기')} onClick={() => onInsertText(key)}>
        <Plus size={11} weight="bold" aria-hidden="true" />
      </button>
    </div>
  )
  const menuItem = menu === null ? undefined : items.find((item) => item.key === menu.key)

  // ---------- 마우스를 올린 블록의 출처: 바 밖(문서 맨 위)에 띄워 맨 위 블록에서도 잘리지 않는다 ----------
  const [tip, setTip] = useState<{ key: string; label: string; right: number; top: number } | null>(null)
  const showTip = (key: string, label: string) => (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setTip({ key, label, right: rect.right, top: rect.top })
  }
  useEffect(() => {
    if (tip === null) return
    // 스크롤하면 블록을 따라 다시 잰다(블록이 사라졌으면 내린다)
    const follow = () => {
      const element = cardRefs.current.get(tip.key)
      if (element === undefined) {
        setTip(null)
        return
      }
      const rect = element.getBoundingClientRect()
      setTip((current) => current === null || (current.top === rect.top && current.right === rect.right) ? current : { ...current, right: rect.right, top: rect.top })
    }
    window.addEventListener('scroll', follow, true)
    return () => window.removeEventListener('scroll', follow, true)
  }, [tip])

  // ---------- 여러 블록 고르기: Ctrl/⌘+누르기는 하나씩, Shift+누르기는 그 사이 모두. Delete 로 지운다 ----------
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const lastPickedRef = useRef<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    // 노트에서 사라진 블록은 고른 것에서도 뺀다
    const keys = new Set(items.map((item) => item.key))
    setSelected((current) => {
      const next = new Set([...current].filter((key) => keys.has(key)))
      return next.size === current.size ? current : next
    })
  }, [items])
  useEffect(() => { if (selected.size === 0) setConfirmDelete(false) }, [selected])
  const pickBlock = (key: string) => (event: ReactMouseEvent<HTMLElement>) => {
    if (key === 'draft' || onDeleteBlocks === undefined) return
    if (!(event.ctrlKey || event.metaKey || event.shiftKey)) return
    event.preventDefault()
    event.stopPropagation()
    window.getSelection()?.removeAllRanges()
    setSelected((current) => {
      const next = new Set(current)
      const from = lastPickedRef.current === null ? -1 : items.findIndex((item) => item.key === lastPickedRef.current)
      const to = items.findIndex((item) => item.key === key)
      if (event.shiftKey && from >= 0 && to >= 0) {
        const [a, b] = from < to ? [from, to] : [to, from]
        for (const item of items.slice(a, b + 1)) if (item.key !== 'draft') next.add(item.key)
      } else if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
    lastPickedRef.current = key
  }
  const deleteSelected = () => {
    if (onDeleteBlocks === undefined || selected.size === 0) return
    onDeleteBlocks([...selected])
    setSelected(new Set())
  }
  useEffect(() => {
    if (selected.size === 0) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))) return
      if (event.key === 'Escape') setSelected(new Set())
      else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        setConfirmDelete(true)
      }
    }
    // 고른 블록 밖을 그냥 누르면 고르기를 푼다
    const onDown = (event: PointerEvent) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey) return
      const target = event.target as Element | null
      if (target?.closest('.note-selection-bar') != null) return
      setSelected(new Set())
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [selected])

  // 새 메모를 티켓으로 쓰는 중이면 그 제목(저장할 때 블록이 티켓으로 만들어진다)
  const [draftTicket, setDraftTicket] = useState<string | null>(null)
  const hasDraft = items.some((item) => item.key === 'draft')
  useEffect(() => { if (!hasDraft) setDraftTicket(null) }, [hasDraft])
  // 제목을 고치는 중인 티켓(item.key)
  const [renamingTicket, setRenamingTicket] = useState<string | null>(null)
  // 그림(표·그림 메모) 크게 보기
  const [zoomed, setZoomed] = useState<PersistentPdfHighlight | null>(null)
  useEffect(() => {
    if (zoomed === null) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setZoomed(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [zoomed])
  const run = (action: () => void) => () => {
    setMenu(null)
    action()
  }

  const stars = (highlight: PersistentPdfHighlight) => highlight.rating === undefined ? null : (
    <span className="note-source-stars" aria-label={t('별 {count}개', { count: highlight.rating })}>{'★'.repeat(highlight.rating)}</span>
  )

  return (
    <>
      {selected.size > 0 ? (
        <div className="note-selection-bar" role="toolbar" aria-label={t('고른 블록')}>
          {confirmDelete ? (
            <>
              <span>{t('{count}개 블록을 지울까요? 메모는 형광펜도 함께 지워집니다.', { count: selected.size })}</span>
              <button type="button" className="note-selection-danger" onClick={deleteSelected}>{t('지우기')}</button>
              <button type="button" onClick={() => setConfirmDelete(false)}>{t('취소')}</button>
            </>
          ) : (
            <>
              <span>{t('{count}개 고름', { count: selected.size })}</span>
              <button type="button" className="note-selection-danger" onClick={() => setConfirmDelete(true)}>{t('지우기')}</button>
              <button type="button" onClick={() => setSelected(new Set())}>{t('고르기 풀기')}</button>
            </>
          )}
        </div>
      ) : null}
      {tip !== null ? createPortal(
        <span className="note-source-float" aria-hidden="true" style={{ left: tip.right, top: tip.top }}>{tip.label}</span>,
        document.body,
      ) : null}
      {items.map((item, index) => {
        if (item.kind === 'section') {
          const renaming = editingKey === item.key
          return (
            <Fragment key={item.key}>
            <div
              ref={register(item.key)}
              className={['note-section', 'note-block', item.collapsed ? 'note-section-collapsed' : '', selected.has(item.key) ? 'note-block-selected' : '', ...shellClass(item.key, index)].filter(Boolean).join(' ')}
              data-note-block={item.key}
              onPointerDown={renaming ? undefined : startBlockDrag(item.key)}
              onClickCapture={pickBlock(item.key)}
              onContextMenu={openMenu(item.key)}
            >
              <button
                type="button"
                className="note-section-toggle"
                aria-label={item.collapsed ? t('{title} 펼치기', { title: item.title }) : t('{title} 접기', { title: item.title })}
                aria-expanded={!item.collapsed}
                onClick={() => onToggleSection?.(item.key, !item.collapsed)}
              >
                {item.collapsed ? <CaretRight size={13} weight="bold" aria-hidden="true" /> : <CaretDown size={13} weight="bold" aria-hidden="true" />}
              </button>
              {renaming ? (
                <input
                  className="note-section-input"
                  aria-label={t('소제목')}
                  defaultValue={item.title}
                  autoFocus
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={(event) => {
                    onRenameSection?.(item.key, event.currentTarget.value)
                    onEdit(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    else if (event.key === 'Escape') onEdit(null)
                  }}
                />
              ) : (
                <span className="note-section-title" title={t('두 번 눌러 이름 바꾸기')} onDoubleClick={() => onEdit(item.key)}>{item.title}</span>
              )}
              <span className="note-section-count">{item.count}</span>
              {grip(item.key)}
              {menuButton(item.key)}
            </div>
            {gapAfter(item.key)}
            </Fragment>
          )
        }

        if (item.kind === 'text') {
          const editing = editingKey === item.key
          const matches = needle === '' || item.text.toLowerCase().includes(needle)
          return (
            <Fragment key={item.key}>
            <div
              ref={register(item.key)}
              className={['pdf-memo-card', 'pdf-memo-card-flow', 'note-block', 'note-text-card', editing ? 'pdf-memo-card-editing' : '', matches ? '' : 'pdf-memo-card-dim', selected.has(item.key) ? 'note-block-selected' : '', ...shellClass(item.key, index)].filter(Boolean).join(' ')}
              data-note-block={item.key}
              onPointerDown={startBlockDrag(item.key)}
              onClickCapture={pickBlock(item.key)}
              onContextMenu={openMenu(item.key)}
            >
              {editing ? (
                <MemoEditor
                  key={item.key}
                  label={t('글')}
                  initialText={item.text}
                  initialHtml={item.html}
                  placeholder={t('글을 쓰세요 (끝에서 Enter 두 번이면 아래에 새 글)')}
                  onSave={(content) => {
                    onSaveText(item.key, content)
                    onEdit(null)
                  }}
                  onCancel={() => onEdit(null)}
                  onNext={onInsertText === undefined ? undefined : () => onInsertText(item.key)}
                />
              ) : (
                <MemoNoteView note={item.text} noteHtml={item.html} onEdit={() => onEdit(item.key)} onChange={(content) => onSaveText(item.key, content)} />
              )}
              {grip(item.key)}
              {menuButton(item.key)}
            </div>
            {gapAfter(item.key)}
            </Fragment>
          )
        }

        const { highlight } = item
        const draft = item.draft === true
        const editing = draft || editingKey === item.key
        const active = activeKey === item.key || editing
        const extras = item.extraHighlights ?? []
        const sources = [highlight, ...extras]
        const matches = needle === ''
          || (highlight.note ?? '').toLowerCase().includes(needle)
          || sources.some((source) => source.anchor.quote.toLowerCase().includes(needle))
          || (item.ticketTitle ?? '').toLowerCase().includes(needle)
        const ticketTitleValue = draft ? draftTicket ?? undefined : item.ticketTitle
        const ticket = ticketTitleValue !== undefined
        // 출처(PDF 이름 · 쪽)는 블록에 마우스를 올렸을 때 블록 바깥 오른쪽 위에 뜬다
        const tipLabel = `${item.sourceLabel ?? item.docLabel ?? 'PDF'} · ${[...new Set(sources.map((source) => `p.${source.anchor.page + 1}`))].join(', ')}${draft ? ` · ${t('새 메모')}` : ''}`
        // 원문 하나: 한 줄 출처 칩으로 접혀 있고 펼치면 전부. 표·그림은 그림이 곧 내용이라 늘 크게. 더한 원문에는 떼기 단추
        const renderSource = (source: PersistentPdfHighlight, extra: boolean) => {
          const collapsed = source.kind !== 'region' && openQuotes?.has(source.id) !== true
          const meta = source.rating === undefined ? null : <span className="note-source-meta">{stars(source)}</span>
          const remove = extra && onRemoveRef !== undefined ? (
            <button type="button" className="note-source-remove" aria-label={t('이 원문 떼기')} title={t('이 원문 떼기')} onClick={(event) => {
              event.stopPropagation()
              onRemoveRef(item.key, source.id)
            }}>
              <X size={11} weight="bold" aria-hidden="true" />
            </button>
          ) : null
          if (collapsed) {
            return (
              <div key={source.id} className={`note-source-chip pdf-memo-card-quote-${source.color}`} title={t('PDF 에서 보기')} onClick={draft ? undefined : () => onJump(source)}>
                <button type="button" className="note-source-expand" aria-label={t('원문 펼치기')} title={t('원문 펼치기')} onClick={(event) => {
                  event.stopPropagation()
                  onToggleCollapse(source.id, false)
                }}>
                  <CaretRight size={11} weight="bold" aria-hidden="true" />
                </button>
                {meta}
                <span className="note-source-chip-text">{source.kind === 'region' ? t('표·그림') : source.anchor.quote.replace(/\s+/gu, ' ').trim()}</span>
                <span className="note-source-page">p.{source.anchor.page + 1}</span>
                {remove}
              </div>
            )
          }
          const pageSize = source.kind === 'region' ? pageSizeOf(source) ?? source.pageSize : undefined
          if (source.kind === 'region' && pageSize !== undefined) {
            return (
              <div key={source.id} className="pdf-memo-card-source note-source-region" onClick={draft ? undefined : () => onJump(source)}>
                {meta}
                <RegionCrop highlight={source} pageSize={pageSize} maxWidth={480} fill />
                {remove}
              </div>
            )
          }
          return (
            <div
              key={source.id}
              className={`pdf-memo-card-quote pdf-memo-card-quote-${source.color} note-source`}
              title={t('PDF 에서 보기')}
              onClick={draft ? undefined : () => onJump(source)}
            >
              <button type="button" className="note-source-expand" aria-label={t('원문 접기')} title={t('원문 접기')} onClick={(event) => {
                event.stopPropagation()
                onToggleCollapse(source.id, true)
              }}>
                <CaretDown size={11} weight="bold" aria-hidden="true" />
              </button>
              {meta}
              {source.anchor.quote.replace(/\s+/gu, ' ').trim()}
              <span className="note-source-page">p.{source.anchor.page + 1}</span>
              {remove}
            </div>
          )
        }
        const sourceList = (
          <div className="note-sources">
            {sources.map((source, at) => renderSource(source, at > 0))}
            {attachingKey === item.key ? (
              <div className="note-source-attach" role="status">
                <span>{t('PDF 에서 더할 원문을 고르세요')}</span>
                <button type="button" onClick={() => onAddRef?.(null)}>{t('그만두기')}</button>
              </div>
            ) : null}
          </div>
        )
        const memo = editing ? (
          <MemoEditor
            key={item.key}
            initialText={highlight.note ?? ''}
            initialHtml={highlight.noteHtml}
            placeholder={!draft ? t('메모를 쓰세요')
              : highlight.kind === 'region' ? t('설명을 쓰세요 (안 써도 그림은 노트에 남습니다 · Esc 로 취소)')
                : t('메모를 쓰세요 (안 쓰고 다른 곳을 누르면 사라집니다)')}
            onSave={(content) => {
              onSaveMemo(highlight.id, content, draft ? draftTicket ?? undefined : undefined)
              onEdit(null)
            }}
            onCancel={() => {
              if (draft) onCancelDraft()
              onEdit(null)
            }}
          />
        ) : (highlight.note ?? '').trim() === '' && (highlight.noteHtml ?? '') === '' ? (
          // 메모 없는 형광펜: 빈 줄 대신, 마우스를 올렸을 때만 「메모 쓰기」가 보인다
          <button type="button" className="note-memo-add" onClick={() => onEdit(item.key)}>{t('메모 쓰기')}</button>
        ) : (
          <MemoNoteView note={highlight.note} noteHtml={highlight.noteHtml} onEdit={() => onEdit(item.key)} onChange={(content) => onSaveMemo(highlight.id, content)} />
        )
        // 티켓 제목: 두 번 눌러 바꾼다(새 메모는 저장한 뒤에)
        const ticketTitle = !ticket ? null : renamingTicket === item.key ? (
          <input
            className="note-ticket-title-input"
            aria-label={t('티켓 제목')}
            defaultValue={ticketTitleValue}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => {
              const next = event.currentTarget.value.trim()
              if (next !== '' && next !== ticketTitleValue) onSetTicket?.(item.key, next)
              setRenamingTicket(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              else if (event.key === 'Escape') setRenamingTicket(null)
            }}
          />
        ) : (
          <div className="note-ticket-title" title={draft ? undefined : t('두 번 눌러 제목 바꾸기')} onDoubleClick={draft ? undefined : () => setRenamingTicket(item.key)}>
            <Ticket size={14} weight="bold" aria-hidden="true" />
            <span>{ticketTitleValue}</span>
          </div>
        )
        // 새 메모: 바로 「티켓으로」 단추(누르는 동안 편집기 포커스를 뺏지 않는다)
        const draftTicketButton = draft && onSetTicket !== undefined ? (
          <button
            type="button"
            className={`note-draft-ticket${ticket ? ' note-draft-ticket-on' : ''}`}
            aria-pressed={ticket}
            title={ticket ? t('메모로 쓰기') : t('티켓으로 쓰기')}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => setDraftTicket((current) => (current === null ? t('새 티켓') : null))}
          >
            <Ticket size={13} weight={ticket ? 'fill' : 'bold'} aria-hidden="true" />
            <span>{t('티켓')}</span>
          </button>
        ) : null
        const region = highlight.kind === 'region'
        const collapsedFirst = highlight.kind !== 'region' && openQuotes?.has(highlight.id) !== true
        return (
          <Fragment key={item.key}>
          <div
            ref={register(item.key)}
            className={[
              'pdf-memo-card',
              'pdf-memo-card-flow',
              'note-block',
              ticket ? 'note-ticket' : '',
              region ? 'note-memo-region' : '',
              `pdf-memo-card-${highlight.color}`,
              active ? 'pdf-memo-card-active' : '',
              editing ? 'pdf-memo-card-editing' : '',
              draft ? 'pdf-memo-card-draft' : '',
              matches ? '' : 'pdf-memo-card-dim',
              collapsedFirst ? 'pdf-memo-card-collapsed' : '',
              selected.has(item.key) ? 'note-block-selected' : '',
              attachingKey === item.key ? 'note-block-attaching' : '',
              ...shellClass(item.key, index),
            ].filter(Boolean).join(' ')}
            data-memo-id={highlight.id}
            data-note-block={item.key}
            onPointerDown={renamingTicket === item.key ? undefined : startBlockDrag(item.key)}
            onClickCapture={pickBlock(item.key)}
            onPointerEnter={(event) => {
              onActivate(item.key)
              showTip(item.key, tipLabel)(event)
            }}
            onPointerLeave={() => {
              onActivate(null)
              setTip((current) => (current?.key === item.key ? null : current))
            }}
            onContextMenu={openMenu(item.key)}
          >
            {draftTicketButton}
            {/* 메모: 원문 → 내 글. 티켓: 제목 → 내 글 → 원문(Req 문구) */}
            {ticketTitle}
            {ticket ? null : sourceList}
            {memo}
            {ticket ? sourceList : null}
            {grip(item.key)}
            {menuButton(item.key)}
          </div>
          {gapAfter(item.key)}
          </Fragment>
        )
      })}
      {onAppendText === undefined ? null : (
        // 맨 아래 빈 곳: 누르면 노트 끝에 새 글
        <div className="note-tail" role="button" tabIndex={-1} aria-label={t('끝에 글 쓰기')} onClick={onAppendText}>
          <span>{t('여기를 눌러 글 쓰기')}</span>
        </div>
      )}

      {zoomed !== null ? (() => {
        const rect = zoomed.anchor.rects[0]
        const pageSize = pageSizeOf(zoomed) ?? zoomed.pageSize
        if (rect === undefined || pageSize === undefined) return null
        // 메모 바(쌓임 맥락) 밖, 문서 맨 위에 띄운다
        return createPortal(
          <div className="note-zoom" role="dialog" aria-label={t('그림 크게 보기')} onClick={() => setZoomed(null)}>
            <div className="note-zoom-figure" style={{ width: `min(92vw, ${(86 * rect.w) / rect.h}vh)` }}>
              <RegionCrop highlight={zoomed} pageSize={pageSize} maxWidth={1600} fill />
            </div>
          </div>,
          document.body,
        )
      })() : null}
      {menu !== null && menuItem !== undefined ? createPortal(
        <>
          <div className="note-menu-backdrop" onPointerDown={() => setMenu(null)} onContextMenu={(event) => { event.preventDefault(); setMenu(null) }} />
          <div
            className="note-menu"
            role="menu"
            aria-label={t('블록 작업')}
            style={{ left: menu.x, top: menu.y }}
            ref={(element) => {
              if (element === null) return
              const rect = element.getBoundingClientRect()
              if (rect.bottom > window.innerHeight - 8) element.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`
              if (rect.right > window.innerWidth - 8) element.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`
            }}
          >
            {menuItem.kind === 'memo' ? (
              <>
                <div className="note-menu-row" role="group" aria-label={t('별점')}>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={menuItem.highlight.rating === value}
                      aria-label={t('별 {count}개', { count: value })}
                      className={`pdf-memo-star${(menuItem.highlight.rating ?? 0) >= value ? ' pdf-memo-star-on' : ''}`}
                      onClick={run(() => onRate(menuItem.highlight.id, menuItem.highlight.rating === value ? 0 : value))}
                    >
                      <Star size={14} weight={(menuItem.highlight.rating ?? 0) >= value ? 'fill' : 'regular'} aria-hidden="true" />
                    </button>
                  ))}
                </div>
                {onAddRef !== undefined ? (
                  <button type="button" role="menuitem" onClick={run(() => onAddRef(menuItem.key))}>{t('원문 더하기')}</button>
                ) : null}
                {onSetTicket !== undefined && menuItem.ticketTitle === undefined ? (
                  <button type="button" role="menuitem" onClick={run(() => {
                    onSetTicket(menuItem.key, t('새 티켓'))
                    setRenamingTicket(menuItem.key)
                  })}>{t('티켓으로 바꾸기')}</button>
                ) : null}
                {onSetTicket !== undefined && menuItem.ticketTitle !== undefined ? (
                  <>
                    <button type="button" role="menuitem" onClick={run(() => setRenamingTicket(menuItem.key))}>{t('티켓 제목 바꾸기')}</button>
                    <button type="button" role="menuitem" onClick={run(() => onSetTicket(menuItem.key, null))}>{t('메모로 되돌리기')}</button>
                  </>
                ) : null}
                {menuItem.highlight.kind === 'region' || menuItem.ticketTitle !== undefined ? null : (
                  <button type="button" role="menuitem" onClick={run(() => onToggleCollapse(menuItem.highlight.id, openQuotes?.has(menuItem.highlight.id) === true))}>
                    {openQuotes?.has(menuItem.highlight.id) === true ? t('원문 접기') : t('원문 펼치기')}
                  </button>
                )}
                {menuItem.highlight.kind === 'region' ? (
                  <button type="button" role="menuitem" onClick={run(() => setZoomed(menuItem.highlight))}>{t('그림 크게 보기')}</button>
                ) : null}
                <button type="button" role="menuitem" onClick={run(() => onJump(menuItem.highlight))}>{t('PDF 에서 보기')}</button>
                <hr />
              </>
            ) : null}
            {menuItem.kind === 'section' ? (
              <button type="button" role="menuitem" onClick={run(() => onEdit(menuItem.key))}>{t('이름 바꾸기')}</button>
            ) : null}
            {onInsertSection !== undefined ? (
              <button type="button" role="menuitem" onClick={run(() => onInsertSection(menuItem.key))}>{t('위에 소제목 넣기')}</button>
            ) : null}
            {onInsertText !== undefined ? (
              <button type="button" role="menuitem" onClick={run(() => onInsertText(menuItem.key))}>{t('아래에 글 넣기')}</button>
            ) : null}
            <hr />
            {menuItem.kind === 'memo' ? (
              <button type="button" role="menuitem" className="note-menu-danger" onClick={run(() => onDeleteMemo(menuItem.highlight.id))}>{t('형광펜과 메모 지우기')}</button>
            ) : menuItem.kind === 'text' ? (
              <button type="button" role="menuitem" className="note-menu-danger" onClick={run(() => onRemoveText(menuItem.key))}>{t('글 지우기')}</button>
            ) : (
              <button type="button" role="menuitem" className="note-menu-danger" onClick={run(() => onRemoveSection?.(menuItem.key))}>{t('소제목 지우기(블록은 남김)')}</button>
            )}
          </div>
        </>,
        document.body,
      ) : null}
    </>
  )
}
