import { useCallback, useEffect, useState } from 'react'
import { FileZip, ArrowCounterClockwise, CheckCircle, FolderOpen, Trash } from '@phosphor-icons/react'
import {
  backupCancel,
  backupCreate,
  backupEstimate,
  backupFileName,
  backupRestore,
  formatBytes,
  listenBackupProgress,
  revealInFolder,
  trashEmpty,
  trashStats,
  type BackupEstimate,
  type BackupProgress,
  type BackupResult,
  type RestoreResult,
  type TrashStats,
} from '../bridge/vaultBackup'
import type { VaultHandle } from '../bridge/vault'
import { errorText } from '../core/errorText'
import { ConfirmDialog } from './ConfirmDialog'
import '../ui/vault-data-tools.css'
import { pick, t } from '../i18n'

interface VaultBackupSettingsProps {
  readonly vault: VaultHandle
  /** 복원한 폴더를 Vault 로 연다 */
  readonly onOpenVault?: (root: string) => void
}

function folderName(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/u, '').split('/').at(-1) ?? path
}

function seconds(millis: number): string {
  return millis < 1000 ? t('1초 미만') : t('{seconds}초', { seconds: Math.round(millis / 1000) })
}

/**
 * 설정 › 데이터 및 복구 › 전체 Vault 백업. Vault 폴더 전체(문서·노트·.iwae 메타데이터)를
 * zip 하나로 묶어 고른 곳에 저장하고, 다 되면 탐색기에서 보여 줘 다른 곳으로 보내기 쉽게 한다.
 */
export function VaultBackupSettings({ vault, onOpenVault }: VaultBackupSettingsProps) {
  const [includeIndex, setIncludeIndex] = useState(false)
  const [estimate, setEstimate] = useState<BackupEstimate | null>(null)
  const [progress, setProgress] = useState<BackupProgress | null>(null)
  const [running, setRunning] = useState<'backup' | 'restore' | null>(null)
  const [result, setResult] = useState<BackupResult | null>(null)
  const [restored, setRestored] = useState<RestoreResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setEstimate(null)
    void backupEstimate(includeIndex).then((next) => { if (alive) setEstimate(next) }).catch(() => undefined)
    return () => { alive = false }
  }, [includeIndex, vault.root])

  useEffect(() => {
    let stop: () => void = () => undefined
    let alive = true
    void listenBackupProgress((next) => setProgress(next)).then((unlisten) => {
      if (alive) stop = unlisten
      else unlisten()
    }).catch(() => undefined)
    return () => {
      alive = false
      stop()
    }
  }, [])

  const createBackup = async () => {
    setError(null)
    setResult(null)
    setRestored(null)
    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const dest = await save({
        title: t('백업 파일 저장 위치'),
        defaultPath: backupFileName(folderName(vault.root)),
        filters: [{ name: t('Zip 압축 파일'), extensions: ['zip'] }],
      })
      if (dest === null) return
      setProgress(null)
      setRunning('backup')
      setResult(await backupCreate(dest, includeIndex))
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setRunning(null)
      setProgress(null)
    }
  }

  const restoreBackup = async () => {
    setError(null)
    setResult(null)
    setRestored(null)
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const archive = await open({ title: t('복원할 백업 파일'), multiple: false, filters: [{ name: t('Zip 압축 파일'), extensions: ['zip'] }] })
      if (typeof archive !== 'string') return
      const dest = await open({ title: t('풀어 놓을 빈 폴더'), directory: true, multiple: false, recursive: true })
      if (typeof dest !== 'string') return
      setProgress(null)
      setRunning('restore')
      setRestored(await backupRestore(archive, dest))
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setRunning(null)
      setProgress(null)
    }
  }

  const reveal = (path: string) => {
    void revealInFolder(path).catch((cause: unknown) => setError(errorText(cause)))
  }

  const percent = progress !== null && progress.bytesTotal > 0 ? Math.min(100, Math.round((progress.bytesDone / progress.bytesTotal) * 100)) : 0

  return (
    <section className="theme-settings vault-backup" aria-labelledby="vault-backup-title">
      <header className="theme-settings-heading">
        <h2 id="vault-backup-title">{t('전체 Vault 백업')}</h2>
        <p>{t('문서·노트·하이라이트·설정(.iwae)까지 Vault 폴더 전체를 zip 하나로 묶습니다. 다른 PC 로 옮기거나 보관할 때 씁니다.')}</p>
      </header>

      <div className="vault-backup-summary">
        <FileZip size={22} aria-hidden="true" />
        <div>
          <strong>{folderName(vault.root)}</strong>
          <span>
            {estimate === null ? t('크기를 재는 중…') : t('파일 {files}개 · {size}', { files: estimate.files.toLocaleString(), size: formatBytes(estimate.bytes) })}
          </span>
        </div>
      </div>

      <label className="vault-backup-option">
        <input type="checkbox" checked={includeIndex} disabled={running !== null} onChange={(event) => setIncludeIndex(event.target.checked)} />
        <span>
          <strong>{t('검색 색인·미리보기 캐시도 넣기')}</strong>
          <small>
            {t('다시 만들 수 있는 파일이라 기본으로 뺍니다{size}.', { size: estimate !== null && estimate.rebuildableBytes > 0 ? ` (${formatBytes(estimate.rebuildableBytes)})` : '' })}
            {' '}{t('빼면 복원한 뒤 [색인 갱신]을 한 번 눌러야 문서 검색이 됩니다.')}
          </small>
        </span>
      </label>

      {running !== null ? (
        <div className="vault-backup-progress" role="status">
          <div className="vault-backup-progress-row">
            <span>{running === 'backup' ? t('백업 만드는 중') : t('복원하는 중')} · {percent}%</span>
            <button type="button" onClick={() => void backupCancel()}>{t('취소')}</button>
          </div>
          <div className="vault-backup-bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
          <small>
            {progress === null
              ? t('파일 목록을 모으는 중…')
              : `${progress.filesDone.toLocaleString()}/${progress.filesTotal.toLocaleString()} · ${formatBytes(progress.bytesDone)} / ${formatBytes(progress.bytesTotal)}${progress.current ? ` · ${progress.current}` : ''}`}
          </small>
        </div>
      ) : (
        <div className="vault-backup-actions">
          <button type="button" className="vault-backup-primary" onClick={() => void createBackup()}>
            <FileZip size={15} aria-hidden="true" /> {t('백업 파일 만들기…')}
          </button>
          <button type="button" onClick={() => void restoreBackup()}>
            <ArrowCounterClockwise size={15} aria-hidden="true" /> {t('백업에서 복원…')}
          </button>
        </div>
      )}

      {result !== null ? (
        <div className="vault-backup-done" role="status">
          <CheckCircle size={18} weight="fill" aria-hidden="true" />
          <div>
            <strong>{t('백업을 만들었습니다')}</strong>
            <span title={result.path}>{folderName(result.path)} · {formatBytes(result.archiveBytes)} · {t('파일 {count}개', { count: result.files.toLocaleString() })} · {seconds(result.millis)}</span>
          </div>
          <button type="button" onClick={() => reveal(result.path)}><FolderOpen size={15} aria-hidden="true" /> {t('폴더에서 보기')}</button>
        </div>
      ) : null}

      {restored !== null ? (
        <div className="vault-backup-done" role="status">
          <CheckCircle size={18} weight="fill" aria-hidden="true" />
          <div>
            <strong>{t('복원했습니다')}</strong>
            <span title={restored.path}>{restored.path} · {t('파일 {count}개', { count: restored.files.toLocaleString() })} · {formatBytes(restored.bytes)}</span>
          </div>
          <button type="button" onClick={() => reveal(restored.path)}><FolderOpen size={15} aria-hidden="true" /> {t('폴더에서 보기')}</button>
          {onOpenVault !== undefined ? (
            <button type="button" className="vault-backup-primary" onClick={() => onOpenVault(restored.path)}>{t('이 Vault 열기')}</button>
          ) : null}
        </div>
      ) : null}

      {error !== null ? <p className="settings-inline-error" role="alert">{error}</p> : null}
      <p className="vault-backup-note">{t('복원은 지금 Vault 를 덮어쓰지 않습니다. 빈 폴더에 풀어 새 Vault 로 엽니다.')}</p>
    </section>
  )
}

