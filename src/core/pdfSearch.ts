import { buildAnchor, type AnchorRect } from './anchor'
import type { PageTextIndex } from './textIndex'

const SNIPPET_LENGTH = 160
/** 최근 검색어를 이만큼 기억한다 */
export const MAX_RECENT_SEARCHES = 30
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_]/u
const COMBINING_MARK = /\p{M}/u

interface NormalizedSearchText {
  readonly text: string
  readonly originalBoundaryByNormalizedBoundary: ReadonlyMap<number, number>
}

export interface PdfSearchOptions {
  readonly caseSensitive: boolean
  readonly wholeWord: boolean
}

export interface PdfSearchMatch {
  readonly id: string
  readonly docId: string
  readonly page: number
  readonly start: number
  readonly end: number
  readonly quote: string
  readonly before: string
  readonly after: string
  readonly rects: readonly AnchorRect[]
}

export function addRecentPdfSearch(
  recentQueries: readonly string[],
  query: string,
): string[] {
  const normalized = query.trim()
  if (normalized.length === 0) return [...recentQueries]
  return [normalized, ...recentQueries.filter((recent) => recent !== normalized)]
    .slice(0, MAX_RECENT_SEARCHES)
}

function codePointBefore(text: string, index: number): string {
  if (index <= 0) return ''
  const low = text.charCodeAt(index - 1)
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2)
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index)
  }
  return text.slice(index - 1, index)
}

function codePointAt(text: string, index: number): string {
  if (index >= text.length) return ''
  const value = text.codePointAt(index)
  return value === undefined ? '' : String.fromCodePoint(value)
}

function isWordCharacter(value: string): boolean {
  return value !== '' && WORD_CHARACTER.test(value)
}

function fallbackGraphemeSegments(text: string): Array<{ segment: string; index: number }> {
  const segments: Array<{ segment: string; index: number }> = []

  for (let index = 0; index < text.length;) {
    const codePoint = codePointAt(text, index)
    const start = index
    index += codePoint.length

    while (index < text.length) {
      const next = codePointAt(text, index)
      if (!COMBINING_MARK.test(next)) break
      index += next.length
    }

    segments.push({ segment: text.slice(start, index), index: start })
  }

  return segments
}

function graphemeSegments(text: string): Array<{ segment: string; index: number }> {
  const Segmenter = (Intl as typeof Intl & {
    Segmenter?: new (
      locale?: string,
      options?: { granularity: 'grapheme' },
    ) => { segment(value: string): Iterable<{ segment: string; index: number }> }
  }).Segmenter

  return Segmenter === undefined
    ? fallbackGraphemeSegments(text)
    : Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text))
}

function normalizeSearchText(text: string): NormalizedSearchText {
  let normalizedText = ''
  const boundaryMap = new Map<number, number>([[0, 0]])

  for (const { segment, index } of graphemeSegments(text)) {
    normalizedText += segment.normalize('NFC')
    boundaryMap.set(normalizedText.length, index + segment.length)
  }

  return {
    text: normalizedText,
    originalBoundaryByNormalizedBoundary: boundaryMap,
  }
}

function hasWholeWordBoundaries(text: string, query: string, start: number, end: number): boolean {
  const queryStart = codePointAt(query, 0)
  const queryEnd = codePointBefore(query, query.length)
  const leftIsBoundary = !isWordCharacter(queryStart) || !isWordCharacter(codePointBefore(text, start))
  const rightIsBoundary = !isWordCharacter(queryEnd) || !isWordCharacter(codePointAt(text, end))
  return leftIsBoundary && rightIsBoundary
}

function matchesAt(
  text: string,
  query: string,
  start: number,
  options: PdfSearchOptions,
  caseInsensitiveCollator: Intl.Collator | undefined,
): boolean {
  const end = start + query.length
  const candidate = text.slice(start, end)
  const sameText = options.caseSensitive
    ? candidate === query
    : caseInsensitiveCollator?.compare(candidate, query) === 0

  if (!sameText) return false
  return !options.wholeWord || hasWholeWordBoundaries(text, query, start, end)
}

function asciiLower(code: number): number {
  return code >= 65 && code <= 90 ? code + 32 : code
}

export function searchPageIndex(
  docId: string,
  page: number,
  index: PageTextIndex,
  query: string,
  options: PdfSearchOptions,
): PdfSearchMatch[] {
  const normalizedIndex = normalizeSearchText(index.text)
  const normalizedQuery = query.normalize('NFC')
  if (normalizedQuery.length === 0 || normalizedQuery.length > normalizedIndex.text.length) return []

  const matches: PdfSearchMatch[] = []
  const collator = options.caseSensitive
    ? undefined
    : new Intl.Collator(undefined, { usage: 'search', sensitivity: 'accent' })
  const lastStart = normalizedIndex.text.length - normalizedQuery.length
  // 쪽 하나가 수천 자라 자리마다 Collator 를 부르면 600쪽 문서에서 수 초가 든다. 첫 글자가 둘 다 ASCII 인데
  // 대소문자를 빼고도 다르면 어떤 비교로도 같을 수 없으므로 바로 건너뛴다(그 밖의 글자는 예전대로 비교한다).
  const firstCode = normalizedQuery.charCodeAt(0)
  const firstAscii = firstCode < 128
  const firstLower = firstAscii ? asciiLower(firstCode) : -1
  const haystack = normalizedIndex.text

  for (let normalizedStart = 0; normalizedStart <= lastStart; normalizedStart += 1) {
    if (firstAscii) {
      const code = haystack.charCodeAt(normalizedStart)
      if (code < 128 && (options.caseSensitive ? code !== firstCode : asciiLower(code) !== firstLower)) continue
    }
    const normalizedEnd = normalizedStart + normalizedQuery.length
    const start = normalizedIndex.originalBoundaryByNormalizedBoundary.get(normalizedStart)
    const end = normalizedIndex.originalBoundaryByNormalizedBoundary.get(normalizedEnd)
    if (start === undefined || end === undefined) continue
    if (!matchesAt(
      normalizedIndex.text,
      normalizedQuery,
      normalizedStart,
      options,
      collator,
    )) continue

    const quote = index.text.slice(start, end)
    const rects = buildAnchor(docId, page, index, start, end).rects
    matches.push({
      id: `${docId}:${page}:${start}:${end}`,
      docId,
      page,
      start,
      end,
      quote,
      before: index.text.slice(Math.max(0, start - SNIPPET_LENGTH), start),
      after: index.text.slice(end, end + SNIPPET_LENGTH),
      rects,
    })
  }

  return matches
}

export function pdfSearchCacheKey(
  docId: string,
  query: string,
  options: PdfSearchOptions,
): string {
  return JSON.stringify([docId, query, options.caseSensitive, options.wholeWord])
}
