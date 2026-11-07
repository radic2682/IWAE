import { useEffect, useRef, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { errorText } from '../core/errorText'
import type { BibEntry } from '../core/bibliography'
import '../ui/bibliography-dialog.css'
import { t } from '../i18n'

interface BibliographyDialogProps {
  readonly documentTitle: string
  readonly entry: BibEntry | undefined
  readonly onSave: (entry: BibEntry) => void
  readonly onClose: () => void
  readonly onFetchCrossref: (doi: string) => Promise<BibEntry>
}

/**
 * 문서 하나의 서지 정보를 고친다. 저장하면 출처는 'manual' 이 되어 자동 추출이 다시
 * 덮지 않는다. Crossref 로 채운 뒤 손대지 않고 저장하면 'crossref' 로 남는다.
 */
export function BibliographyDialog({ documentTitle, entry, onSave, onClose, onFetchCrossref }: BibliographyDialogProps) {
  const [title, setTitle] = useState(entry?.title ?? '')
  const [authors, setAuthors] = useState((entry?.authors ?? []).join('\n'))
  const [year, setYear] = useState(entry?.year === undefined ? '' : String(entry.year))
  const [doi, setDoi] = useState(entry?.doi ?? '')
  const [journal, setJournal] = useState(entry?.journal ?? '')
  const [source, setSource] = useState<BibEntry['source']>(entry?.source ?? 'manual')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const edit = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value)
    setTouched(true)
  }

  const fill = async () => {
    setBusy(true)
    setError(null)
    try {
      const fetched = await onFetchCrossref(doi.trim())
      if (fetched.title !== undefined) setTitle(fetched.title)
      if (fetched.authors.length > 0) setAuthors(fetched.authors.join('\n'))
      if (fetched.year !== undefined) setYear(String(fetched.year))
      if (fetched.journal !== undefined) setJournal(fetched.journal)
      if (fetched.doi !== undefined) setDoi(fetched.doi)
      setSource('crossref')
      setTouched(false)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    const parsedYear = Number.parseInt(year, 10)
    onSave({
      ...(title.trim() === '' ? {} : { title: title.trim() }),
      authors: authors.split('\n').map((line) => line.trim()).filter(Boolean),
      ...(Number.isInteger(parsedYear) && parsedYear > 0 ? { year: parsedYear } : {}),
      ...(doi.trim() === '' ? {} : { doi: doi.trim() }),
      ...(entry?.arxiv === undefined ? {} : { arxiv: entry.arxiv }),
      ...(journal.trim() === '' ? {} : { journal: journal.trim() }),
      source: touched || source === 'pdf' ? 'manual' : source,
      updatedAt: new Date().toISOString(),
    })
  }

  const firstFieldRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => { firstFieldRef.current?.focus() }, [])

  return (
    <div className="bib-dialog-backdrop" onClick={onClose}>
      <div
        className="bib-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('논문 정보 — {title}', { title: documentTitle })}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
      >
        <header className="bib-dialog-head">
          <h2 className="bib-dialog-title">{t('논문 정보')} <small>{documentTitle}</small></h2>
          <button type="button" className="bib-dialog-close" aria-label={t('닫기')} onClick={onClose}><X size={14} aria-hidden="true" /></button>
        </header>
        <label>
          <span>{t('제목')}</span>
          <input ref={firstFieldRef} aria-label={t('제목')} value={title} onChange={(event) => edit(setTitle)(event.target.value)} />
        </label>
        <label>
          <span>{t('저자 (한 줄에 한 명)')}</span>
          <textarea aria-label={t('저자 (한 줄에 한 명)')} rows={3} value={authors} onChange={(event) => edit(setAuthors)(event.target.value)} />
        </label>
        <div className="bib-dialog-row">
          <label>
            <span>{t('연도')}</span>
            <input aria-label={t('연도')} type="number" min="1000" max="9999" value={year} onChange={(event) => edit(setYear)(event.target.value)} />
          </label>
          <label className="bib-dialog-grow">
            <span>DOI</span>
            <input aria-label="DOI" value={doi} onChange={(event) => edit(setDoi)(event.target.value)} />
          </label>
        </div>
        <label>
          <span>{t('학술지')}</span>
          <input aria-label={t('학술지')} value={journal} onChange={(event) => edit(setJournal)(event.target.value)} />
        </label>
        {error !== null ? <p className="bib-dialog-error" role="alert">{error}</p> : null}
        <div className="bib-dialog-actions">
          <button type="button" disabled={doi.trim() === '' || busy} onClick={() => void fill()}>
            {busy ? t('불러오는 중…') : t('Crossref에서 채우기')}
          </button>
          <span className="bib-dialog-spacer" />
          <button type="button" onClick={onClose}>{t('취소')}</button>
          <button type="button" className="bib-dialog-primary" onClick={save}>{t('저장')}</button>
        </div>
      </div>
    </div>
  )
}