interface TrashEmptyControlProps {
  /** 휴지통 목록 항목 수(바뀌면 크기를 다시 잰다) */
  readonly count: number
  readonly onEmptied: () => void
}

/** 설정 › 데이터 및 복구 › 휴지통 머리의 [휴지통 비우기]. 앱 안 확인 창을 거쳐 영구 삭제한다. */
export function TrashEmptyControl({ count, onEmptied }: TrashEmptyControlProps) {
  const [stats, setStats] = useState<TrashStats | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStats(await trashStats())
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh, count])

  const empty = async () => {
    setBusy(true)
    setError(null)
    try {
      await trashEmpty()
      setConfirming(false)
      onEmptied()
    } catch (cause) {
      setError(errorText(cause))
      setConfirming(false)
      onEmptied()
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const items = Math.max(count, stats?.entries ?? 0)
  const isEmpty = stats !== null && stats.files === 0 && items === 0
  return (
    <>
      <span className="trash-empty-size">{stats !== null && stats.bytes > 0 ? formatBytes(stats.bytes) : ''}</span>
      <button
        type="button"
        className="trash-empty-button"
        disabled={isEmpty || busy}
        title={isEmpty ? t('휴지통이 비어 있습니다') : t('휴지통 비우기')}
        onClick={() => setConfirming(true)}
      >
        <Trash size={14} aria-hidden="true" /> {t('휴지통 비우기')}
      </button>
      {error !== null ? <span className="settings-inline-error" role="alert">{error}</span> : null}
      {confirming ? (
        <ConfirmDialog
          title={t('휴지통을 비울까요?')}
          tone="danger"
          confirmLabel={busy ? t('지우는 중…') : t('영구 삭제')}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void empty()}
        >
          <p>{pick({
            ko: <>항목 <strong>{items.toLocaleString()}개</strong>{stats !== null ? <> (파일 {stats.files.toLocaleString()}개, <strong>{formatBytes(stats.bytes)}</strong>)</> : null}를 영구히 지웁니다.</>,
            en: <>Permanently delete <strong>{items.toLocaleString()} {items === 1 ? 'item' : 'items'}</strong>{stats !== null ? <> ({stats.files.toLocaleString()} files, <strong>{formatBytes(stats.bytes)}</strong>)</> : null}.</>,
          })}</p>
          <p>{t('지운 뒤에는 복원할 수 없습니다.')}</p>
        </ConfirmDialog>
      ) : null}
    </>
  )
}
