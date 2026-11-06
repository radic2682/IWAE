import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CaretDown, CaretRight, ClockCounterClockwise, MagnifyingGlass, X } from '@phosphor-icons/react'
import type { PdfSearchMatch, PdfSearchOptions } from '../core/pdfSearch'
import { cleanSnippet, groupSearchMatches, type SearchOutlineEntry } from '../core/pdfSearchGroups'
import type { UsePdfSearchResult } from './usePdfSearch'
import { pageImageUrl } from '../bridge/pdf'
import '../ui/pdf-followup.css'
import { t } from '../i18n'

export interface PdfSearchPanelProps {
  readonly query?: string
  readonly onQueryChange?: (query: string) => void
  readonly search: UsePdfSearchResult
  readonly options: PdfSearchOptions
  readonly onOptionsChange: (options: PdfSearchOptions) => void
  readonly onSelectMatch: (match: PdfSearchMatch) => void
  /** 양쪽 패널에 PDF 가 있을 때 Ctrl+F 를 받을 쪽. 마지막으로 만진 문서 패널만 연다 */
  readonly shortcutTarget?: boolean
  /** 왼쪽 바에 붙여 늘 펼쳐 둔다(검색 칸 + 결과 목록) */
  readonly docked?: boolean
  /** 문서 목차. 왼쪽 바 결과를 절별로 묶는 데 쓴다 */
  readonly outline?: readonly SearchOutlineEntry[]
  /** 쪽 크기(points). 주면 결과마다 그 쪽 미리보기에 찾은 자리를 칠해 보인다 */
  readonly pageSizes?: readonly (readonly [number, number])[]
}

