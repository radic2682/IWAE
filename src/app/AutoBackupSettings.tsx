import { ArrowClockwise, FolderOpen } from '@phosphor-icons/react'
import { Select } from '../ui/Select'
import { AUTO_BACKUP_DAY_CHOICES, AUTO_BACKUP_KEEP_CHOICES, nextAutoBackupAt, type AutoBackupSettings as Settings } from '../core/autoBackup'
import { revealInFolder } from '../bridge/vaultBackup'
import { dateLocale, getLocale, t } from '../i18n'

interface AutoBackupSettingsProps {
  readonly settings: Settings | null
  readonly running: boolean
  readonly onChange: (patch: Partial<Settings>) => void
  readonly onRunNow: () => void
}

function when(iso: string | null): string {
  if (iso === null) return t('아직 없음')
  const date = new Date(iso)
  return Number.isFinite(date.getTime()) ? date.toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : t('아직 없음')
}

/** 설정 › 데이터 및 복구 › 자동 백업: n 일마다 Vault 전체를 고른 폴더에 zip 으로, 최근 몇 개만 남긴다 */
export function AutoBackupSettings({ settings, running, onChange, onRunNow }: AutoBackupSettingsProps) {
  if (settings === null) return null
  const next = nextAutoBackupAt(settings)
  const chooseFolder = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ directory: true, multiple: false, title: t('자동 백업을 둘 폴더'), defaultPath: settings.folder || undefined })
    if (typeof picked === 'string') onChange({ folder: picked })
  }
  return (
    <section className="theme-settings vault-backup auto-backup" aria-labelledby="auto-backup-title">
      <header className="theme-settings-heading">
        <h2 id="auto-backup-title">{t('자동 백업')}</h2>
        <p>{t('정해진 주기마다 Vault 전체를 zip으로 묶어 아래 폴더에 저장합니다. 오래된 백업은 정한 개수만 남기고 지웁니다.')}</p>
      </header>

      <label className="vault-backup-option">
        <input type="checkbox" checked={settings.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
        <span><strong>{t('자동 백업 사용')}</strong></span>
      </label>

      <div className="auto-backup-grid">
        <label>
          <span>{t('주기')}</span>
          <Select
            value={String(settings.everyDays)}
            disabled={!settings.enabled}
            options={AUTO_BACKUP_DAY_CHOICES.map((days) => ({ value: String(days), label: days === 1 ? t('매일') : t('{days}일마다', { days }) }))}
            onChange={(value) => onChange({ everyDays: Number(value) })}
          />
        </label>
        <label>
          <span>{t('남길 개수')}</span>
          <Select
            value={String(settings.keep)}
            disabled={!settings.enabled}
            options={AUTO_BACKUP_KEEP_CHOICES.map((count) => ({ value: String(count), label: t('최근 {count}개', { count }) }))}
            onChange={(value) => onChange({ keep: Number(value) })}
          />
        </label>
      </div>

      <div className="auto-backup-folder">
        <span className="auto-backup-path" title={settings.folder}>{settings.folder === '' ? t('폴더를 고르세요') : settings.folder}</span>
        <button type="button" className="vault-backup-secondary" onClick={() => void chooseFolder()}>{t('폴더 바꾸기')}</button>
        {settings.folder === '' ? null : (
          <button type="button" className="vault-backup-secondary" aria-label={t('자동 백업 폴더 열기')} title={t('폴더 열기')} onClick={() => void revealInFolder(settings.folder).catch(() => undefined)}>
            <FolderOpen size={15} aria-hidden="true" />
          </button>
        )}
      </div>

      <label className="vault-backup-option">
        <input type="checkbox" checked={settings.includeIndex} disabled={!settings.enabled} onChange={(event) => onChange({ includeIndex: event.target.checked })} />
        <span><strong>{t('검색 색인과 미리보기 캐시 포함')}</strong></span>
      </label>

      <dl className="auto-backup-status">
        <dt>{t('마지막 자동 백업')}</dt><dd>{when(settings.lastAt)}</dd>
        <dt>{t('다음 예정')}</dt><dd>{next === null ? t('꺼짐') : next.getTime() <= Date.now() ? t('곧') : when(next.toISOString())}</dd>
        {settings.lastError === null ? null : (<><dt>{t('최근 실패')}</dt><dd className="auto-backup-error">{settings.lastError}</dd></>)}
      </dl>

      <div className="vault-backup-actions">
        <button type="button" className="vault-backup-primary" disabled={running || settings.folder === ''} onClick={onRunNow}>
          <ArrowClockwise size={15} aria-hidden="true" />
          {running ? t('백업하는 중…') : t('지금 백업')}
        </button>
      </div>
    </section>
  )
}
