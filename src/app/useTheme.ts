import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  loadThemeAccent,
  loadThemePalette,
  loadThemePreference,
  resolveTheme,
  saveThemeAccent,
  saveThemePalette,
  saveThemePreference,
  type ResolvedTheme,
  type ThemeAccent,
  type ThemePalette,
  type ThemePreference,
  type ThemeStorage,
  migrateToWhaleDefault,
  ACCENT_STORAGE_KEY,
  PALETTE_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from '../core/theme'
import { deriveAccentVars, deriveThemeVars, resolvePanelColor, type UserTheme } from '../core/userTheme'
import { findUserTheme, setActiveUserTheme, useUserThemes } from './userThemeStore'
import '../ui/user-theme.css'

interface UseThemeOptions {
  readonly storage?: ThemeStorage
  readonly matchMedia?: (query: string) => MediaQueryList
}

export interface ThemeState {
  readonly preference: ThemePreference
  readonly resolvedTheme: ResolvedTheme
  readonly setPreference: (preference: ThemePreference) => void
  readonly palette: ThemePalette
  readonly setPalette: (palette: ThemePalette) => void
  readonly accent: ThemeAccent
  readonly setAccent: (accent: ThemeAccent) => void
}

let switchingTimer: ReturnType<typeof setTimeout> | undefined

/** 사용자가 테마를 바꾼 순간에만 색 전환을 부드럽게 한다(app-themes.css 의 .theme-switching). */
function markThemeSwitching(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.add('theme-switching')
  if (switchingTimer !== undefined) clearTimeout(switchingTimer)
  switchingTimer = setTimeout(() => root.classList.remove('theme-switching'), 260)
}

/** 사용자 테마·직접 고른 강조색이 :root 인라인 변수로 덮은 이름들(다음 적용 때 안 쓰는 것은 걷어 낸다) */
let appliedVars = new Set<string>()

function applyInlineVars(root: HTMLElement, vars: Record<string, string>): void {
  for (const key of appliedVars) if (!(key in vars)) root.style.removeProperty(key)
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
  appliedVars = new Set(Object.keys(vars))
}

function browserMatchMedia(query: string): MediaQueryList | null {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? null
    : window.matchMedia(query)
}

/**
 * 앱 테마. 밝기(data-theme)·색 구성(data-palette)·강조색(data-accent)을 :root 에 달면
 * tokens.css / app-themes.css 의 CSS 변수가 바뀌어 앱 전체가 바로 따라온다.
 */
export function useTheme(options: UseThemeOptions = {}): ThemeState {
  const { storage, matchMedia } = options
  const media = useMemo(
    () => matchMedia?.('(prefers-color-scheme: dark)') ?? browserMatchMedia('(prefers-color-scheme: dark)'),
    [matchMedia],
  )
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    migrateToWhaleDefault(storage)
    return loadThemePreference(storage)
  })
  const [palette, setPaletteState] = useState<ThemePalette>(() => loadThemePalette(storage))
  const [accent, setAccentState] = useState<ThemeAccent>(() => loadThemeAccent(storage))
  const [systemPrefersDark, setSystemPrefersDark] = useState(media?.matches ?? false)
  const resolvedTheme = resolveTheme(preference, systemPrefersDark)
  const userThemes = useUserThemes()
  const activeTheme: UserTheme | null = userThemes.draft ?? findUserTheme(userThemes, userThemes.activeId)
  const basePalette: ThemePalette = activeTheme?.base ?? palette
  const customAccent = userThemes.customAccent

  useEffect(() => {
    if (preference !== 'system' || media === null) return
    setSystemPrefersDark(media.matches)
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [media, preference])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  useEffect(() => {
    const root = document.documentElement
    if (basePalette === 'default') delete root.dataset.palette
    else root.dataset.palette = basePalette
  }, [basePalette])

  useEffect(() => {
    const root = document.documentElement
    if (accent === 'auto' || accent === 'custom') delete root.dataset.accent
    else root.dataset.accent = accent
  }, [accent])

  // 사용자 지정 테마(시드 8개에서 계산한 값)와 직접 고른 강조색을 :root 인라인 변수로 덮는다
  useEffect(() => {
    const vars: Record<string, string> = {}
    if (activeTheme !== null) Object.assign(vars, deriveThemeVars(activeTheme[resolvedTheme], resolvedTheme))
    if (accent === 'custom') {
      Object.assign(vars, deriveAccentVars(customAccent, resolvedTheme, resolvePanelColor(basePalette, activeTheme, resolvedTheme)))
    }
    applyInlineVars(document.documentElement, vars)
  }, [activeTheme, accent, customAccent, resolvedTheme, basePalette])

  // 다른 창에서 바꾼 밝기·색 구성·강조색을 바로 따라간다
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) setPreferenceState(loadThemePreference(storage))
      else if (event.key === PALETTE_STORAGE_KEY) setPaletteState(loadThemePalette(storage))
      else if (event.key === ACCENT_STORAGE_KEY) setAccentState(loadThemeAccent(storage))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [storage])

  const setPreference = useCallback((next: ThemePreference) => {
    markThemeSwitching()
    setPreferenceState(next)
    saveThemePreference(next, storage)
  }, [storage])

  const setPalette = useCallback((next: ThemePalette) => {
    markThemeSwitching()
    setActiveUserTheme(null)
    setPaletteState(next)
    saveThemePalette(next, storage)
  }, [storage])

  const setAccent = useCallback((next: ThemeAccent) => {
    markThemeSwitching()
    setAccentState(next)
    saveThemeAccent(next, storage)
  }, [storage])

  return { preference, resolvedTheme, setPreference, palette, setPalette, accent, setAccent }
}
