// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TranslationSettings as Settings } from '../core/translationSettings'
import { TranslationSettings, type TranslationSettingsState } from './TranslationSettings'
import { setLocale } from '../i18n'

function readyState(
  overrides: Partial<TranslationSettingsState> = {},
): TranslationSettingsState {
  return {
    status: {
      available: true,
      version: '0.12.3',
      deviceKey: 'local-test-device',
    },
    settings: {
      enabled: true,
      executionMode: 'auto',
      mode: 'auto',
      endpoint: 'http://127.0.0.1:11434',
      targetLanguage: 'ko',
      customModel: '',
      externalEndpoint: 'https://api.openai.com/v1',
      externalProvider: 'compatible',
      externalModel: '',
    },
    models: [{
      name: 'translategemma:4b',
      digest: 'sha256:4b',
      size: 3_300_000_000,
    }],
    selectedModel: 'translategemma:4b',
    pullProgress: null,
    pullingModel: null,
    runtimeInstallSupported: false,
    isInstallingRuntime: false,
    error: null,
    externalApiKey: '',
    updateSettings: vi.fn(),
    updateExternalApiKey: vi.fn(),
    pullModel: vi.fn(),
    installRuntime: vi.fn().mockResolvedValue(undefined),
    rerunBenchmark: vi.fn(),
    ...overrides,
  }
}

