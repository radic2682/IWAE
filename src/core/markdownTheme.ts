import { t } from '../i18n'

export const MARKDOWN_THEME_IDS = ['light', 'dark', 'github', 'paper', 'focus', 'code'] as const

export type MarkdownThemeId = typeof MARKDOWN_THEME_IDS[number]

export interface MarkdownThemeTokens {
  background: string
  foreground: string
  muted: string
  border: string
  link: string
  codeBackground: string
  quoteBorder: string
  maxWidth: string
}

export interface MarkdownTheme {
  id: MarkdownThemeId
  label: string
  tokens: MarkdownThemeTokens
}

export const MARKDOWN_THEMES: readonly MarkdownTheme[] = [
  {
    id: 'light',
    get label() { return t('밝은 문서') },
    tokens: { background: '#ffffff', foreground: '#202124', muted: '#6b7280', border: '#e5e7eb', link: '#2563eb', codeBackground: '#f4f5f7', quoteBorder: '#a8b0bb', maxWidth: '820px' },
  },
  {
    id: 'dark',
    get label() { return t('어두운 문서') },
    tokens: { background: '#17191d', foreground: '#e8eaed', muted: '#9aa0a6', border: '#353941', link: '#8ab4f8', codeBackground: '#22252b', quoteBorder: '#747b87', maxWidth: '820px' },
  },
  {
    id: 'github',
    label: 'GitHub',
    tokens: { background: '#ffffff', foreground: '#1f2328', muted: '#59636e', border: '#d1d9e0', link: '#0969da', codeBackground: '#f6f8fa', quoteBorder: '#d1d9e0', maxWidth: '900px' },
  },
  {
    id: 'paper',
    get label() { return t('논문 / 리포트') },
    tokens: { background: '#fbfaf7', foreground: '#24221f', muted: '#736e65', border: '#d8d2c7', link: '#315d8c', codeBackground: '#f0ede7', quoteBorder: '#aa9e8b', maxWidth: '760px' },
  },
  {
    id: 'focus',
    get label() { return t('집중 읽기') },
    tokens: { background: '#f7f5ef', foreground: '#2f312e', muted: '#777b73', border: '#dedbd2', link: '#3c6e71', codeBackground: '#ece9e1', quoteBorder: '#83a09a', maxWidth: '680px' },
  },
  {
    id: 'code',
    get label() { return t('코드 중심') },
    tokens: { background: '#101317', foreground: '#d7dae0', muted: '#8c96a3', border: '#2b333d', link: '#70b7ff', codeBackground: '#181d23', quoteBorder: '#536171', maxWidth: '980px' },
  },
]

export function isMarkdownThemeId(value: unknown): value is MarkdownThemeId {
  return typeof value === 'string' && (MARKDOWN_THEME_IDS as readonly string[]).includes(value)
}

export function getMarkdownTheme(id: MarkdownThemeId): MarkdownTheme {
  return MARKDOWN_THEMES.find((theme) => theme.id === id) ?? MARKDOWN_THEMES[0]!
}
