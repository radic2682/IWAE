import { useEffect, useRef, useState } from 'react'
import { LockKey, X } from '@phosphor-icons/react'
import '../ui/bibliography-dialog.css'
import { t } from '../i18n'

/** 암호 PDF 를 열 때 암호를 묻는다. 암호는 이 세션 동안만 메모리에 둔다(저장하지 않는다) */
export function PdfPasswordDialog({ path, wrong, onSubmit, onCancel }: {
  readonly path: string
  readonly wrong: boolean
  readonly onSubmit: (password: string) => void
  readonly onCancel: () => void
}) {
  const [password, setPassword] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  const name = path.split(/[\\/]/u).at(-1) ?? path
  return (
    <div className="bib-dialog-backdrop" onClick={onCancel}>
      <form
        className="bib-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('PDF 암호')}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }}
        onSubmit={(event) => {
          event.preventDefault()
          if (password !== '') onSubmit(password)
        }}
      >
        <header className="bib-dialog-head">
          <LockKey size={16} aria-hidden="true" />
          <h2 className="bib-dialog-title">{t('암호로 보호된 PDF')} <small>{name}</small></h2>
          <button type="button" className="bib-dialog-close" aria-label={t('닫기')} onClick={onCancel}><X size={14} aria-hidden="true" /></button>
        </header>
        <label>
          <span>{wrong ? t('암호가 맞지 않습니다. 다시 넣어 주세요') : t('이 PDF 를 열 암호')}</span>
          <input ref={inputRef} type="password" autoComplete="off" aria-label={t('암호')} value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <p className="bib-dialog-note">{t('암호는 앱을 닫을 때까지만 기억하고 어디에도 저장하지 않습니다.')}</p>
        <div className="bib-dialog-actions">
          <span className="bib-dialog-spacer" />
          <button type="button" onClick={onCancel}>{t('취소')}</button>
          <button type="submit" className="bib-dialog-primary" disabled={password === ''}>{t('열기')}</button>
        </div>
      </form>
    </div>
  )
}
