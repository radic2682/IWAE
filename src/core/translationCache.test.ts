import { describe, expect, it } from 'vitest'
import { parseTranslationCache, serializeTranslationCache } from './translationCache'

const entry = (translated: string) => ({ source: 'a b', translated, target: 'ko', provider: 'azure', at: '2026-11-10T00:00:00Z' })

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
