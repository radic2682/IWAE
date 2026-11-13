import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowSquareOut, FolderOpen, LinkSimple, Pencil, Plus, Trash, X } from '@phosphor-icons/react'
import { isValidSourceTarget, normalizeSourceTarget, sourceDisplayLabel, sourceTargetKind, type DocSource } from '../../core/docSources'
import '../../ui/doc-sources.css'
import { t } from '../../i18n'

interface DocSourcesDialogProps {
  readonly title: string
  readonly sources: readonly DocSource[]
  /** 열기: 주소는 브라우저(확인 뒤), 경로는 탐색기 */
  readonly onOpen: (source: DocSource) => void
  readonly onAdd: (input: { label: string; target: string; note: string }) => boolean
  readonly onUpdate: (sourceId: string, patch: { label: string; target: string; note: string }) => void
  readonly onRemove: (sourceId: string) => void
  readonly onClose: () => void
  /** 서지 정보(DOI·arXiv)에서 만든 출처 후보. 이미 있는 주소는 빼고 보인다 */
  readonly suggestions?: readonly { label: string; target: string }[]
}

/** 「원본 출처」: 이 문서가 어디서 왔는지(사이트·클라우드·폴더 …) 여러 개 적어 두고 눌러서 연다 */
export function DocSourcesDialog({ title, sources, onOpen, onAdd, onUpdate, onRemove, onClose, suggestions = [] }: DocSourcesDialogProps) {
  const offered = suggestions.filter((item) => !sources.some((source) => source.target === item.target))
  const [editing, setEditing] = useState<string | 'new' | null>(sources.length === 0 ? 'new' : null)
  const [label, setLabel] = useState('')
  const [target, setTarget] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const targetRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (editing !== null && sources.length > 0) setEditing(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, onClose, sources.length])

  useEffect(() => { if (editing !== null) targetRef.current?.focus() }, [editing])

  const startEdit = (source: DocSource | null) => {
    setEditing(source === null ? 'new' : source.id)
    setLabel(source?.label ?? '')
    setTarget(source?.target ?? '')
    setNote(source?.note ?? '')
    setError(null)
  }

  const save = () => {
    const clean = normalizeSourceTarget(target)
    if (!isValidSourceTarget(clean)) {
      setError(t('주소(https://…)나 폴더·파일 경로를 입력하세요.'))
      return
    }
    if (editing === 'new') {
      if (!onAdd({ label, target: clean, note })) {
        setError(t('이미 같은 출처가 있습니다.'))
        return
      }
    } else if (editing !== null) {
      onUpdate(editing, { label, target: clean, note })
    }
    setEditing(null)
    setLabel('')
    setTarget('')
    setNote('')
    setError(null)
  }

  return createPortal(
    <div className="doc-sources-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="doc-sources-dialog" role="dialog" aria-modal="true" aria-label={t('원본 출처')}>
        <header className="doc-sources-head">
          <span className="doc-sources-icon" aria-hidden="true"><LinkSimple size={17} /></span>
          <div className="doc-sources-titles">
            <h2>{t('원본 출처')}</h2>
            <p title={title}>{title}</p>
          </div>
          <button type="button" className="doc-sources-close" aria-label={t('닫기')} onClick={onClose}><X size={15} aria-hidden="true" /></button>
        </header>

        <div className="doc-sources-body">
          {sources.length === 0 && editing !== 'new' ? <p className="doc-sources-empty">{t('등록된 출처가 없습니다.')}</p> : null}
          {offered.length > 0 ? (
            <ul className="doc-sources-suggest" aria-label={t('출처 제안')}>
              {offered.map((item) => (
                <li key={item.target} className="doc-sources-item">
                  <span className="doc-sources-suggest-text">
                    <strong>{item.label}</strong>
                    <small>{item.target}</small>
                  </span>
                  <button type="button" className="doc-sources-secondary" aria-label={t('{name} 출처로 추가', { name: item.label })} onClick={() => onAdd({ label: item.label, target: item.target, note: '' })}>
                    <Plus size={13} aria-hidden="true" /> {t('추가')}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="doc-sources-list">
            {sources.map((source) => {
              const kind = sourceTargetKind(source.target)
              return editing === source.id ? null : (
                <li key={source.id} className="doc-sources-item">
                  <button type="button" className="doc-sources-open" title={source.target} onClick={() => onOpen(source)}>
                    {kind === 'url' ? <ArrowSquareOut size={15} aria-hidden="true" /> : <FolderOpen size={15} aria-hidden="true" />}
                    <span className="doc-sources-text">
                      <strong>{sourceDisplayLabel(source)}</strong>
                      <small>{source.target}</small>
                      {source.note === undefined ? null : <em>{source.note}</em>}
                    </span>
                  </button>
                  <button type="button" className="doc-sources-icon-btn" aria-label={t('{name} 고치기', { name: sourceDisplayLabel(source) })} title={t('고치기')} onClick={() => startEdit(source)}><Pencil size={14} aria-hidden="true" /></button>
                  <button type="button" className="doc-sources-icon-btn" aria-label={t('{name} 지우기', { name: sourceDisplayLabel(source) })} title={t('지우기')} onClick={() => onRemove(source.id)}><Trash size={14} aria-hidden="true" /></button>
                </li>
              )
            })}
          </ul>

          {editing === null ? (
            <button type="button" className="doc-sources-add" onClick={() => startEdit(null)}><Plus size={14} aria-hidden="true" /> {t('출처 추가')}</button>
          ) : (
            <form className="doc-sources-form" onSubmit={(event) => { event.preventDefault(); save() }}>
              <input ref={targetRef} aria-label={t('주소 또는 경로')} placeholder={t('https://… 또는 G:\\폴더\\파일.pdf')} value={target} spellCheck={false} onChange={(event) => { setTarget(event.target.value); setError(null) }} />
              <input aria-label={t('이름')} placeholder={t('이름 (예: 원본, 벤더 포털)')} value={label} onChange={(event) => setLabel(event.target.value)} />
              <input aria-label={t('메모')} placeholder={t('메모 (선택)')} value={note} onChange={(event) => setNote(event.target.value)} />
              {error === null ? null : <p className="doc-sources-error" role="alert">{error}</p>}
              <div className="doc-sources-form-foot">
                {sources.length > 0 || editing !== 'new' ? <button type="button" className="doc-sources-secondary" onClick={() => { setEditing(null); setError(null) }}>{t('취소')}</button> : null}
                <button type="submit" className="doc-sources-primary">{editing === 'new' ? t('추가') : t('저장')}</button>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>,
    document.body,
  )
}
