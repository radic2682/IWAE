import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ArrowsInLineVertical, ArrowsOutLineVertical, MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { t } from '../i18n'
import { memoHighlightIds, updateSection, type MemoNoteBlock, type MemoTicket } from '../core/memoNote'
import { useMemoPointSender, usePaneChannel, usePointSignalReceiver, useRoutedMemoDraft } from '../app/workspaceContext'
import { LINK_CARD_DEPTH, registerPaneLinks, requestPaneLinks, useLinkedDocIds, visibleSlice, type LinkItem, type PaneLinkSnapshot } from '../app/workspaceLinks'
import { MemoFormatBar, MemoFormatSlotContext, type MemoContent } from './MemoColumn'
import { MemoNoteContext, useMemoNoteApi } from './memoNoteContext'
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
  const [searchOpen, setSearchOpen] = useState(false)
  // 문서 창에서 만드는 새 메모(같은 색 창의 문서에서 고른 글): 이 노트로 오면 새 메모 카드로 보이고 여기서 쓴다(비우면 사라진다)
  const draft = useRoutedMemoDraft(path)
  const [draftIndex, setDraftIndex] = useState(0)
  const sendPoint = useMemoPointSender()
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
      const markdown = /.(md|markdown|mdx)$/iu.test(item.highlight.anchor.docId)
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
    setSearchOpen(false)
  }

  return (
    <div ref={rootRef} className={`pane-doc memo-note-tab${wide ? ' memo-note-tab-wide' : ''}`} data-memo-note-tab={path} data-layout={wide ? 'wide' : 'narrow'}>
      <section className="pdf-memo-bar memo-note-tab-bar" aria-label={t('메모 노트')}>
        <div className="pdf-memo-header memo-note-tab-head" role="toolbar" aria-label={t('노트 도구')}>
          {searchOpen ? (
            <div className="pdf-memo-search">
              <MagnifyingGlass size={14} aria-hidden="true" />
              <input
                type="search"
                aria-label={t('노트 검색')}
                placeholder={t('이 노트에서 검색')}
                autoFocus
                value={query}
                onChange={(event) => flow.setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') closeSearch() }}
              />
            </div>
          ) : <span className="memo-note-tab-spacer" />}
          <button
            type="button"
            className="pdf-memo-header-button"
            aria-label={searchOpen ? t('검색 닫기') : t('노트 검색')}
            title={t('이 노트에서 검색')}
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
        {flow.note === null ? (
          <div className="note-empty">
            <p>{t('노트를 불러올 수 없습니다')}</p>
          </div>
        ) : (
          <div className={`markdown-memo-bar-body${wide ? ' note-wide' : ''}`}>
            <div className="note-format-dock">
              <div className="note-format-slot" ref={flow.setFormatSlot} />
              {editingKey === null && draft === null ? <MemoFormatBar onCommand={() => undefined} disabled /> : null}
            </div>
            <div
              ref={scrollRef}
              className="pdf-memo-bar-scroll"
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
