import { useEffect, useSyncExternalStore } from 'react'
import { findTranslation, upsertTranslation, type TranslationCacheEntry } from '../core/translationCache'
import { readTranslationCache, subscribeVaultFile, translationCacheCodec, writeTranslationCache, type VaultHandle } from '../bridge/vault'

/**
 * 번역 캐시(번역 기록) 저장소: 노트 카드의 「번역」, 글 고르기의 「번역」, 설정이 함께 쓴다.
 * - 같은 글·같은 언어·같은 번역기면 요청 없이 꺼낸다(설정에서 끌 수 있다, 기본 켜짐)
 * - Vault 의 `.iwae/translations.json` 에 남는다
 */

const ENABLED_KEY = 'iwae:translation-cache:v1'

function readEnabled(): boolean {
  try { return window.localStorage.getItem(ENABLED_KEY) !== 'off' } catch { return true }
}

type TranslateFn = (text: string, targetLanguage?: string) => Promise<{ readonly text: string } | null>

let entries: readonly TranslationCacheEntry[] = []
let enabled = readEnabled()
let vaultHandle: VaultHandle | null = null
let translateFn: TranslateFn | null = null
let target = ''
let provider = ''
let saveTimer = 0
let version = 0
const listeners = new Set<() => void>()

function emit() {
  version += 1
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function scheduleSave() {
  window.clearTimeout(saveTimer)
  const vault = vaultHandle
  if (vault === null) return
  saveTimer = window.setTimeout(() => { void writeTranslationCache(vault, entries).catch(() => { /* 다음에 다시 쓴다 */ }) }, 600)
}

/** 캐시에 있는 번역(지금 언어·번역기 기준). 없으면 undefined */
export function cachedTranslation(text: string, targetOverride?: string): string | undefined {
  if (!enabled || provider === '') return undefined
  return findTranslation(entries, text, targetOverride ?? target, provider)?.translated
}

/** 번역: 캐시에 있으면 꺼내고, 없으면 번역기에 묻고 캐시에 남긴다. force 면 캐시를 건너뛰고 새로 받는다 */
export async function translateWithCache(text: string, meta: { readonly docId?: string; readonly page?: number } = {}, force = false, targetOverride?: string): Promise<string | null> {
  return translateWithCacheUsing(translateFn, text, meta, force, targetOverride)
}

/** 번역기를 직접 넘겨 쓰는 판(App 은 자기 번역기를 쓴다) */
export async function translateWithCacheUsing(fn: TranslateFn | null, text: string, meta: { readonly docId?: string; readonly page?: number } = {}, force = false, targetOverride?: string): Promise<string | null> {
  if (!force) {
    const hit = cachedTranslation(text, targetOverride)
    if (hit !== undefined) return hit
  }
  if (fn === null) return null
  const result = await fn(text, targetOverride)
  if (result === null) return null
  if (enabled && provider !== '') {
    entries = upsertTranslation(entries, { source: text, translated: result.text, target: targetOverride ?? target, provider, at: new Date().toISOString(), ...meta })
    scheduleSave()
    emit()
  }
  return result.text
}

export function setTranslationCacheEnabled(next: boolean) {
  enabled = next
  try { window.localStorage.setItem(ENABLED_KEY, next ? 'on' : 'off') } catch { /* 이번 실행에만 */ }
  emit()
}

export function clearTranslationCache() {
  entries = []
  const vault = vaultHandle
  if (vault !== null) void writeTranslationCache(vault, []).catch(() => undefined)
  emit()
}

/** 화면에서 읽기: 켜짐 여부·개수·목록(바뀌면 다시 그린다) */
export function useTranslationCache(): { readonly enabled: boolean; readonly count: number; readonly entries: readonly TranslationCacheEntry[]; readonly ready: boolean } {
  useSyncExternalStore(subscribe, () => version, () => version)
  return { enabled, count: entries.length, entries, ready: translateFn !== null }
}

/** App 에서 한 번: 지금 Vault·번역기·언어를 알려 준다 */
export function useTranslationCacheBridge(vault: VaultHandle | null, translate: TranslateFn | null, targetLanguage: string, providerKey: string) {
  useEffect(() => {
    vaultHandle = vault
    entries = []
    emit()
    if (vault === null) return
    let alive = true
    void readTranslationCache(vault).then((loaded) => {
      if (!alive) return
      entries = loaded
      emit()
    })
    // 다른 창이 번역 기록을 더하면 이 창의 기록에 합친다
    const unsubscribe = subscribeVaultFile(vault, 'translations.json', translationCacheCodec, (rebase) => {
      const next = rebase(entries)
      if (next === entries) return
      entries = next
      emit()
    })
    return () => { alive = false; unsubscribe() }
  }, [vault])
  useEffect(() => {
    translateFn = translate
    target = targetLanguage
    provider = providerKey
    emit()
  }, [translate, targetLanguage, providerKey])
}