describe('TranslationSettings', () => {
  it('연결 상태와 모든 모델 모드, 설정 필드를 표시한다', () => {
    render(<TranslationSettings state={readyState()} />)

    expect(screen.getByText('Ollama 연결됨')).toBeDefined()
    expect(screen.getByText(/0\.12\.3/)).toBeDefined()
    expect((screen.getByLabelText('Ollama 주소') as HTMLInputElement).value)
      .toBe('http://127.0.0.1:11434')
    expect(screen.getByRole('combobox', { name: '번역 언어' }).textContent).toBe('한국어')
    for (const name of ['최대 속도 자동', 'CPU', 'GPU']) {
      expect(screen.getByRole('radio', { name })).toBeDefined()
    }
    // 번역 방식을 먼저 고른다: 로컬(Ollama) / 클라우드 API
    expect(screen.getByRole('radio', { name: /^로컬 \(Ollama\)/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: /^클라우드 API/ }).getAttribute('aria-checked')).toBe('false')
    for (const name of ['자동', 'TranslateGemma 4B', 'TranslateGemma 12B', 'TranslateGemma 27B', '사용자 지정']) {
      expect(screen.getByRole('radio', { name })).toBeDefined()
    }
    expect(screen.getByRole('button', { name: '속도 다시 측정' })).toBeDefined()
    expect(screen.getByText(/선택 모델.*translategemma:4b/)).toBeDefined()
  })

  it('endpoint, 번역 언어, 모드와 사용자 지정 모델 변경을 상태에 전달한다', () => {
    const updateSettings = vi.fn<(patch: Partial<Settings>) => void>()
    const { rerender } = render(
      <TranslationSettings state={readyState({ updateSettings })} />,
    )

    fireEvent.change(screen.getByLabelText('Ollama 주소'), {
      target: { value: 'http://localhost:11434' },
    })
    fireEvent.click(screen.getByRole('combobox', { name: '번역 언어' }))
    fireEvent.click(screen.getByRole('option', { name: 'English' }))
    fireEvent.click(screen.getByRole('radio', { name: 'GPU' }))
    fireEvent.click(screen.getByRole('radio', { name: 'TranslateGemma 12B' }))

    expect(updateSettings).toHaveBeenCalledWith({ endpoint: 'http://localhost:11434' })
    expect(updateSettings).toHaveBeenCalledWith({ targetLanguage: 'en' })
    expect(updateSettings).toHaveBeenCalledWith({ executionMode: 'gpu' })
    expect(updateSettings).toHaveBeenCalledWith({ mode: '12b' })

    rerender(<TranslationSettings state={readyState({
      updateSettings,
      settings: {
        enabled: true,
        executionMode: 'auto',
        mode: 'custom',
        endpoint: 'http://127.0.0.1:11434',
        targetLanguage: 'ko',
        customModel: '',
        externalEndpoint: 'https://api.openai.com/v1',
        externalProvider: 'compatible',
        externalModel: '',
      },
    })} />)
    fireEvent.change(screen.getByLabelText('사용자 지정 모델'), {
      target: { value: 'qwen3:8b' },
    })
    expect(updateSettings).toHaveBeenCalledWith({ customModel: 'qwen3:8b' })
  })

  it('외부 API 모드에서 endpoint, model, session key를 각각 변경한다', () => {
    const updateSettings = vi.fn<(patch: Partial<Settings>) => void>()
    const updateExternalApiKey = vi.fn<(apiKey: string) => void>()
    render(<TranslationSettings state={readyState({
      updateSettings,
      updateExternalApiKey,
      settings: {
        ...readyState().settings,
        executionMode: 'external-api',
        externalEndpoint: 'https://gateway.example.test/v1',
        externalProvider: 'compatible',
        externalModel: 'translator-small',
      },
    })} />)

    fireEvent.change(screen.getByLabelText('API endpoint'), { target: { value: 'https://api.example.test/v1' } })
    fireEvent.change(screen.getByLabelText('API model'), { target: { value: 'translator-large' } })
    fireEvent.change(screen.getByLabelText(/^API key/), { target: { value: 'session-secret' } })

    expect(updateSettings).toHaveBeenCalledWith({ externalEndpoint: 'https://api.example.test/v1' })
    expect(updateSettings).toHaveBeenCalledWith({ externalModel: 'translator-large' })
    expect(updateExternalApiKey).toHaveBeenCalledWith('session-secret')
    expect(screen.queryByLabelText('Ollama 주소')).toBeNull()
  })

  it('설치 여부와 예상 크기를 보여주고 명시적 버튼으로만 다운로드한다', () => {
    const pullModel = vi.fn()
    render(<TranslationSettings state={readyState({ pullModel })} />)

    expect(screen.getByText('설치됨')).toBeDefined()
    expect(screen.getByText(/12B.*약 8\.1 GB/)).toBeDefined()
    expect(screen.getByText(/27B.*약 17 GB/)).toBeDefined()
    expect(pullModel).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'TranslateGemma 12B 다운로드' }))
    expect(pullModel).toHaveBeenCalledWith('translategemma:12b')
  })

  it('받기를 누르면 바로 받는 중으로 바뀌고 크기와 진행률을 보여준다', () => {
    const pullModel = vi.fn()
    const { rerender } = render(<TranslationSettings state={readyState({ pullModel })} />)
    fireEvent.click(screen.getByRole('button', { name: 'TranslateGemma 12B 다운로드' }))
    expect(pullModel).toHaveBeenCalledWith('translategemma:12b')

    rerender(<TranslationSettings state={readyState({
      pullModel,
      pullingModel: 'translategemma:12b',
      pullProgress: { status: 'starting', completed: 0, total: 0 },
    })} />)
    expect(screen.getByText('받는 중')).toBeDefined()
    expect(screen.getByText('Ollama에 요청하는 중')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'TranslateGemma 12B 다운로드' })).toBeNull()
    expect((screen.getByRole('button', { name: 'TranslateGemma 27B 다운로드' }) as HTMLButtonElement).disabled).toBe(true)

    rerender(<TranslationSettings state={readyState({
      pullModel,
      pullingModel: 'translategemma:12b',
      pullProgress: { status: 'pulling sha256:abc', completed: 2 * 1024 ** 3, total: 8 * 1024 ** 3 },
    })} />)
    const progress = screen.getByRole('progressbar', { name: 'TranslateGemma 12B 다운로드 진행률' })
    expect(progress.getAttribute('aria-valuenow')).toBe('25')
    expect(screen.getByText(/받는 중 · 2\.00 GB \/ 8\.00 GB · 25%/)).toBeDefined()
  })

  it('자동인데 받은 모델이 없으면 추천 모델 받기를 바로 보여준다', () => {
    const pullModel = vi.fn()
    const { rerender } = render(<TranslationSettings state={readyState({ pullModel, models: [], selectedModel: null })} />)
    expect(screen.getByText(/받은 번역 모델이 없습니다/)).toBeDefined()
    expect(screen.getByText(/받은 모델이 없어 선택할 수 없음/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '추천 모델(4B) 받기' }))
    expect(pullModel).toHaveBeenCalledWith('translategemma:4b')

    rerender(<TranslationSettings state={readyState({
      pullModel, models: [], selectedModel: null, pullingModel: 'translategemma:4b', pullProgress: null,
    })} />)
    expect(screen.getByText(/TranslateGemma 4B 모델을 받고 있습니다/)).toBeDefined()
  })

  it('오프라인이면 Ollama 실행과 주소 확인 방법을 안내한다', () => {
    render(<TranslationSettings state={readyState({
      status: {
        available: false,
        version: '',
        deviceKey: 'offline',
        error: 'Ollama에 연결할 수 없습니다.',
      },
    })} />)

    expect(screen.getByText('Ollama 연결 안 됨')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toMatch(/Ollama를 실행.*주소/)
    expect((screen.getByRole('button', { name: '속도 다시 측정' }) as HTMLButtonElement).disabled)
      .toBe(true)
  })

  it('데스크톱에서 Ollama가 없으면 설치 버튼과 설치 진행 상태를 제공한다', () => {
    const installRuntime = vi.fn()
    const offline = {
      ...readyState({
        status: {
          available: false,
          version: '',
          deviceKey: 'offline',
          error: 'Ollama에 연결할 수 없습니다.',
        },
      }),
      runtimeInstallSupported: true,
      isInstallingRuntime: false,
      installRuntime,
    } as unknown as TranslationSettingsState
    const { rerender } = render(<TranslationSettings state={offline} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ollama 설치' }))
    expect(installRuntime).toHaveBeenCalledOnce()

    rerender(<TranslationSettings state={{
      ...offline,
      isInstallingRuntime: true,
    } as unknown as TranslationSettingsState} />)
    expect((screen.getByRole('button', { name: 'Ollama 설치 중' }) as HTMLButtonElement).disabled)
      .toBe(true)
  })

  it('웹 미리보기에서는 운영체제 설치 대신 공식 다운로드 링크를 제공한다', () => {
    render(<TranslationSettings state={{
      ...readyState({
        status: {
          available: false,
          version: '',
          deviceKey: 'offline',
          error: 'Ollama에 연결할 수 없습니다.',
        },
      }),
      runtimeInstallSupported: false,
    } as unknown as TranslationSettingsState} />)

    const requested: string[] = []
    const listener = (event: Event) => requested.push((event as CustomEvent<string>).detail)
    window.addEventListener('iwae:request-external-link', listener)
    fireEvent.click(screen.getByRole('button', { name: 'Ollama 받기' }))
    window.removeEventListener('iwae:request-external-link', listener)
    expect(requested).toEqual(['https://ollama.com/download'])
  })

  it('모델이 별도 다운로드이며 Gemma 약관 검토가 필요함을 알린다', () => {
    render(<TranslationSettings state={readyState()} />)

    expect(screen.getByText(/IWAE는 모델 가중치를 포함하지 않습니다/)).toBeDefined()
    expect(screen.getByRole('link', { name: 'Gemma 이용 약관' }).getAttribute('href'))
      .toContain('ai.google.dev')
  })

  it('영어로 켜면 영어 문구를 보여준다', () => {
    setLocale('en')
    try {
      render(<TranslationSettings state={readyState()} />)
      expect(screen.getByText('Ollama connected')).toBeDefined()
      expect(screen.getByRole('button', { name: 'Measure speed again' })).toBeDefined()
      expect(screen.getByRole('button', { name: 'Download TranslateGemma 12B' })).toBeDefined()
      expect(screen.getByRole('link', { name: 'Gemma Terms of Use' })).toBeDefined()
    } finally {
      setLocale('ko')
    }
  })

  it('번역 방식을 클라우드로 바꾸면 실행 장치(CPU·GPU)는 감추고, 로컬로 돌아오면 전에 고른 장치를 되살린다', () => {
    const state = readyState()
    const updateSettings = vi.fn()
    const { rerender } = render(<TranslationSettings state={{ ...state, settings: { ...state.settings, executionMode: 'gpu' }, updateSettings }} />)
    fireEvent.click(screen.getByRole('radio', { name: /^클라우드 API/ }))
    expect(updateSettings).toHaveBeenLastCalledWith({ executionMode: 'external-api' })
    rerender(<TranslationSettings state={{ ...state, settings: { ...state.settings, executionMode: 'external-api' }, updateSettings }} />)
    expect(screen.queryByRole('radio', { name: 'GPU' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: /^로컬 \(Ollama\)/ }))
    expect(updateSettings).toHaveBeenLastCalledWith({ executionMode: 'gpu' })
  })

  it('연결 확인은 짧은 문장을 실제로 번역해 결과와 시간, 또는 오류를 보인다', async () => {
    const translate = vi.fn()
      .mockResolvedValueOnce({ translatedText: '안녕하세요. 연결 시험입니다.', model: 'm1', elapsedMs: 420 })
      .mockRejectedValueOnce(new Error('외부 번역 API 요청에 실패했습니다 (HTTP 401): bad'))
    render(<TranslationSettings state={{ ...readyState(), translate }} />)
    fireEvent.click(screen.getByRole('button', { name: '연결 확인' }))
    expect(await screen.findByText('안녕하세요. 연결 시험입니다.')).toBeDefined()
    expect(screen.getByText('420ms · m1')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '연결 확인' }))
    expect(await screen.findByText(/API key가 맞지 않습니다/)).toBeDefined()
  })
})

describe('TranslationSettings provider cards', () => {
  it('클라우드 방식에서는 제공자 카드마다 필요한 것을 한 줄로 보이고, 키 받는 곳은 확인 창 요청으로 연다', () => {
    const updateSettings = vi.fn()
    const state = readyState({ updateSettings })
    render(<TranslationSettings state={{ ...state, settings: { ...state.settings, executionMode: 'external-api', externalProvider: 'deepl', externalEndpoint: 'https://api-free.deepl.com' } }} />)
    expect(screen.getByRole('radio', { name: /DeepL.*DeepL API key \(Free 또는 Pro\)/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: /Azure.*Azure 키 \+ 리소스 지역/ })).toBeDefined()
    const requested: string[] = []
    const listener = (event: Event) => requested.push((event as CustomEvent<string>).detail)
    window.addEventListener('iwae:request-external-link', listener)
    fireEvent.click(screen.getByRole('button', { name: '키 받는 곳 열기' }))
    window.removeEventListener('iwae:request-external-link', listener)
    expect(requested[0]).toContain('deepl.com')
    fireEvent.click(screen.getByRole('radio', { name: /^Google 번역/ }))
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ externalProvider: 'google' }))
  })
})
