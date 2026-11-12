import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ArrowsInLineVertical, ArrowsOutLineVertical, MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { t } from '../i18n'
import { updateSection } from '../core/memoNote'
import { MemoFormatBar, MemoFormatSlotContext } from './MemoColumn'
import { MemoNoteContext, useMemoNoteApi } from './memoNoteContext'
import { NoteFlow } from './NoteFlow'
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
}

/**
 * 메모 노트를 창의 탭으로 보인다(노트 바 없이 노트만). 노트 바와 같은 저장소·같은 카드(NoteFlow)를 쓰므로
 * 같은 노트를 노트 바와 탭에서 함께 보고 어느 쪽에서 고쳐도 하나로 합쳐진다.
 * 폭이 좁으면 노트 바의 카드 목록, 넓으면 문서처럼(글 칸 가운데 + 목차) — 따로 켜는 모드는 없다.
 * 검색·글 블록 넣기·펼치기 단추는 창 머리가 아니라 이 안의 도구줄에 둔다.
 */
export function MemoNoteTabView({ path, highlights, docTitles, onHighlightUpdated, onHighlightRemoved, onJump }: MemoNoteTabViewProps) {
  const api = useMemoNoteApi()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const wide = useMinWidth(rootRef, MEMO_NOTE_WIDE_MIN)
  const [searchOpen, setSearchOpen] = useState(false)
  const flow = useNoteFlowController({ api, path, highlights, docTitles, otherLabel: t('다른 문서'), onHighlightUpdated, onHighlightRemoved, onJump })
  const { items, noteMemos, anyQuoteOpen, editingKey, query, updateNote } = flow
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
              {editingKey === null ? <MemoFormatBar onCommand={() => undefined} disabled /> : null}
            </div>
            <div ref={scrollRef} className="pdf-memo-bar-scroll">
              {items.length === 0 ? <p className="note-empty-hint">{t('비어 있는 노트입니다. 「＋」로 글 블록을 넣어 쓰세요.')}</p> : null}
              <MemoNoteContext.Provider value={flow.scopedApi}>
                <MemoFormatSlotContext.Provider value={flow.formatSlot}>
                  <NoteFlow {...flow.flowProps} />
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
