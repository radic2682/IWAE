import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { fitMenuInViewport } from '../ui/fitMenu'
import { createPortal } from 'react-dom'
import { CaretDown, CaretRight, CaretUp, Crosshair, DotsThree, Hash, LinkSimple, MagnifyingGlassPlus, MinusCircle, PencilSimple, Plus, Star, TextAlignLeft, TextHOne, Translate, Trash, X, XCircle } from '@phosphor-icons/react'
import { MemoEditor, MemoNoteView, type MemoContent } from './MemoEditor'
import { isMarkdownPath } from '../core/markdownPath'
import { RegionCrop } from './RegionCrop'
import { MarkdownRegionCrop } from './MarkdownRegionCrop'
import { cachedTranslation, translateWithCache, useTranslationCache } from '../app/translation/translationCacheStore'
import { t } from '../i18n'
import { fadeIn, reducedMotion, slideFrom } from '../app/motion'
import type { PdfHighlightColor, PersistentPdfHighlight } from './persistentHighlight'
import { insertBlock, memoBlock, removeBlock, splitLeadingTicketId, suggestTicketIds, updateSection, type MemoTicket } from '../core/memoNote'
import { ticketGroupOf, type TicketChoice, type TicketGroup, type TicketIndex, type TicketPlace } from '../core/memoTickets'
import { armClickSuppress } from '../ui/clickSuppress'
import { edgeScroll, firstBelowMidpoint, startBlockDragSession, type BlockDragSession } from './noteBlockDrag'
import { clearBlockReveal, onBlockRevealRequest, peekBlockReveal, revealNoteBlock, useMemoNoteApi, type MemoNoteApi } from './memoNoteContext'
import { usePaneChannel, useWorkspaceLink } from '../app/workspace/workspaceContext'
import { placementRevealMode } from '../app/workspace/workspaceRouting'
import { emitPointSignal } from '../app/workspace/workspaceSignal'
import { menuGuardActive } from '../app/workspace/menuGuard'
import { GapMenu, TicketBadge, TicketPicker, anchorOf, type AnchorBox } from './NoteTicketUi'
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
      /** 원문 문서가 이웃한 같은 색 창에 보이지 않는다: 「→ 문서 이름 p.N」 링크를 단다(누르면 그 문서를 보이게 하는 신호) */
      readonly farSource?: { readonly label: string; readonly page?: number }
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

