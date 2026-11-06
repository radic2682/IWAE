// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOllamaTranslationProvider } from './translation'

const ENDPOINT = 'http://127.0.0.1:11434'

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('createOllamaTranslationProvider — Tauri', () => {
  it('Ollama 런타임 설치는 고정된 Tauri 명령으로만 요청한다', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const invoke = vi.fn().mockResolvedValue({ installed: true, detail: 'installed' })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))
    const provider = createOllamaTranslationProvider() as ReturnType<typeof createOllamaTranslationProvider> & {
      installRuntime(): Promise<void>
    }

    await expect(provider.installRuntime()).resolves.toBeUndefined()
    expect(invoke).toHaveBeenCalledWith('translation_install_ollama', {})
  })

  it('상태·모델·번역 명령에 endpoint와 요청을 그대로 전달한다', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const invoke = vi.fn(async (command: string) => {
      if (command === 'translation_status') return { available: true, version: '0.12.3' }
      if (command === 'translation_models') return [{ name: 'translategemma:4b', size: 3_300_000_000 }]
      return { translatedText: '안녕하세요', model: 'translategemma:4b', elapsedMs: 420 }
    })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))
    const provider = createOllamaTranslationProvider()
    const request = { model: 'translategemma:4b', text: 'hello', targetLanguage: 'ko' }

    await expect(provider.status(ENDPOINT)).resolves.toEqual({
      available: true,
      version: '0.12.3',
      deviceKey: `${ENDPOINT}|0.12.3`,
    })
    await expect(provider.listModels(ENDPOINT)).resolves.toEqual([
      { name: 'translategemma:4b', size: 3_300_000_000 },
    ])
    await expect(provider.translate(ENDPOINT, request)).resolves.toMatchObject({
      translatedText: '안녕하세요',
      elapsedMs: 420,
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'translation_status', { endpoint: ENDPOINT })
    expect(invoke).toHaveBeenNthCalledWith(2, 'translation_models', { endpoint: ENDPOINT })
    expect(invoke).toHaveBeenNthCalledWith(3, 'translation_generate', {
      endpoint: ENDPOINT,
      request,
    })
  })

  it('외부 API 번역은 세션 key를 Tauri 명령에만 전달한다', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const invoke = vi.fn().mockResolvedValue({
      translatedText: '외부 번역',
      model: 'translator-small',
      elapsedMs: 240,
    })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))
    const provider = createOllamaTranslationProvider()

    await expect(provider.translateExternal?.({
      endpoint: 'https://gateway.example.test/v1',
      apiKey: 'session-secret',
      model: 'translator-small',
      text: 'hello',
      targetLanguage: 'ko',
    })).resolves.toMatchObject({ translatedText: '외부 번역' })

    expect(invoke).toHaveBeenCalledWith('translation_external_generate', {
      request: {
        endpoint: 'https://gateway.example.test/v1',
        apiKey: 'session-secret',
        model: 'translator-small',
        text: 'hello',
        targetLanguage: 'ko',
      },
    })
  })

  it('다운로드 중 진행 상황과 완료 값을 progress callback에 전달한다', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const progress = { status: 'success', total: 100, completed: 100 }
    let channel: { onmessage?: (value: unknown) => void } | undefined
    const invoke = vi.fn().mockImplementation(async (_command: string, args: { onProgress: typeof channel }) => {
      channel = args.onProgress
      channel?.onmessage?.({ status: 'pulling sha256:a', total: 100, completed: 40 })
      return progress
    })
    class Channel { onmessage?: (value: unknown) => void }
    vi.doMock('@tauri-apps/api/core', () => ({ invoke, Channel }))
    const onProgress = vi.fn()

    await expect(
      createOllamaTranslationProvider().pullModel(
        ENDPOINT,
        'translategemma:4b',
        onProgress,
      ),
    ).resolves.toBeUndefined()

    expect(invoke).toHaveBeenCalledWith('translation_pull', {
      endpoint: ENDPOINT,
      model: 'translategemma:4b',
      onProgress: expect.any(Channel),
    })
    expect(onProgress).toHaveBeenNthCalledWith(1, { status: 'pulling sha256:a', total: 100, completed: 40 })
    expect(onProgress).toHaveBeenLastCalledWith(progress)
  })

  it('benchmark는 고정된 짧은 문장을 translation_generate로 측정한다', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const model = {
      name: 'translategemma:4b',
      digest: 'sha256:4b',
      size: 3_300_000_000,
    }
    const invoke = vi.fn(async (command: string) => {
      if (command === 'translation_models') return [model]
      return {
        translatedText: '안녕하세요.',
        model: 'translategemma:4b',
        elapsedMs: 315,
      }
    })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))

    await expect(
      createOllamaTranslationProvider().benchmark(ENDPOINT, 'translategemma:4b'),
    ).resolves.toEqual({ model, elapsedMs: 315, success: true })

    expect(invoke).toHaveBeenNthCalledWith(1, 'translation_models', { endpoint: ENDPOINT })
    expect(invoke).toHaveBeenNthCalledWith(2, 'translation_generate', {
      endpoint: ENDPOINT,
      request: {
        model: 'translategemma:4b',
        text: 'Hello. This is a short translation benchmark.',
        targetLanguage: 'ko',
      },
    })
  })

  it('benchmark 생성 실패는 throw 대신 실패 결과로 돌려준다', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const model = {
      name: 'translategemma:4b',
      digest: 'sha256:4b',
      size: 3_300_000_000,
    }
    const invoke = vi.fn(async (command: string) => {
      if (command === 'translation_models') return [model]
      throw new Error('model runner crashed')
    })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))

    await expect(
      createOllamaTranslationProvider().benchmark(ENDPOINT, model.name),
    ).resolves.toEqual({
      model,
      elapsedMs: 0,
      success: false,
      error: 'model runner crashed',
    })
  })
})

