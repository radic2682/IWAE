import { Fragment, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CaretDown, CaretRight, CaretUp, Crosshair, DotsThree, Hash, LinkSimple, MagnifyingGlassPlus, PencilSimple, Plus, Star, TextAlignLeft, TextHOne, Translate, Trash, X, XCircle } from '@phosphor-icons/react'
import { MemoEditor, MemoNoteView, type MemoContent } from './MemoColumn'
import { RegionCrop } from './RegionCrop'
import { MarkdownRegionCrop } from './MarkdownRegionCrop'
import { cachedTranslation, translateWithCache, useTranslationCache } from '../app/translationCacheStore'
import { t } from '../i18n'
import { popIn, slideFrom } from '../app/motion'
import type { PdfHighlightColor, PersistentPdfHighlight } from './persistentHighlight'
import { splitLeadingTicketId, suggestTicketIds, type MemoTicket } from '../core/memoNote'
import '../ui/note-ticket.css'

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
      /** 사용자가 붙인 자유 ID(REQ-01, TODO …)와 제목. 차례는 늘 ID·제목 → 내 글 → 원문 */
      readonly ticket?: MemoTicket
      /** 이 메모에 더 단 원문(형광펜). 첫 원문은 highlight */
      readonly extraHighlights?: readonly PersistentPdfHighlight[]
    }
  | { readonly kind: 'text'; readonly key: string; readonly text: string; readonly html?: string }
  /** 소제목: 다음 소제목까지 묶는다. count = 묶인 블록 수 */
  | { readonly kind: 'section'; readonly key: string; readonly title: string; readonly collapsed: boolean; readonly count: number }


/**
 * 노트 한 장을 한 편의 글처럼 잇는다(메모 바가 PDF 와 따로 스크롤한다). 블록은 바탕·테두리 없이 이어지고,
 * 마우스를 올린 블록만 오른쪽 위 메뉴(…)가 보인다. 블록 어디든 잡고 끌어 차례를 바꾼다.
 * - 메모 블록: 내 메모가 먼저, 원문은 형광펜 색 한 줄 출처 칩으로 접혀 있다가 펼친다. 표·그림 메모는 그림을 폭에 맞춰 크게.
 * - 블록 사이에 마우스를 올리면 + (그 자리에 글 넣기), 맨 아래 빈 곳을 누르면 끝에 새 글.
 * - 글 블록 끝에서 Enter 두 번(또는 Ctrl+Enter)이면 그 아래 새 글 블록.
 * - 블록 어디든(또는 손잡이를) 잡고 끌어 차례를 바꾼다(소제목은 묶인 블록과 함께).
 * 카드마다의 자리를 onCardLayout 으로 알린다(형광펜 → 카드 선은 바깥에서 그린다).
 */

