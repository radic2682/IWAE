import { useCallback, useEffect, useRef, useState } from 'react'
import { loadTranslationApiKey, saveTranslationApiKey } from '../bridge/translation'
import {
  RECOMMENDED_TRANSLATION_MODELS,
  createBenchmarkCacheKey,
  type PullProgress,
  type TranslationModel,
  type TranslationProvider,
  type TranslationResult,
  type TranslationStatus,
} from '../core/translation'
import {
  deeplEndpointForKey,
  externalProviderInfo,
  isKeylessProvider,
  loadTranslationSettings,
  parseTranslationSettings,
  saveTranslationSettings,
  type TranslationSettings,
  type TranslationSettingsStorage,
} from '../core/translationSettings'
import { t } from '../i18n'

const AUTO_TARGET_LATENCY_MS = 2500
const activeTranslations = new WeakMap<TranslationProvider, symbol>()

export interface UseTranslationOptions {
  readonly provider: TranslationProvider
  readonly storage?: TranslationSettingsStorage
}

export interface TranslationCoordinator {
  readonly status: TranslationStatus | null
  readonly settings: TranslationSettings
  readonly models: readonly TranslationModel[]
  readonly selectedModel: string | null
  readonly pullProgress: PullProgress | null
  /** 지금 받는 중인 모델. 설정 창을 닫았다 열어도 이어서 보인다. */
  readonly pullingModel: string | null
  readonly runtimeInstallSupported: boolean
  readonly isInstallingRuntime: boolean
  readonly isTranslating: boolean
  readonly lastResult: TranslationResult | null
  readonly error: string | null
  readonly externalApiKey: string
  readonly updateSettings: (update: Partial<TranslationSettings>) => void
  readonly updateExternalApiKey: (apiKey: string) => void
  readonly translate: (text: string, sourceLanguage?: string, targetLanguage?: string) => Promise<TranslationResult | null>
  readonly cancelTranslation: () => void
  readonly pullModel: (model: string) => Promise<void>
  readonly installRuntime: () => Promise<void>
  readonly rerunBenchmark: () => void
  /** 쓰던 로컬 모델을 메모리에서 내린다(앱을 닫을 때) */
  readonly releaseLocalModel: () => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readCachedModel(
  storage: TranslationSettingsStorage | undefined,
  key: string,
  candidates: readonly TranslationModel[],
): string | null {
  if (storage === undefined) return null
  try {
    const cached = storage.getItem(key)
    return candidates.some((model) => model.name === cached) ? cached : null
  } catch {
    return null
  }
}

function writeCachedModel(
  storage: TranslationSettingsStorage | undefined,
  key: string,
  model: string,
): void {
  if (storage === undefined) return
  try {
    storage.setItem(key, model)
  } catch {
    return
  }
}

function manualModel(settings: TranslationSettings): string | null {
  if (settings.mode === 'auto') return null
  if (settings.mode === 'custom') return settings.customModel || null
  return RECOMMENDED_TRANSLATION_MODELS[settings.mode]
}

function autoCandidates(models: readonly TranslationModel[]): readonly TranslationModel[] {
  const byName = new Map(models.map((model) => [model.name, model]))
  return (['4b', '12b', '27b'] as const)
    .map((mode) => byName.get(RECOMMENDED_TRANSLATION_MODELS[mode]))
    .filter((model): model is TranslationModel => model !== undefined)
}

export function useTranslation({ provider, storage }: UseTranslationOptions): TranslationCoordinator {
  const [settings, setSettings] = useState<TranslationSettings>(() => loadTranslationSettings(storage))
  const [status, setStatus] = useState<TranslationStatus | null>(null)
  const [models, setModels] = useState<readonly TranslationModel[]>([])
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [pullProgress, setPullProgress] = useState<PullProgress | null>(null)
  const [pullingModel, setPullingModel] = useState<string | null>(null)
  const pullingRef = useRef<string | null>(null)
  const [isInstallingRuntime, setIsInstallingRuntime] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)
  const [lastResult, setLastResult] = useState<TranslationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [externalApiKey, setExternalApiKey] = useState('')
  // 외부 API key 는 제공자마다 OS 자격 증명 저장소에 둔다. 제공자를 바꾸면 그 제공자의 key 를 읽는다
  const keySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (settings.executionMode !== 'external-api') return
    let active = true
    setExternalApiKey('')
    void loadTranslationApiKey(settings.externalProvider)
      .then((key) => { if (active) setExternalApiKey(key) })
      .catch(() => { /* 저장소를 못 열면 이번 실행에만 쓴다 */ })
    return () => { active = false }
  }, [settings.executionMode, settings.externalProvider])
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [benchmarkNonce, setBenchmarkNonce] = useState(0)
  const forceBenchmark = useRef(false)
  const requestId = useRef(0)
  const mounted = useRef(true)
  const storageRef = useRef(storage)
  storageRef.current = storage

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestId.current += 1
    }
  }, [])

  useEffect(() => {
    let active = true
    const currentStorage = storageRef.current
    const bypassCache = forceBenchmark.current
    forceBenchmark.current = false
    setStatus(null)
    setModels([])
    setSelectedModel(null)
    setError(null)

    const initialize = async (): Promise<void> => {
      if (settings.executionMode === 'external-api') {
        // DeepL 은 고를 모델이 없다(모델 칸이 비어도 된다)
        const keyless = isKeylessProvider(settings.externalProvider)
        const externalModel = settings.externalModel !== '' ? settings.externalModel : settings.externalProvider === 'deepl' ? 'DeepL' : keyless ? 'Google' : ''
        const configured = externalModel !== '' && provider.translateExternal !== undefined
        const hasKey = keyless || externalApiKey.trim() !== ''
        const message = !configured ? t('외부 API endpoint와 모델을 설정하세요.') : !hasKey ? t('API key를 입력하세요.') : undefined
        setStatus({
          available: configured && hasKey,
          version: t(externalProviderInfo(settings.externalProvider).label),
          deviceKey: `external-api:${settings.externalEndpoint}`,
          ...(message === undefined ? {} : { error: message }),
        })
        setSelectedModel(configured ? externalModel : null)
        setError(message ?? null)
        return
      }
      let nextStatus: TranslationStatus
      try {
        nextStatus = await provider.status(settings.endpoint)
      } catch (caught) {
        nextStatus = {
          available: false,
          version: '',
          deviceKey: settings.endpoint,
          error: errorMessage(caught),
        }
      }
      if (!active) return
      setStatus(nextStatus)
      if (!nextStatus.available) {
        setError(nextStatus.error ?? t('Ollama에 연결할 수 없습니다.'))
        return
      }

      try {
        const installed = await provider.listModels(settings.endpoint)
        if (!active) return
        setModels(installed)

        const chosenManualModel = manualModel(settings)
        if (chosenManualModel !== null) {
          setSelectedModel(chosenManualModel)
          return
        }

        const candidates = autoCandidates(installed)
        if (candidates.length === 0) return
        const cacheKey = createBenchmarkCacheKey(
          settings.endpoint,
          `${settings.executionMode}:${nextStatus.deviceKey}`,
          candidates,
        )
        if (!bypassCache) {
          const cached = readCachedModel(currentStorage, cacheKey, candidates)
          if (cached !== null) {
            setSelectedModel(cached)
            return
          }
        }

        let chosen: string | null = null
        let failure: string | null = null
        for (const candidate of candidates) {
          let result = await provider.benchmark(settings.endpoint, candidate.name)
          if (!active) return
          // 처음 부를 때는 모델을 메모리에 올리느라 몇 초 더 걸린다(4B 도 5초쯤). 한 번 더 재서 실제 번역 속도로 본다.
          if (result.success && result.elapsedMs > AUTO_TARGET_LATENCY_MS) {
            result = await provider.benchmark(settings.endpoint, candidate.name)
            if (!active) return
          }
          if (!result.success) {
            if (chosen === null) failure = result.error ?? t('{model} 모델로 번역하지 못했습니다.', { model: candidate.name })
            break
          }
          // 가장 작은 모델은 느려도 쓴다. 고를 모델이 하나도 없으면 번역이 아예 안 된다.
          if (chosen !== null && result.elapsedMs > AUTO_TARGET_LATENCY_MS) break
          chosen = candidate.name
        }
        setSelectedModel(chosen)
        if (chosen !== null) writeCachedModel(currentStorage, cacheKey, chosen)
        else if (failure !== null) setError(failure)
      } catch (caught) {
        if (active) setError(errorMessage(caught))
      }
    }

    void initialize()
    return () => {
      active = false
    }
  }, [
    benchmarkNonce,
    provider,
    refreshNonce,
    settings.customModel,
    settings.endpoint,
    settings.executionMode,
    settings.externalEndpoint,
    settings.externalModel,
    settings.externalProvider,
    settings.mode,
    // 클라우드 API 는 key 가 있어야 「설정됨」(로컬 모드에서는 key 가 바뀌지 않는다)
    settings.executionMode === 'external-api' ? externalApiKey.trim() !== '' : false,
  ])

  const cancelTranslation = useCallback(() => {
    requestId.current += 1
    setIsTranslating(false)
  }, [])

  const updateSettings = useCallback((update: Partial<TranslationSettings>) => {
    cancelTranslation()
    setSettings((current) => {
      const next = parseTranslationSettings({ ...current, ...update })
      saveTranslationSettings(next, storageRef.current)
      return next
    })
  }, [cancelTranslation])

  const externalProvider = settings.externalProvider
  const updateExternalApiKey = useCallback((apiKey: string) => {
    cancelTranslation()
    setExternalApiKey(apiKey)
    if (keySaveTimer.current !== null) clearTimeout(keySaveTimer.current)
    keySaveTimer.current = setTimeout(() => {
      keySaveTimer.current = null
      void saveTranslationApiKey(externalProvider, apiKey).catch(() => { /* 이번 실행에만 */ })
    }, 600)
  }, [cancelTranslation, externalProvider])

  const translate = useCallback(async (
    text: string,
    sourceLanguage?: string,
    targetOverride?: string,
  ): Promise<TranslationResult | null> => {
    if (selectedModel === null) {
      const message = status === null
        ? t('번역 모델을 확인하는 중입니다. 잠시 후 다시 시도하세요.')
        : status.available
          ? t('번역에 사용할 모델이 선택되지 않았습니다. 설정에서 모델을 설치하거나 선택하세요.')
          : status.error ?? t('Ollama에 연결할 수 없습니다. 설정에서 연결 상태를 확인하세요.')
      setError(message)
      throw new Error(message)
    }
    if (activeTranslations.has(provider)) throw new Error(t('번역 요청이 이미 진행 중입니다.'))

    const token = Symbol('translation')
    activeTranslations.set(provider, token)
    const currentRequest = requestId.current + 1
    requestId.current = currentRequest
    setIsTranslating(true)
    setError(null)

    try {
      const result = settings.executionMode === 'external-api'
        ? await translateWithExternalProvider(provider, {
            provider: settings.externalProvider,
            endpoint: settings.externalProvider === 'deepl' ? deeplEndpointForKey(settings.externalEndpoint, externalApiKey) : settings.externalEndpoint,
            apiKey: externalApiKey,
            model: selectedModel,
            text,
            targetLanguage: targetOverride ?? settings.targetLanguage,
            ...(sourceLanguage === undefined ? {} : { sourceLanguage }),
          })
        : await provider.translate(settings.endpoint, {
            text,
            targetLanguage: targetOverride ?? settings.targetLanguage,
            model: selectedModel,
            executionMode: settings.executionMode,
            ...(sourceLanguage === undefined ? {} : { sourceLanguage }),
          })
      if (requestId.current !== currentRequest || !mounted.current) return null
      setLastResult(result)
      return result
    } catch (caught) {
      if (requestId.current === currentRequest && mounted.current) setError(errorMessage(caught))
      throw caught
    } finally {
      if (activeTranslations.get(provider) === token) activeTranslations.delete(provider)
      if (requestId.current === currentRequest && mounted.current) setIsTranslating(false)
    }
  }, [externalApiKey, provider, selectedModel, settings.endpoint, settings.executionMode, settings.externalEndpoint, settings.externalProvider, settings.targetLanguage, status])

  const pullModel = useCallback(async (model: string): Promise<void> => {
    if (pullingRef.current !== null) throw new Error(t('{model} 모델을 받는 중입니다.', { model: pullingRef.current }))
    pullingRef.current = model
    setPullingModel(model)
    setPullProgress({ status: 'starting', completed: 0, total: 0 })
    setError(null)
    try {
      await provider.pullModel(settings.endpoint, model, (progress) => {
        if (mounted.current) setPullProgress(progress)
      })
      if (mounted.current) setRefreshNonce((value) => value + 1)
    } catch (caught) {
      if (mounted.current) {
        setError(errorMessage(caught))
        setPullProgress(null)
      }
      throw caught
    } finally {
      pullingRef.current = null
      if (mounted.current) setPullingModel(null)
    }
  }, [provider, settings.endpoint])

  const installRuntime = useCallback(async (): Promise<void> => {
    if (provider.installRuntime === undefined) {
      throw new Error(t('이 환경에서는 Ollama 자동 설치를 지원하지 않습니다.'))
    }
    setIsInstallingRuntime(true)
    setError(null)
    try {
      await provider.installRuntime()
      if (mounted.current) setRefreshNonce((value) => value + 1)
    } catch (caught) {
      if (mounted.current) setError(errorMessage(caught))
      throw caught
    } finally {
      if (mounted.current) setIsInstallingRuntime(false)
    }
  }, [provider])

  const rerunBenchmark = useCallback(() => {
    forceBenchmark.current = true
    setBenchmarkNonce((value) => value + 1)
  }, [])

  // 메모리에 올라간 로컬 모델(Ollama 의 llama-server). 클라우드 API 로 바꾸거나 다른 모델로 바꾸면 쓰던 것을 바로 내린다.
  // 그냥 두면 Ollama 가 마지막 요청 뒤 몇 분 동안 수 GB 를 잡고 있다
  const loadedModelRef = useRef<{ endpoint: string; model: string } | null>(null)
  useEffect(() => {
    const local = settings.executionMode !== 'external-api' && selectedModel !== null
    const next = local ? { endpoint: settings.endpoint, model: selectedModel } : null
    const previous = loadedModelRef.current
    if (previous !== null && (next === null || previous.model !== next.model || previous.endpoint !== next.endpoint)) {
      void provider.unload?.(previous.endpoint, previous.model).catch(() => undefined)
    }
    loadedModelRef.current = next
  }, [provider, selectedModel, settings.endpoint, settings.executionMode])
  const releaseLocalModel = useCallback(async () => {
    const loaded = loadedModelRef.current
    if (loaded === null || provider.unload === undefined) return
    // 닫기를 오래 붙잡지 않는다
    await Promise.race([
      provider.unload(loaded.endpoint, loaded.model).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ])
  }, [provider])

  return {
    status,
    settings,
    models,
    selectedModel,
    pullProgress,
    pullingModel,
    runtimeInstallSupported: provider.installRuntime !== undefined,
    isInstallingRuntime,
    isTranslating,
    lastResult,
    error,
    externalApiKey,
    updateSettings,
    updateExternalApiKey,
    translate,
    cancelTranslation,
    pullModel,
    installRuntime,
    rerunBenchmark,
    releaseLocalModel,
  }
}

async function translateWithExternalProvider(
  provider: TranslationProvider,
  request: Parameters<NonNullable<TranslationProvider['translateExternal']>>[0],
): Promise<TranslationResult> {
  if (provider.translateExternal === undefined) throw new Error(t('외부 API 번역을 지원하지 않는 환경입니다.'))
  if (request.apiKey.trim() === '' && !(request.provider !== undefined && isKeylessProvider(request.provider))) throw new Error(t('외부 API key를 입력하세요.'))
  return provider.translateExternal(request)
}
