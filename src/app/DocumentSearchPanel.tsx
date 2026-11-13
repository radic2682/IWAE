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
export function DocumentSearchPanel({ state, records, indexProgress, onOpenHit }: DocumentSearchPanelProps) {
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
      className="doc-search pdf-search-docked"
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
          className="pdf-search-field doc-search-bar"
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            run(query)
          }}
        >
          <MagnifyingGlass size={15} aria-hidden="true" className="doc-search-icon" />
          <input
            ref={inputRef}
            type="text"
            aria-label={t('문서 검색어')}
            placeholder={t('모든 문서에서 검색')}
            value={query}
            spellCheck={false}
            onChange={(event) => state.setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Esc 는 검색어를 지운다
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
              className="pdf-search-clear doc-search-clear"
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
      </div>

      <div className="doc-search-status" role="status" aria-live="polite">
        <span>
          {submitted === '' ? t('모든 PDF 본문에서 같은 글자를 찾습니다') : t('“{query}” {count}건', { query: submitted, count: hits.length })}
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
            <p>{pick({
              ko: <>카드를 누르면 오른쪽에 원본 PDF가 해당 쪽으로 열리고 찾은 부분이 표시됩니다. <kbd>↑</kbd> <kbd>↓</kbd>로 결과를 이동하고 <kbd>/</kbd>로 검색창으로 돌아갑니다.</>,
              en: <>Click a card to open the source PDF at that page on the right, with the match highlighted. Use <kbd>↑</kbd> <kbd>↓</kbd> to move between results and <kbd>/</kbd> to jump to the search box.</>,
            })}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * 왼쪽 바 검색 보기 맨 위의 범위 전환: 지금 PDF 만 / Vault 의 모든 문서.
 * 다른 왼쪽 바 보기의 머리 줄(문서·목차·미리보기 …)과 같은 높이·밑선을 쓴다.
 */
export function SearchScopeSwitch({ scope, onChange }: { readonly scope: 'pdf' | 'vault'; readonly onChange: (scope: 'pdf' | 'vault') => void }) {
  const options = [
    { id: 'pdf', label: t('이 문서') },
    { id: 'vault', label: t('모든 문서') },
  ] as const
  return (
    <div className="side-panel-head side-search-scope">
      <div className="side-search-scope-seg" role="radiogroup" aria-label={t('검색 범위')}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={scope === option.id}
          className={`side-search-scope-option${scope === option.id ? ' side-search-scope-option-on' : ''}`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
      </div>
    </div>
  )
}
