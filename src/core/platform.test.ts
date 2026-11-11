import { afterEach, describe, expect, it, vi } from 'vitest'
import { isMacPlatform, platformShortcut } from './platform'

describe('platformShortcut', () => {
  it('맥에서는 단축키를 ⌘·⇧·⌥ 기호로 바꾼다', () => {
    expect(platformShortcut('PDF 검색 (Ctrl+F)', true)).toBe('PDF 검색 (⌘F)')
    expect(platformShortcut('문서 검색 (Ctrl+Shift+F)', true)).toBe('문서 검색 (⇧⌘F)')
    expect(platformShortcut('(Ctrl+\ 로 차례로)', true)).toBe('(⌘\ 로 차례로)')
    expect(platformShortcut('Alt+← 뒤로', true)).toBe('⌥← 뒤로')
    expect(platformShortcut('Ctrl+,', true)).toBe('⌘,')
  })

  it('Windows 에서는 그대로 두고, 단축키가 없는 글은 건드리지 않는다', () => {
    expect(platformShortcut('인쇄 (Ctrl+P)', false)).toBe('인쇄 (Ctrl+P)')
    expect(platformShortcut('Control panel', true)).toBe('Control panel')
  })
})

describe('isMacPlatform', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('userAgent 가 바뀌면 다시 알아본다(같은 값이면 결과를 그대로 쓴다)', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel' })
    expect(isMacPlatform()).toBe(true)
    expect(isMacPlatform()).toBe(true)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32' })
    expect(isMacPlatform()).toBe(false)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel' })
    expect(isMacPlatform()).toBe(true)
  })

  it('단축키가 없는 글은 OS 를 알아보지 않고 그대로 돌려준다', () => {
    let reads = 0
    vi.stubGlobal('navigator', { get userAgent() { reads += 1; return 'Mozilla/5.0 (Macintosh)' }, platform: 'MacIntel' })
    expect(platformShortcut('메모를 쓰세요')).toBe('메모를 쓰세요')
    expect(reads).toBe(0)
    expect(platformShortcut('검색 (Ctrl+F)')).toBe('검색 (⌘F)')
  })
})
