// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThemeStorage } from '../core/theme'
import { BUILTIN_SEEDS, themeFromPalette } from '../core/userTheme'
import { useTheme } from './useTheme'
import {
  ACTIVE_KEY,
  CUSTOM_ACCENT_KEY,
  THEMES_KEY,
  deleteUserTheme,
  getUserThemeState,
  parseStoredThemes,
  reloadUserThemesForTest,
  saveUserTheme,
  setActiveUserTheme,
  setCustomAccent,
  setThemeDraft,
} from './userThemeStore'

class MemoryStorage implements ThemeStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

const media = () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList

beforeEach(() => {
  window.localStorage.clear()
  reloadUserThemesForTest()
})
afterEach(() => {
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.palette
  delete document.documentElement.dataset.accent
  document.documentElement.removeAttribute('style')
})

describe('userThemeStore', () => {
  it('저장·쓰기·지우기가 localStorage 에 남는다', () => {
    const theme = themeFromPalette('whale', '숲')
    saveUserTheme(theme, { activate: true })
    expect(getUserThemeState().activeId).toBe(theme.id)
    expect(parseStoredThemes(window.localStorage.getItem(THEMES_KEY))).toHaveLength(1)
    expect(window.localStorage.getItem(ACTIVE_KEY)).toBe(theme.id)

    expect(deleteUserTheme(theme.id)).toBe(true)
    expect(getUserThemeState().themes).toHaveLength(0)
    expect(getUserThemeState().activeId).toBeNull()
    expect(window.localStorage.getItem(ACTIVE_KEY)).toBeNull()
  })

  it('다른 창의 변경(storage 이벤트)을 따라간다', () => {
    const theme = themeFromPalette('navy', '다른 창')
    window.localStorage.setItem(THEMES_KEY, JSON.stringify([theme]))
    window.localStorage.setItem(ACTIVE_KEY, theme.id)
    window.localStorage.setItem(CUSTOM_ACCENT_KEY, '#123456')
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: THEMES_KEY })) })
    expect(getUserThemeState().themes.map((item) => item.name)).toEqual(['다른 창'])
    expect(getUserThemeState().activeId).toBe(theme.id)
    expect(getUserThemeState().customAccent).toBe('#123456')
  })

  it('깨진 저장값은 버린다', () => {
    expect(parseStoredThemes('{"a":1}')).toEqual([])
    expect(parseStoredThemes('nope')).toEqual([])
    const good = themeFromPalette('whale', '좋음')
    expect(parseStoredThemes(JSON.stringify([good, { ...good, id: 'x', dark: { ...good.dark, accent: 'red' } }]))).toHaveLength(1)
  })

  it('잘못된 hex 는 강조색으로 받지 않는다', () => {
    setCustomAccent('#FF8A5C')
    setCustomAccent('nope')
    expect(getUserThemeState().customAccent).toBe('#ff8a5c')
  })
})

describe('useTheme + 사용자 테마', () => {
  it('고른 사용자 테마의 시드를 :root 변수로 덮고, 내장 팔레트로 돌아가면 걷는다', () => {
    const storage = new MemoryStorage()
    storage.setItem('iwae.theme.whale-default', '1')
    storage.setItem('iwae.theme.preference', 'dark')
    const { result } = renderHook(() => useTheme({ storage, matchMedia: () => media() }))
    const theme = { ...themeFromPalette('whale', '숲'), dark: { ...BUILTIN_SEEDS.whale.dark, workspace: '#1b221e', accent: '#7fd6a4' } }
    act(() => saveUserTheme(theme, { activate: true }))
    const root = document.documentElement
    expect(root.style.getPropertyValue('--workspace')).toBe('#1b221e')
    expect(root.style.getPropertyValue('--accent')).toBe('#7fd6a4')
    expect(root.dataset.palette).toBe('whale')

    act(() => result.current.setPalette('navy'))
    expect(root.style.getPropertyValue('--workspace')).toBe('')
    expect(root.dataset.palette).toBe('navy')
  })

  it('직접 고른 강조색은 프리셋 속성 대신 인라인 변수로 적용된다', () => {
    const storage = new MemoryStorage()
    storage.setItem('iwae.theme.whale-default', '1')
    storage.setItem('iwae.theme.preference', 'dark')
    const { result } = renderHook(() => useTheme({ storage, matchMedia: () => media() }))
    act(() => { setCustomAccent('#ff8a5c'); result.current.setAccent('custom') })
    const root = document.documentElement
    expect(root.dataset.accent).toBeUndefined()
    expect(root.style.getPropertyValue('--accent')).toBe('#ff8a5c')
    expect(root.style.getPropertyValue('--selection')).toMatch(/66$/)
    act(() => result.current.setAccent('teal'))
    expect(root.dataset.accent).toBe('teal')
    expect(root.style.getPropertyValue('--accent')).toBe('')
  })

  it('편집 중 draft 는 저장 없이 앱에 비치고 비우면 되돌아간다', () => {
    const storage = new MemoryStorage()
    storage.setItem('iwae.theme.whale-default', '1')
    storage.setItem('iwae.theme.preference', 'dark')
    renderHook(() => useTheme({ storage, matchMedia: () => media() }))
    const draft = { ...themeFromPalette('whale', '임시'), dark: { ...BUILTIN_SEEDS.whale.dark, workspace: '#102030' } }
    act(() => setThemeDraft(draft))
    expect(document.documentElement.style.getPropertyValue('--workspace')).toBe('#102030')
    expect(window.localStorage.getItem(THEMES_KEY)).toBeNull()
    act(() => setThemeDraft(null))
    expect(document.documentElement.style.getPropertyValue('--workspace')).toBe('')
  })

  it('setActiveUserTheme(null) 은 내장 색 구성으로', () => {
    const theme = themeFromPalette('whale', '숲')
    saveUserTheme(theme, { activate: true })
    setActiveUserTheme(null)
    expect(getUserThemeState().activeId).toBeNull()
  })
})
