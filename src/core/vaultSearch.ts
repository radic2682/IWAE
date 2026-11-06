import type { VaultFileKind, VaultIndexEntry, VaultStorageKind } from './vaultIndex'
import { t } from '../i18n'

export interface VaultSearchMetadata {
  favorite?: boolean
  lastOpenedAt?: string | null
}

export interface VaultSearchRecord {
  id: string
  kind: VaultFileKind
  storage: VaultStorageKind
  path: string
  folder: string
  filename: string
  displayName: string
  extractedText: string
  pages: readonly VaultSearchPage[]
  missing: boolean
  favorite: boolean
  lastOpenedAt: string | null
  addedAt: string
}

export interface VaultSearchPage {
  readonly page: number
  readonly text: string
}

export interface VaultSearchHit {
  readonly record: VaultSearchRecord
  readonly page: number | null
  readonly snippet: string
  readonly query: string
}

export interface VaultSearchOptions extends VaultSearchFilters {
  caseSensitive?: boolean
  wholeWord?: boolean
}

export interface VaultSearchFilters {
  kind?: VaultFileKind | readonly VaultFileKind[]
  folder?: string
  favorite?: boolean
  recent?: boolean
  missing?: boolean
  limit?: number
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim()
}

function pathParts(path: string): string[] {
  return path.replaceAll('\\', '/').split('/').filter(Boolean)
}

export function buildSearchRecords(
  index: readonly VaultIndexEntry[],
  extractedText: Readonly<Record<string, string>>,
  metadata: Readonly<Record<string, VaultSearchMetadata>> = {},
  pages: Readonly<Record<string, readonly VaultSearchPage[]>> = {},
): VaultSearchRecord[] {
  return index.map((entry) => {
    const parts = pathParts(entry.path)
    return {
      id: entry.id,
      kind: entry.kind,
      storage: entry.storage,
      path: entry.path,
      folder: parts.slice(0, -1).join('/'),
      filename: parts.at(-1) ?? entry.path,
      displayName: entry.displayName,
      extractedText: extractedText[entry.id] ?? pages[entry.id]?.map((page) => page.text).join('\n\n') ?? '',
      pages: pages[entry.id] ?? [],
      missing: entry.missing,
      favorite: metadata[entry.id]?.favorite ?? false,
      lastOpenedAt: metadata[entry.id]?.lastOpenedAt ?? null,
      addedAt: entry.addedAt,
    }
  })
}

function searchText(value: string, query: string, caseSensitive: boolean, wholeWord: boolean): number {
  const source = value.normalize('NFKC')
  const needle = query.normalize('NFKC')
  if (needle === '') return 0
  if (!wholeWord) {
    return caseSensitive ? source.indexOf(needle) : source.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase())
  }
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const expression = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, caseSensitive ? 'u' : 'iu')
  return source.search(expression)
}

