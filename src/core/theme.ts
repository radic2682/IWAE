import { t } from '../i18n'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const THEME_STORAGE_KEY = 'iwae.theme.preference'
// 기본은 웨일 어두운 테마(사용자가 고르면 그것을 따른다)
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'dark'

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : DEFAULT_THEME_PREFERENCE
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  return preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference
}

function browserStorage(): ThemeStorage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage
}

export function loadThemePreference(
  storage: ThemeStorage | undefined = browserStorage(),
): ThemePreference {
  if (storage === undefined) return DEFAULT_THEME_PREFERENCE
  try {
    return parseThemePreference(storage.getItem(THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_THEME_PREFERENCE
  }
}

export function saveThemePreference(
  preference: ThemePreference,
  storage: ThemeStorage | undefined = browserStorage(),
): void {
  if (storage === undefined) return
  try {
    storage.setItem(THEME_STORAGE_KEY, parseThemePreference(preference))
  } catch {}
}

/* ── 색 구성(팔레트)과 강조색 ─────────────────────────────────────────────
   밝기(라이트/다크)와 따로 고른다. 실제 색은 src/ui/app-themes.css 가 :root 의
   data-palette / data-accent 로 정한다. 여기 값은 설정 화면 미리보기용이다. */

export type ThemePalette = 'whale' | 'default' | 'paper' | 'navy'
export type ThemeAccent = 'auto' | 'custom' | 'blue' | 'teal' | 'green' | 'violet' | 'rose' | 'amber'

export const PALETTE_STORAGE_KEY = 'iwae.theme.palette'
export const ACCENT_STORAGE_KEY = 'iwae.theme.accent'
export const DEFAULT_PALETTE: ThemePalette = 'whale'
export const DEFAULT_ACCENT: ThemeAccent = 'auto'

interface PreviewSwatch { readonly workspace: string; readonly chrome: string; readonly paper: string; readonly line: string; readonly text: string; readonly accent: string }

export const THEME_PALETTES: readonly { id: ThemePalette; label: string; description: string; preview: Record<ResolvedTheme, PreviewSwatch> }[] = [
  {
    id: 'whale',
    get label() { return t('기본') },
    get description() { return t('짙은 회색, 파란 강조(기본)') },
    preview: {
      light: { workspace: '#ececec', chrome: '#e3e3e3', paper: '#ffffff', line: '#d4d4d4', text: '#111111', accent: '#1f7ae0' },
      dark: { workspace: '#232324', chrome: '#191919', paper: '#393939', line: '#4c4c4c', text: '#f4f4f4', accent: '#6fbdff' },
    },
  },
  {
    id: 'default',
    get label() { return t('중립 회색') },
    get description() { return t('중립 회색') },
    preview: {
      light: { workspace: '#f1f2f3', chrome: '#f7f7f6', paper: '#ffffff', line: '#dcdcd8', text: '#171a1f', accent: '#2f6fb0' },
      dark: { workspace: '#171a1e', chrome: '#24282d', paper: '#1d2024', line: '#3b424a', text: '#f5f6f7', accent: '#79addd' },
    },
  },
  {
    id: 'paper',
    get label() { return t('따뜻한 종이') },
    get description() { return t('미색 바탕, 갈색 강조') },
    preview: {
      light: { workspace: '#efe9dc', chrome: '#f5f0e5', paper: '#fcfaf4', line: '#e0d7c5', text: '#241f19', accent: '#9a5b2b' },
      dark: { workspace: '#1b1916', chrome: '#292620', paper: '#22201c', line: '#423d35', text: '#f6efe2', accent: '#dba46c' },
    },
  },
  {
    id: 'navy',
    get label() { return t('짙은 남색') },
    get description() { return t('푸른 회색, 남색 강조') },
    preview: {
      light: { workspace: '#e9edf5', chrome: '#f1f4f9', paper: '#fbfcfe', line: '#d3dae6', text: '#111a2e', accent: '#2f55b8' },
      dark: { workspace: '#0e1424', chrome: '#19213b', paper: '#141c30', line: '#2e3a5c', text: '#f3f6fc', accent: '#8fb0ff' },
    },
  },
]

export const THEME_ACCENTS: readonly { id: Exclude<ThemeAccent, 'custom'>; label: string; color: Record<ResolvedTheme, string> | null }[] = [
  { id: 'auto', get label() { return t('테마 기본') }, color: null },
  { id: 'blue', get label() { return t('파랑') }, color: { light: '#2f6fb0', dark: '#79addd' } },
  { id: 'teal', get label() { return t('청록') }, color: { light: '#0f7a7d', dark: '#5ec8c4' } },
  { id: 'green', get label() { return t('초록') }, color: { light: '#2e7d4f', dark: '#74cf98' } },
  { id: 'violet', get label() { return t('보라') }, color: { light: '#6247c2', dark: '#ab96f6' } },
  { id: 'rose', get label() { return t('장미') }, color: { light: '#b4386a', dark: '#f08db3' } },
  { id: 'amber', get label() { return t('호박') }, color: { light: '#a35d0c', dark: '#f0b55e' } },
]

export function parseThemePalette(value: unknown): ThemePalette {
  return THEME_PALETTES.some((palette) => palette.id === value) ? value as ThemePalette : DEFAULT_PALETTE
}

export function parseThemeAccent(value: unknown): ThemeAccent {
  return value === 'custom' || THEME_ACCENTS.some((accent) => accent.id === value) ? value as ThemeAccent : DEFAULT_ACCENT
}

function loadKey<T>(key: string, parse: (value: unknown) => T, fallback: T, storage: ThemeStorage | undefined): T {
  if (storage === undefined) return fallback
  try {
    return parse(storage.getItem(key))
  } catch {
    return fallback
  }
}

function saveKey(key: string, value: string, storage: ThemeStorage | undefined): void {
  if (storage === undefined) return
  try {
    storage.setItem(key, value)
  } catch {}
}

export function loadThemePalette(storage: ThemeStorage | undefined = browserStorage()): ThemePalette {
  return loadKey(PALETTE_STORAGE_KEY, parseThemePalette, DEFAULT_PALETTE, storage)
}

export function saveThemePalette(palette: ThemePalette, storage: ThemeStorage | undefined = browserStorage()): void {
  saveKey(PALETTE_STORAGE_KEY, parseThemePalette(palette), storage)
}

export function loadThemeAccent(storage: ThemeStorage | undefined = browserStorage()): ThemeAccent {
  return loadKey(ACCENT_STORAGE_KEY, parseThemeAccent, DEFAULT_ACCENT, storage)
}

export function saveThemeAccent(accent: ThemeAccent, storage: ThemeStorage | undefined = browserStorage()): void {
  saveKey(ACCENT_STORAGE_KEY, parseThemeAccent(accent), storage)
}

/**
 * 웨일 테마를 기본으로 바꾼 때(2026-10) 한 번만: 이전에 고른 색 구성·밝기·강조색을 웨일 어두운 테마로 옮긴다.
 * 그 뒤에 사용자가 고른 것은 그대로 둔다.
 */
export const WHALE_MIGRATION_KEY = 'iwae.theme.whale-default'
export function migrateToWhaleDefault(storage: ThemeStorage | undefined = browserStorage()): void {
  if (storage === undefined) return
  try {
    if (storage.getItem(WHALE_MIGRATION_KEY) !== null) return
    storage.setItem(PALETTE_STORAGE_KEY, 'whale')
    storage.setItem(THEME_STORAGE_KEY, 'dark')
    storage.setItem(ACCENT_STORAGE_KEY, 'auto')
    storage.setItem(WHALE_MIGRATION_KEY, '1')
  } catch {}
}
