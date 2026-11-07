import { useRef, useState } from 'react'
import { Select } from '../ui/Select'
import type { ExternalTranslationProvider, PullProgress, TranslationExecutionMode, TranslationStatus } from '../core/translation'
import { EXTERNAL_PROVIDERS, externalProviderInfo } from '../core/translationSettings'
import { RECOMMENDED_TRANSLATION_MODELS } from '../core/translation'
import type { TranslationCoordinator } from './useTranslation'
import { pick, t } from '../i18n'

export type TranslationSettingsState = Pick<
  TranslationCoordinator,
  | 'status'
  | 'settings'
  | 'models'
  | 'selectedModel'
  | 'pullProgress'
  | 'pullingModel'
  | 'runtimeInstallSupported'
  | 'isInstallingRuntime'
  | 'error'
  | 'externalApiKey'
  | 'updateSettings'
  | 'updateExternalApiKey'
  | 'pullModel'
  | 'installRuntime'
  | 'rerunBenchmark'
> & {
  readonly benchmarking?: boolean
  /** 연결 시험에 쓴다(짧은 문장을 실제로 번역해 본다) */
  readonly translate?: TranslationCoordinator['translate']
}

const TEST_SENTENCE = 'Hello. This is a connection test.'
type TestState =
  | { readonly status: 'idle' }
  | { readonly status: 'pending' }
  | { readonly status: 'ok'; readonly text: string; readonly ms: number; readonly model: string }
  | { readonly status: 'error'; readonly message: string }

const LOCAL_MODES: readonly (readonly [Exclude<TranslationExecutionMode, 'external-api'>, string, string])[] = [
  ['auto', '최대 속도 자동', '사용 가능한 CPU·GPU 중 Ollama가 가장 빠른 장치를 사용합니다.'],
  ['cpu', 'CPU', 'GPU가 없는 컴퓨터에서도 동작하는 로컬 실행 방식입니다.'],
  ['gpu', 'GPU', 'Ollama 서버가 지원하는 GPU 가속을 우선 사용합니다.'],
]

interface TranslationSettingsProps {
  readonly state: TranslationSettingsState
}

const MODEL_CHOICES = [
  {
    mode: '4b',
    label: 'TranslateGemma 4B',
    model: RECOMMENDED_TRANSLATION_MODELS['4b'],
    size: '약 3.3 GB',
  },
  {
    mode: '12b',
    label: 'TranslateGemma 12B',
    model: RECOMMENDED_TRANSLATION_MODELS['12b'],
    size: '약 8.1 GB',
  },
  {
    mode: '27b',
    label: 'TranslateGemma 27B',
    model: RECOMMENDED_TRANSLATION_MODELS['27b'],
    size: '약 17 GB',
  },
] as const

