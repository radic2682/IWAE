import { afterEach, describe, expect, it } from 'vitest'
import { EN } from './en'
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
})
