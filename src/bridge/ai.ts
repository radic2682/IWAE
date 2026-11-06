/**
 * 바깥 AI 연동(검색 색인·MCP 서버)의 이음매. 데스크톱이 아니면(브라우저 미리보기) 아무것도
 * 하지 않고 빈 값을 돌려준다 — 색인과 서버는 Rust 안에만 있다.
 */

import { isDesktop } from './window'

export interface RagHit {
  docId: string
  title: string
  kind: 'pdf' | 'markdown'
  /** 1-기반 */
  page: number
  charStart: number
  charEnd: number
  snippet: string
  score: number
  matchedBy: ('keyword' | 'semantic')[]
}

export interface RagStatus {
  documents: number
  chunks: number
  embedded: number
  lastIndexedAt: string | null
  running: boolean
  vaultOpen: boolean
}

export interface RagProgress {
  indexed: number
  total: number
  done: boolean
  error: string | null
}

export interface EmbeddingSettings {
  enabled: boolean
  endpoint: string
  model: string
}

export interface ApiSettings {
  enabled: boolean
  port: number
  token: string
}

export interface AiSettings {
  api: ApiSettings
  embedding: EmbeddingSettings
}

export interface ApiServerStatus {
  running: boolean
  error: string | null
}

/** 바깥 AI 가 `show_location` 으로 보낸 자리 */
export interface AiLocation {
  id: string
  docId: string
  /** 1-기반 */
  page: number
  charStart?: number | null
  charEnd?: number | null
  quote?: string | null
  message?: string | null
  receivedAt: string
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return args === undefined ? invoke<T>(command) : invoke<T>(command, args)
}

export async function aiSetVault(root: string | null): Promise<void> {
  if (!isDesktop()) return
  await call('ai_set_vault', { root })
}

export async function ragIndex(): Promise<void> {
  if (!isDesktop()) return
  await call('rag_index')
}

export async function ragStatus(): Promise<RagStatus | null> {
  if (!isDesktop()) return null
  return call<RagStatus>('rag_status')
}

export async function ragSearch(query: string, limit?: number, kind?: 'pdf' | 'markdown'): Promise<RagHit[]> {
  if (!isDesktop()) return []
  return call<RagHit[]>('rag_search', { query, limit, kind })
}

export async function aiSettingsGet(): Promise<AiSettings | null> {
  if (!isDesktop()) return null
  return call<AiSettings>('ai_settings_get')
}

export async function aiEmbeddingConfigure(embedding: EmbeddingSettings): Promise<AiSettings | null> {
  if (!isDesktop()) return null
  return call<AiSettings>('ai_embedding_configure', { embedding })
}

export async function aiApiConfigure(enabled: boolean, port: number): Promise<ApiServerStatus | null> {
  if (!isDesktop()) return null
  return call<ApiServerStatus>('ai_api_configure', { enabled, port })
}

export async function aiApiStatus(): Promise<ApiServerStatus | null> {
  if (!isDesktop()) return null
  return call<ApiServerStatus>('ai_api_status')
}

export async function aiApiRegenerateToken(): Promise<AiSettings | null> {
  if (!isDesktop()) return null
  return call<AiSettings>('ai_api_regenerate_token')
}

async function listenTo<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (!isDesktop()) return () => undefined
  const { listen } = await import('@tauri-apps/api/event')
  return listen<T>(event, (message) => handler(message.payload))
}

export function listenRagProgress(handler: (progress: RagProgress) => void): Promise<() => void> {
  return listenTo('rag-progress', handler)
}

export function listenAiLocation(handler: (location: AiLocation) => void): Promise<() => void> {
  return listenTo('ai-location', handler)
}
