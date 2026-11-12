import { describe, expect, it } from 'vitest'
import {
  emptySessionsMeta, findSessionName, parseSessionsMeta, relativeTimeText, removeFromMeta, renameInMeta, touchSessionMeta,
  uniqueSessionName, validateSessionName,
} from './sessionNames'

describe('세션 이름 검사', () => {
  it('앞뒤 빈칸을 자른 이름을 돌려준다', () => {
    expect(validateSessionName('  논문 3장  ', [])).toEqual({ ok: true, name: '논문 3장' })
  })

  it('비었거나 빈칸뿐이면 막는다', () => {
    expect(validateSessionName('', []).ok).toBe(false)
    expect(validateSessionName('   ', []).ok).toBe(false)
  })

  it('경로 구분자와 파일 이름에 못 쓰는 글자를 막는다', () => {
    for (const bad of ['a/b', 'a\\b', '..\\x', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\nb']) {
      expect(validateSessionName(bad, []).ok, bad).toBe(false)
    }
  })

  it('. 이나 _ 로 시작하는 이름(내부 파일 · 숨김)을 막는다', () => {
    expect(validateSessionName('.trash', []).ok).toBe(false)
    expect(validateSessionName('..', []).ok).toBe(false)
    expect(validateSessionName('_last', []).ok).toBe(false)
  })

  it('너무 긴 이름을 막는다', () => {
    expect(validateSessionName('가'.repeat(60), []).ok).toBe(true)
    expect(validateSessionName('가'.repeat(61), []).ok).toBe(false)
  })

  it('이미 있는 이름은 대소문자를 무시하고 막되, 자기 자신(이름 바꾸기)은 허용한다', () => {
    expect(validateSessionName('Draft', ['draft', '논문']).ok).toBe(false)
    expect(validateSessionName(' 논문 ', ['draft', '논문']).ok).toBe(false)
    expect(validateSessionName('Draft', ['draft', '논문'], 'draft')).toEqual({ ok: true, name: 'Draft' })
    expect(validateSessionName('논문', ['draft', '논문'], 'draft').ok).toBe(false)
  })

  it('겹치지 않는 이름을 만든다', () => {
    expect(uniqueSessionName('세션', [])).toBe('세션')
    expect(uniqueSessionName('세션', ['세션'])).toBe('세션 2')
    expect(uniqueSessionName('세션', ['세션', '세션 2', '세션 3'])).toBe('세션 4')
    expect(uniqueSessionName('  ', ['세션'])).toBe('세션 2')
  })

  it('이름으로 세션을 찾는다(대소문자 무시)', () => {
    expect(findSessionName(['Draft', '논문'], ' draft ')).toBe('Draft')
    expect(findSessionName(['Draft'], 'x')).toBeNull()
  })
})

describe('세션 메타(_last.json)', () => {
  it('읽을 수 없는 값은 빈 메타로 읽고, 쓸 만한 값만 남긴다', () => {
    expect(parseSessionsMeta(null)).toEqual(emptySessionsMeta)
    expect(parseSessionsMeta([])).toEqual(emptySessionsMeta)
    expect(parseSessionsMeta({ last: 5, used: 'x' })).toEqual({ last: null, used: {} })
    expect(parseSessionsMeta({ last: '논문', used: { 논문: 3, 나쁨: 'x', 무한: Infinity } })).toEqual({ last: '논문', used: { 논문: 3 } })
  })

  it('쓴 세션 적기 · 이름 바꾸기 · 지우기', () => {
    const touched = touchSessionMeta(emptySessionsMeta, '논문', 10)
    expect(touched).toEqual({ last: '논문', used: { 논문: 10 } })
    expect(renameInMeta(touched, '논문', '발표')).toEqual({ last: '발표', used: { 발표: 10 } })
    expect(renameInMeta(touchSessionMeta(touched, '기본', 20), '논문', '발표')).toEqual({ last: '기본', used: { 기본: 20, 발표: 10 } })
    expect(removeFromMeta(touched, '논문')).toEqual({ last: null, used: {} })
  })

  it('마지막 사용 시각을 짧은 말로 쓴다', () => {
    const now = 10_000_000
    expect(relativeTimeText(null, now)).toBe('')
    expect(relativeTimeText(now - 5_000, now)).toBe('방금')
    expect(relativeTimeText(now - 5 * 60_000, now)).toBe('5분 전')
    expect(relativeTimeText(now - 3 * 3_600_000, now)).toBe('3시간 전')
    expect(relativeTimeText(now - 2 * 86_400_000, now)).toBe('2일 전')
  })
})
