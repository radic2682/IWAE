import { describe, expect, it } from 'vitest'
import { platformShortcut } from './platform'

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
