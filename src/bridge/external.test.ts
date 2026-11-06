// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { externalLinkHost, isOpenableUrl } from './external'

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  vi.resetModules()
})

describe('external links', () => {
  it('accepts only web and mail addresses', () => {
    expect(isOpenableUrl('https://doi.org/10.1/x')).toBe(true)
    expect(isOpenableUrl('http://example.com')).toBe(true)
    expect(isOpenableUrl('mailto:me@example.com')).toBe(true)
    expect(isOpenableUrl('javascript:alert(1)')).toBe(false)
    expect(isOpenableUrl('file:///C:/x.exe')).toBe(false)
    expect(isOpenableUrl('not a url')).toBe(false)
  })

  it('names the host to show in the confirmation', () => {
    expect(externalLinkHost('https://www.nature.com/articles/x')).toBe('www.nature.com')
    expect(externalLinkHost('mailto:me@example.com')).toBe('me@example.com')
  })

  it('opens through the opener plugin and refuses unsafe schemes', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const openUrl = vi.fn().mockResolvedValue(undefined)
    vi.doMock('@tauri-apps/plugin-opener', () => ({ openUrl }))
    const { openExternalUrl } = await import('./external')
    // resetModules 뒤의 새 i18n 모듈은 시스템 언어(영어)로 시작한다. 한국어로 맞춘다
    ;(await import('../i18n')).setLocale('ko')

    await openExternalUrl('https://example.com/a')
    expect(openUrl).toHaveBeenCalledWith('https://example.com/a')
    await expect(openExternalUrl('javascript:alert(1)')).rejects.toThrow('열 수 없는 주소')
    expect(openUrl).toHaveBeenCalledTimes(1)
  })
})