function snippetAround(text: string, matchIndex: number, queryLength: number): string {
  const start = Math.max(0, matchIndex - 54)
  const end = Math.min(text.length, matchIndex + Math.max(queryLength, 1) + 76)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/gu, ' ').trim()}${end < text.length ? '…' : ''}`
}

function metadataScore(record: VaultSearchRecord, query: string, options: VaultSearchOptions): number | null {
  const caseSensitive = options.caseSensitive ?? false
  const wholeWord = options.wholeWord ?? false
  const fields: readonly [string, number][] = [
    [record.displayName, 5],
    [record.filename.replace(/\.[^.]+$/u, ''), 15],
    [record.folder, 30],
    [record.kind, 30],
  ]
  for (const [value, score] of fields) {
    if (searchText(value, query, caseSensitive, wholeWord) >= 0) return score
  }
  return null
}

export function searchVaultPages(
  records: readonly VaultSearchRecord[],
  query: string,
  options: VaultSearchOptions = {},
): VaultSearchHit[] {
  const normalizedQuery = query.normalize('NFKC').trim()
  const filtered = records.filter((record) => matchesFilters(record, options))
  if (normalizedQuery === '') {
    return searchVault(filtered, '', options).map((record) => ({
      record,
      page: null,
      snippet: record.folder || t('Vault 루트'),
      query,
    }))
  }

  type ScoredHit = VaultSearchHit & { readonly score: number }
  const hits: ScoredHit[] = filtered.flatMap<ScoredHit>((record) => {
    const matchedMetadataScore = metadataScore(record, normalizedQuery, options)
    const pageHits = record.pages.flatMap((page) => {
      const matchIndex = searchText(page.text, normalizedQuery, options.caseSensitive ?? false, options.wholeWord ?? false)
      return matchIndex < 0 ? [] : [{
        record,
        page: page.page,
        snippet: snippetAround(page.text, matchIndex, normalizedQuery.length),
        query,
        score: 40,
      }]
    })
    if (pageHits.length > 0) return pageHits
    if (matchedMetadataScore === null) return []
    return [{ record, page: null, snippet: record.folder || t('Vault 루트'), query, score: matchedMetadataScore }]
  })

  return hits
    .sort((left, right) => left.score - right.score
      || left.record.displayName.localeCompare(right.record.displayName)
      || (left.page ?? -1) - (right.page ?? -1))
    .slice(0, options.limit ?? 40)
    .map(({ score: _score, ...hit }) => hit)
}

function matchScore(record: VaultSearchRecord, query: string): number | null {
  if (query === '') return 100
  const displayName = normalize(record.displayName)
  const filename = normalize(record.filename.replace(/\.[^.]+$/u, ''))
  if (displayName === query) return 0
  if (displayName.startsWith(query)) return 5
  if (displayName.includes(query)) return 10
  if (filename === query) return 15
  if (filename.includes(query)) return 20
  if (normalize(record.folder).includes(query) || normalize(record.kind).includes(query)) return 30
  if (normalize(record.extractedText).includes(query)) return 40
  return null
}

function matchesFilters(record: VaultSearchRecord, filters: VaultSearchFilters): boolean {
  const kinds = filters.kind === undefined
    ? null
    : Array.isArray(filters.kind) ? filters.kind : [filters.kind]
  if (kinds !== null && !kinds.includes(record.kind)) return false
  if (filters.folder !== undefined && normalize(record.folder) !== normalize(filters.folder)) return false
  if (filters.favorite !== undefined && record.favorite !== filters.favorite) return false
  if (filters.recent === true && record.lastOpenedAt === null) return false
  if (filters.missing !== undefined && record.missing !== filters.missing) return false
  return true
}

export function searchVault(
  records: readonly VaultSearchRecord[],
  query: string,
  filters: VaultSearchFilters = {},
): VaultSearchRecord[] {
  const normalizedQuery = normalize(query)
  return records
    .flatMap((record) => {
      if (!matchesFilters(record, filters)) return []
      const score = matchScore(record, normalizedQuery)
      return score === null ? [] : [{ record, score }]
    })
    .sort((left, right) => left.score - right.score
      || (filters.recent === true
        ? (right.record.lastOpenedAt ?? '').localeCompare(left.record.lastOpenedAt ?? '')
        : 0)
      || Number(right.record.favorite) - Number(left.record.favorite)
      || right.record.addedAt.localeCompare(left.record.addedAt)
      || left.record.displayName.localeCompare(right.record.displayName))
    .slice(0, filters.limit ?? 20)
    .map(({ record }) => record)
}

export function serializeSearchRecords(records: readonly VaultSearchRecord[]): string {
  return `${JSON.stringify({ version: 1, records }, null, 2)}\n`
}

export function parseSearchRecords(serialized: string): VaultSearchRecord[] {
  const value: unknown = JSON.parse(serialized)
  if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1
    || !('records' in value) || !Array.isArray(value.records)) {
    throw new Error(t('Vault 검색 인덱스 형식이 올바르지 않습니다.'))
  }
  return value.records.map((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) {
      throw new Error(t('Vault 검색 레코드 형식이 올바르지 않습니다.'))
    }
    const record = candidate as Omit<VaultSearchRecord, 'pages'> & { pages?: readonly VaultSearchPage[] }
    return { ...record, pages: Array.isArray(record.pages) ? record.pages : [] }
  })
}
