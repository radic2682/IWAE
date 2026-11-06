import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  loadThemePreference,
  resolveTheme,
  saveThemePreference,
  type ThemeStorage,
} from './theme'

class MemoryStorage implements ThemeStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('theme preference', () => {
  it('시스템 설정은 OS 색상 선호를 따라간다', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('유효한 선택만 저장하고 잘못된 값은 시스템 설정으로 복구한다', () => {
    const storage = new MemoryStorage()
    saveThemePreference('dark', storage)
    expect(storage.values.get(THEME_STORAGE_KEY)).toBe('dark')
    expect(loadThemePreference(storage)).toBe('dark')

    storage.values.set(THEME_STORAGE_KEY, 'sepia')
    expect(loadThemePreference(storage)).toBe(DEFAULT_THEME_PREFERENCE)
  })
})

describe('색 구성·강조색', () => {
  it('알 수 없는 값은 기본값으로 읽고, 고른 값은 저장했다가 다시 읽는다', async () => {
    const { loadThemePalette, saveThemePalette, loadThemeAccent, saveThemeAccent, parseThemePalette, parseThemeAccent } = await import('./theme')
    const storage = new MemoryStorage()
    expect(loadThemePalette(storage)).toBe('whale')
    expect(loadThemeAccent(storage)).toBe('auto')
    saveThemePalette('navy', storage)
    saveThemeAccent('teal', storage)
    expect(loadThemePalette(storage)).toBe('navy')
    expect(loadThemeAccent(storage)).toBe('teal')
    expect(parseThemePalette('neon')).toBe('whale')
    expect(parseThemeAccent(42)).toBe('auto')
  })

  it('웨일 기본으로 한 번만 옮기고, 그 뒤 고른 것은 둔다', async () => {
    const { migrateToWhaleDefault, loadThemePalette, saveThemePalette } = await import('./theme')
    const storage = new MemoryStorage()
    storage.values.set('iwae.theme.palette', 'paper')
    storage.values.set(THEME_STORAGE_KEY, 'light')
    migrateToWhaleDefault(storage)
    expect(loadThemePalette(storage)).toBe('whale')
    expect(loadThemePreference(storage)).toBe('dark')
    saveThemePalette('navy', storage)
    migrateToWhaleDefault(storage)
    expect(loadThemePalette(storage)).toBe('navy')
  })
})
