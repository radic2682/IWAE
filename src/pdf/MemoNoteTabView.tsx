import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { ArrowsInLineVertical, ArrowsOutLineVertical, MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { t } from '../i18n'
import { menuGuardActive } from '../app/menuGuard'
import { memoHighlightIds, memoNoteTitleOf, updateSection, type MemoNoteBlock, type MemoTicket } from '../core/memoNote'
import { isMarkdownPath } from '../core/markdownPath'
import { announceAction } from '../app/actionFeedback'
import { setAttachRequest, useAttachRequest, useMemoHoverReporter, useMemoPointSender, usePaneChannel, usePointSignalReceiver, useRoutedMemoDraft } from '../app/workspaceContext'
import { useEvent } from '../ui/useEvent'
import { useBarZoom, useBarZoomWheel } from '../app/useBarZoom'
import { TopBarToolbar, useHasTopBarSlot } from '../app/topBarToolbar'
import { CategoryTag } from './CategoryTag'
import { LINK_CARD_DEPTH, registerPaneLinks, requestPaneLinks, useLinkedDocIds, visibleSlice, type LinkItem, type PaneLinkSnapshot } from '../app/workspaceLinks'
import { MemoFormatBar, MemoFormatSlotContext, type MemoContent } from './MemoEditor'
import { MemoNoteContext, revealNoteBlock, useMemoNoteApi } from './memoNoteContext'
import { NoteFlow, type NoteFlowItem } from './NoteFlow'
import { NoteOutline, useExpandQuotesWhileWide } from './NoteOutline'
import type { PersistentPdfHighlight, PersistentPdfHighlightPatch } from './persistentHighlight'
import { useNoteFlowController } from './useNoteFlowController'
import '../ui/pdf-memo.css'
import '../ui/memo-note-tab.css'

/** 이 폭(px) 아래면 노트 바처럼 카드 목록, 이상이면 「메모만 보기」처럼 문서로 읽히는 모양 */
export const MEMO_NOTE_WIDE_MIN = 460

/** ref 요소의 폭이 min 이상인가. 창을 끌어 폭이 바뀌면 따라 바뀐다(모드 스위치 없이 폭만으로 모양이 정해진다) */
function useMinWidth(ref: RefObject<HTMLElement | null>, min: number): boolean {
  const [wide, setWide] = useState(false)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return undefined
    setWide(element.getBoundingClientRect().width >= min)
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width ?? element.getBoundingClientRect().width
      setWide(width >= min)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [min, ref])
  return wide
}

export interface MemoNoteTabViewProps {
  /** 보일 노트(Vault 상대 경로) */
  readonly path: string
  /** 카드가 쓰는 형광펜(모든 문서) */
  readonly highlights: readonly PersistentPdfHighlight[]
  readonly docTitles?: Readonly<Record<string, string>>
  /** 메모 글·색·별점을 형광펜 저장소에 쓴다(노트 바와 같은 길) */
  readonly onHighlightUpdated?: (id: string, patch: PersistentPdfHighlightPatch) => void
  readonly onHighlightRemoved?: (id: string) => void
  /** 카드의 출처·쪽을 눌렀다: 그 메모의 문서 자리로 간다 */
  readonly onJump: (highlight: PersistentPdfHighlight) => void
  /** 이 탭 안에서 고치기 시작했다(글 쓰기·색·별점·지우기·새 메모) — 미리보기 탭이면 보통 탭으로 고정한다 */
  readonly onEdited?: () => void
}

/** 노트 안에서 지금 보는 화면 가운데의 블록 자리(새 메모를 그 앞에 끼운다). 가운데 아래에 처음 오는 카드 앞, 없으면 맨 끝 */
export function centerBlockIndex(scroller: HTMLElement | null, blocks: readonly MemoNoteBlock[]): number {
  if (scroller === null) return blocks.length
  const view = scroller.getBoundingClientRect()
  const center = view.top + view.height / 2
  const cards = new Map([...scroller.querySelectorAll<HTMLElement>('[data-note-block]')].map((element) => [element.dataset.noteBlock ?? '', element] as const))
  const index = blocks.findIndex((block) => {
    const card = cards.get(block.id)
    if (card === undefined) return false
    const box = card.getBoundingClientRect()
    return box.top + box.height / 2 > center
  })
  return index < 0 ? blocks.length : index
}

