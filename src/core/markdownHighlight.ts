import { isMarkdownExcerptSelection, type MarkdownExcerptSelection } from './markdownExcerpt'
import { t } from '../i18n'

export type MarkdownHighlightColor = 'yellow' | 'green' | 'blue' | 'pink'

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
  return value === 'yellow' || value === 'green' || value === 'blue' || value === 'pink'
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
