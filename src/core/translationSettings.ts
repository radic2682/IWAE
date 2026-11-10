import type { ExternalTranslationProvider, TranslationExecutionMode, TranslationModelMode } from './translation'
import { t } from '../i18n'

export type { TranslationExecutionMode } from './translation'

export interface TranslationSettings {
  /** 번역 기능을 쓰는가(끄면 글 고르기 메뉴·노트 카드의 번역 단추가 사라진다) */
  readonly enabled: boolean
  readonly executionMode: TranslationExecutionMode
  readonly mode: TranslationModelMode
  readonly targetLanguage: string
  readonly endpoint: string
  readonly customModel: string
  readonly externalProvider: ExternalTranslationProvider
  readonly externalEndpoint: string
  readonly externalModel: string
}

/** 외부 번역 제공자별 기본 주소와 고를 수 있는 모델(비워 두면 직접 쓴다) */
export const EXTERNAL_PROVIDERS: readonly {
  readonly id: ExternalTranslationProvider
  readonly label: string
  readonly endpoint: string
  readonly models: readonly string[]
  readonly keyHint: string
  /** 카드에 보이는 한 줄: 무엇이 필요한가 */
  readonly need: string
  /** 키를 받는 곳(없으면 링크를 보이지 않는다) */
  readonly keyUrl?: string
  /** API key 없이 쓰는 제공자 */
  readonly keyless?: boolean
}[] = [
  { id: 'google', get label() { return t('Google 번역 (무료 · 키 없음)') }, endpoint: 'https://translate.googleapis.com', models: [], keyHint: '', keyless: true, get need() { return t('필요한 것 없음 · 바로 씁니다') } },
  { id: 'anthropic', label: 'Claude (Anthropic)', endpoint: 'https://api.anthropic.com', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], get keyHint() { return t('console.anthropic.com 에서 만든 API key') }, get need() { return t('Anthropic API key') }, keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', label: 'OpenAI', endpoint: 'https://api.openai.com/v1', models: [], get keyHint() { return t('platform.openai.com 에서 만든 API key') }, get need() { return t('OpenAI API key + 모델 이름') }, keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'gemini', label: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', models: [], get keyHint() { return t('Google AI Studio 에서 만든 API key') }, get need() { return t('Google AI Studio API key + 모델 이름') }, keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'azure', get label() { return t('Azure Translator (번역 전용)') }, endpoint: 'https://api.cognitive.microsofttranslator.com', models: ['global', 'koreacentral', 'eastasia', 'japaneast'], get keyHint() { return t('Azure 포털 「번역기」 리소스의 키 1') }, get need() { return t('Azure 키 + 리소스 지역') }, keyUrl: 'https://portal.azure.com/#create/Microsoft.CognitiveServicesTextTranslation' },
  { id: 'deepl', get label() { return t('DeepL (번역 전용)') }, endpoint: 'https://api-free.deepl.com', models: [], get keyHint() { return t('DeepL 계정의 API key (무료 키는 :fx 로 끝남)') }, get need() { return t('DeepL API key (Free 또는 Pro)') }, keyUrl: 'https://www.deepl.com/your-account/keys' },
  { id: 'compatible', get label() { return t('OpenAI 호환 (OpenRouter · Groq · LM Studio 등)') }, endpoint: '', models: [], get keyHint() { return t('그 서비스의 API key') }, get need() { return t('서비스 주소 + API key + 모델 이름') } },
]

export function externalProviderInfo(id: ExternalTranslationProvider) {
  return EXTERNAL_PROVIDERS.find((item) => item.id === id) ?? EXTERNAL_PROVIDERS[0]!
}

export interface TranslationSettingsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const TRANSLATION_SETTINGS_KEY = 'iwae:translation-settings:v1'

// 저장값에 없는 칸을 채우는 기본값(예전 설정은 로컬 자동 그대로 읽는다)
export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  enabled: true,
  executionMode: 'auto',
  mode: 'auto',
  targetLanguage: 'ko',
  endpoint: 'http://127.0.0.1:11434',
  customModel: '',
  externalProvider: 'anthropic',
  externalEndpoint: 'https://api.anthropic.com',
  externalModel: 'claude-opus-5-5',
}

/** 처음 쓰는 사람(저장된 번역 설정이 없음): 설치·키 없이 바로 되는 Google 번역으로 시작한다 */
export const FIRST_RUN_TRANSLATION_SETTINGS: TranslationSettings = {
  ...DEFAULT_TRANSLATION_SETTINGS,
  executionMode: 'external-api',
  externalProvider: 'google',
  externalEndpoint: 'https://translate.googleapis.com',
  externalModel: '',
}

