import { ArrowsClockwise, DownloadSimple, X } from '@phosphor-icons/react'
import type { UseUpdaterResult } from './useUpdater'
import { t } from '../../i18n'
import '../../ui/notice-stack.css'

interface UpdateBannerProps {
  readonly state: UseUpdaterResult
  /** 설정 창이 열려 있으면 결과를 설정 창 안에서 보이므로 알림을 숨긴다 */
  readonly hidden?: boolean
}

export function progressLabel(state: UseUpdaterResult): string {
  const { downloaded, total } = state.progress
  if (total === null || total <= 0) return t('업데이트 다운로드 중…')
  return t('업데이트 다운로드 중 {percent}%', { percent: Math.min(100, Math.round(downloaded / total * 100)) })
}

export function UpdateBanner({ state, hidden = false }: UpdateBannerProps) {
  if (hidden || state.update === null || state.status === 'idle' || state.status === 'checking' || state.status === 'current' || state.status === 'error') return null
  const title = t('IWAE {version} 업데이트', { version: state.update.version })

  return (
    <aside className="notice-card" aria-label={title} aria-live="polite">
      <div className="notice-mark"><ArrowsClockwise size={16} weight="bold" aria-hidden="true" /></div>
      <div className="notice-copy">
        <strong>{title}</strong>
        {state.status === 'downloading' ? (
          <>
            <span>{progressLabel(state)}</span>
            <progress value={state.progress.downloaded} max={state.progress.total ?? undefined} />
          </>
        ) : (
          <span>{state.update.body.trim() || t('새 버전을 설치할 수 있습니다.')}</span>
        )}
        {state.error !== null && <em role="alert">{state.error}</em>}
      </div>
      <button type="button" className="notice-close" aria-label={t('나중에')} onClick={state.dismiss}><X size={14} aria-hidden="true" /></button>
      {state.status === 'available' || state.status === 'ready' || state.status === 'installing' ? (
        <div className="notice-actions">
          {state.status === 'installing' && <span className="notice-busy">{t('설치 준비 중…')}</span>}
          {state.status === 'available' && (
            <button type="button" onClick={state.suppressCurrentVersion}>{t('이 버전 다시 표시 안 함')}</button>
          )}
          {state.status === 'available' && (
            <button type="button" className="notice-primary" aria-label={t('업데이트 다운로드')} onClick={() => void state.download()}>
              <DownloadSimple size={14} aria-hidden="true" /> {t('업데이트')}
            </button>
          )}
          {state.status === 'ready' && (
            <button type="button" className="notice-primary" aria-label={t('다시 시작해 설치')} onClick={() => void state.install()}>
              {t('다시 시작해 설치')}
            </button>
          )}
        </div>
      ) : null}
    </aside>
  )
}
