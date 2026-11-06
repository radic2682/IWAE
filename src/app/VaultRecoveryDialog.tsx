import { dateLocale, t } from '../i18n'
import { useCallback, useEffect, useState } from 'react'
import { ArrowCounterClockwise, WarningCircle } from '@phosphor-icons/react'
import {
  listConflicts,
  listHistory,
  listTrash,
  resolveConflict,
  restoreHistory,
  restoreTrash,
  type ConflictRecord,
  type HistorySnapshot,
  type TrashEntry,
} from '../bridge/vaultRecovery'
import {
  recoverStorageTransaction,
  scanStorageRecovery,
  type RecoveryAction,
  type RecoveryRecord,
} from '../bridge/storage'
import { readVaultIndex, type VaultHandle } from '../bridge/vault'
import type { VaultIndexEntry } from '../core/vaultIndex'
import { errorText } from '../core/errorText'
import { TrashEmptyControl } from './VaultDataTools'

interface VaultRecoveryDialogProps {
  readonly vault: VaultHandle
}

interface HistoryItem {
  readonly entry: VaultIndexEntry
  readonly snapshot: HistorySnapshot
  readonly targetPath: string
}

export function VaultRecoveryDialog({ vault }: VaultRecoveryDialogProps) {
  const [conflicts, setConflicts] = useState<readonly ConflictRecord[]>([])
  const [trash, setTrash] = useState<readonly TrashEntry[]>([])
  const [journals, setJournals] = useState<readonly RecoveryRecord[]>([])
  const [history, setHistory] = useState<readonly HistoryItem[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const { join } = await import('@tauri-apps/api/path')
      const [nextConflicts, nextTrash, nextJournals, index] = await Promise.all([
        listConflicts(vault),
        listTrash(vault),
        scanStorageRecovery(await join(vault.root, '.iwae', 'journal')),
        readVaultIndex(vault),
      ])
      const historyGroups = await Promise.all(index.entries.map(async (entry) => ({
        entry,
        snapshots: await listHistory(vault, entry.id),
        targetPath: entry.storage === 'vault'
          ? await join(vault.root, ...entry.path.replaceAll('\\', '/').split('/').filter(Boolean))
          : entry.path,
      })))
      setConflicts(nextConflicts)
      setTrash(nextTrash)
      setJournals(nextJournals)
      setHistory(historyGroups.flatMap((group) => group.snapshots.map((snapshot) => ({
        entry: group.entry,
        snapshot,
        targetPath: group.targetPath,
      }))))
    } catch (err) {
      setError(errorText(err))
    }
  }, [vault])

  useEffect(() => { void refresh() }, [refresh])

  const chooseConflict = async (id: string, choice: 'current' | 'incoming' | 'both') => {
    try {
      await resolveConflict(vault, id, choice)
      await refresh()
    } catch (err) {
      setError(errorText(err))
    }
  }

  const restore = async (id: string) => {
    try {
      await restoreTrash(vault, id)
      await refresh()
    } catch (err) {
      setError(errorText(err))
    }
  }

  const recoverJournal = async (journalPath: string, action: RecoveryAction) => {
    try {
      await recoverStorageTransaction(journalPath, action)
      await refresh()
    } catch (err) {
      setError(errorText(err))
    }
  }

  const restoreSnapshot = async (item: HistoryItem) => {
    try {
      await restoreHistory(vault, {
        fileId: item.entry.id,
        snapshotId: item.snapshot.id,
        targetPath: item.targetPath,
      })
      await refresh()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <section className="vault-recovery" aria-labelledby="vault-recovery-title">
      <div className="vault-recovery-heading">
        <div><h2 id="vault-recovery-title">{t('복구 및 데이터 관리')}</h2><p>{t('충돌 사본과 휴지통은 원본을 덮어쓰기 전에 선택할 수 있습니다.')}</p></div>
        <button type="button" aria-label={t('복구 상태 새로고침')} onClick={() => void refresh()}><ArrowCounterClockwise size={15} /></button>
      </div>
      {error !== null && <p role="alert">{error}</p>}
      {journals.length > 0 && (
        <div className="vault-recovery-group"><h3><WarningCircle size={15} />{t('완료되지 않은 저장')}</h3>
          {journals.map((record) => (
            <article key={record.transactionId}>
              <strong>{record.targetPath}</strong>
              <span>{record.stage}</span>
              <div>
                <button type="button" onClick={() => void recoverJournal(record.journalPath, 'retry')}>{t('저장 재시도')}</button>
                <button type="button" onClick={() => void recoverJournal(record.journalPath, 'preserve-copy')}>{t('사본으로 보존')}</button>
                <button type="button" onClick={() => void recoverJournal(record.journalPath, 'cancel')}>{t('저장 취소')}</button>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="vault-recovery-group">
        <h3>{t('버전 기록')} <span>{history.length}</span></h3>
        {history.map((item) => (
          <article key={`${item.entry.id}:${item.snapshot.id}`} className="vault-history-item">
            <div>
              <strong>{item.entry.displayName}</strong>
              <time dateTime={new Date(item.snapshot.createdAt).toISOString()}>
                {new Date(item.snapshot.createdAt).toLocaleString(dateLocale())}
              </time>
              {item.snapshot.size !== null && <span>{item.snapshot.size} B</span>}
            </div>
            {item.snapshot.preview !== null && <pre>{item.snapshot.preview}</pre>}
            <button type="button" aria-label={t('{name} 버전 복원', { name: item.entry.displayName })} onClick={() => void restoreSnapshot(item)}>{t('복원')}</button>
          </article>
        ))}
        {history.length === 0 && <p>{t('복원 가능한 이전 버전이 없습니다.')}</p>}
      </div>
      <div className="vault-recovery-group">
        <h3>{t('파일 충돌')} <span>{conflicts.length}</span></h3>
        {conflicts.map((conflict) => (
          <article key={conflict.id}>
            <strong>{conflict.targetPath}</strong>
            <div>
              <button type="button" onClick={() => void chooseConflict(conflict.id, 'current')}>{t('현재 버전 유지')}</button>
              <button type="button" onClick={() => void chooseConflict(conflict.id, 'incoming')}>{t('외부 버전 적용')}</button>
              <button type="button" onClick={() => void chooseConflict(conflict.id, 'both')}>{t('두 버전 모두 보존')}</button>
            </div>
          </article>
        ))}
        {conflicts.length === 0 && <p>{t('해결할 충돌이 없습니다.')}</p>}
      </div>
      <div className="vault-recovery-group">
        <h3 className="vault-trash-heading">{t('휴지통')} <span>{trash.length}</span><TrashEmptyControl count={trash.length} onEmptied={() => void refresh()} /></h3>
        {trash.map((entry) => (
          <article key={entry.id}><strong>{entry.kind === 'folder' ? t('{path}/ (폴더, 문서 {count}개)', { path: entry.originalPath, count: entry.indexEntries?.length ?? 0 }) : entry.originalPath}</strong><button type="button" aria-label={t('{name} 복원', { name: entry.originalPath })} onClick={() => void restore(entry.id)}>{t('복원')}</button></article>
        ))}
        {trash.length === 0 && <p>{t('휴지통이 비어 있습니다.')}</p>}
      </div>
    </section>
  )
}
