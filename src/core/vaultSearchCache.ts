import type { VaultSearchPage } from './vaultSearch'

export interface VaultSearchTextCacheDocument {
  contentHash: string | null
  pages: VaultSearchPage[]
  complete: boolean
}

export interface VaultSearchTextCache {
  version: 2
  documents: Record<string, VaultSearchTextCacheDocument>
}

interface SearchCacheIndexEntry {
  id: string
  contentHash: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function emptyVaultSearchTextCache(): VaultSearchTextCache {
  return { version: 2, documents: {} }
}

export function parseVaultSearchTextCache(value: unknown): VaultSearchTextCache {
  if (!isRecord(value) || !isRecord(value.documents)) {
    return emptyVaultSearchTextCache()
  }

  const documents: Record<string, VaultSearchTextCacheDocument> = {}
  if (value.version === 1) {
    for (const [id, candidate] of Object.entries(value.documents)) {
      if (!isRecord(candidate)
        || (candidate.contentHash !== null && typeof candidate.contentHash !== 'string')
        || typeof candidate.text !== 'string') return emptyVaultSearchTextCache()
      documents[id] = {
        contentHash: candidate.contentHash,
        pages: [{ page: 0, text: candidate.text }],
        complete: false,
      }
    }
    return { version: 2, documents }
  }
  if (value.version !== 2) return emptyVaultSearchTextCache()

  for (const [id, candidate] of Object.entries(value.documents)) {
    if (!isRecord(candidate)
      || (candidate.contentHash !== null && typeof candidate.contentHash !== 'string')
      || typeof candidate.complete !== 'boolean'
      || !Array.isArray(candidate.pages)
      || candidate.pages.some((page) => !isRecord(page)
        || !Number.isInteger(page.page) || Number(page.page) < 0 || typeof page.text !== 'string')) {
      return emptyVaultSearchTextCache()
    }
    documents[id] = {
      contentHash: candidate.contentHash,
      pages: candidate.pages.map((page) => ({ page: Number(page.page), text: String(page.text) })),
      complete: candidate.complete,
    }
  }
  return { version: 2, documents }
}

export function matchingCachedSearchPages(
  entries: readonly SearchCacheIndexEntry[],
  cache: VaultSearchTextCache,
): Record<string, VaultSearchPage[]> {
  return Object.fromEntries(entries.flatMap((entry) => {
    const cached = cache.documents[entry.id]
    return cached !== undefined && cached.contentHash === entry.contentHash
      ? [[entry.id, cached.pages] as const]
      : []
  }))
}

export function matchingCachedSearchText(
  entries: readonly SearchCacheIndexEntry[],
  cache: VaultSearchTextCache,
): Record<string, string> {
  return Object.fromEntries(Object.entries(matchingCachedSearchPages(entries, cache))
    .map(([id, pages]) => [id, pages.map(({ text }) => text).filter(Boolean).join('\n\n')]))
}

export function updateVaultSearchTextCache(
  cache: VaultSearchTextCache,
  id: string,
  contentHash: string | null,
  pages: readonly VaultSearchPage[],
  complete = true,
): VaultSearchTextCache {
  return {
    version: 2,
    documents: {
      ...cache.documents,
      [id]: { contentHash, pages: [...pages], complete },
    },
  }
}
