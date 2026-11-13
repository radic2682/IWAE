// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RECOMMENDED_TRANSLATION_MODELS,
  type BenchmarkResult,
  type TranslationModel,
  type TranslationProvider,
  type TranslationResult,
} from '../../core/translation'
import {
  TRANSLATION_SETTINGS_KEY,
  saveTranslationSettings,
  type TranslationSettings,
  type TranslationSettingsStorage,
} from '../../core/translationSettings'
import { useTranslation } from './useTranslation'

// 이 테스트들은 로컬(Ollama) 자동 모드를 다룬다. 처음 기본값(Google 번역)이 아니라 로컬로 시작한다
class MemoryStorage implements TranslationSettingsStorage {
  readonly values = new Map<string, string>([[TRANSLATION_SETTINGS_KEY, JSON.stringify({ executionMode: 'auto', externalProvider: 'compatible', externalEndpoint: 'https://api.openai.com/v1', externalModel: '' })]])

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function model(mode: '4b' | '12b' | '27b'): TranslationModel {
  return {
    name: RECOMMENDED_TRANSLATION_MODELS[mode],
    digest: `sha-${mode}`,
    size: Number.parseInt(mode, 10),
  }
}

function benchmark(candidate: TranslationModel, elapsedMs: number, success = true): BenchmarkResult {
  return { model: candidate, elapsedMs, success }
}

function translation(text = '번역됨'): TranslationResult {
  return { translatedText: text, model: RECOMMENDED_TRANSLATION_MODELS['4b'], elapsedMs: 300 }
}

function deferred<Value>(): {
  promise: Promise<Value>
  resolve: (value: Value) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function provider(overrides: Partial<TranslationProvider> = {}): TranslationProvider {
  return {
    status: vi.fn().mockResolvedValue({ available: true, version: '0.12.0', deviceKey: 'cpu:test' }),
    listModels: vi.fn().mockResolvedValue([model('4b'), model('12b')]),
    pullModel: vi.fn().mockResolvedValue(undefined),
    benchmark: vi.fn()
      .mockResolvedValueOnce(benchmark(model('4b'), 800))
      .mockResolvedValueOnce(benchmark(model('12b'), 1800)),
    translate: vi.fn().mockResolvedValue(translation()),
    ...overrides,
  }
}

function saveSettings(storage: TranslationSettingsStorage, settings: Partial<TranslationSettings>): void {
  saveTranslationSettings({
    executionMode: 'auto',
    mode: 'auto',
    targetLanguage: 'ko',
    endpoint: 'http://127.0.0.1:11434',
    customModel: '',
    externalEndpoint: 'https://api.openai.com/v1',
    externalModel: '',
    ...settings,
  }, storage)
}

describe('useTranslation', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('자동 모드는 설치 모델을 순서대로 벤치마크하고 캐시를 재사용한다', async () => {
    const storage = new MemoryStorage()
    const translationProvider = provider()
    const first = renderHook(() => useTranslation({ provider: translationProvider, storage }))

    await waitFor(() => expect(first.result.current.selectedModel).toBe(RECOMMENDED_TRANSLATION_MODELS['12b']))
    expect(translationProvider.benchmark).toHaveBeenCalledTimes(2)
    expect(translationProvider.benchmark).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:11434',
      RECOMMENDED_TRANSLATION_MODELS['4b'],
    )
    expect(translationProvider.benchmark).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:11434',
      RECOMMENDED_TRANSLATION_MODELS['12b'],
    )
    first.unmount()

    const second = renderHook(() => useTranslation({ provider: translationProvider, storage }))
    await waitFor(() => expect(second.result.current.selectedModel).toBe(RECOMMENDED_TRANSLATION_MODELS['12b']))
    expect(translationProvider.benchmark).toHaveBeenCalledTimes(2)
  })

  it('자동 벤치마크는 첫 실패나 목표 지연 초과에서 중단하고 다시 측정할 수 있다', async () => {
    const storage = new MemoryStorage()
    const translationProvider = provider({
      listModels: vi.fn().mockResolvedValue([model('4b'), model('12b'), model('27b')]),
      benchmark: vi.fn()
        .mockResolvedValueOnce(benchmark(model('4b'), 700))
        .mockResolvedValueOnce(benchmark(model('12b'), 3000))
        .mockResolvedValueOnce(benchmark(model('12b'), 2900))
        .mockResolvedValueOnce(benchmark(model('4b'), 600))
        .mockResolvedValueOnce(benchmark(model('12b'), 1400))
        .mockResolvedValueOnce(benchmark(model('27b'), 1000, false)),
    })
    const { result } = renderHook(() => useTranslation({ provider: translationProvider, storage }))

    await waitFor(() => expect(result.current.selectedModel).toBe(RECOMMENDED_TRANSLATION_MODELS['4b']))
    expect(translationProvider.benchmark).toHaveBeenCalledTimes(3)

    act(() => result.current.rerunBenchmark())
    await waitFor(() => expect(result.current.selectedModel).toBe(RECOMMENDED_TRANSLATION_MODELS['12b']))
    expect(translationProvider.benchmark).toHaveBeenCalledTimes(6)
  })

