import { describe, expect, it } from 'vitest'
import { guessLanguage, normalizeSelectionText, sameLanguageFallback } from './translationText'

describe('normalizeSelectionText', () => {
  it('joins wrapped lines with a space and keeps paragraph breaks', () => {
    expect(normalizeSelectionText('recalled more pairs than\nthose who stayed awake.\n\nSecond  paragraph\r\nhere.')).toBe('recalled more pairs than those who stayed awake.\n\nSecond paragraph here.')
  })
  it('de-hyphenates Latin words split at line ends only', () => {
    expect(normalizeSelectionText('consoli-\ndation matters')).toBe('consolidation matters')
    expect(normalizeSelectionText('2020-\n2021 and 한-\n글')).toBe('2020- 2021 and 한- 글')
  })
  it('joins CJK lines without a space', () => {
    expect(normalizeSelectionText('これは\n文です')).toBe('これは文です')
    expect(normalizeSelectionText('学习\n记忆')).toBe('学习记忆')
    expect(normalizeSelectionText('한국어 문장\n다음 줄')).toBe('한국어 문장 다음 줄')
  })
  it('collapses whitespace and trims', () => {
    expect(normalizeSelectionText('  a \t b \n\n\n\n c  ')).toBe('a b\n\nc')
  })
})

describe('sameLanguageFallback', () => {
  it('picks a different language only when source equals target', () => {
    expect(guessLanguage('이번 주에 읽은 논문')).toBe('ko')
    expect(sameLanguageFallback('이번 주에 읽은 논문', 'ko')).toBe('en')
    expect(sameLanguageFallback('This is English text', 'en')).toBe('ko')
    expect(sameLanguageFallback('This is English text', 'ko')).toBeNull()
    expect(sameLanguageFallback('12345', 'ko')).toBeNull()
  })
})
