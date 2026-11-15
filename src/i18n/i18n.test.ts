import { afterEach, describe, expect, it } from 'vitest'
import { EN } from './en'
import { addHighlightColor, colorNameOrDefault, DEFAULT_HIGHLIGHT_COLORS, highlightColorDisplayName } from '../core/highlightColors'
import { getLocale, resolveLocale, setLocale, t } from './index'

describe('i18n', () => {
  afterEach(() => setLocale('ko'))

  it('한국어는 그대로, 영어는 사전에서, 없는 말은 한국어로', () => {
    setLocale('ko')
    expect(t('설정')).toBe('설정')
    setLocale('en')
    expect(getLocale()).toBe('en')
    expect(t('설정')).toBe('Settings')
    expect(t('사전에 없는 말')).toBe('사전에 없는 말')
  })

  it('{이름} 자리를 채운다', () => {
    setLocale('ko')
    expect(t('{count}개', { count: 3 })).toBe('3개')
  })

  it('고른 값 → 설치 언어 → 시스템 언어 차례로 정한다', () => {
    expect(resolveLocale('en', 'ko')).toBe('en')
    expect(resolveLocale(null, 'ko')).toBe('ko')
    expect(['ko', 'en']).toContain(resolveLocale(null, null))
  })

  it('영어 사전에 빈 번역이 없다', () => {
    for (const [korean, english] of Object.entries(EN)) {
      expect(english.trim(), korean).not.toBe('')
    }
  })

  it('영어에서는 개수가 1 이면 단수로 쓴다', () => {
    setLocale('en')
    expect(t('{count}개 항목을 옮겼습니다.', { count: 1 })).toBe('Moved 1 item.')
    expect(t('{count}개 항목을 옮겼습니다.', { count: 3 })).toBe('Moved 3 items.')
    expect(t('{count}개 항목을 옮겼습니다.', { count: 0 })).toBe('Moved 0 items.')
    setLocale('ko')
    expect(t('{count}개 항목을 옮겼습니다.', { count: 1 })).toBe('1개 항목을 옮겼습니다.')
  })

  it('영어 사전의 단수·복수 표시가 모두 짝이 맞는 변수를 쓴다', () => {
    for (const [korean, english] of Object.entries(EN)) {
      for (const match of english.matchAll(/\{(\w+)\|[^|{}]*\|[^|{}]*\}/gu)) {
        expect(korean, korean).toContain(`{${match[1]}}`)
      }
    }
  })

  it('테마·색 이름의 한국어가 영어 화면에 남지 않는다', () => {
    setLocale('en')
    expect(t('패널 위 글자가 읽기 어려울 수 있어요')).not.toMatch(/[가-힣]/u)
    expect(t('내 테마는 {max}개까지 둘 수 있습니다. 안 쓰는 테마를 지운 뒤 다시 해 주세요.', { max: 24 })).toContain('24 themes')
    const added = addHighlightColor(DEFAULT_HIGHLIGHT_COLORS, '#123456', () => 0.5)
    expect(highlightColorDisplayName(added.at(-1)!)).toBe('New color')
    expect(colorNameOrDefault('  ')).toBe('Color')
  })
})
