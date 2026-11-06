import { ArrowClockwise, CheckCircle, EyeSlash } from '@phosphor-icons/react'
import { dateLocale, pick, t } from '../i18n'
import type { UseUpdaterResult } from './useUpdater'

interface UpdateSettingsProps {
  readonly currentVersion: string
  readonly state: UseUpdaterResult
}

function checkedAtLabel(value: string | null): string {
  if (value === null) return t('아직 확인하지 않음')
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? t('확인 기록 없음') : date.toLocaleString(dateLocale())
}

export function UpdateSettings({ currentVersion, state }: UpdateSettingsProps) {
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
          <span><strong>{t('업데이트 자동 확인')}</strong><small>{t('작업 공간을 연 뒤 백그라운드에서 확인합니다.')}</small></span>
          <input
            type="checkbox"
            aria-label={t('업데이트 자동 확인')}
            checked={state.preferences.autoCheck}
            onChange={(event) => state.updatePreferences({ autoCheck: event.currentTarget.checked })}
          />
        </label>
        <label className="settings-toggle-row">
          <span><strong>{t('업데이트 자동 다운로드')}</strong><small>{t('새 버전을 발견하면 설치 파일만 미리 내려받습니다.')}</small></span>
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
      {state.error !== null && <p className="settings-inline-error" role="alert">{state.error}</p>}
    </section>
  )
}
