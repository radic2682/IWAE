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
} from '../core/theme'

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
    if (palette === 'default') delete root.dataset.palette
    else root.dataset.palette = palette
  }, [palette])

  useEffect(() => {
    const root = document.documentElement
    if (accent === 'auto') delete root.dataset.accent
    else root.dataset.accent = accent
  }, [accent])

  const setPreference = useCallback((next: ThemePreference) => {
    markThemeSwitching()
    setPreferenceState(next)
    saveThemePreference(next, storage)
  }, [storage])

  const setPalette = useCallback((next: ThemePalette) => {
    markThemeSwitching()
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
