import { describe, expect, it } from 'vitest'
import { explainTranslationError, isTranslationNotConfigured } from './translationErrors'
import { deeplEndpointForKey } from './translationSettings'

describe('explainTranslationError', () => {
  it('키·한도·연결 문제를 나눠 푼다', () => {
    expect(explainTranslationError('외부 번역 API 요청에 실패했습니다 (HTTP 403): Forbidden', false).kind).toBe('key')
    expect(explainTranslationError('External translation API request failed (HTTP 401): x', false).kind).toBe('key')
    expect(explainTranslationError('외부 번역 API 요청에 실패했습니다 (HTTP 456): Quota exceeded', false).kind).toBe('quota')
    expect(explainTranslationError('외부 번역 API에 연결할 수 없습니다. endpoint를 확인하세요.', false).kind).toBe('network')
    expect(explainTranslationError('Ollama에 연결할 수 없습니다.', true).kind).toBe('local')
    expect(explainTranslationError('뭔가 이상함', false)).toEqual({ kind: 'other', text: '뭔가 이상함' })
  })
  it('설정 부족 오류를 알아본다', () => {
    expect(isTranslationNotConfigured('API key를 입력하세요.')).toBe(true)
    expect(isTranslationNotConfigured('외부 번역 API 요청에 실패했습니다 (HTTP 401): invalid API key')).toBe(false)
  })
})

describe('deeplEndpointForKey', () => {
  it('키 종류에 맞는 주소로 맞춘다', () => {
    expect(deeplEndpointForKey('https://api-free.deepl.com', 'abc:fx')).toBe('https://api-free.deepl.com')
    expect(deeplEndpointForKey('https://api-free.deepl.com', 'abc')).toBe('https://api.deepl.com')
    expect(deeplEndpointForKey('https://api.deepl.com', 'abc:fx')).toBe('https://api-free.deepl.com')
    expect(deeplEndpointForKey('https://proxy.example.com', 'abc')).toBe('https://proxy.example.com')
  })
})