/** 메뉴 항목: 같은 크기의 아이콘 칸 + 글자 */
function menuLabel(icon: ReactNode, label: string) {
  return (
    <>
      <span className="note-menu-icon" aria-hidden="true">{icon}</span>
      <span className="note-menu-label">{label}</span>
    </>
  )
}

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
  /** 메모 글 저장. 새 메모(draft) 글 맨 앞에 ID 를 썼으면 ticket 도 준다 */
  readonly onSaveMemo: (highlightId: string, content: MemoContent, ticket?: MemoTicket) => void
  readonly onCancelDraft: () => void
  readonly onSaveText: (key: string, content: MemoContent) => void
  readonly onRemoveText: (key: string) => void
  readonly onRecolor: (highlightId: string, color: PdfHighlightColor) => void
  readonly onDeleteMemo: (highlightId: string) => void
  readonly onToggleCollapse: (highlightId: string, collapsed: boolean) => void
  readonly onRate: (highlightId: string, rating: number) => void
  /** key 의 카드를 beforeKey 카드 앞으로(null 이면 맨 끝) */
  /** 블록(들)을 beforeKey 앞으로. 여럿이면 그 차례대로 한 번에 */
  readonly onMove: (key: string | readonly string[], beforeKey: string | null) => void
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
  /** 메모 블록의 ID·제목을 바꾼다. 둘 다 비거나 null 이면 그냥 메모 */
  readonly onSetTicket?: (key: string, ticket: MemoTicket | null) => void
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

  // 블록이 생기고·지워지고·순서가 바뀌면 이웃이 새 자리로 스프링으로 미끄러지고(FLIP), 새 블록은 떠오른다.
  // 끄는 중에는 손이 만든 자리라 움직이지 않는다. 처음 그릴 때와 노트를 통째로 바꿀 때(겹치는 블록이 없을 때)도 조용하다
  const flipTopsRef = useRef<Map<string, number> | null>(null)
  useLayoutEffect(() => {
    const tops = new Map<string, number>()
    for (const [key, element] of cardRefs.current) tops.set(key, element.offsetTop)
    const previous = flipTopsRef.current
    flipTopsRef.current = tops
    if (previous === null || previous.size === 0 || document.body.classList.contains('note-block-dragging')) return
    const kept = [...tops.keys()].filter((key) => previous.has(key))
    if (kept.length === 0) return
    for (const key of kept) {
      const element = cardRefs.current.get(key)
      const before = previous.get(key)
      if (element !== undefined && before !== undefined) slideFrom(element, 'y', before - (tops.get(key) ?? before))
    }
    const added = [...tops.keys()].filter((key) => !previous.has(key))
    // 쓰던 새 메모(draft)가 저장되어 진짜 블록으로 바뀐 것은 새로 생긴 게 아니다
    const draftSaved = previous.has('draft') && !tops.has('draft')
    if (!draftSaved && added.length > 0 && added.length <= 2) for (const key of added) { const element = cardRefs.current.get(key); if (element !== undefined) popIn(element) }
  })
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
  // 고른 블록(아래에서 정한다): 끌기가 함께 옮길 블록을 알게
  const selectedRef = useRef<ReadonlySet<string>>(new Set())
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
      // 여러 블록을 골라 둔 채 그중 하나를 끌면 고른 블록을 모두(문서 차례대로) 그 자리로 옮긴다
      const picked = selectedRef.current
      if (picked.size > 1 && picked.has(state.key)) {
        const keys = items.filter((item) => picked.has(item.key) && item.key !== 'draft').map((item) => item.key)
        const moved = new Set(keys.flatMap((pickedKey) => groupOf(pickedKey)))
        const before = items.slice(state.drop).find((item) => !moved.has(item.key) && item.key !== 'draft')
        onMove(keys, before?.key ?? null)
        return
      }
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
  // 끄는 중인 블록(고른 블록 여럿을 끌면 그 모두)
  const draggedGroupOf = (): readonly string[] => {
    if (dragging === null) return []
    const picked = selectedRef.current
    return picked.size > 1 && picked.has(dragging.key) ? [...picked].flatMap((key) => groupOf(key)) : groupOf(dragging.key)
  }
  const shellClass = (key: string, index: number) => {
    const draggedGroup = draggedGroupOf()
    return [
    draggedGroup.includes(key) ? 'pdf-memo-card-dragging' : '',
    dragging !== null && !draggedGroup.includes(key) && dragging.drop === index ? 'pdf-memo-card-drop-before' : '',
    dragging !== null && !draggedGroup.includes(key) && dragging.drop === items.length && index === items.length - 1 ? 'pdf-memo-card-drop-after' : '',
    ]
  }
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
  const menuButton = (key: string, inTab = false) => key === 'draft' ? null : (
    <button
      type="button"
      className={inTab ? 'note-tab-btn note-tab-more' : 'note-block-menu'}
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
  /** 블록 사이: 마우스를 올리면 + 가 나타나 그 자리(key 블록 아래)에 글을 넣는다 */
  const gapAfter = (key: string) => key === 'draft' || onInsertText === undefined ? <div className="note-gap" aria-hidden="true" /> : (
    <div className="note-gap">
      <button type="button" className="note-gap-add" aria-label={t('여기에 글 넣기')} title={t('여기에 글 넣기')} onClick={() => onInsertText(key)}>
        <Plus size={11} weight="bold" aria-hidden="true" />
      </button>
    </div>
  )
  const menuItem = menu === null ? undefined : items.find((item) => item.key === menu.key)

  // ---------- 여러 블록 고르기: Ctrl/⌘+누르기는 하나씩, Shift+누르기는 그 사이 모두. Delete 로 지운다 ----------
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  selectedRef.current = selected
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
      // 고른 블록 위에서 누르면(끌어 함께 옮기려는 것) 고르기를 유지한다
      const block = target?.closest<HTMLElement>('[data-note-block]')
      if (block?.dataset.noteBlock !== undefined && selectedRef.current.has(block.dataset.noteBlock)) return
      setSelected(new Set())
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [selected])

  // 출처 번역(형광펜 id → 번역 줄). 캐시(번역 기록)를 함께 쓴다
  const translationCache = useTranslationCache()
  const [translations, setTranslations] = useState<ReadonlyMap<string, { readonly status: 'loading' | 'done' | 'error'; readonly text: string }>>(() => new Map())
  const setTranslation = (id: string, value: { readonly status: 'loading' | 'done' | 'error'; readonly text: string } | null) => setTranslations((current) => {
    const next = new Map(current)
    if (value === null) next.delete(id)
    else next.set(id, value)
    return next
  })
  const toggleTranslation = (source: PersistentPdfHighlight) => {
    if (translations.has(source.id)) { setTranslation(source.id, null); return }
    const quote = source.anchor.quote
    const hit = cachedTranslation(quote)
    if (hit !== undefined) { setTranslation(source.id, { status: 'done', text: hit }); return }
    setTranslation(source.id, { status: 'loading', text: '' })
    translateWithCache(quote, { docId: source.anchor.docId, page: source.anchor.page })
      .then((text) => setTranslation(source.id, text === null ? { status: 'error', text: t('번역하지 못했습니다. 설정 → 번역을 확인해 주세요') } : { status: 'done', text }))
      .catch((error: unknown) => setTranslation(source.id, { status: 'error', text: error instanceof Error ? error.message : String(error) }))
  }
  // ID 나 제목을 고치는 중인 블록과 칸
  const [headEdit, setHeadEdit] = useState<{ readonly key: string; readonly field: 'id' | 'title' } | null>(null)
  // 이 노트에서 쓴 ID 들(다음 번호 제안·겹침 알림)
  const usedIds = items.flatMap((item) => (item.kind === 'memo' && item.ticket?.id !== undefined ? [{ key: item.key, id: item.ticket.id }] : []))
  // ID·제목 저장: 비운 칸은 지운다(둘 다 비면 그냥 메모)
  // 새 메모(아직 블록이 아니다)에 붙인 ID·제목: 저장할 때 같이 넘긴다
  const [draftHead, setDraftHead] = useState<MemoTicket | undefined>(undefined)
  const hasDraftItem = items.some((item) => item.key === 'draft')
  useEffect(() => { if (!hasDraftItem) setDraftHead(undefined) }, [hasDraftItem])
  const saveHead = (key: string, current: MemoTicket | undefined, field: 'id' | 'title', value: string) => {
    setHeadEdit(null)
    const next = { ...current, [field]: value.trim() }
    if ((next.id ?? '') === (current?.id ?? '') && (next.title ?? '') === (current?.title ?? '')) return
    if (key === 'draft') {
      const id = (next.id ?? '').trim()
      const title = (next.title ?? '').trim()
      setDraftHead(id === '' && title === '' ? undefined : { ...(id === '' ? {} : { id }), ...(title === '' ? {} : { title }) })
      // 다시 메모 칸으로(새 메모는 메모 칸에서 벗어나면 사라지므로)
      window.setTimeout(() => document.querySelector<HTMLElement>('[data-note-block="draft"] .pdf-memo-editor')?.focus(), 0)
      return
    }
    onSetTicket?.(key, next)
  }
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
              <span className="note-selection-hint">{t('끌어서 함께 옮기기')}</span>
              <button type="button" className="note-selection-danger" onClick={() => setConfirmDelete(true)}>{t('지우기')}</button>
              <button type="button" onClick={() => setSelected(new Set())}>{t('고르기 풀기')}</button>
            </>
          )}
        </div>
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
          || `${item.ticket?.id ?? ''} ${item.ticket?.title ?? ''}`.toLowerCase().includes(needle)
        const ticket = draft ? draftHead : item.ticket
        const hasHead = ticket !== undefined
        // 출처(PDF 이름 · 쪽)는 블록에 마우스를 올렸을 때 블록 바깥 오른쪽 위에 뜬다
        // Markdown 에는 쪽이 없다: 쪽 번호 없이 문서 이름만
        const pages = [...new Set(sources.filter((source) => !isMarkdownSource(source)).map((source) => `p.${source.anchor.page + 1}`))]
        const tipLabel = `${item.sourceLabel ?? item.docLabel ?? 'PDF'}${pages.length > 0 ? ` · ${pages.join(', ')}` : ''}${draft ? ` · ${t('새 메모')}` : ''}`
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
          // 원문 번역: 출처 줄 끝의 작은 단추. 캐시에 있으면 바로, 없으면 번역기에 묻는다
          const shown = translations.get(source.id)
          const translateButton = translationCache.ready && source.anchor.quote.trim() !== '' ? (
            <button
              type="button"
              className={`note-source-translate${shown !== undefined ? ' note-source-translate-on' : ''}`}
              aria-label={shown !== undefined ? t('번역 숨기기') : t('번역 보기')}
              aria-pressed={shown !== undefined}
              title={shown !== undefined ? t('번역 숨기기') : t('번역 보기')}
              onClick={(event) => {
                event.stopPropagation()
                toggleTranslation(source)
              }}
            >
              <Translate size={13} aria-hidden="true" />
            </button>
          ) : null
          const translationLine = shown === undefined ? null : (
            <div key={`${source.id}:translation`} className={`note-source-translation${shown.status === 'error' ? ' note-source-translation-error' : ''}`} role="status">
              {shown.status === 'loading' ? t('번역 중…') : shown.text}
            </div>
          )
          if (collapsed) {
            return (
              <Fragment key={source.id}>
              <div className="note-source-chip" data-hl={source.color} title={t('원문에서 보기')} role="button" tabIndex={draft ? undefined : 0} onClick={draft ? undefined : () => onJump(source)} onKeyDown={(event) => { if (!draft && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onJump(source) } }}>
                <button type="button" className="note-source-expand" aria-label={t('원문 펼치기')} title={t('원문 펼치기')} onClick={(event) => {
                  event.stopPropagation()
                  onToggleCollapse(source.id, false)
                }}>
                  <CaretRight size={11} weight="bold" aria-hidden="true" />
                </button>
                {meta}
                <span className="note-source-chip-text">{source.kind === 'region' ? t('표·그림') : source.anchor.quote.replace(/\s+/gu, ' ').trim()}</span>
                {isMarkdownSource(source) ? null : <span className="note-source-page">p.{source.anchor.page + 1}</span>}
                {translateButton}
                {remove}
              </div>
              {translationLine}
              </Fragment>
            )
          }
          if (source.kind === 'region' && source.snapshot !== undefined) {
            return (
              <div key={source.id} className="pdf-memo-card-source note-source-region" onClick={draft ? undefined : () => onJump(source)}>
                {meta}
                <MarkdownRegionCrop highlight={source} />
                {remove}
              </div>
            )
          }
          const pageSize = source.kind === 'region' ? pageSizeOf(source) ?? source.pageSize : undefined
          if (source.kind === 'region' && pageSize !== undefined) {
            // 스캔 쪽의 영역은 OCR 로 읽은 글자가 원문에 있다: 번역 단추와 번역 줄을 같이 단다
            return (
              <Fragment key={source.id}>
                <div className="pdf-memo-card-source note-source-region" onClick={draft ? undefined : () => onJump(source)}>
                  {meta}
                  <RegionCrop highlight={source} pageSize={pageSize} maxWidth={480} fill />
                  {remove}
                  {translateButton === null ? null : <span className="note-region-translate">{translateButton}</span>}
                </div>
                {translationLine}
              </Fragment>
            )
          }
          return (
            <div
              key={source.id}
              className="pdf-memo-card-quote note-source"
              data-hl={source.color}
              title={t('원문에서 보기')}
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
              {isMarkdownSource(source) ? null : <span className="note-source-page">p.{source.anchor.page + 1}</span>}
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
            discardEmptyOnBlur={draft}
            placeholder={!draft ? t('메모를 쓰세요')
              : highlight.kind === 'region' ? t('설명을 쓰세요 (안 쓰고 다른 곳을 누르면 사라집니다 · 그림만 남기려면 Ctrl+Enter)')
                : t('메모를 쓰세요 (안 쓰고 다른 곳을 누르면 사라집니다)')}
            onSave={(content) => {
              // 아직 ID 가 없는데 글 맨 앞에 「REQ-04 」처럼 썼으면 그 낱말을 ID 배지로 옮긴다
              const leading = ticket?.id === undefined && onSetTicket !== undefined ? splitLeadingTicketId(content.text) : null
              if (leading === null) {
                if (draft) onSaveMemo(highlight.id, content, draftHead)
                else onSaveMemo(highlight.id, content)
              } else {
                const stripped = { text: leading.rest, html: stripLeadingWord(content.html, leading.id) }
                if (draft) onSaveMemo(highlight.id, stripped, { ...draftHead, id: leading.id })
                else {
                  onSaveMemo(highlight.id, stripped)
                  onSetTicket?.(item.key, { ...ticket, id: leading.id })
                }
              }
              onEdit(null)
            }}
            onCancel={() => {
              if (draft) onCancelDraft()
              onEdit(null)
            }}
          />
        ) : (highlight.note ?? '').trim() === '' && (highlight.noteHtml ?? '') === '' ? (
          // 메모 없는 형광펜: 빈 줄 대신, 마우스를 올렸을 때만 오른쪽 위 탭의 「메모 쓰기」
          null
        ) : (
          <MemoNoteView note={highlight.note} noteHtml={highlight.noteHtml} onEdit={() => onEdit(item.key)} onChange={(content) => onSaveMemo(highlight.id, content)} />
        )
        // 머리: ID 배지와 제목. 비어 있는 칸은 마우스를 올렸을 때 오른쪽 위에 「+ ID」「+ 제목」으로만 보인다
        const editingId = headEdit?.key === item.key && headEdit.field === 'id'
        const editingTitle = headEdit?.key === item.key && headEdit.field === 'title'
        const canHead = onSetTicket !== undefined
        const idInput = editingId ? (
          <TicketIdInput
            initial={ticket?.id ?? ''}
            suggestions={suggestTicketIds(usedIds.map((used) => used.id))}
            taken={usedIds.filter((used) => used.key !== item.key).map((used) => used.id)}
            onDone={(value) => saveHead(item.key, ticket, 'id', value)}
            onCancel={() => setHeadEdit(null)}
          />
        ) : null
        const titleInput = editingTitle ? (
          <input
            className="note-ticket-title-input"
            aria-label={t('제목')}
            placeholder={t('제목')}
            defaultValue={ticket?.title ?? ''}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => saveHead(item.key, ticket, 'title', event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              else if (event.key === 'Escape') { event.stopPropagation(); setHeadEdit(null) }
            }}
          />
        ) : null
        const head = hasHead || editingId || editingTitle ? (
          <div className="note-ticket-head">
            {(ticket?.id !== undefined || editingId) ? (
              <div className="note-ticket-id-row">
                {idInput ?? (
                  <button type="button" className="note-ticket-id" title={t('ID 바꾸기')} onClick={canHead ? () => setHeadEdit({ key: item.key, field: 'id' }) : undefined}>{ticket?.id}</button>
                )}
              </div>
            ) : null}
            {titleInput ?? (ticket?.title !== undefined ? (
              <div className="note-ticket-title" title={canHead ? t('두 번 눌러 제목 바꾸기') : undefined} onDoubleClick={canHead ? () => setHeadEdit({ key: item.key, field: 'title' }) : undefined}>
                <span>{ticket.title}</span>
              </div>
            ) : null)}
          </div>
        ) : null
        const memoEmpty = !editing && (highlight.note ?? '').trim() === '' && (highlight.noteHtml ?? '') === ''
        // 새 메모는 쓰는 중에도 「+ ID」「+ 제목」을 보인다(눌러도 메모 칸 포커스를 뺏지 않는다)
        const showHeadButtons = canHead && !editingId && !editingTitle && (!editing || draft)
        const tabButtons = [
          memoEmpty && !draft && (canHead ? showHeadButtons : true)
            ? <button key="memo" type="button" className="note-tab-btn" onClick={() => onEdit(item.key)}>{t('메모 쓰기')}</button> : null,
          showHeadButtons && ticket?.id === undefined ? <button key="id" type="button" className="note-tab-btn" onClick={() => setHeadEdit({ key: item.key, field: 'id' })}>{t('+ ID')}</button> : null,
          showHeadButtons && ticket?.title === undefined ? <button key="title" type="button" className="note-tab-btn" onClick={() => setHeadEdit({ key: item.key, field: 'title' })}>{t('+ 제목')}</button> : null,
          editing ? null : menuButton(item.key, true),
        ].filter(Boolean)
        // 호버: 테두리가 형광펜 색이 되고, 위 테두리 양 끝에 출처 탭(왼쪽)과 단추 탭(오른쪽)이 붙는다
        const tabs = (
          <div className="note-block-tabs">
            <div className="note-tab note-tab-l"><span title={tipLabel}>{tipLabel}</span></div>
            {tabButtons.length > 0 ? <div className="note-tab note-tab-r">{tabButtons}</div> : null}
          </div>
        )
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
              hasHead ? 'note-ticket' : '',
              region ? 'note-memo-region' : '',
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
            data-hl={highlight.color}
            data-note-block={item.key}
            // 키보드로도 닿는다: Tab 으로 카드에 와서 Enter 면 원문으로 점프(연결선도 함께 켜진다)
            tabIndex={draft ? undefined : 0}
            role="group"
            aria-label={tipLabel}
            onFocus={(event) => { if (event.target === event.currentTarget) onActivate(item.key) }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || draft || event.key !== 'Enter') return
              event.preventDefault()
              onJump(highlight)
            }}
            onPointerDown={headEdit?.key === item.key ? undefined : startBlockDrag(item.key)}
            onClickCapture={pickBlock(item.key)}
            onPointerEnter={() => onActivate(item.key)}
            onPointerLeave={() => onActivate(null)}
            onContextMenu={openMenu(item.key)}
          >
            {/* 늘 같은 차례: ID·제목 → 내 글 → 원문(출처) */}
            {head}
            {memo}
            {sourceList}
            {tabs}
          </div>
          {gapAfter(item.key)}
          </Fragment>
        )
      })}
      {onAppendText === undefined ? null : (
        // 맨 아래 빈 곳: 한 번 누르면 쓰던 것·고른 것을 놓고, 두 번 누르면 노트 끝에 새 글
        <div
          className="note-tail"
          role="button"
          tabIndex={-1}
          aria-label={t('끝에 글 쓰기')}
          onClick={() => {
            setSelected(new Set())
            setHeadEdit(null)
            onEdit(null)
            onActivate(null)
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
          }}
          onDoubleClick={onAppendText}
        >
          <span>{t('두 번 눌러 글 쓰기')}</span>
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
            tabIndex={-1}
            aria-label={t('블록 작업')}
            style={{ left: menu.x, top: menu.y }}
            ref={(element) => {
              if (element === null) return
              const rect = element.getBoundingClientRect()
              if (rect.bottom > window.innerHeight - 8) element.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`
              if (rect.right > window.innerWidth - 8) element.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`
              // 메뉴 틀에 초점을 두어 Escape·화살표가 듣게 한다. 첫 항목에 두면(앞서 키보드를 썼을 때) 열자마자 칠해진다
              if (!element.contains(document.activeElement)) element.focus({ preventScroll: true })
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setMenu(null)
                return
              }
              const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]'))
              const at = items.indexOf(document.activeElement as HTMLButtonElement)
              const next = event.key === 'ArrowDown' ? (at + 1) % items.length
                : event.key === 'ArrowUp' ? (at <= 0 ? items.length - 1 : at - 1)
                  : event.key === 'Home' ? 0
                    : event.key === 'End' ? items.length - 1
                      : null
              if (next === null || items.length === 0) return
              event.preventDefault()
              items[next]?.focus()
            }}
          >
            {menuItem.kind === 'memo' ? (
              <>
                <div className="note-menu-row note-menu-rating" role="group" aria-label={t('중요도(별점)')}>
                  <span className="note-menu-row-label">{t('중요도')}</span>
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
                  <button type="button" role="menuitem" onClick={run(() => onAddRef(menuItem.key))}>{menuLabel(<LinkSimple size={15} />, t('원문 더하기'))}</button>
                ) : null}
                {onSetTicket !== undefined && menuItem.draft !== true ? (
                  <>
                    <button type="button" role="menuitem" onClick={run(() => setHeadEdit({ key: menuItem.key, field: 'id' }))}>{menuLabel(<Hash size={15} />, menuItem.ticket?.id === undefined ? t('ID 붙이기') : t('ID 바꾸기'))}</button>
                    <button type="button" role="menuitem" onClick={run(() => setHeadEdit({ key: menuItem.key, field: 'title' }))}>{menuLabel(<PencilSimple size={15} />, menuItem.ticket?.title === undefined ? t('제목 붙이기') : t('제목 바꾸기'))}</button>
                    {menuItem.ticket !== undefined ? (
                      <button type="button" role="menuitem" onClick={run(() => onSetTicket(menuItem.key, null))}>{menuLabel(<XCircle size={15} />, t('ID·제목 지우기'))}</button>
                    ) : null}
                  </>
                ) : null}
                {menuItem.highlight.kind === 'region' ? null : (
                  <button type="button" role="menuitem" onClick={run(() => onToggleCollapse(menuItem.highlight.id, openQuotes?.has(menuItem.highlight.id) === true))}>
                    {openQuotes?.has(menuItem.highlight.id) === true ? menuLabel(<CaretUp size={15} />, t('원문 접기')) : menuLabel(<CaretDown size={15} />, t('원문 펼치기'))}
                  </button>
                )}
                {menuItem.highlight.kind === 'region' ? (
                  <button type="button" role="menuitem" onClick={run(() => setZoomed(menuItem.highlight))}>{menuLabel(<MagnifyingGlassPlus size={15} />, t('그림 크게 보기'))}</button>
                ) : null}
                <button type="button" role="menuitem" onClick={run(() => onJump(menuItem.highlight))}>{menuLabel(<Crosshair size={15} />, t('원문에서 보기'))}</button>
                <hr />
              </>
            ) : null}
            {menuItem.kind === 'section' ? (
              <button type="button" role="menuitem" onClick={run(() => onEdit(menuItem.key))}>{menuLabel(<PencilSimple size={15} />, t('이름 바꾸기'))}</button>
            ) : null}
            {onInsertSection !== undefined ? (
              <button type="button" role="menuitem" onClick={run(() => onInsertSection(menuItem.key))}>{menuLabel(<TextHOne size={15} />, t('위에 소제목 넣기'))}</button>
            ) : null}
            {onInsertText !== undefined ? (
              <button type="button" role="menuitem" onClick={run(() => onInsertText(menuItem.key))}>{menuLabel(<TextAlignLeft size={15} />, t('아래에 글 넣기'))}</button>
            ) : null}
            <hr />
            {menuItem.kind === 'memo' ? (
              <button type="button" role="menuitem" className="note-menu-danger" onClick={run(() => onDeleteMemo(menuItem.highlight.id))}>{menuLabel(<Trash size={15} />, t('형광펜과 메모 지우기'))}</button>
            ) : menuItem.kind === 'text' ? (
              <button type="button" role="menuitem" className="note-menu-danger" onClick={run(() => onRemoveText(menuItem.key))}>{menuLabel(<Trash size={15} />, t('글 지우기'))}</button>
            ) : (
              <button type="button" role="menuitem" className="note-menu-danger" onClick={run(() => onRemoveSection?.(menuItem.key))}>{menuLabel(<Trash size={15} />, t('소제목 지우기(블록은 남김)'))}</button>
            )}
          </div>
        </>,
        document.body,
      ) : null}
    </>
  )
}

