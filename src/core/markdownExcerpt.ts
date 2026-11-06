export const MARKDOWN_EXCERPT_DRAG_MIME = 'application/x-iwae-markdown-excerpt'

export type MarkdownExcerptFormat =
  | 'paragraph'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'list'
  | 'quote'
  | 'code'

export interface MarkdownExcerptSelection {
  readonly path: string
  readonly title: string
  readonly quote: string
  readonly prefix: string
  readonly suffix: string
  readonly startOffset: number
  readonly endOffset: number
  readonly format: MarkdownExcerptFormat
}

export interface MarkdownExcerptDragPayload {
  readonly selection: MarkdownExcerptSelection
  readonly capture?: MarkdownCaptureBlockData
  readonly displaySize?: {
    readonly width: number
    readonly height: number
  }
}

export interface MarkdownSourceJumpRequest {
  readonly kind: 'markdown'
  readonly path: string
  readonly startOffset: number
  readonly endOffset: number
  readonly quote: string
}

const FORMATS = new Set<MarkdownExcerptFormat>([
  'paragraph',
  'heading-1',
  'heading-2',
  'heading-3',
  'heading-4',
  'list',
  'quote',
  'code',
])

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function isMarkdownExcerptSelection(value: unknown): value is MarkdownExcerptSelection {
  if (typeof value !== 'object' || value === null) return false
  const selection = value as Partial<MarkdownExcerptSelection>
  return typeof selection.path === 'string'
    && selection.path.length > 0
    && typeof selection.title === 'string'
    && typeof selection.quote === 'string'
    && selection.quote.length > 0
    && typeof selection.prefix === 'string'
    && typeof selection.suffix === 'string'
    && Number.isInteger(selection.startOffset)
    && (selection.startOffset ?? -1) >= 0
    && Number.isInteger(selection.endOffset)
    && (selection.endOffset ?? -1) > (selection.startOffset ?? -1)
    && typeof selection.format === 'string'
    && FORMATS.has(selection.format as MarkdownExcerptFormat)
}

export function markdownExcerptSelectionsEqual(
  left: MarkdownExcerptSelection,
  right: MarkdownExcerptSelection,
): boolean {
  return left.path === right.path
    && left.title === right.title
    && left.quote === right.quote
    && left.prefix === right.prefix
    && left.suffix === right.suffix
    && left.startOffset === right.startOffset
    && left.endOffset === right.endOffset
    && left.format === right.format
}

export function serializeMarkdownExcerptDrag(payload: MarkdownExcerptDragPayload): string {
  return JSON.stringify(payload)
}

export function parseMarkdownExcerptDrag(serialized: string): MarkdownExcerptDragPayload | null {
  try {
    const value: unknown = JSON.parse(serialized)
    if (typeof value !== 'object' || value === null) return null
    const payload = value as Partial<MarkdownExcerptDragPayload>
    if (!isMarkdownExcerptSelection(payload.selection)) return null
    const displaySize = payload.displaySize
    if (displaySize !== undefined && (
      typeof displaySize !== 'object'
      || displaySize === null
      || !isFinitePositive(displaySize.width)
      || !isFinitePositive(displaySize.height)
    )) return null
    return {
      selection: payload.selection,
      ...(payload.capture === undefined ? {} : isMarkdownCaptureBlockData(payload.capture) ? { capture: payload.capture } : {}),
      ...(displaySize === undefined ? {} : { displaySize }),
    }
  } catch {
    return null
  }
}

export function createMarkdownSourceJumpRequest(
  selection: MarkdownExcerptSelection,
): MarkdownSourceJumpRequest {
  return {
    kind: 'markdown',
    path: selection.path,
    startOffset: selection.startOffset,
    endOffset: selection.endOffset,
    quote: selection.quote,
  }
}
import { isMarkdownCaptureBlockData, type MarkdownCaptureBlockData } from './markdownCapture'