export function TranslationSettings({ state }: TranslationSettingsProps) {
  const installed = new Set(state.models.map((model) => model.name))
  const online = state.status?.available === true
  const external = state.settings.executionMode === 'external-api'
  const pulling = state.pullingModel
  const downloadActive = pulling !== null
  const pullingChoice = MODEL_CHOICES.find((choice) => choice.model === pulling)
  const hasRecommendedModel = MODEL_CHOICES.some((choice) => installed.has(choice.model))
  const chosenChoice = MODEL_CHOICES.find((choice) => choice.mode === state.settings.mode)
  const chosenMissing = online && chosenChoice !== undefined && !installed.has(chosenChoice.model)

  const downloadModel = (model: string) => {
    // 실패 내용은 위쪽 알림(state.error)으로 보인다.
    void Promise.resolve(state.pullModel(model)).catch(() => undefined)
  }

  const installRuntime = () => {
    void Promise.resolve(state.installRuntime()).catch(() => undefined)
  }

  // 번역 방식(로컬 Ollama / 클라우드 API)을 먼저 고른다. 로컬로 돌아오면 전에 고른 실행 장치를 되살린다
  const lastLocalRef = useRef<Exclude<TranslationExecutionMode, 'external-api'>>(external ? 'auto' : state.settings.executionMode as Exclude<TranslationExecutionMode, 'external-api'>)
  if (!external) lastLocalRef.current = state.settings.executionMode as Exclude<TranslationExecutionMode, 'external-api'>
  const chooseEngine = (cloud: boolean) => {
    if (cloud === external) return
    setTest({ status: 'idle' })
    state.updateSettings({ executionMode: cloud ? 'external-api' : lastLocalRef.current })
  }

  // 연결 시험: 짧은 문장을 지금 설정으로 실제로 번역해 본다
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const runTest = () => {
    if (state.translate === undefined) return
    setTest({ status: 'pending' })
    void state.translate(TEST_SENTENCE).then(
      (result) => setTest(result === null
        ? { status: 'error', message: t('응답이 없습니다.') }
        : { status: 'ok', text: result.translatedText, ms: result.elapsedMs, model: result.model }),
      (cause: unknown) => setTest({ status: 'error', message: cause instanceof Error ? cause.message : String(cause) }),
    )
  }

  return (
    <section className="translation-settings" aria-labelledby="translation-settings-title">
      <header className="translation-settings-header">
        <div className="translation-settings-heading">
          <h2 id="translation-settings-title">{external ? t('클라우드 API 번역') : t('로컬 번역')}</h2>
          <p className="translation-settings-description">
            {external
              ? t('Claude · OpenAI · Gemini 등 클라우드 모델로 번역합니다. API key 는 이 PC 의 자격 증명 저장소에 보관됩니다.')
              : t('PDF 원문은 그대로 두고 이 컴퓨터의 Ollama로 번역 블록을 만듭니다.')}
          </p>
        </div>
        <ConnectionStatus status={state.status} external={external} />
      </header>

      <div className="translation-settings-engine" role="radiogroup" aria-label={t('번역 방식')}>
        <button type="button" role="radio" aria-checked={!external} className={`translation-settings-engine-option${!external ? ' translation-settings-engine-on' : ''}`} onClick={() => chooseEngine(false)}>
          <strong>{t('로컬 (Ollama)')}</strong>
          <span>{t('이 PC 에서 번역합니다. 글이 밖으로 나가지 않습니다.')}</span>
        </button>
        <button type="button" role="radio" aria-checked={external} className={`translation-settings-engine-option${external ? ' translation-settings-engine-on' : ''}`} onClick={() => chooseEngine(true)}>
          <strong>{t('클라우드 API')}</strong>
          <span>{t('Claude · Gemini · Azure 번역기 · DeepL 등으로 빠르게 번역합니다. 고른 글이 그 서비스로 전송됩니다.')}</span>
        </button>
      </div>

      {(state.status?.error !== undefined || state.error != null) && (
        <p className="translation-settings-alert" role="alert">
          {state.status?.error ?? state.error}{external ? '' : ` ${t('Ollama를 실행하고 아래 서버 주소를 확인하세요.')}`}
        </p>
      )}

      {!external && !online && (
        <div className="translation-settings-runtime-action">
          {state.runtimeInstallSupported ? (
            <button
              type="button"
              className="translation-settings-download"
              disabled={state.isInstallingRuntime}
              onClick={installRuntime}
            >
              {state.isInstallingRuntime ? t('Ollama 설치 중') : t('Ollama 설치')}
            </button>
          ) : (
            <a
              className="translation-settings-download"
              href="https://ollama.com/download"
              target="_blank"
              rel="noreferrer"
            >
              {t('Ollama 받기')}
            </a>
          )}
        </div>
      )}

      <div className="translation-settings-fields">
        {!external && <label className="translation-settings-field">
          <span className="translation-settings-label">{t('Ollama 주소')}</span>
          <input
            className="translation-settings-input"
            type="url"
            value={state.settings.endpoint}
            spellCheck={false}
            onChange={(event) => state.updateSettings({ endpoint: event.currentTarget.value })}
          />
        </label>}

        <label className="translation-settings-field">
          <span className="translation-settings-label">{t('번역 언어')}</span>
          <Select
            className="translation-settings-select"
            ariaLabel={t('번역 언어')}
            value={state.settings.targetLanguage}
            options={[{ value: 'ko', label: '한국어' }, { value: 'en', label: 'English' }, { value: 'ja', label: '日本語' }, { value: 'zh', label: '中文' }]}
            onChange={(value) => state.updateSettings({ targetLanguage: value })}
          />
        </label>
      </div>

      {external && (
        <div className="translation-settings-fields translation-settings-external-fields">
          <label className="translation-settings-field">
            <span className="translation-settings-label">{t('제공자')}</span>
            <Select
              className="translation-settings-input"
              ariaLabel={t('제공자')}
              value={state.settings.externalProvider}
              options={EXTERNAL_PROVIDERS.map((item) => ({ value: item.id, label: t(item.label) }))}
              onChange={(value) => {
                const next = externalProviderInfo(value as ExternalTranslationProvider)
                state.updateSettings({ externalProvider: next.id, externalEndpoint: next.endpoint || state.settings.externalEndpoint, externalModel: next.models[0] ?? '' })
              }}
            />
          </label>
          <label className="translation-settings-field">
            <span className="translation-settings-label">API endpoint</span>
            <input
              className="translation-settings-input"
              type="url"
              value={state.settings.externalEndpoint}
              spellCheck={false}
              onChange={(event) => state.updateSettings({ externalEndpoint: event.currentTarget.value })}
            />
          </label>
          {state.settings.externalProvider === 'deepl' ? null : <label className="translation-settings-field">
            <span className="translation-settings-label">{state.settings.externalProvider === 'azure' ? t('리소스 지역 (예: global, koreacentral)') : 'API model'}</span>
            <input
              className="translation-settings-input"
              type="text"
              list="translation-external-models"
              value={state.settings.externalModel}
              spellCheck={false}
              onChange={(event) => state.updateSettings({ externalModel: event.currentTarget.value })}
            />
            <datalist id="translation-external-models">
              {externalProviderInfo(state.settings.externalProvider).models.map((model) => <option key={model} value={model} />)}
            </datalist>
          </label>}
          <label className="translation-settings-field">
            <span className="translation-settings-label">API key</span>
            <input
              className="translation-settings-input"
              type="password"
              placeholder={t(externalProviderInfo(state.settings.externalProvider).keyHint)}
              value={state.externalApiKey}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => state.updateExternalApiKey(event.currentTarget.value)}
            />
          </label>
        </div>
      )}

      {!external && <fieldset className="translation-settings-models translation-settings-execution-modes">
        <legend>{t('실행 장치')}</legend>
        <div className="translation-settings-model-list">
          {LOCAL_MODES.map(([executionMode, label, description]) => (
            <label className="translation-settings-model" key={executionMode}>
              <input
                type="radio"
                name="translation-execution-mode"
                value={executionMode}
                aria-label={t(label)}
                checked={state.settings.executionMode === executionMode}
                onChange={() => state.updateSettings({ executionMode })}
              />
              <span className="translation-settings-model-copy">
                <strong>{t(label)}</strong>
                <span>{t(description)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>}

      {state.translate === undefined ? null : (
        <div className="translation-settings-test">
          <button type="button" className="translation-settings-download" disabled={test.status === 'pending'} onClick={runTest}>
            {test.status === 'pending' ? t('시험하는 중…') : t('연결 시험')}
          </button>
          {test.status === 'ok' ? (
            <p className="translation-settings-test-result" role="status">
              <span>{t('{ms}ms · {model}', { ms: test.ms, model: test.model })}</span>
              <q>{test.text}</q>
            </p>
          ) : null}
          {test.status === 'error' ? <p className="translation-settings-test-error" role="alert">{test.message}</p> : null}
        </div>
      )}

      {!external && <fieldset className="translation-settings-models">
        <legend>{t('번역 모델')}</legend>

        <div className="translation-settings-model-row">
          <label className="translation-settings-model translation-settings-model-auto">
            <input
              type="radio"
              name="translation-model-mode"
              value="auto"
              aria-label={t('자동')}
              checked={state.settings.mode === 'auto'}
              onChange={() => state.updateSettings({ mode: 'auto' })}
            />
            <span className="translation-settings-model-copy">
              <strong>{t('자동')}</strong>
              <span>{t('받아 둔 모델 가운데 이 컴퓨터에서 충분히 빠른 가장 큰 모델을 골라 씁니다. 모델은 용량이 커서 받기만 직접 누릅니다.')}</span>
            </span>
          </label>
          {online && !hasRecommendedModel && (
            <div className="translation-settings-model-hint" role="note">
              {pullingChoice !== undefined
                ? <span>{t('{model}을 받고 있습니다. 다 받으면 자동으로 이 모델을 씁니다.', { model: pullingChoice.label })}</span>
                : <>
                    <span>{t('아직 받은 번역 모델이 없습니다. 처음이라면 가장 가벼운 4B를 권합니다.')}</span>
                    <button
                      type="button"
                      className="translation-settings-download"
                      disabled={downloadActive}
                      onClick={() => downloadModel(MODEL_CHOICES[0].model)}
                    >
                      {t('추천 모델(4B) 받기')}
                    </button>
                  </>}
            </div>
          )}
        </div>

        <div className="translation-settings-model-list">
          {MODEL_CHOICES.map((choice) => {
            const isInstalled = installed.has(choice.model)
            const isPulling = pulling === choice.model
            return (
              <article className="translation-settings-model-row" key={choice.mode} aria-busy={isPulling || undefined}>
                <label className="translation-settings-model">
                  <input
                    type="radio"
                    name="translation-model-mode"
                    value={choice.mode}
                    aria-label={choice.label}
                    checked={state.settings.mode === choice.mode}
                    onChange={() => state.updateSettings({ mode: choice.mode })}
                  />
                  <span className="translation-settings-model-copy">
                    <strong>{choice.label}</strong>
                    <span>{choice.label} · {t(choice.size)}{online && !isInstalled && !isPulling ? ` · ${t('아직 받지 않음')}` : ''}</span>
                  </span>
                </label>

                <div className="translation-settings-model-action">
                  {isInstalled ? (
                    <span className="translation-settings-installed">{t('설치됨')}</span>
                  ) : isPulling ? (
                    <span className="translation-settings-pulling">
                      <span className="translation-settings-spinner" aria-hidden="true" />
                      {t('받는 중')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="translation-settings-download"
                      disabled={!online || downloadActive}
                      title={downloadActive ? t('다른 모델을 받는 중') : undefined}
                      onClick={() => downloadModel(choice.model)}
                    >
                      {t('{model} 다운로드', { model: choice.label })}
                    </button>
                  )}
                </div>
                {isPulling && (
                  <DownloadProgress label={choice.label} progress={state.pullProgress} />
                )}
              </article>
            )
          })}
        </div>

        <label className="translation-settings-model translation-settings-model-custom">
          <input
            type="radio"
            name="translation-model-mode"
            value="custom"
            checked={state.settings.mode === 'custom'}
            onChange={() => state.updateSettings({ mode: 'custom' })}
          />
          <span className="translation-settings-model-copy"><strong>{t('사용자 지정')}</strong></span>
        </label>

        {state.settings.mode === 'custom' && (
          <label className="translation-settings-field translation-settings-custom-field">
            <span className="translation-settings-label">{t('사용자 지정 모델')}</span>
            <input
              className="translation-settings-input"
              type="text"
              value={state.settings.customModel}
              placeholder={t('예: qwen3:8b')}
              spellCheck={false}
              onChange={(event) => state.updateSettings({ customModel: event.currentTarget.value })}
            />
          </label>
        )}
      </fieldset>}

      {!external && <div className="translation-settings-benchmark">
        <p className="translation-settings-selected-model">
          {t('선택 모델: {model}', { model: state.selectedModel ?? (online && !hasRecommendedModel && state.settings.mode === 'auto'
            ? t('받은 모델이 없어 아직 고르지 못함')
            : t('아직 선택되지 않음')) })}
          {chosenMissing && (pulling === chosenChoice?.model ? ` ${t('(받는 중)')}` : ` ${t('(아직 받지 않음 · 위에서 다운로드를 누르세요)')}`)}
        </p>
        <button
          type="button"
          className="translation-settings-benchmark-button"
          disabled={!online || state.benchmarking === true}
          onClick={() => void state.rerunBenchmark()}
        >
          {state.benchmarking === true ? t('속도 측정 중') : t('속도 다시 측정')}
        </button>
      </div>}

      {!external && <aside className="translation-settings-license" aria-label={t('모델 라이선스 안내')}>
        {pick({
          ko: <p>
            IWAE는 모델 가중치를 포함하지 않습니다. TranslateGemma는 별도로 내려받으며,
            다운로드 전에 <a
              href="https://ai.google.dev/gemma/terms"
              target="_blank"
              rel="noreferrer"
            >Gemma 이용 약관</a>을 검토하세요.
          </p>,
          en: <p>
            IWAE does not include model weights. TranslateGemma is downloaded separately;
            review the <a
              href="https://ai.google.dev/gemma/terms"
              target="_blank"
              rel="noreferrer"
            >Gemma Terms of Use</a> before downloading.
          </p>,
        })}
      </aside>}
    </section>
  )
}

function ConnectionStatus({
  status,
  external,
}: {
  readonly status: TranslationStatus | null
  readonly external: boolean
}) {
  if (status === null) {
    return <p className="translation-settings-status translation-settings-status-checking">{t('연결 확인 중')}</p>
  }
  if (!status.available) {
    return <p className="translation-settings-status translation-settings-status-offline">
      {external ? t('API 설정 필요') : t('Ollama 연결 안 됨')}
    </p>
  }
  return (
    <p className="translation-settings-status translation-settings-status-online">
      <span>{external ? t('API 설정됨') : t('Ollama 연결됨')}</span>
      <span className="translation-settings-version">{external ? status.version : t('버전 {version}', { version: status.version })}</span>
    </p>
  )
}

const PULL_STEPS: readonly (readonly [RegExp, string])[] = [
  [/^starting$/, 'Ollama에 요청하는 중'],
  [/^pulling manifest/, '모델 정보 확인 중'],
  [/^pulling /, '받는 중'],
  [/^downloading/, '받는 중'],
  [/^verifying/, '받은 파일 확인 중'],
  [/^writing manifest|^removing/, '마무리하는 중'],
  [/^success$/, '다 받았습니다'],
]

function pullStepLabel(status: string): string {
  const label = PULL_STEPS.find(([pattern]) => pattern.test(status))?.[1]
  return label === undefined ? status : t(label)
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(0, Math.round(bytes / 1024))} KB`
}

export function DownloadProgress({
  label,
  progress,
}: {
  readonly label: string
  readonly progress: PullProgress | null
}) {
  const known = progress !== null && progress.total > 0
  const percent = known
    ? Math.min(100, Math.max(0, Math.floor((progress.completed / progress.total) * 100)))
    : 0
  const step = pullStepLabel(progress?.status ?? 'starting')
  return (
    <div className="translation-settings-progress" role="status">
      <progress
        aria-label={t('{model} 다운로드 진행률', { model: label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? percent : undefined}
        max={100}
        {...(known ? { value: percent } : {})}
      />
      <span>
        {step}
        {known && ` · ${formatBytes(progress.completed)} / ${formatBytes(progress.total)} · ${percent}%`}
      </span>
    </div>
  )
}
