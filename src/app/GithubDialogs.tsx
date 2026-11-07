import { useEffect, useMemo, useState } from 'react'
import { Select } from '../ui/Select'
import { createPortal } from 'react-dom'
import { ArrowClockwise, FileText, GitBranch, GitCommit, GithubLogo, Tag, X } from '@phosphor-icons/react'
import { previewGithubUrl, type GithubRef, type GithubSource } from '../bridge/github'
import { errorText } from '../core/errorText'
import '../ui/github-dialogs.css'
import { pick, t } from '../i18n'

function Frame({ title, subtitle, onClose, children, busy = false }: {
  readonly title: string
  readonly subtitle?: string
  readonly onClose: () => void
  readonly children: React.ReactNode
  readonly busy?: boolean
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])
  return createPortal(
    <div className="gh-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="gh-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header className="gh-head">
          <span className="gh-icon" aria-hidden="true"><GithubLogo size={17} weight="fill" /></span>
          <div className="gh-titles">
            <h2>{title}</h2>
            {subtitle === undefined ? null : <p>{subtitle}</p>}
          </div>
          <button type="button" className="gh-close" aria-label={t('닫기')} disabled={busy} onClick={onClose}><X size={15} aria-hidden="true" /></button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  )
}

/** 「GitHub 에서 가져오기」: 주소를 붙여 넣으면 저장소·브랜치·폴더를 미리 보이고, 받는다 */
export function GithubImportDialog({ onImport, onClose, folders = [], initialFolder = '' }: {
  /** target: 받은 파일을 넣을 Vault 폴더(Vault 기준 경로) */
  readonly onImport: (url: string, target: string) => Promise<void>
  readonly onClose: () => void
  /** 넣을 곳으로 고를 수 있는 Vault 폴더들 */
  readonly folders?: readonly string[]
  readonly initialFolder?: string
}) {
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState(initialFolder)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = previewGithubUrl(url)
  // 폴더 이름 기본값: 받을 폴더의 마지막 이름, 없으면 저장소 이름
  const defaultName = preview === null ? '' : (preview.path?.split('/').filter(Boolean).at(-1) ?? preview.repo)
  const folderName = (name.trim() === '' ? defaultName : name.trim()).replace(/[\\/:*?"<>|]+/gu, '_')
  const target = [parent, folderName].filter(Boolean).join('/')
  const run = async () => {
    if (preview === null || busy || folderName === '') return
    setBusy(true)
    setError(null)
    try {
      await onImport(url.trim(), target)
      onClose()
    } catch (cause) {
      setError(errorText(cause))
      setBusy(false)
    }
  }
  return (
    <Frame title={t('GitHub에서 가져오기')} subtitle={t('공개 저장소의 폴더를 Vault의 원하는 폴더로 가져옵니다. 나중에 폴더를 옮겨도 새 소식 확인·최신으로 받기가 이어집니다')} onClose={onClose} busy={busy}>
      <div className="gh-body">
        <input
          className="gh-url"
          aria-label={t('GitHub 주소')}
          placeholder={t('https://github.com/소유자/저장소/tree/main/docs')}
          value={url}
          autoFocus
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void run() }}
        />
        {url.trim() === '' ? (
          <p className="gh-hint">{pick({ ko: <>저장소 주소나, 폴더만 받으려면 <code>…/tree/브랜치/폴더</code> 주소를 붙여 넣으세요.</>, en: <>Paste a repository URL, or a <code>…/tree/branch/folder</code> URL to get just one folder.</> })}</p>
        ) : preview === null ? (
          <p className="gh-error" role="alert">{t('github.com 주소가 아닙니다.')}</p>
        ) : (
          <dl className="gh-preview">
            <dt>{t('저장소')}</dt><dd>{preview.owner}/{preview.repo}</dd>
            <dt>{t('브랜치')}</dt><dd>{preview.reference ?? t('기본 브랜치')}</dd>
            <dt>{t('받을 폴더')}</dt><dd>{preview.path ?? t('저장소 전체')}</dd>
          </dl>
        )}
        <div className="gh-target">
          <label>
            <span>{t('넣을 곳')}</span>
            <Select
              ariaLabel={t('넣을 곳')}
              value={parent}
              disabled={busy}
              options={[{ value: '', label: t('Vault 맨 위') }, ...folders.map((folder) => ({ value: folder, label: folder }))]}
              onChange={setParent}
            />
          </label>
          <label>
            <span>{t('폴더 이름')}</span>
            <input aria-label={t('폴더 이름')} placeholder={defaultName || t('폴더 이름')} value={name} disabled={busy} spellCheck={false} onChange={(event) => setName(event.target.value)} />
          </label>
          {preview === null || folderName === '' ? null : <p className="gh-hint">{t('Vault 위치:')} <code>{target}</code></p>}
        </div>
        {error === null ? null : <p className="gh-error" role="alert">{error}</p>}
      </div>
      <footer className="gh-foot">
        <button type="button" className="gh-secondary" disabled={busy} onClick={onClose}>{t('취소')}</button>
        <button type="button" className="gh-primary" disabled={preview === null || busy || folderName === ''} onClick={() => void run()}>
          {busy ? t('받는 중…') : t('가져오기')}
        </button>
      </footer>
    </Frame>
  )
}

const KIND_LABEL: Readonly<Record<GithubRef['kind'], string>> = { branch: '브랜치', tag: '태그(릴리스)', commit: '최근 커밋' }

