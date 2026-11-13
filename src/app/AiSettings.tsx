import { useCallback, useEffect, useState } from 'react'
import { ArrowClockwise, Copy, Key, ShieldCheck } from '@phosphor-icons/react'
import {
  aiApiConfigure,
  aiApiRegenerateToken,
  aiApiStatus,
  aiEmbeddingConfigure,
  aiSettingsGet,
  listenRagProgress,
  ragIndex,
  ragStatus,
  type AiSettings as Settings,
  type ApiServerStatus,
  type RagStatus,
} from '../bridge/ai'
import { errorText } from '../core/errorText'
import type { PullProgress } from '../core/translation'
import { DownloadProgress } from './TranslationSettings'
import '../ui/ai-settings.css'
import { t } from '../i18n'

interface AiSettingsProps {
  /** Ollama 에 설치된 모델 이름들 */
  readonly listModels: (endpoint: string) => Promise<readonly string[]>
  readonly pullModel: (endpoint: string, model: string, onProgress?: (progress: PullProgress) => void) => Promise<void>
}

export function connectionCommand(port: number, token: string): string {
  return `claude mcp add --transport http iwae http://127.0.0.1:${port}/mcp --header "Authorization: Bearer ${token}"`
}

/**
 * 설정의 「외부 AI 연결」. MCP 서버를 켜고 끄고, Claude Code 에 붙일 명령을 복사하고,
 * 검색 색인과 의미 검색 모델을 관리한다.
 */
