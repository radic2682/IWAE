import { useEffect, useRef, useState } from 'react'
import { Check } from '@phosphor-icons/react'
import { normalizeHex } from '../core/colorMath'
import { accentContrast, deriveAccentVars } from '../core/userTheme'
import type { ResolvedTheme, ThemeAccent } from '../core/theme'
import { t } from '../i18n'
import { setCustomAccent, useUserThemes } from './userThemeStore'
import '../ui/user-theme.css'

/**
 * 강조색 줄의 "직접 고르기": 색 하나를 고르면 밝기별 강조색·원문 선·선택색·버튼 글자색을 계산해 바로 적용한다.
 * 계산 결과가 패널 위에서 읽히는지(WCAG 4.5:1)를 배지로 보여 준다.
 */
export function CustomAccentControl({ accent, resolvedTheme, panelColor, onSelect }: {
  readonly accent: ThemeAccent
  readonly resolvedTheme: ResolvedTheme
  /** 지금 화면의 패널(--chrome) 색 */
  readonly panelColor: string
  readonly onSelect: () => void
}) {
  const { customAccent } = useUserThemes()
  const [text, setText] = useState(customAccent)
  const pickerRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setText(customAccent) }, [customAccent])

  const applied = deriveAccentVars(customAccent, resolvedTheme, panelColor)['--accent'] ?? customAccent
  const contrast = accentContrast(applied, panelColor)
  const adjusted = applied.toLowerCase() !== customAccent.toLowerCase()
  const selected = accent === 'custom'

  const commit = (value: string) => {
    const hex = normalizeHex(value)
    if (hex === null) return false
    setCustomAccent(hex)
    onSelect()
    return true
  }
  const openPicker = () => {
    onSelect()
    const input = pickerRef.current
    if (input === null) return
    try { input.showPicker() } catch { input.click() }
  }

  return (
    <>
      <label className="theme-accent-swatch" title={t('직접 고르기')}>
        <input type="radio" name="theme-accent" value="custom" aria-label={t('직접 고르기')} checked={selected} onChange={onSelect} />
        <span
          className="theme-accent-dot theme-accent-dot-custom"
          style={{ ['--swatch' as string]: customAccent }}
          aria-hidden="true"
          onClick={(event) => { if (selected) { event.preventDefault(); openPicker() } }}
        >
          <Check size={12} weight="bold" />
        </span>
        <small>{t('직접 고르기')}</small>
      </label>
      {selected ? (
      <div className="theme-accent-custom-detail">
      <div className="theme-accent-custom-field" data-selected="true">
        <button type="button" className="theme-accent-custom-chip" style={{ background: customAccent }} aria-label={t('색 고르기')} onClick={openPicker} />
        <input
          ref={pickerRef}
          type="color"
          className="theme-color-native"
          tabIndex={-1}
          aria-hidden="true"
          value={customAccent}
          onChange={(event) => commit(event.target.value)}
        />
        <input
          type="text"
          className="theme-hex-input"
          aria-label={t('강조색 직접 입력')}
          spellCheck={false}
          maxLength={7}
          value={text.toUpperCase()}
          data-invalid={normalizeHex(text) === null ? 'true' : undefined}
          onChange={(event) => { setText(event.target.value); commit(event.target.value) }}
          onBlur={() => setText(customAccent)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.currentTarget.blur() } }}
        />
      </div>
      <span className={`theme-contrast-badge${contrast.ok ? '' : ' theme-contrast-badge-warn'}`} role="status">
        {contrast.ok ? t('대비 충분') : `${t('대비 낮음')} ${contrast.ratio.toFixed(1)}:1`}
        {adjusted ? <small>{t('자동 보정')}</small> : null}
      </span>
      </div>
      ) : null}
    </>
  )
}
