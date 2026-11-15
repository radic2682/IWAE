import { describe, expect, it } from 'vitest'
import { parseFileLink, pdfPageFromFragment, safeDecodeURI } from './vaultFileLink'

describe('parseFileLink', () => {
  it('경로의 %23 은 #, 진짜 # 는 조각을 연다', () => {
    expect(parseFileLink('file:///C:/Users/me/C%23%20%EA%B3%B5%EB%B6%80/Vault/C%23%20notes.md')).toEqual({ path: 'C:/Users/me/C# 공부/Vault/C# notes.md', fragment: '' })
    expect(parseFileLink('file:///C:/Vault/a.pdf#page=3')).toEqual({ path: 'C:/Vault/a.pdf', fragment: 'page=3' })
  })

  it('깨진 퍼센트 부호가 있어도 던지지 않는다', () => {
    expect(parseFileLink('file:///C:/Vault/50%.pdf').path).toBe('C:/Vault/50%.pdf')
    expect(safeDecodeURI('%E0%A4%A')).toBe('%E0%A4%A')
  })

  it('맥 절대 경로의 맨 앞 슬래시를 지키고 드라이브 경로에는 붙이지 않는다', () => {
    expect(parseFileLink('file:///Users/me/a.pdf').path).toBe('/Users/me/a.pdf')
    expect(parseFileLink('file:///c:/x/a.pdf').path).toBe('c:/x/a.pdf')
  })
})

describe('pdfPageFromFragment', () => {
  it('page=N 에서 쪽을 읽는다', () => {
    expect(pdfPageFromFragment('page=12')).toBe(12)
    expect(pdfPageFromFragment('#page=2&zoom=100')).toBe(2)
    expect(pdfPageFromFragment('page=0')).toBeNull()
    expect(pdfPageFromFragment('section')).toBeNull()
    expect(pdfPageFromFragment(null)).toBeNull()
  })
})
