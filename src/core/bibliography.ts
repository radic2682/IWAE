/**
 * PDF 서지 정보. 자동으로 뽑은 값(pdf)은 사람이 고친 값(manual)이나 Crossref 에서 받은
 * 값을 절대 덮지 않는다 — 자동 추출은 문서를 열 때마다 다시 돌기 때문이다.
 */
import { t } from '../i18n'

export interface BibEntry {
  readonly title?: string
  readonly authors: readonly string[]
  readonly year?: number
  readonly doi?: string
  readonly arxiv?: string
  readonly journal?: string
  readonly source: 'pdf' | 'crossref' | 'manual'
  readonly updatedAt: string
}

export interface BibliographyFile {
  readonly version: 1
  readonly entries: Readonly<Record<string, BibEntry>>
}

export const EMPTY_BIBLIOGRAPHY: BibliographyFile = { version: 1, entries: {} }

const DOI = /\b(10\.\d{4,9}\/[^\s"<>]+)/iu
const ARXIV = /\barXiv:\s*(\d{4}\.\d{4,5}(?:v\d+)?)/iu

/** 첫 몇 쪽 본문에서 DOI·arXiv 번호를 찾는다. 문장 끝 구두점은 떼어 낸다 */
export function extractIdentifiers(text: string): { doi?: string; arxiv?: string } {
  const found: { doi?: string; arxiv?: string } = {}
  const doi = DOI.exec(text)?.[1]?.replace(/[.,;:)\]}>'"]+$/u, '')
  if (doi !== undefined && doi !== '') found.doi = doi
  const arxiv = ARXIV.exec(text)?.[1]
  if (arxiv !== undefined) found.arxiv = arxiv
  return found
}

/** PDF 저자 칸은 형식이 제각각이다. `;`, ` and `, `,` 순서로 나눠 본다 */
export function parseAuthors(raw: string): string[] {
  const text = raw.trim()
  if (text === '') return []
  const separator = text.includes(';') ? /\s*;\s*/u : /\s+and\s+/u.test(text) ? /\s+and\s+/u : /\s*,\s*/u
  return text.split(separator).map((part) => part.trim()).filter(Boolean)
}

/** `D:20230115…` 이나 `2023-01-15` 에서 연도만 */
export function yearFrom(value: string | null | undefined): number | undefined {
  const match = /(?:^D:|^)(\d{4})/u.exec(value?.trim() ?? '')
  if (match === null) return undefined
  const year = Number(match[1])
  return year >= 1000 && year <= 9999 ? year : undefined
}

interface PdfInfo {
  readonly title?: string | null
  readonly author?: string | null
  readonly creationDate?: string | null
}

/** PDF 정보 사전과 첫 쪽 본문으로 자동 항목을 만든다 */
export function entryFromPdf(info: PdfInfo, firstPagesText: string, now: string): BibEntry {
  const ids = extractIdentifiers(firstPagesText)
  const year = yearFrom(info.creationDate)
  return {
    ...(info.title ? { title: info.title } : {}),
    authors: parseAuthors(info.author ?? ''),
    ...(year === undefined ? {} : { year }),
    ...ids,
    source: 'pdf',
    updatedAt: now,
  }
}

/** 자동(pdf) 값은 이미 있는 다른 출처를 덮지 않는다. 그 밖에는 새 값이 이긴다 */
export function mergeEntry(existing: BibEntry | undefined, incoming: BibEntry): BibEntry {
  if (existing === undefined) return incoming
  if (incoming.source === 'pdf' && existing.source !== 'pdf') return existing
  return incoming
}

function lastName(author: string): string {
  const trimmed = author.trim()
  if (trimmed.includes(',')) return trimmed.split(',')[0]!.trim()
  const parts = trimmed.split(/\s+/u)
  return parts[parts.length - 1] ?? trimmed
}

function keyPart(value: string): string {
  return value.normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase('en')
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'on', 'of', 'in', 'for', 'to'])

/** BibTeX 항목 하나. 키는 첫 저자 성 + 연도 + 제목 첫 낱말 */
export function toBibtex(entry: BibEntry): string {
  const firstWord = (entry.title ?? '').split(/\s+/u).find((word) => !STOP_WORDS.has(word.toLowerCase())) ?? ''
  const key = [keyPart(lastName(entry.authors[0] ?? 'anon')), entry.year ?? '', keyPart(firstWord)].join('') || 'entry'
  const fields: [string, string | number | undefined][] = [
    ['title', entry.title],
    ['author', entry.authors.length > 0 ? entry.authors.join(' and ') : undefined],
    ['year', entry.year],
    ['journal', entry.journal],
    ['doi', entry.doi],
    ['eprint', entry.arxiv],
  ]
  const lines = fields
    .filter((field): field is [string, string | number] => field[1] !== undefined && field[1] !== '')
    .map(([name, value]) => `  ${name} = {${String(value).replace(/[{}]/gu, '')}},`)
  return [`@article{${key},`, ...lines, '}'].join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const firstString = (value: unknown): string | undefined =>
  Array.isArray(value) && typeof value[0] === 'string' && value[0].trim() !== '' ? value[0].trim() : undefined

/** Crossref `works/{doi}` 응답의 `message` 를 항목으로 바꾼다. 없는 칸은 비워 둔다 */
export function parseCrossrefWork(message: unknown, now: string): BibEntry {
  if (!isRecord(message)) throw new Error(t('Crossref 응답 형식이 올바르지 않습니다.'))
  const authors = Array.isArray(message.author)
    ? message.author.flatMap((author) => {
        if (!isRecord(author)) return []
        if (typeof author.name === 'string') return [author.name]
        const name = [author.given, author.family].filter((part) => typeof part === 'string' && part !== '').join(' ')
        return name === '' ? [] : [name]
      })
    : []
  const issued = isRecord(message.issued) && Array.isArray(message.issued['date-parts'])
    ? message.issued['date-parts'][0]
    : undefined
  const year = Array.isArray(issued) && typeof issued[0] === 'number' ? issued[0] : undefined
  const title = firstString(message.title)
  const journal = firstString(message['container-title'])
  const doi = typeof message.DOI === 'string' ? message.DOI : undefined
  return {
    ...(title === undefined ? {} : { title }),
    authors,
    ...(year === undefined ? {} : { year }),
    ...(journal === undefined ? {} : { journal }),
    ...(doi === undefined ? {} : { doi }),
    source: 'crossref',
    updatedAt: now,
  }
}

function parseEntry(value: unknown): BibEntry | null {
  if (!isRecord(value)) return null
  if (!Array.isArray(value.authors) || !value.authors.every((author) => typeof author === 'string')) return null
  if (value.source !== 'pdf' && value.source !== 'crossref' && value.source !== 'manual') return null
  if (typeof value.updatedAt !== 'string') return null
  const text = (key: string) => typeof value[key] === 'string' && value[key] !== '' ? { [key]: value[key] as string } : {}
  return {
    ...text('title'),
    authors: value.authors as string[],
    ...(Number.isInteger(value.year) ? { year: value.year as number } : {}),
    ...text('doi'),
    ...text('arxiv'),
    ...text('journal'),
    source: value.source,
    updatedAt: value.updatedAt,
  }
}

export function parseBibliographyFile(value: unknown): BibliographyFile {
  if (!isRecord(value) || !isRecord(value.entries)) return EMPTY_BIBLIOGRAPHY
  const entries: Record<string, BibEntry> = {}
  for (const [id, raw] of Object.entries(value.entries)) {
    const entry = parseEntry(raw)
    if (entry !== null) entries[id] = entry
  }
  return { version: 1, entries }
}