export function AiSettings({ listModels, pullModel }: AiSettingsProps) {
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined)
  const [server, setServer] = useState<ApiServerStatus>({ running: false, error: null })
  const [index, setIndex] = useState<RagStatus | null>(null)
  const [port, setPort] = useState('47821')
  const [modelInstalled, setModelInstalled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pullProgress, setPullProgress] = useState<PullProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshIndex = useCallback(() => {
    void ragStatus().then(setIndex).catch(() => undefined)
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([aiSettingsGet(), aiApiStatus()]).then(([loaded, status]) => {
      if (!active) return
      setSettings(loaded)
      if (loaded !== null) setPort(String(loaded.api.port))
      if (status !== null) setServer(status)
    }).catch((cause: unknown) => setError(errorText(cause)))
    refreshIndex()
    let stop: () => void = () => undefined
    void listenRagProgress((progress) => {
      if (progress.done) refreshIndex()
    }).then((unlisten) => {
      if (active) stop = unlisten
      else unlisten()
    })
    return () => {
      active = false
      stop()
    }
  }, [refreshIndex])

  const embedding = settings?.embedding
  useEffect(() => {
    if (embedding === undefined) return
    let active = true
    void listModels(embedding.endpoint)
      .then((names) => {
        if (active) setModelInstalled(names.some((name) => name === embedding.model || name.startsWith(`${embedding.model}:`)))
      })
      .catch(() => { if (active) setModelInstalled(null) })
    return () => { active = false }
  }, [embedding, listModels])

  if (settings === undefined) return <p className="settings-empty-copy">{t('불러오는 중…')}</p>
  if (settings === null) return <p className="settings-empty-copy">{t('외부 AI 연결은 데스크톱 앱에서만 쓸 수 있습니다.')}</p>

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(null)
    }
  }

  const portNumber = Number.parseInt(port, 10)
  const portValid = Number.isInteger(portNumber) && portNumber >= 1024 && portNumber <= 65535
  const command = connectionCommand(settings.api.port, settings.api.token)

  const setEnabled = (enabled: boolean) => run('api', async () => {
    if (!portValid) throw new Error(t('포트는 1024–65535 사이여야 합니다.'))
    const status = await aiApiConfigure(enabled, portNumber)
    setSettings({ ...settings, api: { ...settings.api, enabled, port: portNumber } })
    if (status !== null) setServer(status)
  })

  const enableSemantic = (enabled: boolean) => run('embedding', async () => {
    const next = await aiEmbeddingConfigure({ ...settings.embedding, enabled })
    if (next !== null) setSettings(next)
  })

  return (
    <section className="ai-settings" aria-labelledby="ai-settings-title">
      <header className="settings-section-heading">
        <div>
          <h2 id="ai-settings-title">{t('외부 AI 연결')}</h2>
          <p>{t('Claude Code 같은 AI가 이 Vault를 검색하고, 찾은 위치를 IWAE에 알려 줄 수 있습니다.')}</p>
        </div>
      </header>

      <div className="settings-list">
        <div className="settings-toggle-row">
          <span>
            <strong>{t('외부 AI가 IWAE를 사용하도록 허용')}</strong>
            <small><span>{server.running ? t('실행 중') : t('꺼짐')}</span> · 127.0.0.1:{settings.api.port}</small>
          </span>
          <button
            type="button"
            role="switch"
            className="ai-settings-switch"
            aria-label={t('외부 AI가 IWAE를 사용하도록 허용')}
            aria-checked={settings.api.enabled}
            disabled={busy === 'api'}
            onClick={() => void setEnabled(!settings.api.enabled)}
          >
            <span />
          </button>
        </div>
        <label className="ai-settings-field">
          <span>{t('포트')}</span>
          <input
            aria-label={t('포트')}
            inputMode="numeric"
            value={port}
            onChange={(event) => setPort(event.target.value)}
            onBlur={() => {
              if (portValid && portNumber !== settings.api.port && settings.api.enabled) void setEnabled(true)
            }}
          />
        </label>
      </div>
      {server.error !== null ? <p className="settings-inline-error" role="alert">{server.error}</p> : null}

      <div className="ai-settings-command">
        <span>{t('Claude Code에서 한 번 실행하세요')}</span>
        <textarea aria-label={t('Claude Code 연결 명령')} readOnly rows={3} value={command} />
        <div className="ai-settings-actions">
          <button type="button" onClick={() => void navigator.clipboard.writeText(command).catch(() => undefined)}>
            <Copy size={14} aria-hidden="true" /> {t('명령 복사')}
          </button>
          <button
            type="button"
            disabled={busy === 'token'}
            onClick={() => void run('token', async () => {
              const next = await aiApiRegenerateToken()
              if (next !== null) setSettings(next)
            })}
          >
            <Key size={14} aria-hidden="true" /> {t('토큰 재발급')}
          </button>
        </div>
        <p className="ai-settings-note">
          <ShieldCheck size={14} aria-hidden="true" />
          {t('이 PC에서 토큰을 가진 프로그램만 접속할 수 있습니다. 외부 AI는 자료를 읽고, 위치를 알리고, 형광펜과 노트를 추가하거나 고칠 수 있습니다. PDF 원본은 바꾸지 못합니다.')}
        </p>
      </div>

      <div className="ai-settings-index">
        <div>
          <strong>{t('검색 색인')}</strong>
          <small>
            {index === null
              ? t('Vault를 열면 만들어집니다')
              : t('문서 {documents} · 조각 {chunks} · 의미 벡터 {embedded}', { documents: index.documents, chunks: index.chunks, embedded: index.embedded })}
          </small>
        </div>
        <button type="button" disabled={index?.running === true} onClick={() => void ragIndex().then(refreshIndex)}>
          <ArrowClockwise size={14} aria-hidden="true" /> {index?.running ? t('색인 중…') : t('지금 색인')}
        </button>
      </div>

      <div className="settings-list">
        <div className="settings-toggle-row">
          <span>
            <strong>{t('의미 검색({model})', { model: settings.embedding.model })}</strong>
            <small>{t('비슷한 뜻의 구절도 찾습니다. Ollama에서 로컬로 실행됩니다.')}</small>
          </span>
          <button
            type="button"
            role="switch"
            className="ai-settings-switch"
            aria-label={t('의미 검색 사용')}
            aria-checked={settings.embedding.enabled}
            disabled={busy === 'embedding' || modelInstalled === false}
            onClick={() => void enableSemantic(!settings.embedding.enabled)}
          >
            <span />
          </button>
        </div>
        {modelInstalled === false ? (
          <div className="ai-settings-model">
            <span>{t('{model} 모델이 아직 없습니다', { model: settings.embedding.model })}</span>
            <button
              type="button"
              disabled={busy === 'pull'}
              onClick={() => void run('pull', async () => {
                setPullProgress(null)
                await pullModel(settings.embedding.endpoint, settings.embedding.model, setPullProgress)
                setModelInstalled(true)
                const next = await aiEmbeddingConfigure({ ...settings.embedding, enabled: true })
                if (next !== null) setSettings(next)
              })}
            >
              {busy === 'pull' ? t('받는 중…') : t('{model} 받기', { model: settings.embedding.model })}
            </button>
            {busy === 'pull' ? <DownloadProgress label={settings.embedding.model} progress={pullProgress} /> : null}
          </div>
        ) : null}
        {modelInstalled === null ? <p className="ai-settings-note">{t('Ollama에 연결하지 못해 모델 상태를 확인할 수 없습니다.')}</p> : null}
      </div>
      {error !== null ? <p className="settings-inline-error" role="alert">{error}</p> : null}
    </section>
  )
}
