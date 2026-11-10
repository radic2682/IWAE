/**
 * 번역 캐시이자 번역 기록. 같은 글을 같은 언어·같은 번역기로 다시 번역하면 요청 없이 꺼내 쓴다.
 * Vault 의 `.iwae/translations.json` 에 남는다(이 PC·이 Vault 밖으로 나가지 않는다).
 */

/**
 * 2: 번역하기 전에 줄바꿈을 이어 붙이게 됐다. 1 에서 줄바꿈 그대로 번역해 결과가 여러 줄로 끊긴 항목은
 * 열쇠가 같아 계속 꺼내 쓰이므로, 읽을 때 버리고 다시 번역하게 한다.
 */
export const TRANSLATION_CACHE_VERSION = 2
/** 너무 커지지 않게: 오래된 것부터 버린다 */
export const TRANSLATION_CACHE_LIMIT = 5000

export interface TranslationCacheEntry {
  readonly key: string
  readonly source: string
  readonly translated: string
  /** 번역한 언어(예: ko) */
  readonly target: string
  /** 번역기(예: azure, ollama:모델) */
  readonly provider: string
  /** 어느 문서·쪽의 글인가(기록에서 그 자리로 가려고) */
  readonly docId?: string
  readonly page?: number
  /** 번역한 시각(ISO) */
  readonly at: string
}

/** 글의 열쇠: 빈칸을 하나로 모아 같은 글이면 같은 열쇠(줄바꿈·띄어쓰기 차이는 무시) */
export function normalizeSource(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

export function translationCacheKey(text: string, target: string, provider: string): string {
  return `${provider}|${target}|${normalizeSource(text)}`
}

export function findTranslation(entries: readonly TranslationCacheEntry[], text: string, target: string, provider: string): TranslationCacheEntry | undefined {
  const key = translationCacheKey(text, target, provider)
  return entries.find((entry) => entry.key === key)
}

/** 새 번역을 맨 앞에 넣는다(같은 열쇠는 바꿔 끼우고, 한도를 넘으면 오래된 것부터 버린다) */
export function upsertTranslation(entries: readonly TranslationCacheEntry[], entry: Omit<TranslationCacheEntry, 'key'>): TranslationCacheEntry[] {
  const key = translationCacheKey(entry.source, entry.target, entry.provider)
  const next = { ...entry, key, source: normalizeSource(entry.source) }
  return [next, ...entries.filter((item) => item.key !== key)].slice(0, TRANSLATION_CACHE_LIMIT)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseTranslationCache(value: unknown): TranslationCacheEntry[] {
  if (!isRecord(value) || !Array.isArray(value.entries)) return []
  const legacy = typeof value.version !== 'number' || value.version < 2
  const seen = new Set<string>()
  return value.entries.flatMap((item: unknown): TranslationCacheEntry[] => {
    if (!isRecord(item)) return []
    const { source, translated, target, provider, at } = item
    if (typeof source !== 'string' || typeof translated !== 'string' || typeof target !== 'string' || typeof provider !== 'string' || typeof at !== 'string') return []
    if (legacy && translated.trim().includes('\n')) return []
    const key = translationCacheKey(source, target, provider)
    if (seen.has(key)) return []
    seen.add(key)
    return [{
      key, source: normalizeSource(source), translated, target, provider, at,
      ...(typeof item.docId === 'string' ? { docId: item.docId } : {}),
      ...(typeof item.page === 'number' && Number.isFinite(item.page) ? { page: item.page } : {}),
    }]
  }).slice(0, TRANSLATION_CACHE_LIMIT)
}

export function serializeTranslationCache(entries: readonly TranslationCacheEntry[]): string {
  const plain = entries.map(({ key: _key, ...rest }) => rest)
  return `${JSON.stringify({ version: TRANSLATION_CACHE_VERSION, entries: plain }, null, 2)}\n`
}