export function PdfSearchPanel({
  query,
  onQueryChange,
  search,
  options,
  onOptionsChange,
  onSelectMatch,
  shortcutTarget = true,
  docked = false,
  outline = [],
  pageSizes,
}: PdfSearchPanelProps) {
  const controlledTool = query !== undefined && onQueryChange !== undefined
  const queryValue = query ?? ''
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const toolRef = useRef<HTMLDivElement | null>(null)
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [resultsOpen, setResultsOpen] = useState(false)
  const expanded = hovered || pinned
  const current = search.activeIndex >= 0 && search.activeIndex < search.matches.length
    ? search.activeIndex + 1
    : 0

  useEffect(() => {
    if (!controlledTool || !shortcutTarget) return
    const openSearch = (event: Event) => {
      const picked = (event as CustomEvent<{ query?: string } | undefined>).detail?.query
      if (picked !== undefined && picked !== '') onQueryChange?.(picked)
      setPinned(true)
      setResultsOpen(true)
    }
    window.addEventListener('iwae:pdf-search', openSearch)
    return () => window.removeEventListener('iwae:pdf-search', openSearch)
  }, [controlledTool, shortcutTarget, onQueryChange])

  useEffect(() => {
    if (pinned) searchInputRef.current?.focus()
  }, [pinned])
  // 왼쪽 바에 붙였으면 Ctrl+F 로 검색 칸에 바로 간다
  useEffect(() => {
    if (!docked || !shortcutTarget) return
    // 고른 글자가 함께 오면 그 글자로 바꿔 바로 찾는다
    const focus = (event: Event) => {
      const picked = (event as CustomEvent<{ query?: string } | undefined>).detail?.query
      if (picked !== undefined && picked !== '') onQueryChange?.(picked)
      window.setTimeout(() => {
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }, 0)
    }
    window.addEventListener('iwae:pdf-search', focus)
    return () => window.removeEventListener('iwae:pdf-search', focus)
  }, [docked, shortcutTarget, onQueryChange])

  // 결과 목록은 PDF 를 눌러도 닫지 않는다 — 결과를 하나씩 눌러 보며 본문을 바로바로 오가야 한다.
  // 닫기는 ✕ 단추나 Esc 로만 한다.
  const closeSearch = () => {
    setPinned(false)
    setHovered(false)
    setResultsOpen(false)
  }

  const handleSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSearch()
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (event.shiftKey) search.previous()
    else search.next()
  }

  const results = (
    <section className="pdf-search-panel pdf-search-panel-compact" aria-label={t('PDF 검색 결과')}>
      <header className="pdf-search-panel-header">
        <span className="pdf-search-progress" aria-label={t('PDF 검색 진행률')}>
          {t('{completed} / {total} 페이지', { completed: search.progress.completed, total: search.progress.total })}
        </span>
      </header>

      {controlledTool && search.recentQueries.length > 0 ? (
        <div className="pdf-search-recent" aria-label={t('최근 검색어')}>
          {search.recentQueries.map((recent) => (
            <button
              key={recent}
              type="button"
              className="pdf-search-recent-query"
              aria-label={t('최근 검색어 {query}', { query: recent })}
              onClick={() => onQueryChange(recent)}
            >
              {recent}
            </button>
          ))}
        </div>
      ) : null}

      {search.status === 'error' ? (
        <div className="pdf-search-state pdf-search-state-error" role="alert">
          {t('PDF 검색 중 오류가 발생했습니다')}
        </div>
      ) : null}

      {search.status === 'complete' && search.matches.length === 0 ? (
        <div className="pdf-search-state">{t('검색 결과가 없습니다')}</div>
      ) : null}

      {search.matches.length > 0 ? (
        <ol className="pdf-search-results">
          {search.matches.map((match, index) => {
            const active = index === search.activeIndex
            return (
              <li className="pdf-search-result-item" key={match.id}>
                <button
                  type="button"
                  className={`pdf-search-result-row${active ? ' pdf-search-result-row-active' : ''}`}
                  aria-label={t('{page}페이지 {quote}', { page: match.page + 1, quote: match.quote })}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => {
                    search.select(index)
                    onSelectMatch(match)
                  }}
                >
                  <span className="pdf-search-result-page">{t('{page}페이지', { page: match.page + 1 })}</span>
                  <span className="pdf-search-result-snippet">
                    <span>{match.before}</span>
                    <mark>{match.quote}</mark>
                    <span>{match.after}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      ) : null}
    </section>
  )

  if (docked && controlledTool) {
    return (
      <div className="pdf-search-docked">
        <div className="pdf-search-field">
          <MagnifyingGlass size={15} aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            aria-label={t('PDF 검색')}
            value={queryValue}
            placeholder={t('이 PDF에서 검색')}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onQueryChange('')
                return
              }
              handleSearchKey(event)
            }}
          />
          <output className="pdf-search-position" aria-label={t('검색 결과 위치')}>
            {current}/{search.matches.length}
          </output>
          <button
            type="button"
            className="pdf-search-option"
            aria-label={t('대소문자 구분')}
            aria-pressed={options.caseSensitive}
            onClick={() => onOptionsChange({ ...options, caseSensitive: !options.caseSensitive })}
          >
            Aa
          </button>
          <button
            type="button"
            className="pdf-search-option"
            aria-label={t('완전한 단어')}
            aria-pressed={options.wholeWord}
            onClick={() => onOptionsChange({ ...options, wholeWord: !options.wholeWord })}
          >
            W
          </button>
        </div>
        <DockedSearchResults
          query={queryValue}
          search={search}
          outline={outline}
          onPickRecent={onQueryChange}
          onSelectMatch={onSelectMatch}
          pageSizes={pageSizes}
        />
      </div>
    )
  }

  if (!controlledTool) {
    return (
      <div className="pdf-search-legacy">
        <div className="pdf-search-field">
          <output className="pdf-search-position" aria-label={t('검색 결과 위치')}>
            {current}/{search.matches.length}
          </output>
          <button
            type="button"
            className="pdf-search-option"
            aria-label={t('대소문자 구분')}
            aria-pressed={options.caseSensitive}
            onClick={() => onOptionsChange({ ...options, caseSensitive: !options.caseSensitive })}
          >
            Aa
          </button>
          <button
            type="button"
            className="pdf-search-option"
            aria-label={t('완전한 단어')}
            aria-pressed={options.wholeWord}
            onClick={() => onOptionsChange({ ...options, wholeWord: !options.wholeWord })}
          >
            W
          </button>
        </div>
        {results}
      </div>
    )
  }

  return (
    <div
      ref={toolRef}
      className={`pdf-floating-control pdf-search-floating-tool${expanded ? ' pdf-floating-control-expanded pdf-search-floating-tool-expanded' : ''}`}
      onMouseEnter={() => {
        setHovered(true)
        if (queryValue.trim().length > 0 || search.recentQueries.length > 0) setResultsOpen(true)
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="pdf-floating-control-trigger pdf-search-trigger"
        aria-label={t('PDF 검색')}
        aria-expanded={expanded}
        aria-pressed={pinned}
        onClick={() => {
          setPinned((currentPinned) => !currentPinned)
          setResultsOpen(true)
        }}
      >
        <MagnifyingGlass size={18} weight="bold" aria-hidden="true" />
      </button>
      <div className="pdf-floating-control-expansion" aria-hidden={!expanded}>
        {expanded ? <div className="pdf-search-field">
            <input
              ref={searchInputRef}
              type="search"
              aria-label={t('PDF 검색')}
              value={queryValue}
              placeholder={t('PDF에서 검색')}
              tabIndex={expanded ? 0 : -1}
              onFocus={() => setResultsOpen(true)}
              onChange={(event) => {
                onQueryChange(event.currentTarget.value)
                // 글자를 치면 고정한다. 마우스가 검색창을 떠나도 접히지 않는다.
                setPinned(true)
                setResultsOpen(true)
              }}
              onKeyDown={handleSearchKey}
            />
            <output className="pdf-search-position" aria-label={t('검색 결과 위치')}>
              {current}/{search.matches.length}
            </output>
            <button
              type="button"
              className="pdf-search-option"
              aria-label={t('대소문자 구분')}
              aria-pressed={options.caseSensitive}
              tabIndex={expanded ? 0 : -1}
              onClick={() => onOptionsChange({ ...options, caseSensitive: !options.caseSensitive })}
            >
              Aa
            </button>
            <button
              type="button"
              className="pdf-search-option"
              aria-label={t('완전한 단어')}
              aria-pressed={options.wholeWord}
              tabIndex={expanded ? 0 : -1}
              onClick={() => onOptionsChange({ ...options, wholeWord: !options.wholeWord })}
            >
              W
            </button>
            <button
              type="button"
              className="pdf-search-option pdf-search-close"
              aria-label={t('PDF 검색 닫기')}
              title={t('검색 닫기 (Esc)')}
              tabIndex={expanded ? 0 : -1}
              onClick={closeSearch}
            >
              <X size={13} aria-hidden="true" />
            </button>
        </div> : null}
      </div>
      {expanded && resultsOpen && (queryValue.trim().length > 0 || search.recentQueries.length > 0)
        ? results
        : null}
    </div>
  )
}

/**
 * 왼쪽 바의 검색 결과. 찾은 곳을 문서 목차의 절별로 묶어 "어디에 나오는지"를 먼저 보이고,
 * 각 줄은 찾은 낱말 둘레의 글만 깔끔히 보인다. 목차·색인 줄에서 찾은 것은 맨 아래에 접어 둔다.
 */
function DockedSearchResults({
  query,
  search,
  outline,
  onPickRecent,
  onSelectMatch,
  pageSizes,
}: {
  readonly query: string
  readonly search: UsePdfSearchResult
  readonly outline: readonly SearchOutlineEntry[]
  readonly onPickRecent: (query: string) => void
  readonly onSelectMatch: (match: PdfSearchMatch) => void
  readonly pageSizes?: readonly (readonly [number, number])[]
}) {
  const groups = useMemo(() => groupSearchMatches(search.matches, outline), [search.matches, outline])
  // 펼침을 바꾼 묶음만 기억한다(기본: 본문 펼침, 목차·색인 접힘). 검색어가 바뀌면 처음으로
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => setToggled(new Set()), [query])
  const listRef = useRef<HTMLDivElement | null>(null)

  const activeGroup = groups.find((group) => group.items.some((item) => item.index === search.activeIndex))?.key
  const isOpen = (key: string, toc: boolean) => key === activeGroup || (toc ? toggled.has(key) : !toggled.has(key))

  // Enter 로 다음 결과로 가면 그 줄이 보이게. 목록 안에 포커스가 있으면 포커스도 그 줄로 옮긴다
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')
    row?.scrollIntoView?.({ block: 'nearest' })
    if (row != null && listRef.current?.contains(document.activeElement) === true) row.focus()
  }, [search.activeIndex])
  /** 결과 줄을 누른 뒤: Enter·↓ 다음 결과, Shift+Enter·↑ 앞 결과(그 자리로 간다) */
  const moveFromRow = (event: KeyboardEvent<HTMLElement>) => {
    const forward = (event.key === 'Enter' && !event.shiftKey) || event.key === 'ArrowDown'
    const backward = (event.key === 'Enter' && event.shiftKey) || event.key === 'ArrowUp'
    if (!forward && !backward) return
    event.preventDefault()
    if (search.matches.length === 0) return
    const current = search.activeIndex < 0 ? (forward ? -1 : 0) : search.activeIndex
    const index = (current + (forward ? 1 : -1) + search.matches.length) % search.matches.length
    const match = search.matches[index]
    if (match === undefined) return
    search.select(index)
    onSelectMatch(match)
  }

  const searching = search.progress.total > 0 && search.progress.completed < search.progress.total
  const pageCount = new Set(search.matches.map((match) => match.page)).size
  const bodyGroups = groups.filter((group) => !group.toc).length

  if (query.trim() === '') {
    return search.recentQueries.length === 0 ? null : (
      <div className="pdf-search-recent pdf-search-recent-docked" aria-label={t('최근 검색어')}>
        <div className="pdf-search-recent-head">
          <span className="pdf-search-recent-label">{t('최근 검색')} <span className="pdf-search-recent-count">{search.recentQueries.length}</span></span>
          {search.clearRecent !== undefined ? (
            <button type="button" className="pdf-search-recent-clear" onClick={search.clearRecent}>{t('모두 지우기')}</button>
          ) : null}
        </div>
        {/* 최근 것부터 줄마다 하나. 눌러 다시 찾고, 줄 끝 × 로 하나씩 지운다 */}
        <ul className="pdf-search-recent-list">
          {search.recentQueries.map((recent) => (
            <li key={recent} className="pdf-search-recent-row">
              <button type="button" className="pdf-search-recent-query" aria-label={t('최근 검색어 {query}', { query: recent })} title={recent} onClick={() => onPickRecent(recent)}>
                <ClockCounterClockwise size={13} aria-hidden="true" />
                <span>{recent}</span>
              </button>
              {search.removeRecent !== undefined ? (
                <button type="button" className="pdf-search-recent-remove" aria-label={t('최근 검색어 {query} 지우기', { query: recent })} title={t('지우기')} onClick={() => search.removeRecent?.(recent)}>
                  <X size={11} weight="bold" aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <section className="pdf-search-panel pdf-search-grouped" aria-label={t('PDF 검색 결과')}>
      <header className="pdf-search-summary">
        <span>
          {search.matches.length === 0
            ? (searching ? t('찾는 중…') : '')
            : bodyGroups > 0 && outline.length > 0
              ? t('{count}건 · {pages}쪽 · {sections}개 절', { count: search.matches.length, pages: pageCount, sections: bodyGroups })
              : t('{count}건 · {pages}쪽', { count: search.matches.length, pages: pageCount })}
        </span>
        {searching ? (
          <span className="pdf-search-meter" aria-label={t('PDF 검색 진행률')} role="progressbar" aria-valuemin={0} aria-valuemax={search.progress.total} aria-valuenow={search.progress.completed}>
            <span style={{ width: `${(search.progress.completed / search.progress.total) * 100}%` }} />
          </span>
        ) : null}
      </header>

      {search.status === 'error' ? (
        <div className="pdf-search-state pdf-search-state-error" role="alert">{t('PDF 검색 중 오류가 발생했습니다')}</div>
      ) : null}
      {search.status === 'complete' && search.matches.length === 0 ? (
        <div className="pdf-search-state">{t('검색 결과가 없습니다')}</div>
      ) : null}

      <div className="pdf-search-groups" ref={listRef}>
        {groups.map((group) => {
          const open = isOpen(group.key, group.toc)
          const pages = group.items.map((item) => item.match.page + 1)
          const first = Math.min(...pages)
          const last = Math.max(...pages)
          return (
            <div key={group.key} className={`pdf-search-group${group.toc ? ' pdf-search-group-toc' : ''}`}>
              <button
                type="button"
                className="pdf-search-group-head"
                aria-expanded={open}
                onClick={() => setToggled((current) => {
                  const next = new Set(current)
                  if (next.has(group.key)) next.delete(group.key)
                  else next.add(group.key)
                  return next
                })}
              >
                {open ? <CaretDown size={11} weight="bold" aria-hidden="true" /> : <CaretRight size={11} weight="bold" aria-hidden="true" />}
                <span className="pdf-search-group-title">{group.title ?? t('앞부분')}</span>
                <span className="pdf-search-group-meta">{first === last ? t('{page}쪽', { page: first }) : t('{first}–{last}쪽', { first, last })} · {group.items.length}</span>
              </button>
              {open ? (
                <ol className="pdf-search-results">
                  {group.items.map(({ match, index }) => {
                    const active = index === search.activeIndex
                    const snippet = cleanSnippet(match.before, match.after)
                    return (
                      <li className="pdf-search-result-item" key={match.id}>
                        <button
                          type="button"
                          className={`pdf-search-result-row${active ? ' pdf-search-result-row-active' : ''}`}
                          aria-label={t('{page}페이지 {quote}', { page: match.page + 1, quote: match.quote })}
                          aria-current={active ? 'true' : undefined}
                          onClick={() => {
                            search.select(index)
                            onSelectMatch(match)
                          }}
                          onKeyDown={moveFromRow}
                        >
                          <SearchPageThumb match={match} pageSize={pageSizes?.[match.page]} />
                          <span className="pdf-search-result-snippet">
                            {snippet.before}<mark>{match.quote}</mark>{snippet.after}
                          </span>
                          <span className="pdf-search-result-page">{match.page + 1}</span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** 결과의 쪽 미리보기(작게). 찾은 자리를 칠해 보인다. 화면에 들어올 때만 그림을 받는다 */
function SearchPageThumb({ match, pageSize }: { readonly match: PdfSearchMatch; readonly pageSize: readonly [number, number] | undefined }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (element === null || visible) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '200px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [visible])
  const ratio = pageSize === undefined ? 1.294 : pageSize[1] / pageSize[0]
  return (
    <span ref={ref} className="pdf-search-thumb" style={{ aspectRatio: `1 / ${ratio}` }} aria-hidden="true">
      {visible ? <img src={pageImageUrl(match.docId, match.page, 160)} alt="" loading="lazy" draggable={false} /> : null}
      {pageSize === undefined ? null : match.rects.map((rect, index) => (
        <i
          key={index}
          className="pdf-search-thumb-hit"
          style={{
            left: `${(rect.x / pageSize[0]) * 100}%`,
            top: `${(rect.y / pageSize[1]) * 100}%`,
            width: `${Math.max((rect.w / pageSize[0]) * 100, 4)}%`,
            height: `${Math.max((rect.h / pageSize[1]) * 100, 1.2)}%`,
          }}
        />
      ))}
    </span>
  )
}

