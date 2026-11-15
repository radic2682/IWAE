import { describe, expect, it } from 'vitest'
import { findTranslation, parseTranslationCache, serializeTranslationCache, translationCacheKey } from './translationCache'

const entry = (translated: string) => ({ source: 'a b', translated, target: 'ko', provider: 'azure', at: '2026-11-10T00:00:00Z' })

describe('findTranslation', () => {
  const make = (source: string, translated: string, target: string) => ({ key: translationCacheKey(source, target, 'azure'), source, translated, target, provider: 'azure', at: 'x' })
  it('ignores an entry where the source language equals the target and nothing changed', () => {
    expect(findTranslation([make('안녕하세요 반갑습니다', '안녕하세요 반갑습니다', 'ko')], '안녕하세요 반갑습니다', 'ko', 'azure')).toBeUndefined()
  })
  it('still returns a real translation', () => {
    expect(findTranslation([make('안녕하세요 반갑습니다', 'Hello, nice to meet you', 'en')], '안녕하세요 반갑습니다', 'en', 'azure')?.translated).toBe('Hello, nice to meet you')
  })
})

describe('parseTranslationCache', () => {
  it('drops version 1 entries whose translation was split across lines', () => {
    const parsed = parseTranslationCache({ version: 1, entries: [entry('첫 줄\n둘째 줄'), { ...entry('한 줄'), source: 'c' }] })
    expect(parsed.map((item) => item.translated)).toEqual(['한 줄'])
  })

  it('keeps multi-line translations written by version 2', () => {
    const parsed = parseTranslationCache({ version: 2, entries: [entry('문단 하나\n\n문단 둘')] })
    expect(parsed).toHaveLength(1)
  })

  it('round-trips through serialize as version 2', () => {
    const text = serializeTranslationCache(parseTranslationCache({ version: 2, entries: [entry('가\n나')] }))
    expect(parseTranslationCache(JSON.parse(text))).toHaveLength(1)
  })
})
