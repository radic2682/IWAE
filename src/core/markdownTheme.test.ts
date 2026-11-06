import { describe, expect, it } from 'vitest'
import { getMarkdownTheme, MARKDOWN_THEMES } from './markdownTheme'

describe('markdown theme registry', () => {
  it.each(['light', 'dark', 'github', 'paper', 'focus', 'code'] as const)(
    'ships the %s markdown theme',
    (id) => {
      expect(getMarkdownTheme(id)).toMatchObject({ id })
    },
  )

  it('returns a complete token set for every theme', () => {
    for (const theme of MARKDOWN_THEMES) {
      expect(theme.tokens).toMatchObject({
        background: expect.any(String),
        foreground: expect.any(String),
        muted: expect.any(String),
        border: expect.any(String),
        link: expect.any(String),
        codeBackground: expect.any(String),
        quoteBorder: expect.any(String),
        maxWidth: expect.stringMatching(/px$/u),
      })
    }
  })
})