/** html 맨 앞(태그 사이)의 낱말 하나와 뒤따르는 빈칸을 뗀다 */
function stripLeadingWord(html: string, word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return html.replace(new RegExp(`^((?:\\s|<[^>]+>)*)${escaped}(?:\\s|&nbsp;|\u00a0)+`, 'u'), '$1')
}

/** ID 입력칸: 아무 글이나 되고, 이 노트에서 쓴 ID 의 다음 번호를 제안하며, 이미 쓴 ID 면 알려 준다 */
function TicketIdInput({ initial, suggestions, taken, onDone, onCancel }: {
  readonly initial: string
  readonly suggestions: readonly string[]
  readonly taken: readonly string[]
  readonly onDone: (value: string) => void
  readonly onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const [pick, setPick] = useState(-1)
  const done = useRef(false)
  const needle = value.trim().toLowerCase()
  const shown = suggestions.filter((suggestion) => needle === '' || suggestion.toLowerCase().startsWith(needle)).filter((suggestion) => suggestion.toLowerCase() !== needle).slice(0, 5)
  const duplicate = needle !== '' && taken.some((id) => id.toLowerCase() === needle)
  const finish = (next: string) => {
    if (done.current) return
    done.current = true
    onDone(next)
  }
  return (
    <div className="note-ticket-id-edit">
      <input
        className="note-ticket-id-input"
        aria-label={t('ID')}
        placeholder={suggestions[0] ?? 'REQ-01'}
        value={value}
        autoFocus
        size={Math.max(6, value.length + 1)}
        aria-invalid={duplicate}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => { setValue(event.target.value); setPick(-1) }}
        onBlur={() => finish(value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && shown.length > 0) { event.preventDefault(); setPick((at) => (at + 1) % shown.length) }
          else if (event.key === 'ArrowUp' && shown.length > 0) { event.preventDefault(); setPick((at) => (at <= 0 ? shown.length - 1 : at - 1)) }
          else if (event.key === 'Tab' && shown.length > 0 && pick < 0 && value.trim() === '') { event.preventDefault(); setValue(shown[0] ?? '') }
          else if (event.key === 'Enter') { event.preventDefault(); finish(pick >= 0 ? shown[pick] ?? value : value) }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); done.current = true; onCancel() }
        }}
      />
      {shown.length > 0 ? (
        <div className="note-ticket-id-suggest" role="listbox" aria-label={t('ID 제안')}>
          {shown.map((suggestion, at) => (
            <button
              key={suggestion}
              type="button"
              role="option"
              aria-selected={at === pick}
              className={at === pick ? 'note-ticket-id-suggest-on' : undefined}
              onPointerDown={(event) => { event.preventDefault(); finish(suggestion) }}
            >
              {suggestion}{at === 0 && suggestions[0] === suggestion ? <span>{t('다음 번호')}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {duplicate ? <p className="note-ticket-id-warn" role="status">{t('이 노트에 이미 있는 ID 입니다')}</p> : null}
    </div>
  )
}

/** Markdown 문서의 원문인가(쪽 번호가 없다) */
function isMarkdownSource(source: PersistentPdfHighlight): boolean {
  return /\.(md|markdown|mdx)$/iu.test(source.anchor.docId)
}

