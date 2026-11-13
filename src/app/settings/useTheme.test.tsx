// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThemeStorage } from '../../core/theme'
import { useTheme } from './useTheme'

class MemoryStorage implements ThemeStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

afterEach(() => {
  delete document.documentElement.dataset.theme
})

describe('useTheme', () => {
  it('시스템 설정이면 시스템 다크 모드를 적용하고 시스템 변경을 추적한다', () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined
    const media = {
      matches: true,
      addEventListener: vi.fn((_type: string, next: (event: MediaQueryListEvent) => void) => { listener = next }),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList
    const storage = new MemoryStorage()
    storage.setItem('iwae.theme.whale-default', '1')
    storage.setItem('iwae.theme.preference', 'system')
    const result = renderHook(() => useTheme({
      storage,
      matchMedia: () => media,
    }))

    expect(result.result.current.preference).toBe('system')
    expect(result.result.current.resolvedTheme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    act(() => listener?.({ matches: false } as MediaQueryListEvent))
    expect(result.result.current.resolvedTheme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('명시한 테마를 저장하고 시스템 변경보다 우선한다', () => {
    const storage = new MemoryStorage()
    const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList
    const result = renderHook(() => useTheme({ storage, matchMedia: () => media }))

    act(() => result.result.current.setPreference('dark'))

    expect(result.result.current.resolvedTheme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect([...storage.values.values()]).toContain('dark')
  })
})

describe('useTheme 색 구성·강조색', () => {
  it(':root 에 data-palette / data-accent 를 달고 기본값이면 뗀다', () => {
    const storage = new MemoryStorage()
    const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList
    const result = renderHook(() => useTheme({ storage, matchMedia: () => media }))

    act(() => result.result.current.setPalette('paper'))
    act(() => result.result.current.setAccent('rose'))
    expect(document.documentElement.dataset.palette).toBe('paper')
    expect(document.documentElement.dataset.accent).toBe('rose')
    expect([...storage.values.values()]).toEqual(expect.arrayContaining(['paper', 'rose']))

    act(() => result.result.current.setPalette('default'))
    act(() => result.result.current.setAccent('auto'))
    expect(document.documentElement.dataset.palette).toBeUndefined()
    expect(document.documentElement.dataset.accent).toBeUndefined()
  })
})
