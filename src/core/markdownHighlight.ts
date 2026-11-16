import { isMarkdownExcerptSelection, type MarkdownExcerptSelection } from './markdownExcerpt'
import { isHighlightColorId } from './highlightColors'
import { t } from '../i18n'
import { locateQuote, quoteMatchesAt } from './flowAnchorCheck'

/** 형광펜 색의 id(목록에 없는 id 도 그대로 둔다) */
export type MarkdownHighlightColor = string

export interface PersistentMarkdownHighlight {
  readonly id: string
  readonly sourceFileId: string
  readonly sourceHash: string
  readonly selection: MarkdownExcerptSelection
  readonly color: MarkdownHighlightColor
}

export interface PersistentMarkdownHighlightFile {
  readonly version: 1
  readonly highlights: readonly PersistentMarkdownHighlight[]
}

export function createPersistentMarkdownHighlight(
  sourceFileId: string,
  sourceHash: string,
  selection: MarkdownExcerptSelection,
  color: MarkdownHighlightColor = 'yellow',
): PersistentMarkdownHighlight {
  return {
    id: `${sourceFileId}:${sourceHash}:${selection.startOffset}:${selection.endOffset}`,
    sourceFileId,
    sourceHash,
    selection,
    color,
  }
}

export function removePersistentMarkdownHighlight(
  highlights: readonly PersistentMarkdownHighlight[],
  highlightId: string,
): readonly PersistentMarkdownHighlight[] {
  return highlights.filter(({ id }) => id !== highlightId)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHighlightColor(value: unknown): value is MarkdownHighlightColor {
  return isHighlightColorId(value)
}

export function parsePersistentMarkdownHighlights(value: unknown): PersistentMarkdownHighlight[] {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.highlights)) {
    throw new Error(t('Markdown 형광펜 저장 형식이 잘못되었습니다.'))
  }
  const highlights: PersistentMarkdownHighlight[] = []
  const ids = new Set<string>()
  for (const item of value.highlights) {
    if (!isRecord(item)
      || typeof item.id !== 'string'
      || typeof item.sourceFileId !== 'string'
      || item.sourceFileId.length === 0
      || typeof item.sourceHash !== 'string'
      || item.sourceHash.length === 0
      || !isMarkdownExcerptSelection(item.selection)) {
      throw new Error(t('Markdown 형광펜 항목이 잘못되었습니다.'))
    }
    const color = item.color === undefined ? 'yellow' : item.color
    if (!isHighlightColor(color)) throw new Error(t('Markdown 형광펜 색상이 잘못되었습니다.'))
    const normalized = createPersistentMarkdownHighlight(
      item.sourceFileId,
      item.sourceHash,
      item.selection,
      color,
    )
    if (normalized.id !== item.id) throw new Error(t('Markdown 형광펜 식별자가 범위와 일치하지 않습니다.'))
    if (ids.has(item.id)) continue
    ids.add(item.id)
    highlights.push({
      ...normalized,
      selection: structuredClone(item.selection),
    })
  }
  return highlights
}

export function markdownHighlightFile(
  highlights: readonly PersistentMarkdownHighlight[],
): PersistentMarkdownHighlightFile {
  return { version: 1, highlights: structuredClone(highlights) }
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/gu, '\n')
}

function commonSuffixLength(left: string, right: string): number {
  let count = 0
  while (count < left.length && count < right.length
    && left[left.length - 1 - count] === right[right.length - 1 - count]) count += 1
  return count
}

function commonPrefixLength(left: string, right: string): number {
  let count = 0
  while (count < left.length && count < right.length && left[count] === right[count]) count += 1
  return count
}

/**
 * 파일이 바뀐 뒤에도 형광펜을 붙들어 둔다.
 * 원문 해시가 같아도 그 자리의 본문 글이 저장한 인용문과 다르면(읽기 화면의 그리는 방식이 바뀐 경우) 새 범위를 찾는다.
 * 해시가 다르면 늘 인용문과 앞뒤 글로 새 범위를 찾는다.
 * 찾지 못한 형광펜은 목록에서 빠질 뿐(칠하지 않는다) 저장 데이터는 건드리지 않는다.
 */
export function relocateMarkdownHighlights(
  renderedText: string,
  highlights: readonly PersistentMarkdownHighlight[],
  currentHash: string,
): PersistentMarkdownHighlight[] {
  const text = normalizeLineEndings(renderedText)
  const result: PersistentMarkdownHighlight[] = []
  for (const highlight of highlights) {
    const { selection } = highlight
    // 해시가 같고 자리의 글도 인용문과 같으면 그대로(다시 찾지 않는다)
    if (highlight.sourceHash === currentHash && quoteMatchesAt(text, selection.startOffset, selection.endOffset, selection.quote)) {
      result.push(highlight)
      continue
    }
    const quote = normalizeLineEndings(selection.quote)
    const prefix = normalizeLineEndings(selection.prefix)
    const suffix = normalizeLineEndings(selection.suffix)
    let best = -1
    let bestScore = -1
    let bestDistance = Number.POSITIVE_INFINITY
    let index = text.indexOf(quote)
    while (index >= 0) {
      const score = commonSuffixLength(text.slice(Math.max(0, index - prefix.length), index), prefix)
        + commonPrefixLength(text.slice(index + quote.length, index + quote.length + suffix.length), suffix)
      const distance = Math.abs(index - selection.startOffset)
      if (score > bestScore || (score === bestScore && distance < bestDistance)) {
        best = index
        bestScore = score
        bestDistance = distance
      }
      index = text.indexOf(quote, index + 1)
    }
    if (best >= 0) {
      result.push({
        ...highlight,
        selection: { ...selection, startOffset: best, endOffset: best + quote.length },
      })
      continue
    }
    // 줄바꿈·블록 사이 공백이 달라 그대로는 못 찾을 때: 공백을 무시하고 찾는다
    const found = locateQuote(text, { quote, prefix, suffix }, selection.startOffset)
    if (found !== null) result.push({ ...highlight, selection: { ...selection, startOffset: found[0], endOffset: found[1] } })
  }
  return result
}
