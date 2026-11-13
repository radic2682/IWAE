import { useState } from 'react'
import { isDesktop } from '../../bridge/window'
import { getLocale, readLocalePreference, saveLocalePreference, t, type LocalePreference } from '../../i18n'

const OPTIONS: readonly { readonly value: LocalePreference; readonly label: () => string }[] = [
  { value: 'ko', label: () => '한국어' },
  { value: 'en', label: () => 'English' },
  { value: 'system', label: () => t('시스템 언어 따르기') },
]

/** 화면 언어. 고른 값은 바로 남기고, 모든 화면에는 다시 시작한 뒤 걸린다 */
export function LanguageSettings() {
  const [preference, setPreference] = useState<LocalePreference>(() => readLocalePreference() ?? 'system')
  const [changed, setChanged] = useState(false)
  const running = getLocale()
  return (
    <section className="theme-settings language-settings" aria-labelledby="language-settings-title">
      <header className="theme-settings-heading">
        {/* 읽지 못하는 언어로 바뀌어도 찾을 수 있게 두 언어로 */}
        <h2 id="language-settings-title">{running === 'ko' ? '언어 · Language' : 'Language · 언어'}</h2>
      </header>
      <div className="ui-scale-presets" role="radiogroup" aria-label={t('언어')}>
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            className={`ui-scale-preset${preference === option.value ? ' ui-scale-preset-active' : ''}`}
            aria-checked={preference === option.value}
            onClick={() => {
              setPreference(option.value)
              saveLocalePreference(option.value)
              setChanged(true)
            }}
          >
            {option.label()}
          </button>
        ))}
      </div>
      {changed ? (
        <p className="language-settings-restart">
          {running === 'ko' ? '다시 시작하면 모든 화면에 걸립니다.' : 'Restart IWAE to apply it everywhere.'}
          {isDesktop() ? (
            <button
              type="button"
              className="ui-scale-preset"
              onClick={() => {
                void import('@tauri-apps/plugin-process').then(({ relaunch }) => relaunch())
              }}
            >
              {running === 'ko' ? '지금 다시 시작' : 'Restart now'}
            </button>
          ) : null}
        </p>
      ) : null}
    </section>
  )
}
