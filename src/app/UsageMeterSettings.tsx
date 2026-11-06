import { setUsageMeterEnabled, useUsageMeterEnabled } from '../core/usageMeterPref'
import '../ui/ai-settings.css'
import { t } from '../i18n'

/** 설정 「화면 및 문서」: PDF 하단 막대의 CPU·메모리 표시 켜고 끄기 */
export function UsageMeterSettings() {
  const enabled = useUsageMeterEnabled()
  return (
    <section className="theme-settings usage-meter-settings" aria-labelledby="usage-meter-title">
      <header className="theme-settings-heading">
        <h2 id="usage-meter-title">{t('CPU·메모리 표시')}</h2>
        <p>{t('PDF 하단 막대 오른쪽 끝에 IWAE 가 지금 쓰는 CPU·메모리를 보입니다. 마우스를 올리면 시스템 전체도 보입니다.')}</p>
      </header>
      <div className="settings-list">
        <div className="settings-toggle-row">
          <span>
            <strong>{t('하단 막대에 CPU·메모리 보이기')}</strong>
            <small>{t('2초마다 다시 잽니다 · 데스크톱 앱에서만')}</small>
          </span>
          <button
            type="button"
            role="switch"
            className="ai-settings-switch"
            aria-label={t('하단 막대에 CPU·메모리 보이기')}
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
