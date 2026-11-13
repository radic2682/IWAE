import { Check, Moon, Sun, Monitor } from '@phosphor-icons/react'
import {
  THEME_ACCENTS,
  THEME_PALETTES,
  type ResolvedTheme,
  type ThemeAccent,
  type ThemePalette,
  type ThemePreference,
} from '../core/theme'
import { resolvePanelColor } from '../core/userTheme'
import { t } from '../i18n'
import { CustomAccentControl } from './CustomAccentControl'
import { HighlightColorSettings } from './HighlightColorSettings'
import { UserThemeCards } from './UserThemeCards'
import { findUserTheme, setActiveUserTheme, useUserThemes } from './userThemeStore'

interface ThemeSettingsProps {
  readonly preference: ThemePreference
  readonly resolvedTheme: ResolvedTheme
  readonly onChange: (preference: ThemePreference) => void
  readonly palette?: ThemePalette
  readonly onPaletteChange?: (palette: ThemePalette) => void
  readonly accent?: ThemeAccent
  readonly onAccentChange?: (accent: ThemeAccent) => void
  /** 열린 Vault 폴더(테마 폴더 열기에 쓴다) */
  readonly vaultRoot?: string | null
}

const CHOICES = [
  { value: 'system', label: '시스템 설정', icon: Monitor },
  { value: 'light', label: '라이트', icon: Sun },
  { value: 'dark', label: '다크', icon: Moon },
] as const

export function ThemeSettings({
  preference,
  resolvedTheme,
  onChange,
  palette = 'default',
  onPaletteChange,
  accent = 'auto',
  onAccentChange,
  vaultRoot = null,
}: ThemeSettingsProps) {
  const userThemes = useUserThemes()
  const activeUserTheme = findUserTheme(userThemes, userThemes.activeId)
  const panelColor = resolvePanelColor(activeUserTheme?.base ?? (palette === 'whale' || palette === 'paper' || palette === 'navy' ? palette : 'default'), activeUserTheme, resolvedTheme)
  const paletteAccent = THEME_PALETTES.find((item) => item.id === palette)?.preview[resolvedTheme].accent
  return (
    <section className="theme-settings" data-theme-drop="" aria-labelledby="theme-settings-title">
      <header className="theme-settings-heading">
        <h2 id="theme-settings-title">{t('화면 테마')}</h2>
        <p>{t('작업 공간의 밝기를 고릅니다. 시스템 설정은 운영체제 설정을 따릅니다.')}</p>
      </header>
      <div className="theme-settings-options" role="radiogroup" aria-label={t('화면 테마 선택')}>
        {CHOICES.map(({ value, label, icon: Icon }) => (
          <label key={value} className="theme-settings-option">
            <input
              type="radio"
              name="theme"
              value={value}
              checked={preference === value}
              onChange={() => onChange(value)}
            />
            <Icon size={18} aria-hidden="true" />
            <span>{t(label)}</span>
          </label>
        ))}
      </div>
      <p className="theme-settings-current">{resolvedTheme === 'dark' ? t('현재 다크 모드 적용 중') : t('현재 라이트 모드 적용 중')}</p>

      {onPaletteChange !== undefined ? (
        <div className="theme-subsection">
          <h3 id="theme-palette-title">{t('색 구성')}</h3>
          <div className="theme-palette-grid" role="radiogroup" aria-labelledby="theme-palette-title">
            {THEME_PALETTES.map((item) => {
              const swatch = item.preview[resolvedTheme]
              return (
                <label key={item.id} className="theme-palette-card">
                  <input
                    type="radio"
                    name="theme-palette"
                    value={item.id}
                    aria-label={item.label}
                    checked={palette === item.id && activeUserTheme === null}
                    onChange={() => { setActiveUserTheme(null); onPaletteChange(item.id) }}
                  />
                  <span className="theme-palette-preview" aria-hidden="true" style={{ background: swatch.workspace, borderColor: swatch.line }}>
                    <span className="theme-palette-preview-side" style={{ background: swatch.chrome, borderColor: swatch.line }}>
                      <i style={{ background: swatch.accent }} />
                      <i style={{ background: swatch.line }} />
                      <i style={{ background: swatch.line }} />
                    </span>
                    <span className="theme-palette-preview-page" style={{ background: swatch.paper, borderColor: swatch.line }}>
                      <i style={{ background: swatch.text, opacity: 0.85 }} />
                      <i style={{ background: swatch.text, opacity: 0.35 }} />
                      <i style={{ background: swatch.text, opacity: 0.35 }} />
                      <b style={{ background: swatch.accent }} />
                    </span>
                  </span>
                  <span className="theme-palette-copy">
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                  <span className="theme-palette-check" aria-hidden="true"><Check size={11} weight="bold" /></span>
                </label>
              )
            })}
            <UserThemeCards resolvedTheme={resolvedTheme} palette={palette} onFallback={() => onPaletteChange('whale')} vaultRoot={vaultRoot} />
          </div>
        </div>
      ) : null}

      {onAccentChange !== undefined ? (
        <div className="theme-subsection">
          <h3 id="theme-accent-title">{t('강조색')}</h3>
          <div className="theme-accent-row" role="radiogroup" aria-labelledby="theme-accent-title">
            {THEME_ACCENTS.map((item) => {
              const color = item.color?.[resolvedTheme] ?? paletteAccent ?? 'var(--accent)'
              return (
                <label key={item.id} className="theme-accent-swatch" title={item.label}>
                  <input
                    type="radio"
                    name="theme-accent"
                    value={item.id}
                    aria-label={item.label}
                    checked={accent === item.id}
                    onChange={() => onAccentChange(item.id)}
                  />
                  <span className={`theme-accent-dot${item.id === 'auto' ? ' theme-accent-dot-auto' : ''}`} style={{ ['--swatch' as string]: color }} aria-hidden="true">
                    <Check size={12} weight="bold" />
                  </span>
                  <small>{item.label}</small>
                </label>
              )
            })}
            <CustomAccentControl accent={accent} resolvedTheme={resolvedTheme} panelColor={panelColor} onSelect={() => onAccentChange('custom')} />
          </div>
        </div>
      ) : null}

      <HighlightColorSettings />
    </section>
  )
}