/** 「다른 버전 보기」: 브랜치·태그·최근 커밋 중 골라 그 시점 문서로 바꾼다 */
export function GithubVersionsDialog({ source, load, onPick, onClose }: {
  readonly source: GithubSource
  readonly load: () => Promise<readonly GithubRef[]>
  readonly onPick: (ref: GithubRef) => Promise<void>
  readonly onClose: () => void
}) {
  const [refs, setRefs] = useState<readonly GithubRef[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    load().then((value) => { if (alive) setRefs(value) }, (cause: unknown) => { if (alive) setError(errorText(cause)) })
    return () => { alive = false }
  }, [load])
  const groups = useMemo(() => (['branch', 'tag', 'commit'] as const).map((kind) => ({ kind, items: (refs ?? []).filter((ref) => ref.kind === kind) })), [refs])
  const current = source.branch ?? source.detached
  const isCurrent = (ref: GithubRef) => ref.name === current || (ref.kind === 'commit' && ref.name === source.head)
  return (
    <Frame title={t('다른 버전 보기')} subtitle={source.branch !== null ? t('{name} · 지금 {branch} 브랜치', { name: source.name, branch: source.branch }) : t('{name} · 지금 {ref} 보는 중', { name: source.name, ref: source.detached ?? '' })} onClose={onClose} busy={busy !== null}>
      <div className="gh-body gh-refs">
        {error !== null ? <p className="gh-error" role="alert">{error}</p> : refs === null ? <p className="gh-hint">{t('목록을 읽는 중…')}</p> : groups.map(({ kind, items }) => items.length === 0 ? null : (
          <section key={kind} className="gh-ref-group">
            <h3>{t(KIND_LABEL[kind])}</h3>
            {items.map((ref) => (
              <button
                key={`${kind}:${ref.name}`}
                type="button"
                className={`gh-ref${isCurrent(ref) ? ' gh-ref-current' : ''}`}
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(ref.name)
                  setError(null)
                  try {
                    await onPick(ref)
                    onClose()
                  } catch (cause) {
                    setError(errorText(cause))
                    setBusy(null)
                  }
                }}
              >
                {kind === 'branch' ? <GitBranch size={14} aria-hidden="true" /> : kind === 'tag' ? <Tag size={14} aria-hidden="true" /> : <GitCommit size={14} aria-hidden="true" />}
                <span className="gh-ref-name">{ref.name}</span>
                <span className="gh-ref-subject">{ref.subject}</span>
                <span className="gh-ref-date">{busy === ref.name ? t('바꾸는 중…') : isCurrent(ref) ? t('지금') : ref.date}</span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </Frame>
  )
}

/** 새 소식 확인·최신으로 결과: 새 커밋 수와 바뀐(바뀔) 문서. 문서를 누르면 연다 */
export function GithubChangesDialog({ source, changed, applied, onOpen, onPull, onClose }: {
  readonly source: GithubSource
  readonly changed: readonly string[]
  /** true = 최신으로 받은 뒤(이미 바뀜), false = 새 소식 확인(아직 안 바뀜) */
  readonly applied: boolean
  readonly onOpen: (path: string) => void
  readonly onPull?: () => Promise<void>
  readonly onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const documents = changed.filter((path) => /\.(?:md|markdown|pdf)$/iu.test(path))
  const others = changed.length - documents.length
  const title = applied ? t('최신으로 받았습니다') : source.behind > 0 ? t('새 커밋 {count}개', { count: source.behind }) : t('새 소식 없음')
  const subtitle = applied
    ? `${source.name} · ${source.branch ?? source.detached} · ${source.headDate} ${source.headSubject}`
    : source.behind > 0 ? t('{name} · 「최신으로」를 누르면 아래 파일이 바뀝니다', { name: source.name }) : t('{name} · 이미 최신입니다 ({date})', { name: source.name, date: source.headDate })
  return (
    <Frame title={title} subtitle={subtitle} onClose={onClose} busy={busy}>
      <div className="gh-body">
        {changed.length === 0 ? (
          <p className="gh-hint">{applied ? t('받은 폴더 안에서 바뀐 파일이 없습니다.') : source.branch === null ? t('지금 {ref} 를 보는 중이라 브랜치 새 소식은 「최신으로」에서 돌아가며 받습니다.', { ref: source.detached ?? '' }) : t('바뀐 파일이 없습니다.')}</p>
        ) : (
          <ul className="gh-changes">
            {documents.map((path) => (
              <li key={path}>
                <button type="button" className="gh-change" disabled={!applied || !/\.(?:md|markdown)$/iu.test(path)} onClick={() => { onOpen(path); onClose() }}>
                  <FileText size={14} aria-hidden="true" />
                  <span>{path.split('/').slice(2).join('/')}</span>
                </button>
              </li>
            ))}
            {others > 0 ? <li className="gh-change-more">{t('그림 등 다른 파일 {count}개', { count: others })}</li> : null}
          </ul>
        )}
        {error === null ? null : <p className="gh-error" role="alert">{error}</p>}
      </div>
      <footer className="gh-foot">
        <button type="button" className="gh-secondary" disabled={busy} onClick={onClose}>{t('닫기')}</button>
        {!applied && onPull !== undefined && (source.behind > 0 || source.branch === null) ? (
          <button
            type="button"
            className="gh-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onPull()
                onClose()
              } catch (cause) {
                setError(errorText(cause))
                setBusy(false)
              }
            }}
          >
            <ArrowClockwise size={14} aria-hidden="true" />
            {busy ? t('받는 중…') : t('최신으로')}
          </button>
        ) : null}
      </footer>
    </Frame>
  )
}
