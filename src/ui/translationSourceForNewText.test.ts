// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { AUTO_SOURCE, getTranslationSource, setTranslationSource, sourceForNewText } from './translationPair'

describe('sourceForNewText', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setTranslationSource(AUTO_SOURCE)
  })

  it('자동 감지면 원문 언어를 넘기지 않는다', () => {
    expect(sourceForNewText('안녕하세요 반갑습니다', AUTO_SOURCE)).toBeUndefined()
    expect(sourceForNewText('안녕하세요 반갑습니다', undefined)).toBeUndefined()
  })

  it('기억한 원문 언어가 글과 맞으면 그대로 쓴다', () => {
    setTranslationSource('en')
    expect(sourceForNewText('hello world, this is a test', 'en')).toBe('en')
    expect(getTranslationSource()).toBe('en')
  })

  it('기억한 원문 언어가 글과 다르면(한국어 글인데 English) 자동 감지로 돌리고 기억도 지운다', () => {
    setTranslationSource('en')
    expect(sourceForNewText('글이 아닌 것, 곧 표와 그림은 영역 캡처로', 'en')).toBeUndefined()
    expect(getTranslationSource()).toBe(AUTO_SOURCE)
  })

  it('글로 언어를 어림할 수 없으면 기억한 언어를 그대로 쓴다', () => {
    setTranslationSource('ja')
    expect(sourceForNewText('12345 !!!', 'ja')).toBe('ja')
  })
})
