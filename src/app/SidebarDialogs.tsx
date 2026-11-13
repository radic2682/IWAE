import { useEffect, useRef, useState } from 'react'
import { Select } from '../ui/Select'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Copy, FilePlus, Folder, FolderOpen, FolderSimple, HouseSimple, LinkSimple, Trash, X } from '@phosphor-icons/react'
import { errorText } from '../core/errorText'
import { cleanEntryName } from '../bridge/vaultFiles'
import { pick, t } from '../i18n'
import '../ui/sidebar-dialog.css'

/** Escape 는 대화상자만 닫는다 — 위로 올라가면 라이브러리 모드까지 접힌다 */
function stopEscape(event: KeyboardEvent<HTMLElement>, close: () => void) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  close()
}

function DialogFrame({
  label,
  icon,
  tone = 'default',
  title,
  subtitle,
  busy,
  onClose,
  children,
}: {
  readonly label: string
  readonly icon: ReactNode
  readonly tone?: 'default' | 'danger'
  readonly title: ReactNode
  readonly subtitle?: ReactNode
  readonly busy: boolean
  readonly onClose: () => void
  readonly children: ReactNode
}) {
  return createPortal(
    <div
      className="side-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="side-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={(event) => stopEscape(event, () => { if (!busy) onClose() })}
      >
        <header className="side-dialog-head">
          <span className={`side-dialog-icon side-dialog-icon-${tone}`} aria-hidden="true">{icon}</span>
          <div className="side-dialog-titles">
            <h2>{title}</h2>
            {subtitle === undefined ? null : <p>{subtitle}</p>}
          </div>
          <button type="button" className="side-dialog-close" aria-label={t('닫기')} onClick={onClose} disabled={busy}>
            <X size={14} aria-hidden="true" />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export interface FolderNameDialogProps {
  readonly mode: 'create' | 'rename'
  readonly initialName?: string
  /** 만들 위치(부모 폴더). 바꿀 수 있는 목록을 주면 고를 수 있다 */
  readonly parentPath: string
  readonly parentChoices?: readonly string[]
  readonly onSubmit: (parentPath: string, name: string) => Promise<void>
  readonly onClose: () => void
}

function locationLabel(path: string): string {
  return path === '' ? t('Vault 맨 위') : path.split('/').join(' / ')
}

/** 새 폴더 · 폴더 이름 바꾸기 대화상자 */
export function FolderNameDialog({ mode, initialName = '', parentPath, parentChoices, onSubmit, onClose }: FolderNameDialogProps) {
  const [name, setName] = useState(initialName)
  const [parent, setParent] = useState(parentPath)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = inputRef.current
    if (input === null) return
    input.focus()
    input.select()
  }, [])

  // 치는 동안 이름을 검사한다. 끝의 마침표·공백은 Windows 가 못 쓰므로 떼어 낸 이름을 미리 보여 준다
  const check = (() => {
    if (name.trim() === '') return { name: '', problem: null as string | null }
    try {
      return { name: cleanEntryName(name), problem: null as string | null }
    } catch (err) {
      return { name: '', problem: errorText(err) }
    }
  })()
  const adjusted = check.problem === null && check.name !== '' && check.name !== name.trim()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (check.problem !== null) {
      setError(check.problem)
      return
    }
    const trimmed = check.name
    if (trimmed === '') {
      setError(t('폴더 이름을 입력하세요.'))
      return
    }
    if (mode === 'rename' && trimmed === initialName) {
      onClose()
      return
    }
    setBusy(true)
    setError(null)
    onSubmit(parent, trimmed)
      .then(onClose)
      .catch((err: unknown) => {
        setError(errorText(err))
        setBusy(false)
        inputRef.current?.focus()
      })
  }

  const creating = mode === 'create'
  const title = creating ? t('새 폴더') : t('폴더 이름 바꾸기')
  return (
    <DialogFrame
      label={title}
      icon={<FolderSimple size={16} weight="duotone" />}
      title={title}
      subtitle={creating ? t('Vault 안에 폴더를 만듭니다') : t('위치: {location}', { location: locationLabel(parentPath) })}
      busy={busy}
      onClose={onClose}
    >
      <form className="side-dialog-body" onSubmit={submit}>
        <label className="side-dialog-field">
          <span>{t('이름')}</span>
          <input
            ref={inputRef}
            aria-label={creating ? t('새 폴더 이름') : t('폴더 이름')}
            value={name}
            placeholder={t('예: 05_Papers')}
            spellCheck={false}
            aria-invalid={error !== null}
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
            }}
          />
        </label>
        {creating ? (
          parentChoices === undefined ? (
            <div className="side-dialog-field">
              <span>{t('위치')}</span>
              <span className="side-dialog-location">{locationLabel(parent)}</span>
            </div>
          ) : (
            <label className="side-dialog-field">
              <span>{t('위치')}</span>
              <Select
                ariaLabel={t('만들 위치')}
                value={parent}
                options={[{ value: '', label: t('Vault 맨 위') }, ...parentChoices.map((path) => ({ value: path, label: locationLabel(path) }))]}
                onChange={setParent}
              />
            </label>
          )
        ) : null}
        {error === null && adjusted ? (
          <p className="side-dialog-hint">{t('끝의 마침표와 공백은 Windows에서 쓸 수 없어 「{name}」 폴더로 만듭니다.', { name: check.name })}</p>
        ) : (
          <p className="side-dialog-error" role={(error ?? check.problem) === null ? undefined : 'alert'}>{error ?? check.problem ?? ''}</p>
        )}
        <footer className="side-dialog-foot">
          <button type="button" className="side-dialog-secondary" onClick={onClose} disabled={busy}>{t('취소')}</button>
          <button type="submit" className="side-dialog-primary" disabled={busy || name.trim() === '' || check.problem !== null}>
            {busy ? (creating ? t('만드는 중…') : t('바꾸는 중…')) : (creating ? t('만들기') : t('이름 바꾸기'))}
          </button>
        </footer>
      </form>
    </DialogFrame>
  )
}

