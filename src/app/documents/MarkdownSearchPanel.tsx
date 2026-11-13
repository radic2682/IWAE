import { pick, t } from '../../i18n'
import { CaretDown, CaretUp, MagnifyingGlass, X } from '@phosphor-icons/react'

export interface MarkdownSearchHit {
  readonly index: number
  readonly before: string
  readonly quote: string
  readonly after: string
}

/** 글(렌더된 본문 글자)에서 검색어 자리들. 대소문자는 가리지 않는다(본문 표시와 같은 규칙) */
export function markdownSearchHits(text: string, rawQuery: string, context = 40): MarkdownSearchHit[] {
  const query = rawQuery.trim()
  if (query === '') return []
  const haystack = text.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  const hits: MarkdownSearchHit[] = []
  let at = haystack.indexOf(needle)
  while (at >= 0 && hits.length < 2000) {
    hits.push({
      index: hits.length,
      before: text.slice(Math.max(at - context, 0), at).replace(/\s+/gu, ' '),
      quote: text.slice(at, at + query.length),
      after: text.slice(at + query.length, at + query.length + context).replace(/\s+/gu, ' '),
    })
    at = haystack.indexOf(needle, at + query.length)
  }
  return hits
}

/**
 * 왼쪽 바 「검색」 보기의 Markdown 판: 검색 칸 · 결과 수 · 앞뒤 단추 · 결과 목록(앞뒤 글과 함께).
 * 누르거나 앞뒤로 옮기면 본문의 그 자리로 간다.
 */
export function MarkdownSearchPanel({ query, onQueryChange, hits, activeIndex, onSelect }: {
  readonly query: string
  readonly onQueryChange: (query: string) => void
  /** 본문에 칠한 검색 자리(차례대로) */
  readonly hits: readonly MarkdownSearchHit[]
  readonly activeIndex: number
  readonly onSelect: (index: number) => void
}) {
  const step = (direction: 1 | -1) => {
    if (hits.length === 0) return
    onSelect(((activeIndex < 0 ? (direction > 0 ? -1 : 0) : activeIndex) + direction + hits.length) % hits.length)
  }
  return (
    <section className="pdf-search-panel markdown-search-panel" aria-label={t('Markdown 검색')}>
      <div className="markdown-search-row">
        <MagnifyingGlass size={14} aria-hidden="true" />
        <input
          aria-label={t('Markdown 검색어')}
          placeholder={t('이 문서에서 찾기')}
          value={query}
          autoFocus
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              step(event.shiftKey ? -1 : 1)
            }
          }}
        />
        {query === '' ? null : <button type="button" className="markdown-search-icon" aria-label={t('검색어 지우기')} title={pick({ ko: '지우기', en: 'Clear' })} onClick={() => onQueryChange('')}><X size={12} aria-hidden="true" /></button>}
      </div>
      {query.trim() === '' ? null : (
        <div className="markdown-search-status">
          <span>{hits.length === 0 ? t('결과 없음') : `${activeIndex < 0 ? 0 : activeIndex + 1} / ${hits.length}`}</span>
          <button type="button" className="markdown-search-icon" aria-label={t('이전 결과')} title={t('이전 (Shift+Enter)')} onClick={() => step(-1)}><CaretUp size={13} aria-hidden="true" /></button>
          <button type="button" className="markdown-search-icon" aria-label={t('다음 결과')} title={t('다음 (Enter)')} onClick={() => step(1)}><CaretDown size={13} aria-hidden="true" /></button>
        </div>
      )}
      <ol className="markdown-search-results">
        {hits.slice(0, 400).map((hit) => (
          <li key={hit.index}>
            <button type="button" className={`markdown-search-result${hit.index === activeIndex ? ' markdown-search-result-active' : ''}`} onClick={() => onSelect(hit.index)}>
              <span>…{hit.before}</span><mark>{hit.quote}</mark><span>{hit.after}…</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
