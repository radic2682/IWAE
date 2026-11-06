import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { searchVaultPages, type VaultSearchHit, type VaultSearchRecord } from '../core/vaultSearch'
import { pick, t } from '../i18n'
import '../ui/document-search.css'

/**
 * 문서 검색 화면의 상태. 화면을 닫았다 열어도 질의가 남도록 App 이 갖는다.
 * 검색은 앱이 이미 추출해 둔 모든 PDF 본문 글자에서 한다.
 */
export function useDocumentSearch() {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')

  const run = useCallback((text: string) => {
    const trimmed = text.trim()
    if (trimmed === '') return
    setSubmitted(trimmed)
  }, [])

  return { query, setQuery, submitted, run }
}

export type DocumentSearchState = ReturnType<typeof useDocumentSearch>

/** 질의 낱말을 굵게 */
function highlightTerms(text: string, terms: readonly string[]): ReactNode {
  const words = terms.map((term) => term.trim()).filter((term) => term.length >= 2)
  if (words.length === 0) return text
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).sort((a, b) => b.length - a.length)
  const pattern = new RegExp(`(${escaped.join('|')})`, 'giu')
  return text.split(pattern).map((part, index) => index % 2 === 1 ? <mark key={index}>{part}</mark> : part)
}

interface DocumentSearchPanelProps {
  state: DocumentSearchState
  onClose: () => void
  /** 찾을 본문 글자(앱이 추출해 둔 것) */
  records: readonly VaultSearchRecord[]
  /** 본문 추출이 어디까지 됐나 */
  indexProgress?: { indexed: number; total: number }
  /** 결과를 고르면 오른쪽 패널에 그 PDF 쪽을 연다 */
  onOpenHit: (hit: VaultSearchHit) => void
}

/**
 * 문서 검색 화면의 왼쪽 패널. 검색창과 결과 카드. 카드를 누르면 오른쪽 패널에
 * 원본 PDF 가 그 쪽으로 열리고 찾은 자리가 칠해진다.
 */
export function DocumentSearchPanel({ state, onClose, records, indexProgress, onOpenHit }: DocumentSearchPanelProps) {
  const hits = useMemo(
    () => state.submitted !== '' ? searchVaultPages(records, state.submitted, { kind: 'pdf', limit: 300 }).filter((hit) => hit.page !== null) : [],
    [records, state.submitted],
  )
  const [selected, setSelected] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 질의가 바뀌면 고른 카드를 푼다
  useEffect(() => {
    setSelected(null)
  }, [state.submitted])

  // 치는 대로 찾는다(잠깐 멈추면)
  const { query, submitted, run } = state
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed === '' || trimmed === submitted) return
    const timer = window.setTimeout(() => run(trimmed), 450)
    return () => window.clearTimeout(timer)
  }, [query, run, submitted])

  const open = (index: number) => {
    const hit = hits[index]
    if (hit === undefined) return
    setSelected(index)
    onOpenHit(hit)
  }

  useEffect(() => {
    if (selected === null) return
    listRef.current?.querySelector<HTMLElement>(`[data-hit-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const moveSelection = (delta: number) => {
    if (hits.length === 0) return
    open(Math.max(0, Math.min(hits.length - 1, selected === null ? 0 : selected + delta)))
  }

  return (
    <div
      className="doc-search"
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          moveSelection(event.key === 'ArrowDown' ? 1 : -1)
        } else if (event.key === '/') {
          event.preventDefault()
          inputRef.current?.focus()
        }
      }}
    >
      <div className="doc-search-head">
        <form
          className="doc-search-bar"
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            run(query)
          }}
        >
          <MagnifyingGlass size={16} aria-hidden="true" className="doc-search-icon" />
          <input
            ref={inputRef}
            type="text"
            aria-label={t('문서 검색어')}
            placeholder={t('모든 PDF 본문에서 찾을 글자')}
            value={query}
            spellCheck={false}
            onChange={(event) => state.setQuery(event.target.value)}
            onKeyDown={(event) => {
              // 검색어가 있으면 Esc 는 먼저 검색어만 지운다(한 번 더 누르면 화면을 닫는다)
              if (event.key === 'Escape' && query !== '') {
                event.preventDefault()
                event.stopPropagation()
                state.setQuery('')
              }
            }}
          />
          {query !== '' ? (
            <button
              type="button"
              className="doc-search-clear"
              aria-label={t('검색어 지우기')}
              onClick={() => {
                state.setQuery('')
                inputRef.current?.focus()
              }}
            >
              <X size={11} weight="bold" aria-hidden="true" />
            </button>
          ) : null}
        </form>
        <button type="button" className="doc-search-close" aria-label={t('검색 화면 닫기 (Esc)')} onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="doc-search-status" role="status" aria-live="polite">
        <span>
          {submitted === '' ? t('모든 PDF 본문에서 글자 그대로 찾습니다') : t('“{query}” {count}건', { query: submitted, count: hits.length })}
          {indexProgress !== undefined && indexProgress.indexed < indexProgress.total
            ? ` · ${t('본문 추출 {indexed}/{total}', { indexed: indexProgress.indexed, total: indexProgress.total })}` : ''}
        </span>
      </div>

      <div className="doc-results" ref={listRef} role="listbox" aria-label={t('문서 검색 결과')}>
        {hits.map((hit, index) => (
          <button
            key={`${hit.record.id}:${hit.page}:${index}`}
            type="button"
            role="option"
            aria-selected={selected === index}
            data-hit-index={index}
            className={`doc-card${selected === index ? ' doc-card-selected' : ''}`}
            onClick={() => open(index)}
          >
            <span className="doc-card-head">
              <span className="doc-card-doc">{hit.record.displayName}</span>
              <span className="doc-card-page">p.{(hit.page ?? 0) + 1}</span>
            </span>
            <span className="doc-card-text">{highlightTerms(hit.snippet, [hit.query])}</span>
          </button>
        ))}
        {submitted !== '' && hits.length === 0 ? <p className="doc-results-empty">{t('결과가 없습니다')}</p> : null}
        {submitted === '' ? (
          <div className="doc-results-help">
            <p>{t('Vault 의 모든 PDF 본문에서 낱말을 글자 그대로 찾습니다.')}</p>
            <p>{pick({
              ko: <>카드를 누르면 오른쪽에 원본 PDF 가 그 쪽으로 열리고 찾은 자리가 칠해집니다. <kbd>↑</kbd> <kbd>↓</kbd> 로 옮겨 다니고 <kbd>/</kbd> 로 검색창에 갑니다.</>,
              en: <>Click a card to open the source PDF at that page on the right, with the match highlighted. Use <kbd>↑</kbd> <kbd>↓</kbd> to move between results and <kbd>/</kbd> to jump to the search box.</>,
            })}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