/** 확인 창에 이름을 몇 개까지 늘어놓을지. 나머지는 「외 N개」 */
const LISTED_NAMES = 6

function NameList({ names }: { readonly names: readonly string[] }) {
  if (names.length === 0) return null
  const shown = names.slice(0, LISTED_NAMES)
  return (
    <ul className="side-dialog-names">
      {shown.map((item, index) => <li key={index}>{item}</li>)}
      {names.length > shown.length ? <li>{t('외 {count}개', { count: names.length - shown.length })}</li> : null}
    </ul>
  )
}

export interface DeleteEntryDialogProps {
  /** 문서(기본) 또는 노트. 문구만 달라진다 */
  readonly kind?: 'document' | 'note'
  readonly name: string
  readonly path: string
  readonly onConfirm: () => Promise<void>
  readonly onClose: () => void
}

/** 문서 하나를 휴지통으로 옮기기 전 확인. 이름을 대고, 지워지는 것이 아니라 옮겨진다고 말한다 */
export function DeleteEntryDialog({ kind = 'document', name, path, onConfirm, onClose }: DeleteEntryDialogProps) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // 실수로 Enter 를 눌러도 옮겨지지 않게 초점은 취소에 둔다
  useEffect(() => { cancelRef.current?.focus() }, [])
  const confirm = () => {
    setBusy(true)
    setError(null)
    onConfirm()
      .then(onClose)
      .catch((err: unknown) => {
        setError(errorText(err))
        setBusy(false)
      })
  }
  return (
    <DialogFrame
      label={kind === 'note' ? t('노트 삭제') : t('문서 삭제')}
      icon={<Trash size={16} weight="duotone" />}
      tone="danger"
      title={kind === 'note' ? t('「{name}」 노트를 휴지통으로 옮길까요?', { name }) : t('「{name}」 문서를 휴지통으로 옮길까요?', { name })}
      subtitle={t('위치: {location}', { location: locationLabel(path) })}
      busy={busy}
      onClose={onClose}
    >
      <div className="side-dialog-body">
        <p className="side-dialog-message">
          {kind === 'note'
            ? t('노트 파일은 지워지지 않고 Vault의 .iwae/trash/notes 폴더로 옮겨집니다.')
            : t('파일은 지워지지 않고 Vault 휴지통으로 옮겨집니다. 설정 › 데이터 및 복구에서 되돌릴 수 있습니다.')}
        </p>
        <p className="side-dialog-error" role={error === null ? undefined : 'alert'}>{error ?? ''}</p>
        <footer className="side-dialog-foot">
          <button ref={cancelRef} type="button" className="side-dialog-secondary" onClick={onClose} disabled={busy}>{t('취소')}</button>
          <button type="button" className="side-dialog-primary side-dialog-danger" onClick={confirm} disabled={busy}>
            {busy ? t('옮기는 중…') : t('휴지통으로 이동')}
          </button>
        </footer>
      </div>
    </DialogFrame>
  )
}

export interface DeleteFolderDialogProps {
  readonly name: string
  readonly path: string
  readonly documentCount: number
  readonly folderCount: number
  /** 함께 옮겨지는 문서 이름들(많으면 앞쪽만 보인다) */
  readonly documentNames?: readonly string[]
  readonly onConfirm: () => Promise<void>
  readonly onClose: () => void
}

