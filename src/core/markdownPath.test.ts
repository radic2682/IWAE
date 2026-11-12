import { describe, expect, it } from 'vitest'
import { isMarkdownPath } from './markdownPath'

describe('isMarkdownPath', () => {
  it('확장자가 .md · .markdown 인 이름만 Markdown 이다(대소문자 무시)', () => {
    expect(isMarkdownPath('notes/a.md')).toBe(true)
    expect(isMarkdownPath('A.MD')).toBe(true)
    expect(isMarkdownPath('guide.markdown')).toBe(true)
  })

  it('점 없이 md 로 끝나는 이름(notes/cmd · readmemd)은 Markdown 이 아니다', () => {
    expect(isMarkdownPath('notes/cmd')).toBe(false)
    expect(isMarkdownPath('readmemd')).toBe(false)
    expect(isMarkdownPath('notes/xmarkdown')).toBe(false)
    expect(isMarkdownPath('a.mdx')).toBe(false)
    expect(isMarkdownPath('a.md.bak')).toBe(false)
  })
})
