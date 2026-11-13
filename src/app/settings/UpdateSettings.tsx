import { ArrowClockwise, CheckCircle, DownloadSimple, EyeSlash, WarningCircle } from '@phosphor-icons/react'
import { dateLocale, pick, t } from '../../i18n'
import type { UseUpdaterResult } from '../onboarding/useUpdater'
import { progressLabel } from '../onboarding/UpdateBanner'
import { ReleaseHistory } from '../onboarding/ReleaseNotesView'

interface UpdateSettingsProps {
  readonly currentVersion: string
  readonly state: UseUpdaterResult
  /** 업데이트 기록에서 먼저 펼쳐 보일 버전(「지난 기록 보기」·정보 보기에서 열 때) */
  readonly historyFocusVersion?: string | null
}

function checkedAtLabel(value: string | null): string {
  if (value === null) return t('아직 확인하지 않음')
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? t('확인 기록 없음') : date.toLocaleString(dateLocale())
}

function UpdateResult({ state }: { readonly state: UseUpdaterResult }) {
  const { status, update } = state
  if (status === 'checking') {
    return <div className="update-result" role="status"><span>{t('업데이트를 확인하는 중…')}</span></div>
  }
  if (status === 'current') {
    return <div className="update-result" role="status"><CheckCircle size={16} weight="fill" aria-hidden="true" /><span>{t('최신 버전을 사용 중입니다.')}</span></div>
  }
  if (status === 'error') {
    return (
      <div className="update-result update-result-error" role="alert">
        <WarningCircle size={16} weight="fill" aria-hidden="true" />
        <span>{t('업데이트를 확인하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도하세요.')}</span>
      </div>
    )
  }
  if (update === null || status === 'idle') return null
  const title = t('IWAE {version} 업데이트', { version: update.version })
  return (
    <div className="update-result update-result-available" role="status" aria-label={title}>
      <div className="update-result-copy">
        <strong>{title}</strong>
        {status === 'downloading' ? (
          <>
            <span>{progressLabel(state)}</span>
            <progress value={state.progress.downloaded} max={state.progress.total ?? undefined} />
          </>
        ) : status === 'ready' ? (
          <span>{t('내려받기를 마쳤습니다. 다시 시작하면 설치됩니다.')}</span>
        ) : (
          <span>{update.body.trim() || t('새 버전을 설치할 수 있습니다.')}</span>
        )}
      </div>
      <div className="update-result-actions">
        {status === 'available' && (
          <button type="button" className="update-result-primary" aria-label={t('업데이트 다운로드')} onClick={() => void state.download()}>
            <DownloadSimple size={14} aria-hidden="true" /> {t('업데이트 다운로드')}
          </button>
        )}
        {status === 'ready' && (
          <button type="button" className="update-result-primary" aria-label={t('다시 시작해 설치')} onClick={() => void state.install()}>
            {t('다시 시작해 설치')}
          </button>
        )}
        {status === 'installing' && <span>{t('설치 준비 중…')}</span>}
      </div>
    </div>
  )
}

export function UpdateSettings({ currentVersion, state, historyFocusVersion = null }: UpdateSettingsProps) {
  return (
    <section className="update-settings" aria-labelledby="update-settings-title">
      <header className="settings-section-heading">
        <div>
          <h2 id="update-settings-title">{t('업데이트')}</h2>
          <p>{t('새 버전을 확인하고 내려받는 방법을 선택합니다. 설치는 항상 직접 시작합니다.')}</p>
        </div>
        <span className="update-version"><CheckCircle size={15} weight="fill" aria-hidden="true" /> {currentVersion}</span>
      </header>

      <div className="settings-list">
        <label className="settings-toggle-row">
          <span><strong>{t('업데이트 자동 확인')}</strong><small>{t('작업 공간을 열 때와 실행 중 6시간마다 확인합니다.')}</small></span>
          <input
            type="checkbox"
            aria-label={t('업데이트 자동 확인')}
            checked={state.preferences.autoCheck}
            onChange={(event) => state.updatePreferences({ autoCheck: event.currentTarget.checked })}
          />
        </label>
        <label className="settings-toggle-row">
          <span><strong>{t('업데이트 자동 다운로드')}</strong><small>{t('새 버전이 있으면 설치 파일을 미리 내려받습니다.')}</small></span>
          <input
            type="checkbox"
            aria-label={t('업데이트 자동 다운로드')}
            checked={state.preferences.autoDownload}
            onChange={(event) => state.updatePreferences({ autoDownload: event.currentTarget.checked })}
          />
        </label>
      </div>

      <div className="update-settings-status">
        <span>{t('마지막 확인')}</span>
        <strong>{checkedAtLabel(state.preferences.lastCheckedAt)}</strong>
        <button type="button" aria-label={t('지금 확인')} disabled={state.status === 'checking'} onClick={() => void state.checkNow()}>
          <ArrowClockwise size={14} aria-hidden="true" /> {state.status === 'checking' ? t('확인 중…') : t('지금 확인')}
        </button>
      </div>

      <UpdateResult state={state} />

      {state.preferences.suppressedVersion !== null && (
        <div className="update-suppressed-version">
          <EyeSlash size={16} aria-hidden="true" />
          <span>{pick({
            ko: <><strong>{state.preferences.suppressedVersion}</strong> 알림을 숨긴 상태입니다.</>,
            en: <>Notifications for <strong>{state.preferences.suppressedVersion}</strong> are hidden.</>,
          })}</span>
          <button type="button" aria-label={t('숨긴 버전 초기화')} onClick={state.clearSuppressedVersion}>{t('다시 표시')}</button>
        </div>
      )}
      {state.error !== null && state.status !== 'error' && <p className="settings-inline-error" role="alert">{state.error}</p>}

      <ReleaseHistory currentVersion={currentVersion} focusVersion={historyFocusVersion} />
    </section>
  )
}