/** 폴더 삭제 확인. 지우지 않고 Vault 휴지통으로 옮긴다는 것을 분명히 말한다 */
export function DeleteFolderDialog({ name, path, documentCount, folderCount, documentNames = [], onConfirm, onClose }: DeleteFolderDialogProps) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // 실수로 Enter 를 눌러도 옮겨지지 않게 초점은 취소에 둔다
  useEffect(() => { cancelRef.current?.focus() }, [])

  const confirm = () => {
    setBusy(true)
    setError(null)
    onConfirm()
      .then(onClose)
      .catch((err: unknown) => {
        setError(errorText(err))
        setBusy(false)
      })
  }

  const contents = [
    documentCount > 0 ? t('문서 {count}개', { count: documentCount }) : null,
    folderCount > 0 ? t('하위 폴더 {count}개', { count: folderCount }) : null,
  ].filter(Boolean).join(', ')
  return (
    <DialogFrame
      label={t('폴더 삭제')}
      icon={<Trash size={16} weight="duotone" />}
      tone="danger"
      title={t('「{name}」 폴더를 삭제할까요?', { name })}
      subtitle={t('위치: {location}', { location: locationLabel(path) })}
      busy={busy}
      onClose={onClose}
    >
      <div className="side-dialog-body">
        <p className="side-dialog-message">
          {contents === ''
            ? t('빈 폴더입니다.')
            : pick({ ko: <>안에 있는 <strong>{contents}</strong>가 함께 삭제됩니다.</>, en: <>The <strong>{contents}</strong> inside will be deleted too.</> })}
          {' '}{t('파일은 지워지지 않고 Vault 휴지통으로 옮겨집니다. 설정 › 데이터 및 복구에서 되돌릴 수 있습니다.')}
        </p>
        <NameList names={documentNames} />
        <p className="side-dialog-error" role={error === null ? undefined : 'alert'}>{error ?? ''}</p>
        <footer className="side-dialog-foot">
          <button ref={cancelRef} type="button" className="side-dialog-secondary" onClick={onClose} disabled={busy}>{t('취소')}</button>
          <button type="button" className="side-dialog-primary side-dialog-danger" onClick={confirm} disabled={busy}>
            {busy ? t('옮기는 중…') : t('휴지통으로 이동')}
          </button>
        </footer>
      </div>
    </DialogFrame>
  )
}

export type PdfAddChoice =
  | { readonly kind: 'reference' }
  | { readonly kind: 'copy-current-folder'; readonly folderPath: string }
  | { readonly kind: 'copy-another-folder'; readonly folderPath: string }

export interface AddPdfDialogProps {
  readonly currentFolder: string
  readonly folderChoices: readonly string[]
  readonly onChoose: (choice: PdfAddChoice) => void
  readonly onClose: () => void
}

/**
 * PDF 추가. 넣을 폴더를 목록에서 고르고(지금 보는 폴더가 미리 골라져 있다) 「파일 골라 복사」를 누르면 파일 대화상자가 열린다(App).
 * 원본 위치 참조는 잘 쓰지 않으니 아래 작은 글 단추로 둔다.
 */
export function AddPdfDialog({ currentFolder, folderChoices, onChoose, onClose }: AddPdfDialogProps) {
  const [target, setTarget] = useState(currentFolder)
  const listRef = useRef<HTMLDivElement>(null)
  // 골라진 폴더가 보이게 한 번 굴린다
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [])
  const choose = (choice: PdfAddChoice) => {
    onChoose(choice)
    onClose()
  }
  const folders = ['', ...[...folderChoices].sort((left, right) => left.localeCompare(right, 'ko'))]
  return (
    <DialogFrame
      label={t('PDF 추가')}
      icon={<FilePlus size={16} weight="duotone" />}
      title={t('PDF 추가')}
      subtitle={t('넣을 폴더를 고른 뒤 파일을 고르세요')}
      busy={false}
      onClose={onClose}
    >
      <div className="side-dialog-body">
        <div ref={listRef} className="side-folder-picker" role="radiogroup" aria-label={t('넣을 폴더')}>
          {folders.map((path) => {
            const depth = path === '' ? 0 : path.split('/').length
            const name = path === '' ? t('Vault 맨 위') : path.split('/').at(-1) ?? path
            const selected = target === path
            return (
              <button
                key={path === '' ? '/' : path}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`side-folder-picker-row${selected ? ' side-folder-picker-row-selected' : ''}`}
                style={{ paddingLeft: `${10 + depth * 16}px` }}
                title={path === '' ? t('Vault 맨 위') : path}
                onClick={() => setTarget(path)}
                onDoubleClick={() => choose({ kind: 'copy-another-folder', folderPath: path })}
              >
                {path === '' ? <HouseSimple size={15} aria-hidden="true" /> : selected ? <FolderOpen size={15} weight="fill" aria-hidden="true" /> : <Folder size={15} aria-hidden="true" />}
                <span className="side-folder-picker-name">{name}</span>
                {path === currentFolder && path !== '' ? <span className="side-folder-picker-tag">{t('지금 폴더')}</span> : null}
              </button>
            )
          })}
        </div>
      </div>
      <div className="side-dialog-foot side-add-foot">
        <button type="button" className="side-dialog-link" onClick={() => choose({ kind: 'reference' })}>
          <LinkSimple size={13} aria-hidden="true" />
          {t('복사하지 않고 원본 위치를 참조')}
        </button>
        <button type="button" className="side-dialog-secondary" onClick={onClose}>{t('취소')}</button>
        <button type="button" className="side-dialog-primary" onClick={() => choose({ kind: 'copy-another-folder', folderPath: target })}>
          <Copy size={14} aria-hidden="true" />
          {t('파일을 골라 복사')}
        </button>
      </div>
    </DialogFrame>
  )
}