  it('자동은 처음 부를 때 느린 것(모델 올리기)을 한 번 더 재고, 가장 작은 모델은 느려도 고른다', async () => {
    const translationProvider = provider({
      listModels: vi.fn().mockResolvedValue([model('4b')]),
      benchmark: vi.fn()
        .mockResolvedValueOnce(benchmark(model('4b'), 5000))
        .mockResolvedValueOnce(benchmark(model('4b'), 4000)),
    })
    const { result } = renderHook(() => useTranslation({ provider: translationProvider, storage: new MemoryStorage() }))

    await waitFor(() => expect(result.current.selectedModel).toBe(RECOMMENDED_TRANSLATION_MODELS['4b']))
    expect(translationProvider.benchmark).toHaveBeenCalledTimes(2)
    expect(result.current.error).toBeNull()
  })

  it('자동에서 받은 모델이 번역에 실패하면 그 까닭을 알린다', async () => {
    const translationProvider = provider({
      listModels: vi.fn().mockResolvedValue([model('4b')]),
      benchmark: vi.fn().mockResolvedValue({ ...benchmark(model('4b'), 0, false), error: '메모리가 부족합니다' }),
    })
    const { result } = renderHook(() => useTranslation({ provider: translationProvider, storage: new MemoryStorage() }))

    await waitFor(() => expect(result.current.error).toBe('메모리가 부족합니다'))
    expect(result.current.selectedModel).toBeNull()
  })

  it('Ollama가 offline이면 모델 조회와 벤치마크를 실행하지 않는다', async () => {
    const translationProvider = provider({
      status: vi.fn().mockResolvedValue({
        available: false,
        version: '',
        deviceKey: 'offline',
        error: 'connection refused',
      }),
    })
    const { result } = renderHook(() => useTranslation({
      provider: translationProvider,
      storage: new MemoryStorage(),
    }))

    await waitFor(() => expect(result.current.status?.available).toBe(false))
    expect(result.current.error).toBe('connection refused')
    expect(result.current.models).toEqual([])
    expect(result.current.selectedModel).toBeNull()
    expect(translationProvider.listModels).not.toHaveBeenCalled()
    expect(translationProvider.benchmark).not.toHaveBeenCalled()
  })

  it('외부 API 모드는 Ollama 없이 세션 key로 번역한다', async () => {
    const storage = new MemoryStorage()
    saveSettings(storage, {
      executionMode: 'external-api',
      externalEndpoint: 'https://gateway.example.test/v1',
      externalModel: 'translator-small',
    })
    const translateExternal = vi.fn().mockResolvedValue({
      translatedText: '외부 번역',
      model: 'translator-small',
      elapsedMs: 220,
    })
    const translationProvider = provider({ translateExternal })
    const { result } = renderHook(() => useTranslation({ provider: translationProvider, storage }))

    await waitFor(() => expect(result.current.selectedModel).toBe('translator-small'))
    expect(translationProvider.status).not.toHaveBeenCalled()
    expect(translationProvider.listModels).not.toHaveBeenCalled()

    act(() => result.current.updateExternalApiKey('session-secret'))
    await expect(result.current.translate('hello')).resolves.toMatchObject({ translatedText: '외부 번역' })
    expect(translateExternal).toHaveBeenCalledWith({
      provider: 'compatible',
      endpoint: 'https://gateway.example.test/v1',
      apiKey: 'session-secret',
      model: 'translator-small',
      text: 'hello',
      targetLanguage: 'ko',
    })
    expect([...storage.values.values()].join('')).not.toContain('session-secret')
  })