function NoteFlowImpl({
  noteApiRef,
  revealRef: placementRef,
  tickets,
  openPath,
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
  embedded = false,
}: {
  /** 노트 기능(MemoNoteContext). 컨텍스트 값은 앱이 그릴 때마다 새 객체라서, 안에서는 늘 같은 ref 로 가장 새 값을 읽는다 */
  readonly noteApiRef: { readonly current: MemoNoteApi | null }
  /** 티켓의 다른 자리로 가기(곳 목록): 같은 색 창이 있으면 신호로, 아니면 이 화면에서 */
  readonly revealRef: { readonly current: (path: string, blockId: string, highlightId: string) => void }
  /** 노트 기능에서 카드 모양에 쓰는 값만 따로 받는다(이 값이 바뀔 때만 다시 그린다) */
  readonly tickets: TicketIndex | undefined
  readonly openPath: string | null
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
  /** 별점을 매긴다. 없으면 메뉴에 중요도 줄이 없다(별점을 담을 곳이 없는 캔버스 메모) */
  readonly onRate?: (highlightId: string, rating: number) => void
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
  /** 노트 목록이 아니라 다른 화면(캔버스) 안의 카드 한 장으로 쓴다: 끌어 차례 바꾸기·노트 사이 옮기기는 끈다(카드를 옮기는 일은 그 화면이 맡는다) */
  readonly embedded?: boolean
}) {
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const reportedRef = useRef('')
  const reportLayoutRef = useRef<() => void>(() => undefined)
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
    if (!draftSaved && added.length > 0 && added.length <= 2) for (const key of added) { const element = cardRefs.current.get(key); if (element !== undefined) fadeIn(element) }
  })
  const reportLayout = () => {
    const layout = new Map<string, { top: number; height: number }>()
    for (const [key, element] of cardRefs.current) layout.set(key, { top: element.offsetTop, height: element.offsetHeight })
    const signature = [...layout].map(([key, box]) => `${key}:${box.top}:${box.height}`).join('|')
    if (signature !== reportedRef.current) {
      reportedRef.current = signature
      onCardLayout(layout)
    }
  }
  reportLayoutRef.current = reportLayout
  useLayoutEffect(reportLayout)

  // ---------- 끌어 차례 바꾸기 ----------
  const [dragging, setDragging] = useState<{ key: string; drop: number } | null>(null)
  const draggingRef = useRef<{ key: string; drop: number } | null>(null)
  const dropIndexAt = (clientY: number) => {
    const index = firstBelowMidpoint(items.map((item) => cardRefs.current.get(item.key)?.getBoundingClientRect()), clientY)
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
    if ((event.target as Element).closest('button, input, textarea, select, a, [contenteditable="true"], .pdf-memo-editor, .format-bar') !== null) return
    const startX = event.clientX
    const startY = event.clientY
    const scroller = event.currentTarget.closest('.pdf-memo-bar-scroll')
    const card = event.currentTarget
    let started = false
    // 다른 노트 위로 가는 끌기(손에 붙는 모양 · 노트 사이 옮기기 · Alt 링크 · 탭 위에 머물러 열기)는 noteBlockDrag 가 맡는다
    let session: BlockDragSession | null = null
    const move = (moveEvent: PointerEvent) => {
      if (!started) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return
        started = true
        window.getSelection()?.removeAllRanges()
        document.body.classList.add('note-block-dragging')
        // 끈 뒤에 따라오는 click(고치기 열기 · 원문 접기)은 삼킨다: 손을 뗀 한 틱 뒤, Esc · 창 밖에서 뗀 끌기는 새로 누를 때 풀린다
        armClickSuppress()
        const picked = selectedRef.current
        const carryKeys = picked.size > 1 && picked.has(key) ? items.filter((item) => picked.has(item.key) && item.key !== 'draft').map((item) => item.key) : [key]
        session = startBlockDragSession({
          card,
          startX,
          startY,
          keys: carryKeys,
          sourcePath: openPath,
          snapSection: carryKeys.length === 1 && items.find((item) => item.key === key)?.kind === 'section',
          api: () => noteApiRef.current,
          onCancel: cancel,
          // 프레임 뒤에야 다른 노트 위가 된 것도 이 노트의 놓을 자리 줄을 지운다
          onCrossingChange: (crossing) => {
            if (crossing && draggingRef.current?.drop !== -1) {
              draggingRef.current = { key, drop: -1 }
              setDragging(draggingRef.current)
            }
          },
        })
      }
      moveEvent.preventDefault()
      if (session?.update(moveEvent).crossing === true) {
        // 다른 노트 위: 이 노트의 놓을 자리 줄은 지운다(받는 노트가 자기 줄을 그린다)
        if (draggingRef.current?.drop !== -1) {
          draggingRef.current = { key, drop: -1 }
          setDragging(draggingRef.current)
        }
        return
      }
      const next = { key, drop: dropIndexAt(moveEvent.clientY) }
      if (draggingRef.current?.drop !== next.drop) {
        draggingRef.current = next
        setDragging(next)
      }
      if (scroller !== null) edgeScroll(scroller, moveEvent.clientY)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      document.body.classList.remove('note-block-dragging')
      session?.dispose()
      session = null
      draggingRef.current = null
      setDragging(null)
    }
    // Esc: 아무것도 바꾸지 않고 끌기를 그만둔다
    const cancel = cleanup
    function finish(upEvent: PointerEvent) {
      const state = draggingRef.current
      // 다른 노트에 놓았으면(또는 Alt 인데 놓을 노트가 없어 그만두면) 여기서 끝난다. pointercancel 은 놓은 것이 아니다
      const handled = started && upEvent.type === 'pointerup' && (session?.drop() ?? false)
      cleanup()
      if (!started || state === null) return
      if (handled || upEvent.type === 'pointercancel') return
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
  // 끄는 중인 블록들은 한 번만 구한다(카드마다 구하면 블록 수의 제곱만큼 든다)
  const draggedGroup = new Set(draggedGroupOf())
  const shellClass = (key: string, index: number) => [
    draggedGroup.has(key) ? 'pdf-memo-card-dragging' : '',
    dragging !== null && !draggedGroup.has(key) && dragging.drop === index ? 'pdf-memo-card-drop-before' : '',
    dragging !== null && !draggedGroup.has(key) && dragging.drop === items.length && index === items.length - 1 ? 'pdf-memo-card-drop-after' : '',
  ].filter(Boolean).join(' ')

  // ---------- 우클릭 메뉴 ----------
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  // 글 블록을 쓰다 말고(Esc, 다른 자리 누르기) 비운 채 떠나면 그 빈 블록을 지운다 — 새로 넣은 빈 글이 노트에 남지 않게
  const previousEditingKey = useRef<string | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  useEffect(() => {
    const previous = previousEditingKey.current
    previousEditingKey.current = editingKey
    if (previous === null || previous === editingKey) return
    const left = itemsRef.current.find((item) => item.key === previous)
    if (left?.kind === 'text' && left.text.trim() === '') onRemoveText(previous)
  }, [editingKey, onRemoveText])
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
  /** 블록 사이: 마우스를 올리면 + 가 나타나 그 자리(key 블록 아래)에 글을 넣는다 */
  // 노트 기능(MemoNoteContext)이 있으면 +는 「글 넣기 / 티켓 넣기」 메뉴를 열고, 없으면 바로 글을 넣는다
  const noteApi = noteApiRef.current
  const canPickTicket = tickets !== undefined && noteApi?.highlightOf !== undefined && openPath !== null
  const [gapMenu, setGapMenu] = useState<{ key: string; anchor: AnchorBox } | null>(null)
  const [ticketPick, setTicketPick] = useState<{ key: string; anchor: AnchorBox } | null>(null)
  /** 고른 티켓을 key 블록 아래에 같은 형광펜을 가리키는 메모 블록으로 넣고 그 블록을 보인다 */
  const insertTicketBlock = (key: string, choice: TicketChoice) => {
    if (noteApi === null || noteApi.openPath === null) return
    const block = memoBlock(choice.highlightId, choice.ticket)
    noteApi.updateOpen((note) => {
      const at = note.blocks.findIndex((item) => item.id === key)
      return insertBlock(note, block, at < 0 ? note.blocks.length : at + 1)
    })
    revealNoteBlock(noteApi, noteApi.openPath, block.id)
  }
  const menuItem = menu === null ? undefined : items.find((item) => item.key === menu.key)

  // ---------- 노트 블록으로 가서 보이기(티켓 배지의 「곳」 목록·새로 넣은 티켓) ----------
  // 다른 노트면 그 노트가 열린 뒤에, 접힌 소제목 안이면 펼친 뒤에 그 블록으로 스크롤하고 잠깐 깜빡인다
  const revealRef = useRef<() => void>(() => undefined)
  revealRef.current = () => {
    const target = peekBlockReveal()
    if (target === null || noteApi === null || noteApi.openPath !== target.path) return
    const element = Array.from(document.querySelectorAll<HTMLElement>('[data-note-block]')).find((candidate) => candidate.dataset.noteBlock === target.blockId) ?? null
    if (element === null) {
      const blocks = noteApi.openNote?.blocks ?? []
      const at = blocks.findIndex((block) => block.id === target.blockId)
      if (at < 0) return
      const section = blocks.slice(0, at).reverse().find((block) => block.kind === 'section')
      if (section?.kind === 'section' && section.collapsed === true) noteApi.updateOpen((note) => updateSection(note, section.id, { collapsed: false }))
      return
    }
    clearBlockReveal()
    element.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
    // 클래스가 아니라 Web Animations 로: 마우스를 올려 카드 className 이 바뀌어도 깜빡임이 끊기지 않는다
    if (typeof element.animate === 'function') {
      const ring = (offset: string, color: string) => ({ outline: `2px solid ${color}`, outlineOffset: offset })
      element.animate(
        [{ ...ring('2px', 'var(--accent)') }, { ...ring('2px', 'var(--accent)'), offset: 0.6 }, { ...ring('7px', 'transparent') }],
        { duration: reducedMotion() ? 1000 : 1600, easing: 'ease-out' },
      )
    }
  }
  useEffect(() => { revealRef.current() })
  useEffect(() => onBlockRevealRequest(() => revealRef.current()), [])

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
      .then((text) => setTranslation(source.id, text === null ? { status: 'error', text: t('번역하지 못했습니다. 설정 → 번역을 확인하세요') } : { status: 'done', text }))
      .catch((error: unknown) => setTranslation(source.id, { status: 'error', text: error instanceof Error ? error.message : String(error) }))
  }
  // ID 나 제목을 고치는 중인 블록과 칸
  const [headEdit, setHeadEdit] = useState<{ readonly key: string; readonly field: 'id' | 'title' } | null>(null)
  // 이 노트에서 쓴 ID 들(다음 번호 제안·겹침 알림)
  // (ID 를 고치는 카드만 쓴다)
  const usedIds = headEdit?.field === 'id' ? items.flatMap((item) => (item.kind === 'memo' && item.ticket?.id !== undefined ? [{ key: item.key, id: item.ticket.id }] : [])) : undefined
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

  // 카드(행)가 부르는 손잡이: 늘 같은 객체이고 부를 때 가장 새 동작으로 넘어가서, 카드가 이 컴포넌트의 렌더마다 다시 그려지지 않는다
  const live = { startBlockDrag, pickBlock, openMenu, saveHead, toggleTranslation, setMenu, setGapMenu, setHeadEdit, onEdit, onActivate, onSaveMemo, onCancelDraft, onSaveText, onToggleCollapse, onJump, onAddRef, onRemoveRef, onSetTicket, onInsertText, onToggleSection, onRenameSection }
  const liveRef = useRef(live)
  useLayoutEffect(() => { liveRef.current = live })
  // 카드 크기가 바뀌면(글을 쓰다 줄이 늘 때 등) 다음 프레임에 카드 자리를 다시 알린다
  const cardObserver = useRef<ResizeObserver | null>(null)
  const embeddedRef = useRef(embedded)
  embeddedRef.current = embedded
  const api = useMemo<NoteFlowApi>(() => {
    let frame = 0
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        reportLayoutRef.current()
      })
    })
    cardObserver.current = observer
    return {
      register: (key, element) => {
        const previous = cardRefs.current.get(key)
        if (element === null) {
          if (previous !== undefined) observer?.unobserve(previous)
          cardRefs.current.delete(key)
        } else {
          if (previous !== undefined && previous !== element) observer?.unobserve(previous)
          cardRefs.current.set(key, element)
          observer?.observe(element)
        }
      },
      startDrag: (key, event) => { if (!embeddedRef.current) liveRef.current.startBlockDrag(key)(event) },
      pick: (key, event) => liveRef.current.pickBlock(key)(event),
      contextMenu: (key, event) => liveRef.current.openMenu(key)(event),
      openMenuAt: (key, x, y) => liveRef.current.setMenu({ key, x, y }),
      openGapMenu: (key, anchor) => liveRef.current.setGapMenu({ key, anchor }),
      setHeadEdit: (value) => liveRef.current.setHeadEdit(value),
      saveHead: (key, current, field, value) => liveRef.current.saveHead(key, current, field, value),
      toggleTranslation: (source) => liveRef.current.toggleTranslation(source),
      highlightOf: (highlightId) => noteApiRef.current?.highlightOf?.(highlightId),
      reveal: (path, blockId, highlightId) => placementRef.current(path, blockId, highlightId),
      onEdit: (key) => liveRef.current.onEdit(key),
      onActivate: (key) => liveRef.current.onActivate(key),
      onSaveMemo: (highlightId, content, ticket) => liveRef.current.onSaveMemo(highlightId, content, ticket),
      onCancelDraft: () => liveRef.current.onCancelDraft(),
      onSaveText: (key, content) => liveRef.current.onSaveText(key, content),
      onToggleCollapse: (highlightId, collapsed) => liveRef.current.onToggleCollapse(highlightId, collapsed),
      onJump: (highlight) => liveRef.current.onJump(highlight),
      onAddRef: (key) => liveRef.current.onAddRef?.(key),
      onRemoveRef: (key, highlightId) => liveRef.current.onRemoveRef?.(key, highlightId),
      onSetTicket: (key, ticket) => liveRef.current.onSetTicket?.(key, ticket),
      onInsertText: (key) => liveRef.current.onInsertText?.(key),
      onToggleSection: (key, collapsed) => liveRef.current.onToggleSection?.(key, collapsed),
      onRenameSection: (key, title) => liveRef.current.onRenameSection?.(key, title),
    }
  }, [noteApiRef])
  useEffect(() => () => cardObserver.current?.disconnect(), [])

  return (
    <>
      {gapMenu === null ? null : (
        <GapMenu
          anchor={gapMenu.anchor}
          onClose={() => setGapMenu(null)}
          onText={() => { const key = gapMenu.key; setGapMenu(null); onInsertText?.(key) }}
          onTicket={() => { setTicketPick({ key: gapMenu.key, anchor: gapMenu.anchor }); setGapMenu(null) }}
        />
      )}
      {ticketPick === null || noteApi?.tickets === undefined || noteApi.highlightOf === undefined ? null : (
        <TicketPicker
          anchor={ticketPick.anchor}
          tickets={noteApi.tickets}
          highlightOf={noteApi.highlightOf}
          openPath={noteApi.openPath}
          existing={new Set((noteApi.openNote?.blocks ?? []).flatMap((block) => (block.kind === 'memo' ? [block.highlightId] : [])))}
          onClose={() => setTicketPick(null)}
          onPick={(choice) => { const key = ticketPick.key; setTicketPick(null); insertTicketBlock(key, choice) }}
        />
      )}
      {selected.size > 0 ? (
        <div className="note-selection-bar" role="toolbar" aria-label={t('고른 블록')}>
          {confirmDelete ? (
            <>
              <span>{t('블록 {count}개를 지울까요? 메모는 형광펜도 함께 지워집니다.', { count: selected.size })}</span>
              <button type="button" className="note-selection-danger" onClick={deleteSelected}>{t('지우기')}</button>
              <button type="button" onClick={() => setConfirmDelete(false)}>{t('취소')}</button>
            </>
          ) : (
            <>
              <span>{t('{count}개 고름', { count: selected.size })}</span>
              <span className="note-selection-hint">{t('끌어서 함께 옮기기')}</span>
              <button type="button" className="note-selection-danger" onClick={() => setConfirmDelete(true)}>{t('지우기')}</button>
              <button type="button" onClick={() => setSelected(new Set())}>{t('선택 해제')}</button>
            </>
          )}
        </div>
      ) : null}
      {items.map((item, index) => {
        const shellCls = shellClass(item.key, index)
        const selectedHere = selected.has(item.key)
        const gapExpanded = gapMenu?.key === item.key
        const canInsertText = onInsertText !== undefined
        if (item.kind === 'section') {
          return <NoteSectionRow key={item.key} item={item} api={api} renaming={editingKey === item.key} selected={selectedHere} shellCls={shellCls} gapExpanded={gapExpanded} canInsertText={canInsertText} canPickTicket={canPickTicket} />
        }
        if (item.kind === 'text') {
          return (
            <NoteTextRow
              key={item.key}
              item={item}
              api={api}
              editing={editingKey === item.key}
              matches={needle === '' || item.text.toLowerCase().includes(needle)}
              selected={selectedHere}
              shellCls={shellCls}
              gapExpanded={gapExpanded}
              canInsertText={canInsertText}
              canPickTicket={canPickTicket}
            />
          )
        }
        const draft = item.draft === true
        const editing = draft || editingKey === item.key
        const sources = [item.highlight, ...(item.extraHighlights ?? [])]
        return (
          <NoteMemoRow
            key={item.key}
            item={item}
            api={api}
            needle={needle}
            editing={editing}
            active={activeKey === item.key || editing}
            attaching={attachingKey === item.key}
            headEditField={headEdit?.key === item.key ? headEdit.field : null}
            draftHead={draft ? draftHead : undefined}
            openKey={sources.filter((source) => openQuotes?.has(source.id) === true).map((source) => source.id).join('|')}
            translations={sources.map((source) => translations.get(source.id))}
            translateReady={translationCache.ready}
            regionSizes={sources.map((source) => (source.kind === 'region' ? pageSizeOf(source) : undefined))}
            usedIds={headEdit?.key === item.key && headEdit.field === 'id' ? usedIds : undefined}
            badgeGroup={draft || tickets === undefined ? undefined : ticketGroupOf(tickets, (draft ? draftHead : item.ticket)?.id)}
            openPath={openPath}
            canHead={onSetTicket !== undefined}
            canRemoveRef={onRemoveRef !== undefined}
            selected={selectedHere}
            shellCls={shellCls}
            gapExpanded={gapExpanded}
            canInsertText={canInsertText}
            canPickTicket={canPickTicket}
          />
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
              fitMenuInViewport(element)
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
                {onRate === undefined ? null : (
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
                )}
                {onAddRef !== undefined ? (
                  <button type="button" role="menuitem" onClick={run(() => onAddRef(menuItem.key))}>{menuLabel(<LinkSimple size={15} />, t('원문 추가'))}</button>
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
            {menuItem.kind === 'memo' && openPath !== null && noteApi?.notesOf(menuItem.highlight.id).some((path) => path !== openPath) === true ? (
              // 같은 형광펜을 다른 노트도 담고 있으면(Alt 링크) 이 노트에서만 뺄 수 있다: 형광펜은 그대로, 다른 노트의 블록도 그대로
              <button type="button" role="menuitem" onClick={run(() => noteApi.updateNoteAt(openPath, (note) => removeBlock(note, menuItem.key)))}>{menuLabel(<MinusCircle size={15} />, t('이 노트에서만 빼기'))}</button>
            ) : null}
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

/**
 * 같은 props 면 다시 그리지 않는다(PdfPane 이 스크롤마다 다시 그려져도 노트 카드 수백 장을 건드리지 않게).
 * 동작 props 는 부르는 쪽(PdfPane)이 늘 같은 함수로 넘긴다.
 */
const NoteFlowMemo = memo(NoteFlowImpl, (previous, next) => {
  const keys = Object.keys(next) as (keyof typeof next)[]
  if (keys.length !== Object.keys(previous).length) return false
  for (const key of keys) {
    if (Object.is(previous[key], next[key])) continue
    // items 는 PdfPane 이 입력이 바뀔 때마다 새 배열로 만든다: 카드 내용이 그대로면 같은 것으로 본다
    if (key === 'items' && sameItems(previous.items, next.items)) continue
    return false
  }
  return true
})

// ============================================================================
// 카드 한 장(행). 메모가 수백 개여도 스크롤·마우스 올리기·글쓰기 때 바뀐 카드만 다시 그리도록 React.memo 로 나눴다.
// 행은 NoteFlow 의 상태·동작을 늘 같은 api 객체로만 부른다(바뀌는 값은 모두 props 로 받는다).
// ============================================================================

type Translation = { readonly status: 'loading' | 'done' | 'error'; readonly text: string }
type HeadEdit = { readonly key: string; readonly field: 'id' | 'title' }

/** 행이 NoteFlow 를 부르는 손잡이. 늘 같은 객체이고, 부를 때 가장 새 동작으로 넘어간다 */
interface NoteFlowApi {
  readonly register: (key: string, element: HTMLDivElement | null) => void
  readonly startDrag: (key: string, event: ReactPointerEvent<HTMLElement>) => void
  readonly pick: (key: string, event: ReactMouseEvent<HTMLElement>) => void
  readonly contextMenu: (key: string, event: ReactMouseEvent) => void
  readonly openMenuAt: (key: string, x: number, y: number) => void
  readonly openGapMenu: (key: string, anchor: AnchorBox) => void
  readonly setHeadEdit: (value: HeadEdit | null) => void
  readonly saveHead: (key: string, current: MemoTicket | undefined, field: 'id' | 'title', value: string) => void
  readonly toggleTranslation: (source: PersistentPdfHighlight) => void
  readonly highlightOf: (highlightId: string) => PersistentPdfHighlight | undefined
  readonly reveal: (path: string, blockId: string, highlightId: string) => void
  readonly onEdit: (key: string | null) => void
  readonly onActivate: (key: string | null) => void
  readonly onSaveMemo: (highlightId: string, content: MemoContent, ticket?: MemoTicket) => void
  readonly onCancelDraft: () => void
  readonly onSaveText: (key: string, content: MemoContent) => void
  readonly onToggleCollapse: (highlightId: string, collapsed: boolean) => void
  readonly onJump: (highlight: PersistentPdfHighlight) => void
  readonly onAddRef: (key: string | null) => void
  readonly onRemoveRef: (key: string, highlightId: string) => void
  readonly onSetTicket: (key: string, ticket: MemoTicket | null) => void
  readonly onInsertText: (key: string) => void
  readonly onToggleSection: (key: string, collapsed: boolean) => void
  readonly onRenameSection: (key: string, title: string) => void
}

/** 행이 같은지: 바뀐 것만 다시 그린다. 배열은 칸마다, item 은 값으로 견준다(PdfPane 이 렌더마다 새로 만든다) */
function sameRowProps(previous: Readonly<Record<string, unknown>>, next: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(next)
  if (keys.length !== Object.keys(previous).length) return false
  for (const key of keys) {
    const a = previous[key]
    const b = next[key]
    if (Object.is(a, b)) continue
    if (key === 'item') {
      if (!sameItem(a as NoteFlowItem, b as NoteFlowItem)) return false
    } else if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length || a.some((value, at) => !Object.is(value, b[at]))) return false
    } else {
      return false
    }
  }
  return true
}

/**
 * 노트 바의 카드 목록. 노트 기능 컨텍스트는 앱이 그릴 때마다(스크롤로 쪽이 바뀌어도) 새 객체가 되므로,
 * 여기서 한 번 읽고 카드 모양에 쓰는 값만 넘긴다(카드 수백 장이 컨텍스트 때문에 다시 그려지지 않게)
 */
type NoteFlowProps = Omit<Parameters<typeof NoteFlowImpl>[0], 'noteApiRef' | 'revealRef' | 'tickets' | 'openPath'>
export function NoteFlow(props: NoteFlowProps) {
  const noteApi = useMemoNoteApi()
  const noteApiRef = useRef(noteApi)
  noteApiRef.current = noteApi
  // 티켓의 다른 자리로: 같은 색 창에 메모 노트가 보이면 가리키기 신호로(그 창이 그 노트를 보이고 그 블록으로 간다),
  // 아니면 예전처럼 이 화면(노트 바)에서 그 노트를 열어 보인다
  const workspace = useWorkspaceLink()
  const { pane, channel } = usePaneChannel()
  const revealRef = useRef<(path: string, blockId: string, highlightId: string) => void>(() => undefined)
  revealRef.current = (path, blockId, highlightId) => {
    const api = noteApiRef.current
    if (api === null) return
    const mode = placementRevealMode({ path, openPath: api.openPath, pane, channel, channelNotes: workspace.visibleNotePathsFor(pane) })
    if (mode === 'signal' && pane !== null && channel !== null) emitPointSignal({ from: pane, channel, target: { kind: 'memo', memoId: highlightId, notePath: path, blockId }, reason: 'click' })
    else revealNoteBlock(api, path, blockId)
  }
  return <NoteFlowMemo {...props} noteApiRef={noteApiRef} revealRef={revealRef} tickets={noteApi?.tickets} openPath={noteApi?.openPath ?? null} />
}

/** 카드 목록이 같은가(순서와 각 카드 내용) */
export function sameItems(a: readonly NoteFlowItem[], b: readonly NoteFlowItem[]): boolean {
  return a === b || (a.length === b.length && a.every((item, index) => sameItem(item, b[index]!)))
}

/** 같은 카드 내용인가(item 은 PdfPane 이 렌더마다 새로 만들지만 안의 값은 그대로인 경우가 대부분이다) */
export function sameItem(a: NoteFlowItem, b: NoteFlowItem): boolean {
  if (a === b) return true
  if (a.kind !== b.kind || a.key !== b.key) return false
  if (a.kind === 'section' && b.kind === 'section') return a.title === b.title && a.collapsed === b.collapsed && a.count === b.count
  if (a.kind === 'text' && b.kind === 'text') return a.text === b.text && a.html === b.html
  if (a.kind !== 'memo' || b.kind !== 'memo') return false
  const extraA = a.extraHighlights ?? []
  const extraB = b.extraHighlights ?? []
  return a.highlight === b.highlight && a.draft === b.draft && a.docLabel === b.docLabel && a.sourceLabel === b.sourceLabel
    && a.farSource?.label === b.farSource?.label && a.farSource?.page === b.farSource?.page
    && a.ticket?.id === b.ticket?.id && a.ticket?.title === b.ticket?.title
    && extraA.length === extraB.length && extraA.every((highlight, at) => highlight === extraB[at])
}

function BlockMenuButton({ api, itemKey, inTab = false }: { readonly api: NoteFlowApi; readonly itemKey: string; readonly inTab?: boolean }) {
  if (itemKey === 'draft') return null
  return (
    <button
      type="button"
      className={inTab ? 'note-tab-btn note-tab-more' : 'note-block-menu'}
      aria-label={t('블록 메뉴')}
      title={t('메뉴')}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        api.openMenuAt(itemKey, rect.right - 190, rect.bottom + 4)
      }}
    >
      <DotsThree size={16} weight="bold" aria-hidden="true" />
    </button>
  )
}

/** 블록 사이: 마우스를 올리면 + 가 나타나 그 자리(key 블록 아래)에 글을 넣는다 */
function NoteGapAfter({ api, itemKey, canInsertText, canPickTicket, expanded }: {
  readonly api: NoteFlowApi
  readonly itemKey: string
  readonly canInsertText: boolean
  readonly canPickTicket: boolean
  readonly expanded: boolean
}) {
  if (itemKey === 'draft' || !canInsertText) return <div className="note-gap" aria-hidden="true" />
  return (
    <div className="note-gap">
      {canPickTicket ? (
        <button
          type="button"
          className="note-gap-add"
          aria-label={t('여기에 넣기')}
          title={t('여기에 넣기')}
          aria-haspopup="menu"
          aria-expanded={expanded}
          onClick={(event) => api.openGapMenu(itemKey, anchorOf(event.currentTarget))}
        >
          <Plus size={11} weight="bold" aria-hidden="true" />
        </button>
      ) : (
        <button type="button" className="note-gap-add" aria-label={t('여기에 글 넣기')} title={t('여기에 글 넣기')} onClick={() => api.onInsertText(itemKey)}>
          <Plus size={11} weight="bold" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

interface RowShared {
  readonly api: NoteFlowApi
  readonly selected: boolean
  readonly shellCls: string
  readonly gapExpanded: boolean
  readonly canInsertText: boolean
  readonly canPickTicket: boolean
}

const NoteSectionRow = memo(function NoteSectionRow({ item, renaming, api, selected, shellCls, gapExpanded, canInsertText, canPickTicket }: RowShared & {
  readonly item: Extract<NoteFlowItem, { kind: 'section' }>
  readonly renaming: boolean
}) {
  const ref = useCallback((element: HTMLDivElement | null) => api.register(item.key, element), [api, item.key])
  return (
    <Fragment>
      <div
        ref={ref}
        className={['note-section', 'note-block', item.collapsed ? 'note-section-collapsed' : '', selected ? 'note-block-selected' : '', shellCls].filter(Boolean).join(' ')}
        data-note-block={item.key}
        onPointerDown={renaming ? undefined : (event) => api.startDrag(item.key, event)}
        onClickCapture={(event) => api.pick(item.key, event)}
        onContextMenu={(event) => api.contextMenu(item.key, event)}
      >
        <button
          type="button"
          className="note-section-toggle"
          aria-label={item.collapsed ? t('{title} 펼치기', { title: item.title }) : t('{title} 접기', { title: item.title })}
          aria-expanded={!item.collapsed}
          onClick={() => api.onToggleSection(item.key, !item.collapsed)}
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
              api.onRenameSection(item.key, event.currentTarget.value)
              api.onEdit(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              else if (event.key === 'Escape') api.onEdit(null)
            }}
          />
        ) : (
          <span className="note-section-title" title={t('두 번 눌러 이름 바꾸기')} onDoubleClick={() => api.onEdit(item.key)}>{item.title}</span>
        )}
        <span className="note-section-count">{item.count}</span>
        <BlockMenuButton api={api} itemKey={item.key} />
      </div>
      <NoteGapAfter api={api} itemKey={item.key} canInsertText={canInsertText} canPickTicket={canPickTicket} expanded={gapExpanded} />
    </Fragment>
  )
}, sameRowProps)

const NoteTextRow = memo(function NoteTextRow({ item, editing, matches, api, selected, shellCls, gapExpanded, canInsertText, canPickTicket }: RowShared & {
  readonly item: Extract<NoteFlowItem, { kind: 'text' }>
  readonly editing: boolean
  readonly matches: boolean
}) {
  const ref = useCallback((element: HTMLDivElement | null) => api.register(item.key, element), [api, item.key])
  return (
    <Fragment>
      <div
        ref={ref}
        className={['pdf-memo-card', 'pdf-memo-card-flow', 'note-block', 'note-text-card', editing ? 'pdf-memo-card-editing' : '', matches ? '' : 'pdf-memo-card-dim', selected ? 'note-block-selected' : '', shellCls].filter(Boolean).join(' ')}
        data-note-block={item.key}
        onPointerDown={(event) => api.startDrag(item.key, event)}
        onClickCapture={(event) => api.pick(item.key, event)}
        onContextMenu={(event) => api.contextMenu(item.key, event)}
      >
        {editing ? (
          <MemoEditor
            key={item.key}
            label={t('글')}
            initialText={item.text}
            initialHtml={item.html}
            placeholder={t('글을 쓰세요. 끝에서 Enter를 두 번 누르면 새 글이 생깁니다')}
            onSave={(content) => {
              api.onSaveText(item.key, content)
              api.onEdit(null)
            }}
            onCancel={() => api.onEdit(null)}
            onNext={canInsertText ? () => api.onInsertText(item.key) : undefined}
          />
        ) : (
          <MemoNoteView note={item.text} noteHtml={item.html} onEdit={() => api.onEdit(item.key)} onChange={(content) => api.onSaveText(item.key, content)} />
        )}
        <BlockMenuButton api={api} itemKey={item.key} />
      </div>
      <NoteGapAfter api={api} itemKey={item.key} canInsertText={canInsertText} canPickTicket={canPickTicket} expanded={gapExpanded} />
    </Fragment>
  )
}, sameRowProps)

const NoteMemoRow = memo(function NoteMemoRow({
  item, api, needle, editing, active, attaching, headEditField, draftHead, openKey, translations, translateReady, regionSizes, usedIds, badgeGroup, openPath,
  canHead, canRemoveRef, selected, shellCls, gapExpanded, canInsertText, canPickTicket,
}: RowShared & {
  readonly item: Extract<NoteFlowItem, { kind: 'memo' }>
  readonly needle: string
  readonly editing: boolean
  readonly active: boolean
  readonly attaching: boolean
  readonly headEditField: 'id' | 'title' | null
  readonly draftHead: MemoTicket | undefined
  /** 원문을 펼쳐 둔 이 카드의 형광펜 id 들(「|」로 이은 것) */
  readonly openKey: string
  /** 원문(첫 원문, 더한 원문 …)마다의 번역 줄 */
  readonly translations: readonly (Translation | undefined)[]
  readonly translateReady: boolean
  /** 원문마다 표·그림의 쪽 크기(글 원문은 undefined) */
  readonly regionSizes: readonly (readonly [number, number] | undefined)[]
  /** ID 를 고치는 중일 때만: 이 노트에서 쓴 ID 들 */
  readonly usedIds: readonly { readonly key: string; readonly id: string }[] | undefined
  /** 같은 ID 가 여러 자리에 있으면 그 자리들(없으면 undefined) */
  readonly badgeGroup: TicketGroup | undefined
  readonly openPath: string | null
  readonly canHead: boolean
  readonly canRemoveRef: boolean
}) {
  const ref = useCallback((element: HTMLDivElement | null) => api.register(item.key, element), [api, item.key])
  const enterSwallowed = useRef(false)
  const { highlight } = item
  const draft = item.draft === true
  const extras = item.extraHighlights ?? []
  const sources = [highlight, ...extras]
  const openIds = openKey === '' ? [] : openKey.split('|')
  const isOpen = (id: string) => openIds.includes(id)
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
  const renderSource = (source: PersistentPdfHighlight, extra: boolean, at: number) => {
    const collapsed = source.kind !== 'region' && !isOpen(source.id)
    const meta = source.rating === undefined ? null : <span className="note-source-meta">{noteStars(source)}</span>
    const remove = extra && canRemoveRef ? (
      <button type="button" className="note-source-remove" aria-label={t('이 원문 분리')} title={t('이 원문 분리')} onClick={(event) => {
        event.stopPropagation()
        api.onRemoveRef(item.key, source.id)
      }}>
        <X size={11} weight="bold" aria-hidden="true" />
      </button>
    ) : null
    // 원문 번역: 출처 줄 끝의 작은 단추. 캐시에 있으면 바로, 없으면 번역기에 묻는다
    const shown = translations[at]
    const translateButton = translateReady && source.anchor.quote.trim() !== '' ? (
      <button
        type="button"
        className={`note-source-translate${shown !== undefined ? ' note-source-translate-on' : ''}`}
        aria-label={shown !== undefined ? t('번역 숨기기') : t('번역 보기')}
        aria-pressed={shown !== undefined}
        title={shown !== undefined ? t('번역 숨기기') : t('번역 보기')}
        onClick={(event) => {
          event.stopPropagation()
          api.toggleTranslation(source)
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
    // 형광펜 색 점이 곧 원문 펼치기·접기 단추(칩의 나머지를 누르면 원문 자리로 간다)
    const dotButton = (open: boolean) => (
      <button
        type="button"
        className="note-source-dot"
        aria-label={open ? t('근거 접기') : t('근거 펼치기')}
        aria-expanded={open}
        title={open ? t('근거 접기') : t('근거 펼치기')}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          api.onToggleCollapse(source.id, open)
        }}
      >
        <span aria-hidden="true" />
      </button>
    )
    if (collapsed) {
      return (
        <Fragment key={source.id}>
        <div className="note-source-chip" data-hl={source.color} title={t('원문에서 보기')} role="button" tabIndex={draft ? undefined : 0} onClick={draft ? undefined : () => api.onJump(source)} onKeyDown={(event) => { if (!draft && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); api.onJump(source) } }}>
          {dotButton(false)}
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
        <div key={source.id} className="pdf-memo-card-source note-source-region" onClick={draft ? undefined : () => api.onJump(source)}>
          {meta}
          <MarkdownRegionCrop highlight={source} />
          {remove}
        </div>
      )
    }
    const pageSize = source.kind === 'region' ? regionSizes[at] ?? source.pageSize : undefined
    if (source.kind === 'region' && pageSize !== undefined) {
      // 스캔 쪽의 영역은 OCR 로 읽은 글자가 원문에 있다: 번역 단추와 번역 줄을 같이 단다
      return (
        <Fragment key={source.id}>
          <div className="pdf-memo-card-source note-source-region" onClick={draft ? undefined : () => api.onJump(source)}>
            {meta}
            <RegionCrop highlight={source} pageSize={pageSize} maxWidth={480} fill capped />
            {remove}
            {translateButton === null ? null : <span className="note-region-translate">{translateButton}</span>}
          </div>
          {translationLine}
        </Fragment>
      )
    }
    return (
      <Fragment key={source.id}>
        <div
          className="pdf-memo-card-quote note-source"
          data-hl={source.color}
          title={t('원문에서 보기')}
          onClick={draft ? undefined : () => api.onJump(source)}
        >
          {dotButton(true)}
          {meta}
          <span className="note-source-quote">{source.anchor.quote.replace(/\s+/gu, ' ').trim()}</span>
          {isMarkdownSource(source) ? null : <span className="note-source-page">p.{source.anchor.page + 1}</span>}
          {translateButton}
          {remove}
        </div>
        {translationLine}
      </Fragment>
    )
  }
  const sourceList = (
    <div className="note-sources">
      {sources.map((source, at) => renderSource(source, at > 0, at))}
      {attaching ? (
        <div className="note-source-attach" role="status">
          <span>{t('PDF에서 추가할 원문을 고르세요')}</span>
          <button type="button" onClick={() => api.onAddRef(null)}>{t('취소')}</button>
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
        : highlight.kind === 'region' ? t('설명을 쓰세요. 쓰지 않고 다른 곳을 누르면 사라지며, 그림만 남기려면 Ctrl+Enter를 누르세요')
          : t('메모를 쓰세요. 쓰지 않고 다른 곳을 누르면 사라집니다')}
      onSave={(content) => {
        // 아직 ID 가 없는데 글 맨 앞에 「REQ-04 」처럼 썼으면 그 낱말을 ID 배지로 옮긴다
        const leading = ticket?.id === undefined && canHead ? splitLeadingTicketId(content.text) : null
        if (leading === null) {
          if (draft) api.onSaveMemo(highlight.id, content, draftHead)
          else api.onSaveMemo(highlight.id, content)
        } else {
          const stripped = { text: leading.rest, html: stripLeadingWord(content.html, leading.id) }
          if (draft) api.onSaveMemo(highlight.id, stripped, { ...draftHead, id: leading.id })
          else {
            api.onSaveMemo(highlight.id, stripped)
            api.onSetTicket(item.key, { ...ticket, id: leading.id })
          }
        }
        api.onEdit(null)
      }}
      onCancel={() => {
        if (draft) api.onCancelDraft()
        api.onEdit(null)
      }}
    />
  ) : (highlight.note ?? '').trim() === '' && (highlight.noteHtml ?? '') === '' ? (
    // 메모 없는 형광펜: 빈 줄 대신, 마우스를 올렸을 때만 오른쪽 위 탭의 「메모 쓰기」
    null
  ) : (
    <MemoNoteView note={highlight.note} noteHtml={highlight.noteHtml} onEdit={() => api.onEdit(item.key)} onChange={(content) => api.onSaveMemo(highlight.id, content)} />
  )
  // 머리: ID 배지와 제목. 비어 있는 칸은 마우스를 올렸을 때 오른쪽 위에 「+ ID」「+ 제목」으로만 보인다
  const editingId = headEditField === 'id'
  const editingTitle = headEditField === 'title'
  const idInput = editingId ? (
    <TicketIdInput
      initial={ticket?.id ?? ''}
      suggestions={suggestTicketIds((usedIds ?? []).map((used) => used.id))}
      taken={(usedIds ?? []).filter((used) => used.key !== item.key).map((used) => used.id)}
      onDone={(value) => api.saveHead(item.key, ticket, 'id', value)}
      onCancel={() => api.setHeadEdit(null)}
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
      onBlur={(event) => api.saveHead(item.key, ticket, 'title', event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') { event.stopPropagation(); api.setHeadEdit(null) }
      }}
    />
  ) : null
  const head = hasHead || editingId || editingTitle ? (
    <div className="note-ticket-head">
      {(ticket?.id !== undefined || editingId) ? (
        <div className="note-ticket-id-row">
          {idInput ?? (
            <button type="button" className="note-ticket-id" title={t('ID 바꾸기')} onClick={canHead ? () => api.setHeadEdit({ key: item.key, field: 'id' }) : undefined}>{ticket?.id}</button>
          )}
          {badgeGroup !== undefined && badgeGroup.places.length > 1 && !editingId ? (
            <TicketBadge
              group={badgeGroup}
              current={{ path: openPath, blockId: item.key }}
              highlightOf={api.highlightOf}
              onReveal={(place: TicketPlace) => api.reveal(place.path, place.blockId, place.highlightId)}
            />
          ) : null}
        </div>
      ) : null}
      {titleInput ?? (ticket?.title !== undefined ? (
        <div className="note-ticket-title" title={canHead ? t('두 번 눌러 제목 바꾸기') : undefined} onDoubleClick={canHead ? () => api.setHeadEdit({ key: item.key, field: 'title' }) : undefined}>
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
      ? <button key="memo" type="button" className="note-tab-btn" onClick={() => api.onEdit(item.key)}>{t('메모 쓰기')}</button> : null,
    showHeadButtons && ticket?.id === undefined ? <button key="id" type="button" className="note-tab-btn" onClick={() => api.setHeadEdit({ key: item.key, field: 'id' })}>{t('+ ID')}</button> : null,
    showHeadButtons && ticket?.title === undefined ? <button key="title" type="button" className="note-tab-btn" onClick={() => api.setHeadEdit({ key: item.key, field: 'title' })}>{t('+ 제목')}</button> : null,
    editing ? null : <BlockMenuButton key="menu" api={api} itemKey={item.key} inTab />,
  ].filter(Boolean)
  // 호버: 테두리가 형광펜 색이 되고, 위 테두리 양 끝에 출처 탭(왼쪽)과 단추 탭(오른쪽)이 붙는다
  const tabs = (
    <div className="note-block-tabs">
      <div className="note-tab note-tab-l"><span title={tipLabel}>{tipLabel}</span></div>
      {tabButtons.length > 0 ? <div className="note-tab note-tab-r">{tabButtons}</div> : null}
    </div>
  )
  const region = highlight.kind === 'region'
  const collapsedFirst = highlight.kind !== 'region' && !isOpen(highlight.id)
  return (
    <Fragment>
    <div
      ref={ref}
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
        selected ? 'note-block-selected' : '',
        attaching ? 'note-block-attaching' : '',
        shellCls,
      ].filter(Boolean).join(' ')}
      data-memo-id={highlight.id}
      data-hl={highlight.color}
      data-note-block={item.key}
      // 키보드로도 닿는다: Tab 으로 카드에 와서 Enter 면 원문으로 점프(연결선도 함께 켜진다)
      tabIndex={draft ? undefined : 0}
      role="group"
      aria-label={tipLabel}
      onFocus={(event) => { if (event.target === event.currentTarget) api.onActivate(item.key) }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || draft || event.key !== 'Enter') return
        event.preventDefault()
        api.onJump(highlight)
      }}
      onPointerDown={headEditField !== null ? undefined : (event) => api.startDrag(item.key, event)}
      onClickCapture={(event) => api.pick(item.key, event)}
      // 메뉴 항목을 막 고른 자리면 진입을 비켜 가되, 포인터가 진짜 움직이면 그때 켠다(menuGuard)
      onPointerEnter={() => { if (menuGuardActive()) enterSwallowed.current = true; else api.onActivate(item.key) }}
      onPointerMove={() => { if (enterSwallowed.current && !menuGuardActive()) { enterSwallowed.current = false; api.onActivate(item.key) } }}
      onPointerLeave={() => { enterSwallowed.current = false; api.onActivate(null) }}
      onContextMenu={(event) => api.contextMenu(item.key, event)}
    >
      {/* 늘 같은 차례: ID·제목 → 내 글 → 원문(출처) */}
      <div className="note-card-body">
        {head}
        {memo}
        {sourceList}
        {item.farSource === undefined ? null : (
          <button type="button" className="note-far-link" data-far-memo={highlight.id} title={t('이 메모의 문서를 같은 색 칸에 표시')}>
            <span aria-hidden="true">→</span> {item.farSource.label}{item.farSource.page === undefined ? '' : ` p.${item.farSource.page}`}
          </button>
        )}
      </div>
      {tabs}
    </div>
    <NoteGapAfter api={api} itemKey={item.key} canInsertText={canInsertText} canPickTicket={canPickTicket} expanded={gapExpanded} />
    </Fragment>
  )
}, sameRowProps)

function noteStars(highlight: PersistentPdfHighlight) {
  return highlight.rating === undefined ? null : (
    <span className="note-source-stars" aria-label={t('별 {count}개', { count: highlight.rating })}>{'★'.repeat(highlight.rating)}</span>
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
      {duplicate ? <p className="note-ticket-id-warn" role="status">{t('이 노트에 이미 있는 ID입니다')}</p> : null}
    </div>
  )
}

/** Markdown 문서의 원문인가(쪽 번호가 없다) */
function isMarkdownSource(source: PersistentPdfHighlight): boolean {
  return isMarkdownPath(source.anchor.docId)
}

