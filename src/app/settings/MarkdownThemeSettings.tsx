import { MARKDOWN_THEMES, type MarkdownThemeId } from '../../core/markdownTheme'
import { t } from '../../i18n'

interface MarkdownThemeSettingsProps {
  readonly value: MarkdownThemeId
  readonly onChange: (theme: MarkdownThemeId) => void
}

export function MarkdownThemeSettings({ value, onChange }: MarkdownThemeSettingsProps) {
  return (
    <section className="markdown-theme-settings" aria-labelledby="markdown-theme-title">
      <h2 id="markdown-theme-title">{t('Markdown 문서 테마')}</h2>
      <p>{t('모든 Markdown 문서에 한 번에 적용됩니다. 원본 파일은 변경하지 않습니다.')}</p>
      <div className="markdown-theme-grid">
        {MARKDOWN_THEMES.map((theme) => (
          <label key={theme.id} style={{ background: theme.tokens.background, color: theme.tokens.foreground }}>
            <input
              type="radio"
              name="markdown-theme"
              value={theme.id}
              aria-label={theme.label}
              checked={value === theme.id}
              onChange={() => onChange(theme.id)}
            />
            <span>{theme.label}</span>
            <small style={{ background: theme.tokens.codeBackground }}>Aa · code</small>
          </label>
        ))}
      </div>
    </section>
  )
}
