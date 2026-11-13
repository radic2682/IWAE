import { useEffect, useMemo, useRef, useState } from 'react'
import { Select } from '../../ui/Select'
import { File, FileMd, FilePdf, MagnifyingGlass, Star, X } from '@phosphor-icons/react'
import { searchVaultPages, type VaultSearchHit, type VaultSearchRecord } from '../../core/vaultSearch'
import type { VaultFileKind } from '../../core/vaultIndex'
import { CANVAS_ENABLED } from '../../core/features'
import { t } from '../../i18n'

interface VaultSearchProps {
  records: readonly VaultSearchRecord[]
  onOpen: (hit: VaultSearchHit) => void
  onFavoriteChange?: (id: string, favorite: boolean) => void
  indexingProgress?: { readonly indexed: number; readonly total: number }
  compact?: boolean
}

export function VaultSearch({ records, onOpen, onFavoriteChange, indexingProgress, compact = false }: VaultSearchProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<VaultFileKind | undefined>()
  const [folder, setFolder] = useState<string | undefined>()
  const [favorite, setFavorite] = useState(false)
  const [recent, setRecent] = useState(false)
  const [missing, setMissing] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const folders = useMemo(() => [...new Set(records.map((record) => record.folder).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right)), [records])
  const results = useMemo(() => searchVaultPages(records, query, {
    kind,
    folder,
    favorite: favorite ? true : undefined,
    recent: recent ? true : undefined,
    missing: missing ? true : undefined,
    caseSensitive,
    wholeWord,
    limit: 12,
  }), [caseSensitive, favorite, folder, kind, missing, query, recent, records, wholeWord])

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeSearch()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [open])

  const openSearch = () => {
    setOpen(true)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  const closeSearch = () => {
    setOpen(false)
    setActiveIndex(-1)
  }

  const openResult = (hit: VaultSearchHit) => {
    onOpen(hit)
    closeSearch()
  }

  return (
    <div ref={rootRef} className={`vault-search${compact ? ' vault-search-compact' : ''}${open ? ' vault-search-open' : ''}`}>
      {!open ? (
        <button type="button" className="vault-search-trigger" aria-label={t('Vault 검색')} onClick={openSearch}>
          <MagnifyingGlass size={15} aria-hidden="true" />
          <span>{t('검색')}</span>
        </button>
      ) : (
        <>
          <div className="vault-search-input-row">
            <MagnifyingGlass size={15} aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              aria-label={t('Vault 검색어')}
              placeholder={t('파일 이름, 폴더, 내용 검색')}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActiveIndex(-1)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') closeSearch()
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActiveIndex((current) => Math.min(current + 1, results.length - 1))
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActiveIndex((current) => Math.max(current - 1, 0))
                }
                if (event.key === 'Enter') {
                  const result = results[activeIndex < 0 ? 0 : activeIndex]
                  if (result !== undefined) openResult(result)
                }
              }}
            />
            <button type="button" aria-label={t('대소문자 구분')} aria-pressed={caseSensitive} onClick={() => setCaseSensitive((value) => !value)}>Aa</button>
            <button type="button" aria-label={t('완전한 단어')} aria-pressed={wholeWord} onClick={() => setWholeWord((value) => !value)}>{t('단어')}</button>
            <button type="button" aria-label={t('Vault 검색 닫기')} onClick={closeSearch}><X size={14} /></button>
          </div>
          <div className="vault-search-filters" aria-label={t('파일 종류 필터')}>
            <button type="button" aria-pressed={kind === undefined} onClick={() => setKind(undefined)}>{t('전체')}</button>
            <button type="button" aria-label={t('PDF만 보기')} aria-pressed={kind === 'pdf'} onClick={() => setKind(kind === 'pdf' ? undefined : 'pdf')}>PDF</button>
            <button type="button" aria-label={t('Markdown만 보기')} aria-pressed={kind === 'markdown'} onClick={() => setKind(kind === 'markdown' ? undefined : 'markdown')}>MD</button>
            {CANVAS_ENABLED ? <button type="button" aria-label={t('캔버스만 보기')} aria-pressed={kind === 'canvas'} onClick={() => setKind(kind === 'canvas' ? undefined : 'canvas')}>{t('노트')}</button> : null}
            <button type="button" aria-label={t('이미지만 보기')} aria-pressed={kind === 'image'} onClick={() => setKind(kind === 'image' ? undefined : 'image')}>{t('이미지')}</button>
            <button type="button" aria-label={t('기타 파일만 보기')} aria-pressed={kind === 'other'} onClick={() => setKind(kind === 'other' ? undefined : 'other')}>{t('기타')}</button>
          </div>
          <div className="vault-search-filters vault-search-secondary-filters" aria-label={t('파일 상태 필터')}>
            <Select
              className="vault-search-folder"
              ariaLabel={t('폴더 필터')}
              value={folder ?? ''}
              options={[{ value: '', label: t('모든 폴더') }, ...folders.map((path) => ({ value: path, label: path }))]}
              onChange={(value) => setFolder(value || undefined)}
            />
            <button type="button" aria-label={t('즐겨찾기만 보기')} aria-pressed={favorite} onClick={() => setFavorite((value) => !value)}>{t('즐겨찾기')}</button>
            <button type="button" aria-label={t('최근 파일만 보기')} aria-pressed={recent} onClick={() => setRecent((value) => !value)}>{t('최근')}</button>
            <button type="button" aria-label={t('누락 파일만 보기')} aria-pressed={missing} onClick={() => setMissing((value) => !value)}>{t('누락')}</button>
          </div>
          <div className="vault-search-results" role="listbox" aria-label={t('Vault 검색 결과')}>
            {indexingProgress !== undefined && indexingProgress.indexed < indexingProgress.total && (
              <p className="vault-search-indexing" role="status">
                {t('PDF 본문 인덱싱 {indexed}/{total}', { indexed: indexingProgress.indexed, total: indexingProgress.total })}
              </p>
            )}
            {results.map((hit, index) => (
              <div
                role="option"
                aria-selected={index === activeIndex}
                key={`${hit.record.id}:${hit.page ?? 'file'}`}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <button
                  type="button"
                  className="vault-search-result-main"
                  aria-label={`${hit.record.displayName}${hit.page === null ? '' : ` ${t('{page}쪽', { page: hit.page + 1 })}`}`}
                  onClick={() => openResult(hit)}
                >
                  {hit.record.kind === 'pdf' ? <FilePdf size={15} /> : hit.record.kind === 'markdown' ? <FileMd size={15} /> : <File size={15} />}
                  <span>
                    <strong>{hit.record.displayName}</strong>
                    <small>{hit.page === null ? hit.record.folder || t('Vault 루트') : t('{page}쪽', { page: hit.page + 1 })}</small>
                    {hit.page !== null && <small className="vault-search-snippet">{hit.snippet}</small>}
                  </span>
                  {hit.record.missing && <em>{t('찾을 수 없음')}</em>}
                </button>
                {onFavoriteChange === undefined ? null : (
                  <button
                    type="button"
                    className="vault-search-favorite"
                    aria-label={hit.record.favorite ? t('{name} 즐겨찾기 해제', { name: hit.record.displayName }) : t('{name} 즐겨찾기 추가', { name: hit.record.displayName })}
                    aria-pressed={hit.record.favorite}
                    onClick={() => onFavoriteChange(hit.record.id, !hit.record.favorite)}
                  >
                    <Star size={14} weight={hit.record.favorite ? 'fill' : 'regular'} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
            {results.length === 0 && <p>{t('검색 결과가 없습니다.')}</p>}
          </div>
        </>
      )}
    </div>
  )
}
