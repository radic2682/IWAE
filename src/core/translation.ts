export type TranslationModelMode = 'auto' | '4b' | '12b' | '27b' | 'custom'
export type TranslationExecutionMode = 'auto' | 'cpu' | 'gpu' | 'external-api'
export type LocalTranslationExecutionMode = Exclude<TranslationExecutionMode, 'external-api'>

export const RECOMMENDED_TRANSLATION_MODELS = {
  '4b': 'translategemma:4b',
  '12b': 'translategemma:12b',
  '27b': 'translategemma:27b',
} as const satisfies Record<Exclude<TranslationModelMode, 'auto' | 'custom'>, string>

export interface TranslationStatus {
  readonly available: boolean
  readonly version: string
  readonly deviceKey: string
  readonly error?: string
}

export interface TranslationModel {
  readonly name: string
  readonly digest: string
  readonly size: number
  readonly modifiedAt?: string
}

export interface PullProgress {
  readonly status: string
  readonly completed: number
  readonly total: number
}

export interface TranslationRequest {
  readonly text: string
  readonly targetLanguage: string
  readonly model: string
  readonly executionMode?: LocalTranslationExecutionMode
  readonly sourceLanguage?: string
}

export interface TranslationResult {
  readonly translatedText: string
  readonly model: string
  readonly elapsedMs: number
}

/** 외부(클라우드) 번역 제공자. anthropic 은 Claude Messages API, 나머지는 OpenAI 호환 chat/completions */
export type ExternalTranslationProvider = 'google' | 'anthropic' | 'openai' | 'gemini' | 'compatible' | 'azure' | 'deepl'

export interface ExternalTranslationRequest {
  readonly provider?: ExternalTranslationProvider
  readonly endpoint: string
  readonly apiKey: string
  readonly model: string
  readonly text: string
  readonly targetLanguage: string
  readonly sourceLanguage?: string
}

export interface BenchmarkResult {
  readonly model: TranslationModel
  readonly elapsedMs: number
  readonly success: boolean
  readonly error?: string
}

export interface TranslationProvider {
  installRuntime?(): Promise<void>
  status(endpoint: string): Promise<TranslationStatus>
  listModels(endpoint: string): Promise<readonly TranslationModel[]>
  pullModel(
    endpoint: string,
    model: string,
    onProgress: (value: PullProgress) => void,
  ): Promise<void>
  benchmark(endpoint: string, model: string): Promise<BenchmarkResult>
  translate(endpoint: string, request: TranslationRequest): Promise<TranslationResult>
  translateExternal?(request: ExternalTranslationRequest): Promise<TranslationResult>
  /** 메모리에 올라간 로컬 모델을 바로 내린다(Ollama keep_alive: 0) */
  unload?(endpoint: string, model: string): Promise<void>
}

export function selectAutoModel(
  results: readonly BenchmarkResult[],
  targetLatencyMs: number,
): TranslationModel | undefined {
  let selected: TranslationModel | undefined

  for (const result of results) {
    if (
      !result.success
      || !Number.isFinite(result.elapsedMs)
      || result.elapsedMs < 0
      || result.elapsedMs > targetLatencyMs
    ) {
      continue
    }
    if (selected === undefined || result.model.size > selected.size) selected = result.model
  }

  return selected
}

export function createBenchmarkCacheKey(
  endpoint: string,
  deviceKey: string,
  models: readonly TranslationModel[],
): string {
  const modelVersions = models
    .map((model) => `${model.name}@${model.digest}`)
    .sort((left, right) => left.localeCompare(right))
    .join(',')
  return `iwae:translation-benchmark:v1:${endpoint}|${deviceKey}|${modelVersions}`
}
