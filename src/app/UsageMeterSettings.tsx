import { setUsageMeterEnabled, useUsageMeterEnabled } from '../core/usageMeterPref'
import '../ui/ai-settings.css'
import { t } from '../i18n'

/** 설정 「화면 및 문서」: PDF 하단 막대의 CPU·메모리 표시 켜고 끄기 */
export function UsageMeterSettings() {
  const enabled = useUsageMeterEnabled()
  return (
    <section className="theme-settings usage-meter-settings" aria-labelledby="usage-meter-title">
      <header className="theme-settings-heading">
        <h2 id="usage-meter-title">{t('CPU와 메모리 표시')}</h2>
        <p>{t('PDF 하단 막대 오른쪽 끝에 IWAE의 CPU와 메모리 사용량을 표시합니다. 마우스를 올리면 시스템 전체 사용량도 보입니다.')}</p>
      </header>
      <div className="settings-list">
        <div className="settings-toggle-row">
          <span>
            <strong>{t('하단 막대에 CPU와 메모리 표시')}</strong>
            <small>{t('2초마다 갱신합니다. 데스크톱 앱에서만 쓸 수 있습니다')}</small>
          </span>
          <button
            type="button"
            role="switch"
            className="ai-settings-switch"
            aria-label={t('하단 막대에 CPU와 메모리 표시')}
            aria-checked={enabled}
            onClick={() => setUsageMeterEnabled(!enabled)}
          >
            <span />
          </button>
        </div>
      </div>
    </section>
  )
}
