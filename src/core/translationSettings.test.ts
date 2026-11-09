import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRANSLATION_SETTINGS,
  FIRST_RUN_TRANSLATION_SETTINGS,
  TRANSLATION_SETTINGS_KEY,
  loadTranslationSettings,
  parseTranslationSettings,
  saveTranslationSettings,
  type TranslationSettings,
  type TranslationSettingsStorage,
} from './translationSettings'

class MemoryStorage implements TranslationSettingsStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('parseTranslationSettings', () => {
  it('잘못된 저장값은 자동·한국어 기본값으로 복구한다', () => {
    expect(parseTranslationSettings({ mode: 'unknown' })).toEqual({
      enabled: true,
      executionMode: 'auto',
      mode: 'auto',
      targetLanguage: 'ko',
      endpoint: 'http://127.0.0.1:11434',
      customModel: '',
      externalEndpoint: 'https://api.anthropic.com',
      externalProvider: 'anthropic',
      externalModel: 'claude-opus-5-5',
    })
  })

  it.each(['auto', 'cpu', 'gpu', 'external-api'] as const)('%s 실행 모드를 보존한다', (executionMode) => {
    expect(parseTranslationSettings({
      ...DEFAULT_TRANSLATION_SETTINGS,
      executionMode,
    }).executionMode).toBe(executionMode)
  })

  it('구버전 저장값에는 자동 실행 모드를 추가한다', () => {
    expect(parseTranslationSettings({
      mode: '4b',
      targetLanguage: 'ko',
      endpoint: 'http://127.0.0.1:11434',
      customModel: '',
    })).toEqual({
      ...DEFAULT_TRANSLATION_SETTINGS,
      mode: '4b',
    })
  })

  it.each(['auto', '4b', '12b', '27b'] as const)('%s 모드를 보존한다', (mode) => {
    expect(parseTranslationSettings({
      ...DEFAULT_TRANSLATION_SETTINGS,
      mode,
    }).mode).toBe(mode)
  })

  it('사용자 지정 모델을 보존하고 앞뒤 공백을 제거한다', () => {
    expect(parseTranslationSettings({
      executionMode: 'gpu',
      mode: 'custom',
      targetLanguage: 'ja',
      endpoint: 'https://ollama.lan:11434',
      customModel: '  my-translator:v2  ',
    })).toEqual({
      enabled: true,
      executionMode: 'gpu',
      mode: 'custom',
      targetLanguage: 'ja',
      endpoint: 'https://ollama.lan:11434',
      customModel: 'my-translator:v2',
      externalEndpoint: 'https://api.anthropic.com',
      externalProvider: 'anthropic',
      externalModel: 'claude-opus-5-5',
    })
  })

  it.each([
    'ftp://127.0.0.1:11434',
    'file:///tmp/ollama.sock',
    'not a url',
    '',
  ])('http 또는 https가 아닌 endpoint %s를 기본값으로 복구한다', (endpoint) => {
    expect(parseTranslationSettings({
      ...DEFAULT_TRANSLATION_SETTINGS,
      endpoint,
    }).endpoint).toBe(DEFAULT_TRANSLATION_SETTINGS.endpoint)
  })

  it('유효한 필드만 복구하고 설정 외 데이터는 버린다', () => {
    expect(parseTranslationSettings({
      executionMode: 'cpu',
      mode: '12b',
      targetLanguage: '  en  ',
      endpoint: 'http://192.168.0.20:11434/path',
      customModel: 42,
      pdfText: 'secret PDF text',
      prompt: 'hidden prompt',
      translatedText: 'stored translation',
    })).toEqual({
      enabled: true,
      executionMode: 'cpu',
      mode: '12b',
      targetLanguage: 'en',
      endpoint: 'http://192.168.0.20:11434/path',
      customModel: '',
      externalEndpoint: 'https://api.anthropic.com',
      externalProvider: 'anthropic',
      externalModel: 'claude-opus-5-5',
    })
  })

  it('외부 API endpoint와 모델만 정규화하고 API key는 설정에서 버린다', () => {
    expect(parseTranslationSettings({
      ...DEFAULT_TRANSLATION_SETTINGS,
      executionMode: 'external-api',
      externalEndpoint: '  https://gateway.example.test/v1  ',
      externalProvider: 'compatible',
      externalModel: '  translator-small  ',
      externalApiKey: 'must-not-persist',
    })).toEqual({
      ...DEFAULT_TRANSLATION_SETTINGS,
      executionMode: 'external-api',
      externalEndpoint: 'https://gateway.example.test/v1',
      externalProvider: 'compatible',
      externalModel: 'translator-small',
    })
  })
})

describe('translation settings persistence', () => {
  it('고정된 v1 키로 설정만 저장하고 다시 불러온다', () => {
    const storage = new MemoryStorage()
    const settings: TranslationSettings = {
      enabled: true,
      executionMode: 'external-api',
      mode: 'custom',
      targetLanguage: 'de',
      endpoint: 'https://ollama.example.test',
      customModel: 'translator:latest',
      externalEndpoint: 'https://gateway.example.test/v1',
      externalProvider: 'compatible',
      externalModel: 'translator-small',
    }

    saveTranslationSettings(settings, storage)

    expect(TRANSLATION_SETTINGS_KEY).toBe('iwae:translation-settings:v1')
    expect([...storage.values.keys()]).toEqual([TRANSLATION_SETTINGS_KEY])
    expect(JSON.parse(storage.values.get(TRANSLATION_SETTINGS_KEY)!)).toEqual(settings)
    expect(loadTranslationSettings(storage)).toEqual(settings)
  })

  it('저장된 JSON이 없으면 처음 기본값(Google 번역), 손상됐으면 기본값을 반환한다', () => {
    const empty = new MemoryStorage()
    const malformed = new MemoryStorage()
    malformed.values.set(TRANSLATION_SETTINGS_KEY, '{invalid')

    expect(loadTranslationSettings(empty)).toEqual(FIRST_RUN_TRANSLATION_SETTINGS)
    expect(loadTranslationSettings(empty).externalProvider).toBe('google')
    expect(loadTranslationSettings(malformed)).toEqual(DEFAULT_TRANSLATION_SETTINGS)
  })

  it('저장 시에도 검증해 PDF 본문·prompt·번역문을 영속화하지 않는다', () => {
    const storage = new MemoryStorage()
    const unsafe = {
      ...DEFAULT_TRANSLATION_SETTINGS,
      pdfText: 'source',
      prompt: 'translate this',
      translatedText: 'result',
    }

    saveTranslationSettings(unsafe, storage)

    const saved = storage.values.get(TRANSLATION_SETTINGS_KEY)!
    expect(saved).not.toContain('source')
    expect(saved).not.toContain('translate this')
    expect(saved).not.toContain('result')
    expect(saved).not.toContain('externalApiKey')
    expect(JSON.parse(saved)).toEqual(DEFAULT_TRANSLATION_SETTINGS)
  })
  it('예전 설정(제공자 없이 주소만 있음)은 OpenAI 호환으로 읽는다', () => {
    const parsed = parseTranslationSettings({ executionMode: 'external-api', externalEndpoint: 'https://gateway.example.test/v1', externalModel: 'm' })
    expect(parsed.externalProvider).toBe('compatible')
    expect(parsed.externalModel).toBe('m')
  })
})