/** API key 없이 쓰는 제공자인가 */
export function isKeylessProvider(id: ExternalTranslationProvider): boolean {
  return externalProviderInfo(id).keyless === true
}

const EXTERNAL_PROVIDER_IDS = new Set<ExternalTranslationProvider>(['google', 'anthropic', 'openai', 'gemini', 'compatible', 'azure', 'deepl'])

const MODES = new Set<TranslationModelMode>(['auto', '4b', '12b', '27b', 'custom'])
const EXECUTION_MODES = new Set<TranslationExecutionMode>(['auto', 'cpu', 'gpu', 'external-api'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

function validEndpoint(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_TRANSLATION_SETTINGS.endpoint
  const endpoint = value.trim()
  try {
    const parsed = new URL(endpoint)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? endpoint
      : DEFAULT_TRANSLATION_SETTINGS.endpoint
  } catch {
    return DEFAULT_TRANSLATION_SETTINGS.endpoint
  }
}

export function parseTranslationSettings(raw: unknown): TranslationSettings {
  if (!isRecord(raw)) return { ...DEFAULT_TRANSLATION_SETTINGS }

  const mode = typeof raw.mode === 'string' && MODES.has(raw.mode as TranslationModelMode)
    ? raw.mode as TranslationModelMode
    : DEFAULT_TRANSLATION_SETTINGS.mode

  const executionMode = typeof raw.executionMode === 'string'
    && EXECUTION_MODES.has(raw.executionMode as TranslationExecutionMode)
    ? raw.executionMode as TranslationExecutionMode
    : DEFAULT_TRANSLATION_SETTINGS.executionMode

  return {
    enabled: raw.enabled !== false,
    executionMode,
    mode,
    targetLanguage: nonEmptyString(raw.targetLanguage, DEFAULT_TRANSLATION_SETTINGS.targetLanguage),
    endpoint: validEndpoint(raw.endpoint),
    customModel: typeof raw.customModel === 'string' ? raw.customModel.trim() : '',
    // 예전 설정(제공자 없음)은 OpenAI 호환으로 읽는다(그때는 그것만 있었다)
    externalProvider: typeof raw.externalProvider === 'string' && EXTERNAL_PROVIDER_IDS.has(raw.externalProvider as ExternalTranslationProvider)
      ? raw.externalProvider as ExternalTranslationProvider
      : raw.externalEndpoint === undefined ? DEFAULT_TRANSLATION_SETTINGS.externalProvider : 'compatible',
    externalEndpoint: validExternalEndpoint(raw.externalEndpoint),
    externalModel: typeof raw.externalModel === 'string' ? raw.externalModel.trim() : raw.externalEndpoint === undefined ? DEFAULT_TRANSLATION_SETTINGS.externalModel : '',
  }
}

function validExternalEndpoint(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_TRANSLATION_SETTINGS.externalEndpoint
  const endpoint = value.trim()
  try {
    const parsed = new URL(endpoint)
    const loopback = parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1'
      || parsed.hostname === '[::1]'
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' && loopback
      ? endpoint.replace(/\/$/, '')
      : DEFAULT_TRANSLATION_SETTINGS.externalEndpoint
  } catch {
    return DEFAULT_TRANSLATION_SETTINGS.externalEndpoint
  }
}

function browserStorage(): TranslationSettingsStorage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export function loadTranslationSettings(
  storage: TranslationSettingsStorage | undefined = browserStorage(),
): TranslationSettings {
  if (storage === undefined) return { ...DEFAULT_TRANSLATION_SETTINGS }
  try {
    const saved = storage.getItem(TRANSLATION_SETTINGS_KEY)
    return saved === null
      ? { ...FIRST_RUN_TRANSLATION_SETTINGS }
      : parseTranslationSettings(JSON.parse(saved))
  } catch {
    return { ...DEFAULT_TRANSLATION_SETTINGS }
  }
}

export function saveTranslationSettings(
  settings: unknown,
  storage: TranslationSettingsStorage | undefined = browserStorage(),
): void {
  if (storage === undefined) return
  const safeSettings = parseTranslationSettings(settings)
  try {
    storage.setItem(TRANSLATION_SETTINGS_KEY, JSON.stringify(safeSettings))
  } catch {
    return
  }
}

/** DeepL 은 키로 Free/Pro 가 갈린다(무료 키는 :fx 로 끝나고 api-free.deepl.com). 주소가 키와 어긋나면 맞춰 준다 */
export function deeplEndpointForKey(endpoint: string, apiKey: string): string {
  const free = apiKey.trim().endsWith(':fx')
  if (!/^https:\/\/api(-free)?\.deepl\.com/u.test(endpoint)) return endpoint
  return free ? 'https://api-free.deepl.com' : 'https://api.deepl.com'
}
