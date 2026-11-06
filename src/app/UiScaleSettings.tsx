import { useCallback, useEffect, useState } from 'react'
import { isDesktop } from '../bridge/window'
import { t } from '../i18n'

const STORAGE_KEY = 'iwae:ui-scale:v1'
export const UI_SCALE_MIN = 0.8
export const UI_SCALE_MAX = 1.5
const PRESETS = [0.9, 1, 1.1, 1.25] as const

export function clampUiScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.round(Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value)) * 100) / 100
}

function readUiScale(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === null ? 1 : clampUiScale(Number(raw))
  } catch {
    return 1
  }
}

/**
 * 화면 전체 크기. 웹뷰 확대(브라우저의 Ctrl+＋ 와 같은 것)로 글자·아이콘·여백을 함께 키운다 —
 * 부품마다 크기를 따로 키우면 줄 높이와 아이콘이 서로 어긋난다. PDF 배율은 따로 간다.
 */
export function useUiScale() {
  const [scale, setScaleState] = useState(readUiScale)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (isDesktop()) {
        try {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview')
          if (!cancelled) await getCurrentWebview().setZoom(scale)
          return
        } catch {
          // 권한이 없거나 웹뷰가 거부하면 아래 CSS 확대로 물러난다
        }
      }
      if (!cancelled) document.documentElement.style.setProperty('zoom', String(scale))
    })()
    return () => { cancelled = true }
  }, [scale])
  const setScale = useCallback((next: number) => {
    const value = clampUiScale(next)
    setScaleState(value)
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value))
    } catch {
      // 저장하지 못해도 이번 실행에는 적용된다
    }
  }, [])
  return { scale, setScale }
}

interface UiScaleSettingsProps {
  readonly scale: number
  readonly onChange: (scale: number) => void
}

export function UiScaleSettings({ scale, onChange }: UiScaleSettingsProps) {
  const percent = Math.round(scale * 100)
  return (
    <section className="theme-settings ui-scale-settings" aria-labelledby="ui-scale-title">
      <header className="theme-settings-heading">
        <h2 id="ui-scale-title">{t('화면 크기')}</h2>
        <p>{t('글자·아이콘·여백을 함께 키우거나 줄입니다. PDF 배율은 아래 막대에서 따로 조절합니다.')}</p>
      </header>
      <div className="ui-scale-row">
        <input
          type="range"
          min={UI_SCALE_MIN * 100}
          max={UI_SCALE_MAX * 100}
          step={5}
          value={percent}
          aria-label={t('화면 크기')}
          onChange={(event) => onChange(Number(event.target.value) / 100)}
        />
        <output className="ui-scale-value" aria-live="polite">{percent}%</output>
      </div>
      <div className="ui-scale-presets" role="group" aria-label={t('자주 쓰는 크기')}>
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`ui-scale-preset${Math.abs(preset - scale) < 0.001 ? ' ui-scale-preset-active' : ''}`}
            aria-pressed={Math.abs(preset - scale) < 0.001}
            onClick={() => onChange(preset)}
          >
            {Math.round(preset * 100)}%
          </button>
        ))}
      </div>
    </section>
  )
}
