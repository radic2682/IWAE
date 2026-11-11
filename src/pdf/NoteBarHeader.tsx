import { useRef, useState } from 'react'
import { ArrowsIn, ArrowsInLineVertical, ArrowsOut, ArrowsOutLineVertical, MagnifyingGlass, Plus, X } from '@phosphor-icons/react'
import { t } from '../i18n'
import { CategoryTag } from './CategoryTag'
import { NoteTitle } from './NoteTitle'
import { NoteSwitcherMenu, noteSwitcherGroups } from './NoteSwitcher'
import type { MemoNoteApi } from './memoNoteContext'
import type { PersistentPdfHighlight } from './persistentHighlight'

/**
 * 오른쪽 노트 바의 머리(PDF·Markdown 이 같이 쓴다): 노트 이름(두 번 눌러 바꾸기) · 모든 노트에서 검색 ·
 * 글 블록 넣기 · 원문 모두 접기/펼치기 · 메모만 보기 · 노트 닫기.
 */
export function NoteBarHeader({
  api,
  fallbackTitle,
  highlights,
  currentDocId,
  docTitles,
  onPickResult,
  onAddText,
  anyQuoteOpen,
  onToggleQuotes,
  memoOnly,
  onToggleMemoOnly,
  onClose,
  onQueryChange,
  className = 'pdf-memo-header',
}: {
  readonly api: MemoNoteApi | null
  readonly fallbackTitle: string
  /** 검색할 메모(모든 문서의 형광펜) */
  readonly highlights: readonly PersistentPdfHighlight[]
  readonly currentDocId: string
  readonly docTitles?: Readonly<Record<string, string>>
  /** 검색 결과를 눌렀다(열린 노트에 없으면 그 메모를 담은 노트를 연 뒤 부른다) */
  readonly onPickResult: (highlight: PersistentPdfHighlight) => void
  readonly onAddText?: () => void
  /** 원문이 하나라도 펼쳐져 있는가(없으면 접기/펼치기 단추를 감춘다) */
  readonly anyQuoteOpen?: boolean
  readonly onToggleQuotes?: () => void
  readonly memoOnly?: boolean
  readonly onToggleMemoOnly?: () => void
  readonly onClose?: () => void
  /** 검색어가 바뀌었다(노트 블록 흐리게 하기·메모만 보기 목록 거르기에 쓴다) */
  readonly onQueryChange?: (query: string) => void
  readonly className?: string
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQueryState] = useState('')
  const setQuery = (next: string) => {
    setQueryState(next)
    onQueryChange?.(next)
  }
  const queryRef = useRef(query)
  queryRef.current = query
  const [resultsOpen, setResultsOpen] = useState(false)
  const needle = query.trim().toLowerCase()
  const results = needle === '' ? [] : highlights
    .filter((highlight) => (highlight.note ?? '').trim() !== '')
    .filter((highlight) => (highlight.note ?? '').toLowerCase().includes(needle)
      || highlight.anchor.quote.toLowerCase().includes(needle)
      || (highlight.topic ?? '').toLowerCase().includes(needle))
    .sort((a, b) => (a.anchor.docId === currentDocId ? 0 : 1) - (b.anchor.docId === currentDocId ? 0 : 1) || a.anchor.page - b.anchor.page)
    .slice(0, 30)
  const noteOpen = api !== null && api.openPath !== null
  const [switchOpen, setSwitchOpen] = useState(false)
  // 노트 바꾸기: 노트가 하나라도 있거나 이 PDF 에 만들 수 있을 때만
  const switcherGroups = api === null ? null : noteSwitcherGroups(api, currentDocId)
  const canSwitch = api !== null && switcherGroups !== null && (api.entries.length > 0 || (switcherGroups.owner !== null && api.createForDoc !== undefined))

  return (
    <div className={className}>
      {searchOpen ? null : (
        <span className="note-head-switch" data-note-switch-trigger="">
          <NoteTitle
            api={api}
            className="note-head-title"
            fallback={fallbackTitle}
            switcher={canSwitch ? { open: switchOpen, onToggle: () => setSwitchOpen((open) => !open), onRename: () => setSwitchOpen(false) } : undefined}
          />
        </span>
      )}
      {!searchOpen && switchOpen && canSwitch ? (
        <NoteSwitcherMenu
          api={api}
          currentDocId={currentDocId}
          docLabel={api.docLabel?.(currentDocId) ?? (docTitles?.[currentDocId] ?? '').split(' · ')[0] ?? ''}
          onClose={() => setSwitchOpen(false)}
        />
      ) : null}
      {searchOpen ? (
        <div className="pdf-memo-search">
          <MagnifyingGlass size={14} aria-hidden="true" />
          <input
            type="search"
            aria-label={t('노트 검색')}
            placeholder={t('모든 노트에서 검색')}
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setResultsOpen(true)
            }}
            onFocus={() => setResultsOpen(true)}
            onBlur={() => window.setTimeout(() => {
              setResultsOpen(false)
              // 비워 둔 채 나가면 검색 칸을 접고 제목을 다시 보인다
              setSearchOpen((open) => open && queryRef.current.trim() !== '')
            }, 120)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setQuery('')
                setResultsOpen(false)
                setSearchOpen(false)
              }
            }}
          />
          {resultsOpen && memoOnly !== true && needle !== '' ? (
            <div className="pdf-memo-results" role="listbox" aria-label={t('노트 검색 결과')}>
              {results.length === 0 ? <p>{t('찾은 메모가 없습니다')}</p> : results.map((highlight) => (
                <button
                  key={highlight.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setResultsOpen(false)
                    // 열린 노트에 없으면 그 메모를 담은 노트를 연다
                    const inOpen = api?.openNote?.blocks.some((block) => block.kind === 'memo' && (block.highlightId === highlight.id || (block.refs ?? []).includes(highlight.id))) === true
                    const other = api?.notesOf(highlight.id)[0]
                    if (!inOpen && other !== undefined) api?.open(other)
                    onPickResult(highlight)
                  }}
                >
                  <span className="pdf-memo-results-meta">
                    {highlight.anchor.docId === currentDocId ? '' : `${docTitles?.[highlight.anchor.docId] ?? t('다른 문서')} · `}p.{highlight.anchor.page + 1}{highlight.topic === undefined ? null : <> · <CategoryTag name={highlight.topic} /></>}
                  </span>
                  <span className="pdf-memo-results-note">{highlight.note}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        className="pdf-memo-header-button"
        aria-label={searchOpen ? t('검색 닫기') : t('노트 검색')}
        title={t('모든 노트에서 검색')}
        aria-pressed={searchOpen}
        onClick={() => {
          if (searchOpen) setQuery('')
          setSearchOpen((open) => !open)
        }}
      >
        <MagnifyingGlass size={15} aria-hidden="true" />
      </button>
      {noteOpen && onAddText !== undefined ? (
        <button type="button" className="pdf-memo-header-button" aria-label={t('글 블록 넣기')} title={t('글 블록 넣기')} onClick={onAddText}>
          <Plus size={15} weight="bold" aria-hidden="true" />
        </button>
      ) : null}
      {onToggleQuotes === undefined || anyQuoteOpen === undefined ? null : (
        <button
          type="button"
          className="pdf-memo-header-button"
          aria-label={anyQuoteOpen ? t('메모 모두 접기') : t('메모 모두 펼치기')}
          title={anyQuoteOpen ? t('모두 접기') : t('모두 펼치기')}
          onClick={onToggleQuotes}
        >
          {anyQuoteOpen ? <ArrowsInLineVertical size={15} aria-hidden="true" /> : <ArrowsOutLineVertical size={15} aria-hidden="true" />}
        </button>
      )}
      {onToggleMemoOnly === undefined ? null : (
        <button
          type="button"
          className="pdf-memo-header-button"
          aria-label={memoOnly === true ? t('문서와 같이 보기') : t('메모만 보기')}
          title={memoOnly === true ? t('문서와 같이 보기') : t('메모만 보기')}
          aria-pressed={memoOnly === true}
          onClick={onToggleMemoOnly}
        >
          {memoOnly === true ? <ArrowsIn size={15} aria-hidden="true" /> : <ArrowsOut size={15} aria-hidden="true" />}
        </button>
      )}
      {onClose === undefined || !noteOpen ? null : (
        <button type="button" className="pdf-memo-header-button" aria-label={t('노트 닫기')} title={t('노트 닫기')} onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