  it('데스크톱에서는 Ollama를 설치한 뒤 상태를 다시 조회한다', async () => {
    const installation = deferred<void>()
    const installRuntime = vi.fn().mockReturnValue(installation.promise)
    const status = vi.fn()
      .mockResolvedValueOnce({
        available: false,
        version: '',
        deviceKey: 'offline',
        error: 'connection refused',
      })
      .mockResolvedValueOnce({ available: true, version: '0.34.2', deviceKey: 'cpu:test' })
    const translationProvider = provider({ status, installRuntime })
    const { result } = renderHook(() => useTranslation({
      provider: translationProvider,
      storage: new MemoryStorage(),
    }))

    await waitFor(() => expect(result.current.status?.available).toBe(false))
    expect(result.current.runtimeInstallSupported).toBe(true)

    let request!: Promise<void>
    act(() => {
      request = result.current.installRuntime()
    })
    await waitFor(() => expect(result.current.isInstallingRuntime).toBe(true))

    await act(async () => installation.resolve())
    await expect(request).resolves.toBeUndefined()
    await waitFor(() => expect(result.current.status?.available).toBe(true))
    expect(status).toHaveBeenCalledTimes(2)
    expect(result.current.isInstallingRuntime).toBe(false)
  })

  it('설치된 자동 후보가 없으면 선택하지 않는다', async () => {
    const translationProvider = provider({ listModels: vi.fn().mockResolvedValue([]) })
    const { result } = renderHook(() => useTranslation({
      provider: translationProvider,
      storage: new MemoryStorage(),
    }))

    await waitFor(() => expect(result.current.status?.available).toBe(true))
    await waitFor(() => expect(translationProvider.listModels).toHaveBeenCalledTimes(1))
    expect(result.current.selectedModel).toBeNull()
    expect(translationProvider.benchmark).not.toHaveBeenCalled()
  })

  it('모델이 선택되지 않은 번역 요청을 오류 상태로 노출한다', async () => {
    const translationProvider = provider({ listModels: vi.fn().mockResolvedValue([]) })
    const { result } = renderHook(() => useTranslation({
      provider: translationProvider,
      storage: new MemoryStorage(),
    }))
    await waitFor(() => expect(translationProvider.listModels).toHaveBeenCalledTimes(1))

    await act(async () => {
      await expect(result.current.translate('translate me')).rejects.toThrow('모델이 선택되지 않았습니다')
    })

    expect(result.current.error).toContain('모델이 선택되지 않았습니다')
    expect(translationProvider.translate).not.toHaveBeenCalled()
  })

  it('StrictMode의 개발용 effect 재실행 뒤에도 번역 결과를 반환한다', async () => {
    const storage = new MemoryStorage()
    saveSettings(storage, { mode: '4b' })
    const translationProvider = provider()
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
    const { result } = renderHook(
      () => useTranslation({ provider: translationProvider, storage }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.selectedModel).toBe(RECOMMENDED_TRANSLATION_MODELS['4b']))

    await expect(result.current.translate('strict mode')).resolves.toMatchObject({ translatedText: '번역됨' })
  })

  it('선택한 로컬 실행 모드를 번역 요청에 전달한다', async () => {
    const storage = new MemoryStorage()
    saveSettings(storage, { mode: '4b', executionMode: 'cpu' })
    const translate = vi.fn().mockResolvedValue(translation())
    const translationProvider = provider({ translate })
    const { result } = renderHook(() => useTranslation({ provider: translationProvider, storage }))
    await waitFor(() => expect(result.current.selectedModel).toBe(RECOMMENDED_TRANSLATION_MODELS['4b']))

    await result.current.translate('cpu translation')

    expect(translate).toHaveBeenCalledWith(
      'http://127.0.0.1:11434',
      expect.objectContaining({ executionMode: 'cpu' }),
    )
  })

  it.each([
    ['12b', '', RECOMMENDED_TRANSLATION_MODELS['12b']],
    ['custom', 'my-translator:v2', 'my-translator:v2'],
  ] as const)('%s 수동 모드는 벤치마크 없이 모델을 선택한다', async (mode, customModel, expected) => {
    const storage = new MemoryStorage()
    saveSettings(storage, { mode, customModel })
    const translationProvider = provider()
    const { result } = renderHook(() => useTranslation({ provider: translationProvider, storage }))

    await waitFor(() => expect(result.current.selectedModel).toBe(expected))
    expect(translationProvider.benchmark).not.toHaveBeenCalled()
  })