describe('createOllamaTranslationProvider — browser preview', () => {
  it('명시적 개발 fetch 모드가 없으면 네트워크 요청 없이 실패한다', async () => {
    const fetch = vi.fn()
    const provider = createOllamaTranslationProvider({ fetch })

    await expect(provider.status(ENDPOINT)).rejects.toThrow(/개발 fetch 모드|Tauri/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('개발 fetch 모드를 켜면 Ollama HTTP API를 직접 사용한다', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ version: '0.12.3' }))
      .mockResolvedValueOnce(jsonResponse({
        model: 'translategemma:4b',
        response: '{"translatedText":"안녕"}',
        done: true,
      }))
    const provider = createOllamaTranslationProvider({ developmentFetch: true, fetch })

    await expect(provider.status(ENDPOINT)).resolves.toEqual({
      available: true,
      version: '0.12.3',
      deviceKey: `${ENDPOINT}|0.12.3`,
    })
    await expect(provider.translate(ENDPOINT, {
      model: 'translategemma:4b',
      text: 'hello',
      targetLanguage: 'ko',
      executionMode: 'cpu',
    })).resolves.toEqual({ translatedText: '안녕', model: 'translategemma:4b', elapsedMs: expect.any(Number) })

    expect(fetch).toHaveBeenNthCalledWith(1, `${ENDPOINT}/api/version`, expect.objectContaining({
      method: 'GET',
    }))
    expect(fetch).toHaveBeenNthCalledWith(2, `${ENDPOINT}/api/generate`, expect.objectContaining({
      method: 'POST',
      body: expect.stringMatching(/"stream":false.*"num_gpu":0/),
    }))
  })

  it('CORS 또는 연결 실패를 설정 방법이 포함된 오류로 바꾼다', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const provider = createOllamaTranslationProvider({ developmentFetch: true, fetch })

    await expect(provider.status(ENDPOINT)).rejects.toThrow(/CORS|OLLAMA_ORIGINS|Ollama/)
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