/**
 * 메모 노트를 창의 탭으로 보인다(노트 바 없이 노트만). 노트 바와 같은 저장소·같은 카드(NoteFlow)를 쓰므로
 * 같은 노트를 노트 바와 탭에서 함께 보고 어느 쪽에서 고쳐도 하나로 합쳐진다.
 * 폭이 좁으면 노트 바의 카드 목록, 넓으면 문서처럼(글 칸 가운데 + 목차) — 따로 켜는 모드는 없다.
 * 검색·글 블록 넣기·펼치기 단추는 창 머리가 아니라 이 안의 도구줄에 둔다.
 */
export function MemoNoteTabView({ path, highlights, docTitles, onHighlightUpdated, onHighlightRemoved, onJump, onEdited }: MemoNoteTabViewProps) {
  const api = useMemoNoteApi()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const wide = useMinWidth(rootRef, MEMO_NOTE_WIDE_MIN)
  // 카드 목록 모양에서는 이 창 안에서 Ctrl+휠로 확대·축소한다(설정에 기억되는 「오른쪽 바」 배율). 문서처럼 읽는 넓은 모양에서는 쓰지 않는다
  const barZoom = useBarZoom('right')
  const [barEl, setBarEl] = useState<HTMLElement | null>(null)
  useBarZoomWheel(barEl, 'right', !wide)
  const [searchOpen, setSearchOpen] = useState(false)
  // 모든 메모에서 찾기: 검색 결과 목록
  const [resultsOpen, setResultsOpen] = useState(false)
  // 문서 창에서 만드는 새 메모(같은 색 창의 문서에서 고른 글): 이 노트로 오면 새 메모 카드로 보이고 여기서 쓴다(비우면 사라진다)
  const draft = useRoutedMemoDraft(path)
  const [draftIndex, setDraftIndex] = useState(0)
  const sendPoint = useMemoPointSender()
  // 카드 위에 마우스를 올리면: 누를 때 움직일 같은 색 창(그 메모의 문서 · 같은 메모가 든 다른 노트)에 윤곽
  const reportMemoHover = useMemoHoverReporter()
  const hoverSwallowed = useRef(false)
  const draftId = draft?.highlight.id ?? null
  const flow = useNoteFlowController({
    api,
    path,
    highlights,
    docTitles,
    otherLabel: t('다른 문서'),
    draft: draft?.highlight ?? null,
    draftIndex,
    onHighlightUpdated: (id, patch) => {
      if (draft !== null && id === draft.highlight.id) draft.patch(patch)
      else {
        onHighlightUpdated?.(id, patch)
        onEdited?.()
      }
    },
    onHighlightRemoved: onHighlightRemoved === undefined ? undefined : (id) => {
      onHighlightRemoved(id)
      onEdited?.()
    },
    onJump,
  })
  const { items, noteMemos, anyQuoteOpen, editingKey, query, updateNote } = flow
  const [revealKey, setRevealKey] = useState<string | null>(null)

  // 원문 더하기: 이 노트의 카드가 「원문 더하기」를 눌렀으면 다음에 문서 창에서 고른 글이 그 카드의 원문이 된다(Esc 로 그만둔다)
  const attach = useAttachRequest()
  const attachingKey = attach !== null && attach.path === path ? attach.key : null
  useEffect(() => {
    if (attachingKey === null) return undefined
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') setAttachRequest(null) }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [attachingKey])
  const addRef = useEvent((key: string | null) => {
    setAttachRequest(key === null ? null : { path, key })
    if (key !== null) announceAction(t('문서에서 더할 원문을 고르세요'))
  })

  // 모든 메모에서 찾기: 이 노트뿐 아니라 모든 노트의 메모 글·원문·분류에서 찾는다
  const needle = query.trim().toLowerCase()
  const results = useMemo(() => {
    if (needle === '') return []
    const own = new Set((api?.noteAt(path)?.blocks ?? []).flatMap((block) => (block.kind === 'memo' ? memoHighlightIds(block) : [])))
    return highlights
      .filter((highlight) => (highlight.note ?? '').trim() !== '')
      .filter((highlight) => (highlight.note ?? '').toLowerCase().includes(needle)
        || highlight.anchor.quote.toLowerCase().includes(needle)
        || (highlight.topic ?? '').toLowerCase().includes(needle))
      .sort((a, b) => Number(!own.has(a.id)) - Number(!own.has(b.id)) || a.anchor.docId.localeCompare(b.anchor.docId) || a.anchor.page - b.anchor.page)
      .slice(0, 30)
  }, [api, highlights, needle, path])
  const pickResult = (highlight: PersistentPdfHighlight) => {
    setResultsOpen(false)
    if (api === null) return
    const owners = api.notesOf(highlight.id)
    const blockIn = (notePath: string) => api.noteAt(notePath)?.blocks.find((block) => block.kind === 'memo' && memoHighlightIds(block).includes(highlight.id))
    if (owners.includes(path)) {
      // 이 노트의 카드: 카드를 보이고 같은 색 창이 그 메모의 문서 자리로 간다
      const block = blockIn(path)
      if (block !== undefined) { flow.setActiveKey(block.id); setRevealKey(block.id) }
      sendPoint(highlight.id, 'note')
      return
    }
    const other = owners[0]
    const block = other === undefined ? undefined : blockIn(other)
    // 다른 노트의 카드: 그 노트를 탭으로 열고 그 카드를 보인다
    if (other !== undefined && block !== undefined) revealNoteBlock(api, other, block.id)
    // 어느 노트에도 없는 메모: 문서의 그 자리로
    else onJump(highlight)
  }

  // 새 메모가 들어올 때 보고 있던 화면 가운데에 끼우고(그 자리로 굴려 보인다), 쓰기 시작하면 미리보기 탭은 고정한다
  useLayoutEffect(() => {
    if (draftId === null) return
    setDraftIndex(centerBlockIndex(scrollRef.current, flow.blocks))
    onEdited?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 초안이 새로 생길 때만 자리를 정한다
  }, [draftId])
  useEffect(() => {
    if (draftId === null) return
    scrollRef.current?.querySelector<HTMLElement>('[data-note-block="draft"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [draftId, draftIndex])
  // 글을 쓰기 시작하면(카드 편집) 미리보기 탭은 보통 탭이 된다
  useEffect(() => {
    if (editingKey !== null) onEdited?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 편집 시작에만
  }, [editingKey])

  // 가리키기 신호: 같은 색 창에서 누른 형광펜의 카드를 활성으로 하고 보이게 굴린다
  usePointSignalReceiver((signal) => {
    if (signal.target.kind !== 'memo') return false
    const { memoId, notePath, blockId } = signal.target
    // 어느 노트인지 정해진 신호(티켓의 다른 자리)는 그 노트만 받는다
    if (notePath !== undefined && notePath !== path) return false
    const at = flow.blocks.findIndex((block) => (blockId === undefined ? block.kind === 'memo' && memoHighlightIds(block).includes(memoId) : block.id === blockId))
    const block = flow.blocks[at]
    if (block === undefined) return false
    // 접힌 소제목 안이면 펼친다
    const section = flow.blocks.slice(0, at).reverse().find((candidate) => candidate.kind === 'section')
    if (section?.kind === 'section' && section.collapsed === true) updateNote((note) => updateSection(note, section.id, { collapsed: false }))
    flow.setActiveKey(block.id)
    setRevealKey(block.id)
    return true
  }, flow.blocks)
  useEffect(() => {
    if (revealKey === null) return
    const card = scrollRef.current?.querySelector<HTMLElement>('[data-note-block="' + revealKey + '"]')
    if (card === null || card === undefined) return
    card.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    setRevealKey(null)
  }, [revealKey, items])

  // ---------- 연결선: 이 노트의 보이는 카드 사각형을 작업 공간 층에 내놓는다(workspaceLinks) ----------
  const { pane, channel } = usePaneChannel()
  const cardsRef = useRef<readonly HTMLElement[] | null>(null)
  const firstCardRef = useRef(0)
  const publishRef = useRef({ activeKey: flow.activeKey, editingKey, items })
  publishRef.current = { activeKey: flow.activeKey, editingKey, items }
  const notePane = flow.note !== null
  useLayoutEffect(() => {
    if (pane === null) return undefined
    const measure = (): PaneLinkSnapshot | null => {
      const root = rootRef.current
      const scroller = scrollRef.current
      if (root === null || scroller === null) return null
      const body = scroller.getBoundingClientRect()
      const frame = (root.closest<HTMLElement>('.pane-grid-body, .pane') ?? root).getBoundingClientRect()
      // 카드 목록은 그린 뒤 한 번만 훑어 둔다(스크롤마다 1,000 장을 다시 찾지 않는다). 보이는 카드만 재서 내놓는다
      const cards = cardsRef.current ?? (cardsRef.current = [...scroller.querySelectorAll<HTMLElement>('[data-memo-id]')])
      const slice = visibleSlice(cards.length, (index) => {
        const rect = cards[index]!.getBoundingClientRect()
        return rect.height === 0 ? null : rect
      }, body.top, body.bottom, firstCardRef.current)
      firstCardRef.current = slice.first
      const items: LinkItem[] = slice.indexes.map((index) => {
        const card = cards[index]!
        const rect = card.getBoundingClientRect()
        return { id: card.dataset.memoId ?? '', rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, y: rect.top + LINK_CARD_DEPTH }
      })
      const { activeKey, editingKey: editing, items: flowItems } = publishRef.current
      const activeIds = flowItems.flatMap((item) => (item.kind === 'memo' && item.draft !== true && (item.key === activeKey || item.key === editing) ? [item.highlight.id] : []))
      return {
        frame: { left: frame.left, top: frame.top, right: frame.right, bottom: frame.bottom },
        body: { left: body.left, top: body.top, right: body.right, bottom: body.bottom },
        items,
        activeIds,
      }
    }
    return registerPaneLinks({ pane, role: 'note', channel }, measure)
  }, [pane, channel, notePane])
  // 그릴 때마다(카드 목록·활성 카드가 바뀌었을 수 있다) 카드 목록을 다시 훑게 하고, 스크롤·크기 변화와 함께 다시 잰다
  useLayoutEffect(() => {
    cardsRef.current = null
    requestPaneLinks()
  })
  useEffect(() => {
    const scroller = scrollRef.current
    const root = rootRef.current
    if (scroller === null || root === null) return undefined
    const again = () => requestPaneLinks()
    scroller.addEventListener('scroll', again, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(again)
    observer?.observe(root)
    observer?.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', again)
      observer?.disconnect()
    }
  }, [notePane])

  // 원문 문서가 이웃한 같은 색 창에 보이지 않는 카드: 「→ 문서 이름 p.N」 으로 그 문서를 보이게 한다(신호는 새 창을 열기도 한다)
  const linkedDocIds = useLinkedDocIds(pane)
  const flowItems = useMemo<NoteFlowItem[]>(() => {
    if (pane === null || channel === null) return items
    return items.map((item) => {
      if (item.kind !== 'memo' || item.draft === true || linkedDocIds.includes(item.highlight.anchor.docId)) return item
      const label = (item.sourceLabel ?? item.docLabel ?? '').split(' · ')[0] ?? ''
      const markdown = isMarkdownPath(item.highlight.anchor.docId)
      return { ...item, farSource: { label: label === '' ? t('원문') : label, ...(markdown ? {} : { page: item.highlight.anchor.page + 1 }) } }
    })
  }, [items, linkedDocIds, pane, channel])

  const saveMemo = (highlightId: string, content: MemoContent, ticket?: MemoTicket) => {
    if (draft !== null && highlightId === draft.highlight.id) draft.save(content, ticket, draftIndex)
    else flow.flowProps.onSaveMemo(highlightId, content, ticket)
  }
  // 문서처럼 읽는 폭에서는 원문을 모두 펼쳐 보인다(좁아지면 전 상태로)
  useExpandQuotesWhileWide(wide, flow.openQuotes, flow.setOpenQuotes, noteMemos)

  const closeSearch = () => {
    flow.setQuery('')
    setResultsOpen(false)
    setSearchOpen(false)
  }
  const queryRef = useRef(query)
  queryRef.current = query

  // 서식 줄 + 검색 · 글 블록 · 펼치기 단추. 상단바 도구줄 자리가 있으면 지금 만지는 칸 것만 거기에 그리고, 없으면(시험 · 단독) 노트 맨 위에 둔다
  const hasTopBarSlot = useHasTopBarSlot()
  const dock = (
    <div className="note-format-dock memo-note-tab-dock">
      <div className="note-format-slot" ref={flow.setFormatSlot} />
      {editingKey === null && draft === null ? <MemoFormatBar onCommand={() => undefined} disabled /> : null}
      {/* 검색 · 글 블록 넣기 · 펼치기: 서식 줄 오른쪽 끝(제목 줄은 칸 머리와 겹쳐서 없앴다) */}
      <div className="memo-note-tab-actions" role="toolbar" aria-label={t('노트 도구')}>
      <button
        type="button"
        className="pdf-memo-header-button"
        aria-label={searchOpen ? t('검색 닫기') : t('노트 검색')}
        title={t('모든 메모에서 찾기')}
        aria-pressed={searchOpen}
        onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
      >
        <MagnifyingGlass size={15} aria-hidden="true" />
      </button>
      {flow.note === null ? null : (
        <button type="button" className="pdf-memo-header-button" aria-label={t('글 블록 넣기')} title={t('글 블록 넣기')} onClick={flow.appendText}>
          <Plus size={15} weight="bold" aria-hidden="true" />
        </button>
      )}
      {noteMemos.length === 0 ? null : (
        <button
          type="button"
          className="pdf-memo-header-button"
          aria-label={anyQuoteOpen ? t('메모 모두 접기') : t('메모 모두 펼치기')}
          title={anyQuoteOpen ? t('모두 접기') : t('모두 펼치기')}
          onClick={flow.toggleQuotes}
        >
          {anyQuoteOpen ? <ArrowsInLineVertical size={15} aria-hidden="true" /> : <ArrowsOutLineVertical size={15} aria-hidden="true" />}
        </button>
      )}
      </div>
    </div>
  )

  return (
    <div ref={rootRef} className={`pane-doc memo-note-tab${wide ? ' memo-note-tab-wide' : ''}`} data-memo-note-tab={path} data-layout={wide ? 'wide' : 'narrow'}>
      <section ref={setBarEl} className="pdf-memo-bar memo-note-tab-bar" aria-label={t('메모 노트')} style={{ '--bar-zoom': wide ? 1 : barZoom } as CSSProperties}>
        {searchOpen ? (
          <div className="memo-note-tab-searchrow">
            <div className="pdf-memo-search">
              <MagnifyingGlass size={14} aria-hidden="true" />
              <input
                type="search"
                aria-label={t('노트 검색')}
                placeholder={t('모든 메모에서 찾기')}
                autoFocus
                value={query}
                onChange={(event) => {
                  flow.setQuery(event.target.value)
                  setResultsOpen(true)
                }}
                onFocus={() => setResultsOpen(true)}
                onBlur={() => window.setTimeout(() => {
                  setResultsOpen(false)
                  // 비워 둔 채 나가면 검색 칸을 접고 이름을 다시 보인다
                  setSearchOpen((open) => open && queryRef.current.trim() !== '')
                }, 120)}
                onKeyDown={(event) => { if (event.key === 'Escape') closeSearch() }}
              />
              {resultsOpen && needle !== '' ? (
                <div className="pdf-memo-results" role="listbox" aria-label={t('노트 검색 결과')}>
                  {results.length === 0 ? <p>{t('찾은 메모가 없습니다')}</p> : results.map((highlight) => {
                    const owner = api?.notesOf(highlight.id).find((candidate) => candidate !== path)
                    return (
                      <button
                        key={highlight.id}
                        type="button"
                        role="option"
                        aria-selected={false}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => pickResult(highlight)}
                      >
                        <span className="pdf-memo-results-meta">
                          {(docTitles?.[highlight.anchor.docId] ?? t('다른 문서')) + ' · p.' + (highlight.anchor.page + 1)}{owner === undefined ? null : ' · ' + memoNoteTitleOf(owner)}{highlight.topic === undefined ? null : <> · <CategoryTag name={highlight.topic} /></>}
                        </span>
                        <span className="pdf-memo-results-note">{highlight.note}</span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {flow.note === null ? (
          <div className="note-empty">
            <p>{t('노트를 불러올 수 없습니다')}</p>
          </div>
        ) : (
          <div className={`markdown-memo-bar-body${wide ? ' note-wide' : ''}`}>
            {hasTopBarSlot ? <TopBarToolbar>{dock}</TopBarToolbar> : dock}
            <div
              ref={scrollRef}
              className="pdf-memo-bar-scroll"
              // 다른 노트에서 끌어 온 블록이 놓일 노트를 칸 안에서 알아보는 표시(noteBlockDrag)
              data-note-path={path}
              // 메뉴 항목을 막 고른 자리면 호버를 비켜 가고(menuGuard), 포인터가 진짜 움직이면 그때 올려 둔 카드를 켠다
              onPointerOver={(event) => {
                if (!(event.target instanceof Element)) return
                if (menuGuardActive()) { hoverSwallowed.current = true; return }
                const card = event.target.closest<HTMLElement>('[data-memo-id]')
                reportMemoHover(card === null || card.dataset.noteBlock === 'draft' ? null : card.dataset.memoId ?? null)
              }}
              onPointerMove={(event) => {
                if (!hoverSwallowed.current || menuGuardActive() || !(event.target instanceof Element)) return
                hoverSwallowed.current = false
                const card = event.target.closest<HTMLElement>('[data-memo-id]')
                reportMemoHover(card === null || card.dataset.noteBlock === 'draft' ? null : card.dataset.memoId ?? null)
              }}
              onPointerLeave={() => { hoverSwallowed.current = false; reportMemoHover(null) }}
              onClick={(event) => {
                // 카드를 누르면 같은 색 창이 그 형광펜으로 간다(글 쓰는 칸·단추·원문 칩은 제외: 원문 칩은 onJump 가 보낸다)
                if (!(event.target instanceof Element)) return
                // 「→ 문서 이름」: 원문 문서를 같은 색 창에 보이게 하는 신호(떨어진 창이면 탭으로 열린다)
                const far = event.target.closest<HTMLElement>('[data-far-memo]')?.dataset.farMemo
                if (far !== undefined) {
                  sendPoint(far, 'note')
                  return
                }
                if (event.target.closest('.pdf-memo-editor, button, input, textarea, [contenteditable="true"], .note-source-chip, .pdf-memo-card-source, .note-source-region') !== null) return
                const memoId = event.target.closest<HTMLElement>('[data-memo-id]')?.dataset.memoId
                if (memoId !== undefined && memoId !== '') sendPoint(memoId, 'note')
              }}
            >
              {items.length === 0 && draft === null ? <p className="note-empty-hint">{t('비어 있는 노트입니다. 「＋」로 글 블록을 넣어 쓰세요.')}</p> : null}
              <MemoNoteContext.Provider value={flow.scopedApi}>
                <MemoFormatSlotContext.Provider value={flow.formatSlot}>
                  <NoteFlow
                    {...flow.flowProps}
                    attachingKey={attachingKey}
                    onAddRef={addRef}
                    items={flowItems}
                    editingKey={draft !== null ? 'draft' : flow.flowProps.editingKey}
                    onSaveMemo={saveMemo}
                    onCancelDraft={draft !== null ? draft.cancel : flow.flowProps.onCancelDraft}
                  />
                </MemoFormatSlotContext.Provider>
              </MemoNoteContext.Provider>
            </div>
            {wide ? (
              <NoteOutline items={items} query={query} scrollerRef={scrollRef} onToggleSection={(key, collapsed) => updateNote((note) => updateSection(note, key, { collapsed }))} />
            ) : null}
          </div>
        )}
      </section>
    </div>
  )
}