  it('모델 다운로드 진행률을 노출하고 완료 후 모델 목록을 새로 읽는다', async () => {
    const storage = new MemoryStorage()
    saveSettings(storage, { mode: '4b' })
    const translationProvider = provider({
      listModels: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([model('4b')]),
      pullModel: vi.fn().mockImplementation(async (_endpoint, _model, onProgress) => {
        onProgress({ status: 'pulling', completed: 25, total: 100 })
        onProgress({ status: 'success', completed: 100, total: 100 })
      }),
    })
    const { result } = renderHook(() => useTranslation({ provider: translationProvider, storage }))
    await waitFor(() => expect(translationProvider.listModels).toHaveBeenCalledTimes(1))

    await act(async () => result.current.pullModel(RECOMMENDED_TRANSLATION_MODELS['4b']))

    expect(result.current.pullProgress).toEqual({ status: 'success', completed: 100, total: 100 })
    expect(result.current.pullingModel).toBeNull()
    await waitFor(() => expect(translationProvider.listModels).toHaveBeenCalledTimes(2))
    expect(result.current.models.map(({ name }) => name)).toEqual([RECOMMENDED_TRANSLATION_MODELS['4b']])
  })

  it('provider별 번역 요청을 직렬화하고 실패 후 재시도를 허용한다', async () => {
    const storage = new MemoryStorage()
    saveSettings(storage, { mode: '4b' })
    const first = deferred<TranslationResult>()
    const translate = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(translation('재시도 성공'))
    const translationProvider = provider({ translate })
    const { result } = renderHook(() => useTranslation({ provider: translationProvider, storage }))
    await waitFor(() => expect(result.current.selectedModel).toBe(RECOMMENDED_TRANSLATION_MODELS['4b']))

    let firstRequest!: Promise<TranslationResult | null>
    act(() => {
      firstRequest = result.current.translate('first')
    })
    await waitFor(() => expect(result.current.isTranslating).toBe(true))
    await expect(result.current.translate('second')).rejects.toThrow('이미 진행 중')

    await act(async () => first.resolve(translation('첫 결과')))
    await expect(firstRequest).resolves.toMatchObject({ translatedText: '첫 결과' })

    await expect(result.current.translate('failure')).rejects.toThrow('temporary failure')
    await waitFor(() => expect(result.current.error).toBe('temporary failure'))
    await expect(result.current.translate('retry')).resolves.toMatchObject({ translatedText: '재시도 성공' })
  })

  it('취소된 요청의 늦은 결과를 버리고 완료 상태로 되돌린다', async () => {
    const storage = new MemoryStorage()
    saveSettings(storage, { mode: '4b' })
    const pending = deferred<TranslationResult>()
    const translationProvider = provider({ translate: vi.fn().mockReturnValue(pending.promise) })
    const { result } = renderHook(() => useTranslation({ provider: translationProvider, storage }))
    await waitFor(() => expect(result.current.selectedModel).toBe(RECOMMENDED_TRANSLATION_MODELS['4b']))

    let request!: Promise<TranslationResult | null>
    act(() => {
      request = result.current.translate('cancel me')
    })
    await waitFor(() => expect(result.current.isTranslating).toBe(true))
    act(() => result.current.cancelTranslation())
    expect(result.current.isTranslating).toBe(false)

    await act(async () => pending.resolve(translation('늦은 결과')))
    await expect(request).resolves.toBeNull()
    expect(result.current.lastResult).toBeNull()
  })

  it('설정 변경을 저장하고 새 endpoint 상태를 다시 조회한다', async () => {
    const storage = new MemoryStorage()
    const translationProvider = provider()
    const { result } = renderHook(() => useTranslation({ provider: translationProvider, storage }))
    await waitFor(() => expect(result.current.status?.available).toBe(true))

    act(() => result.current.updateSettings({ endpoint: 'http://192.168.0.50:11434' }))

    await waitFor(() => expect(translationProvider.status).toHaveBeenLastCalledWith('http://192.168.0.50:11434'))
    expect(result.current.settings.endpoint).toBe('http://192.168.0.50:11434')
  })

  it('클라우드 API 로 바꾸면 쓰던 로컬 모델을 메모리에서 내리고, 앱을 닫을 때도 내린다', async () => {
    const storage = new MemoryStorage()
    const unload = vi.fn().mockResolvedValue(undefined)
    const translationProvider = provider({ unload })
    const { result } = renderHook(() => useTranslation({ provider: translationProvider, storage }))
    await waitFor(() => expect(result.current.selectedModel).not.toBeNull())
    const loaded = result.current.selectedModel!
    await act(async () => { await result.current.releaseLocalModel() })
    expect(unload).toHaveBeenLastCalledWith('http://127.0.0.1:11434', loaded)
    unload.mockClear()
    act(() => result.current.updateSettings({ executionMode: 'external-api' }))
    await waitFor(() => expect(unload).toHaveBeenCalledWith('http://127.0.0.1:11434', loaded))
  })
})
