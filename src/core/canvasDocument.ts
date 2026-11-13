import type { Anchor } from './anchor'
import { isPdfExcerptBlock, type PdfExcerptBlock } from './pdfExcerpt'
import {
  isMarkdownExcerptSelection,
  markdownExcerptSelectionsEqual,
  type MarkdownExcerptSelection,
} from './markdownExcerpt'
import { isMarkdownCaptureBlockData, type MarkdownCaptureBlockData } from './markdownCapture'
import { parseExcerptHighlights, type ExcerptHighlight } from './excerptHighlights'
import { normalizeTicket, type MemoTicket } from './memoNote'
import { t } from '../i18n'

export type CanvasShapeKind = 'rectangle' | 'square' | 'ellipse' | 'diamond'
export type CanvasBlockKind = 'title' | 'paragraph' | 'code' | CanvasShapeKind | 'pdfExcerpt' | 'markdownExcerpt' | 'translation' | 'arrow' | 'image'
export type CanvasBlockPreset = 'title' | 'paragraph' | 'code' | CanvasShapeKind | 'arrow'
export type CanvasEdgeMarker = 'none' | 'arrow'
export type TextBlockLevel = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

export interface TextBlockStyle {
  readonly level: TextBlockLevel
  readonly fontSize: number
  readonly bold: boolean
  readonly italic: boolean
  readonly underline: boolean
  readonly strike: boolean
  readonly code: boolean
  readonly align: 'left' | 'center' | 'right'
  readonly list: 'none' | 'bullet' | 'number'
  readonly color: string
  readonly highlight: string
  readonly background: string
  readonly borderColor: string
  /** 테두리 두께(px). 없으면 블록 종류의 기본 두께 */
  readonly borderWidth?: number
}

export interface CanvasBlockBase {
  readonly kind: CanvasBlockKind
  readonly width: number
  readonly height: number
  readonly manualHeight?: true
  readonly style: TextBlockStyle
}

export interface TextCanvasBlock extends CanvasBlockBase {
  readonly kind: 'title' | 'paragraph' | 'code'
  readonly text: string
  /** 형광펜에 이은 메모 카드의 서식 글(굵게·색·목록 …). text 는 늘 같은 내용의 글이다. 예전 파일에는 없다 */
  readonly noteHtml?: string
  /** 형광펜에 이은 메모 카드의 ID·제목(노트 메모 카드와 같다). 예전 파일에는 없다 */
  readonly ticket?: MemoTicket
}

export interface ShapeCanvasBlock extends CanvasBlockBase {
  readonly kind: CanvasShapeKind
}

export interface ImageCanvasBlock extends CanvasBlockBase {
  readonly kind: 'image'
  readonly src: string
  readonly alt: string
}

export interface PdfExcerptCanvasBlock extends CanvasBlockBase {
  readonly kind: 'pdfExcerpt'
  readonly visualAspectRatio?: number
  readonly excerpt: PdfExcerptBlock
  /** 발췌 위에 칠한 형광펜 */
  readonly highlights?: readonly ExcerptHighlight[]
  readonly source: { readonly relation: 'excerpt'; readonly anchor: Anchor }
}

export interface MarkdownExcerptCanvasBlock extends CanvasBlockBase {
  readonly kind: 'markdownExcerpt'
  readonly selection: MarkdownExcerptSelection
  readonly capture?: MarkdownCaptureBlockData
  readonly source: {
    readonly relation: 'markdown-excerpt'
    readonly selection: MarkdownExcerptSelection
  }
}

export interface TranslationCanvasBlock extends CanvasBlockBase {
  readonly kind: 'translation'
  readonly text: string
  readonly sourceBlockId: string
  readonly targetLanguage: string
  readonly model: string
  readonly source: { readonly relation: 'translation'; readonly anchor?: Anchor }
}

export interface ArrowCanvasBlock extends CanvasBlockBase {
  readonly kind: 'arrow'
  readonly direction: 'right'
}

export type CanvasBlockData = TextCanvasBlock | ShapeCanvasBlock | ImageCanvasBlock | PdfExcerptCanvasBlock | MarkdownExcerptCanvasBlock | TranslationCanvasBlock | ArrowCanvasBlock

export type CanvasBlockCommand =
  | { readonly type: 'setBlockBackground'; readonly background: string }
  | { readonly type: 'setBlockBorderColor'; readonly borderColor: string }
  | { readonly type: 'setBlockBorderWidth'; readonly borderWidth: number }

export interface PersistedCanvasNodeV1 {
  readonly id: string
  readonly type?: string
  readonly position: { readonly x: number; readonly y: number }
  readonly data: Record<string, unknown>
  readonly style?: { readonly width?: number; readonly height?: number }
  readonly className?: string
}

export interface PersistedCanvasNode {
  readonly id: string
  readonly type?: string
  readonly position: { readonly x: number; readonly y: number }
  readonly data: { readonly block: CanvasBlockData }
  readonly className?: string
}

export interface PersistedCanvasEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
  readonly startMarker?: CanvasEdgeMarker
  readonly endMarker?: CanvasEdgeMarker
}

export interface CanvasViewport {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

export interface CanvasDocumentV1 {
  readonly version: 1
  readonly nodes: readonly PersistedCanvasNodeV1[]
  readonly edges: readonly PersistedCanvasEdge[]
  readonly viewport: CanvasViewport
}

export interface CanvasDocumentV2 {
  readonly version: 2
  readonly nodes: readonly PersistedCanvasNode[]
  readonly edges: readonly PersistedCanvasEdge[]
  readonly viewport: CanvasViewport
}

export type CanvasDocument = CanvasDocumentV1 | CanvasDocumentV2

export const CANVAS_GRID_SIZE = 20
export const CANVAS_VERTICAL_GRID_SIZE = CANVAS_GRID_SIZE / 2
export const CANVAS_MIN_WIDTH = 180
export const CANVAS_MIN_HEIGHT = 40
/** 그리기 도형(네모·원·마름모)은 격자에 묶이지 않는다. 이보다 작게는 줄이지 않는다 */
export const CANVAS_SHAPE_MIN_SIZE = 8

export function isCanvasShapeKind(kind: CanvasBlockKind): kind is CanvasShapeKind {
  return kind === 'rectangle' || kind === 'square' || kind === 'ellipse' || kind === 'diamond'
}

/** 블록 위치: 그리기 도형은 놓은 자리 그대로(정수로만), 나머지는 격자에 맞춘다 */
export function normalizeCanvasNodePosition(block: CanvasBlockData, position: CanvasPosition): CanvasPosition {
  if (isCanvasShapeKind(block.kind)) return { x: Math.round(position.x), y: Math.round(position.y) }
  return normalizeCanvasPosition(position)
}

type CanvasSize = { readonly width: number; readonly height: number }
type CanvasPosition = { readonly x: number; readonly y: number }

function snapToGrid(value: number, gridSize = CANVAS_GRID_SIZE, mode: 'nearest' | 'ceil' = 'nearest'): number {
  const units = value / gridSize
  const snapped = (mode === 'ceil' ? Math.ceil(units) : Math.round(units)) * gridSize
  return Object.is(snapped, -0) ? 0 : snapped
}

export function normalizeCanvasPosition(position: CanvasPosition): CanvasPosition {
  return {
    x: snapToGrid(position.x),
    y: snapToGrid(position.y, CANVAS_VERTICAL_GRID_SIZE),
  }
}

export function normalizeCanvasBlockSize(
  block: CanvasBlockData,
  requested: CanvasSize,
  contentHeight = 0,
): CanvasSize {
  if (isCanvasShapeKind(block.kind)) {
    const width = Math.max(CANVAS_SHAPE_MIN_SIZE, Math.round(requested.width))
    const height = Math.max(CANVAS_SHAPE_MIN_SIZE, Math.round(requested.height))
    return block.kind === 'square' ? { width: Math.max(width, height), height: Math.max(width, height) } : { width, height }
  }
  if (block.kind === 'pdfExcerpt' || block.kind === 'image' || (block.kind === 'markdownExcerpt' && block.capture !== undefined)) {
    const width = Math.max(1, requested.width)
    const aspectRatio = block.kind === 'image'
      ? block.width / block.height
      : block.kind === 'pdfExcerpt'
        ? pdfExcerptAspectRatio(block)
        : block.capture?.aspectRatio ?? block.width / block.height
    return { width, height: width / aspectRatio }
  }
  const width = Math.max(CANVAS_MIN_WIDTH, snapToGrid(requested.width))
  const requestedHeight = contentHeight > 0 ? contentHeight : requested.height
  const height = Math.max(
    CANVAS_MIN_HEIGHT,
    snapToGrid(requestedHeight, CANVAS_VERTICAL_GRID_SIZE, contentHeight > 0 ? 'ceil' : 'nearest'),
  )
  return { width, height }
}

export function normalizeCanvasSize(requested: CanvasSize, contentHeight = 0): CanvasSize {
  const width = Math.max(CANVAS_MIN_WIDTH, snapToGrid(requested.width))
  const requestedHeight = Math.max(CANVAS_MIN_HEIGHT, requested.height, contentHeight)
  const height = Math.max(
    CANVAS_MIN_HEIGHT,
    snapToGrid(
      requestedHeight,
      CANVAS_VERTICAL_GRID_SIZE,
      contentHeight > requested.height ? 'ceil' : 'nearest',
    ),
  )
  return { width, height }
}

export function pdfExcerptAspectRatio(block: PdfExcerptCanvasBlock): number {
  if (block.visualAspectRatio !== undefined && block.visualAspectRatio > 0) return block.visualAspectRatio
  const { w, h } = block.excerpt.selection.crop
  return w / h
}

const BLOCK_KINDS = new Set<CanvasBlockKind>([
  'title', 'paragraph', 'code', 'rectangle', 'square', 'ellipse', 'diamond', 'pdfExcerpt', 'markdownExcerpt', 'translation', 'arrow', 'image',
])
const SHAPE_KINDS = new Set<CanvasShapeKind>(['rectangle', 'square', 'ellipse', 'diamond'])
const TEXT_LEVELS = new Set<TextBlockLevel>(['paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const TEXT_ALIGNS = new Set<TextBlockStyle['align']>(['left', 'center', 'right'])
const TEXT_LISTS = new Set<TextBlockStyle['list']>(['none', 'bullet', 'number'])

const TEXT_LEVEL_FONT_SIZES: Readonly<Record<TextBlockLevel, number>> = {
  paragraph: 20,
  h1: 32,
  h2: 25,
  h3: 23,
  h4: 21,
  h5: 20,
  h6: 18,
}

export function textBlockLevelFontSize(level: TextBlockLevel): number {
  return TEXT_LEVEL_FONT_SIZES[level]
}

export function createDefaultTextBlockStyle(level: TextBlockLevel = 'paragraph'): TextBlockStyle {
  return {
    level,
    fontSize: textBlockLevelFontSize(level),
    bold: level !== 'paragraph',
    italic: false,
    underline: false,
    strike: false,
    code: false,
    align: 'left',
    list: 'none',
    color: '#1f2328',
    highlight: 'transparent',
    background: 'transparent',
    borderColor: '#c9ced6',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (isFiniteNumber(value)) return true
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : isRecord(value) && Object.values(value).every((item) => isJsonValue(item, seen))
  seen.delete(value)
  return valid
}

function isAnchor(value: unknown): value is Anchor {
  if (!isRecord(value)) return false
  return typeof value.docId === 'string'
    && Number.isInteger(value.page)
    && (value.page as number) >= 0
    && value.coordSpace === 'pdfium-page'
    && Array.isArray(value.rects)
    && value.rects.every((rect) => isRecord(rect)
      && isFiniteNumber(rect.x)
      && isFiniteNumber(rect.y)
      && isPositiveNumber(rect.w)
      && isPositiveNumber(rect.h))
    && Array.isArray(value.charRange)
    && value.charRange.length === 2
    && value.charRange.every((offset) => Number.isInteger(offset) && (offset as number) >= 0)
    && typeof value.quote === 'string'
    && typeof value.prefix === 'string'
    && typeof value.suffix === 'string'
}

function anchorsEqual(left: Anchor, right: Anchor): boolean {
  return left.docId === right.docId
    && left.page === right.page
    && left.coordSpace === right.coordSpace
    && left.quote === right.quote
    && left.prefix === right.prefix
    && left.suffix === right.suffix
    && left.charRange[0] === right.charRange[0]
    && left.charRange[1] === right.charRange[1]
    && left.rects.length === right.rects.length
    && left.rects.every((rect, index) => {
      const other = right.rects[index]
      return other !== undefined
        && rect.x === other.x
        && rect.y === other.y
        && rect.w === other.w
        && rect.h === other.h
    })
}

function parseTextStyle(value: unknown): TextBlockStyle {
  if (!isRecord(value)) throw new Error(t('캔버스 블록 서식이 잘못되었습니다.'))
  if (
    typeof value.level !== 'string'
    || !TEXT_LEVELS.has(value.level as TextBlockLevel)
    || !isPositiveNumber(value.fontSize)
    || typeof value.bold !== 'boolean'
    || typeof value.italic !== 'boolean'
    || typeof value.underline !== 'boolean'
    || typeof value.strike !== 'boolean'
    || typeof value.code !== 'boolean'
    || typeof value.align !== 'string'
    || !TEXT_ALIGNS.has(value.align as TextBlockStyle['align'])
    || typeof value.list !== 'string'
    || !TEXT_LISTS.has(value.list as TextBlockStyle['list'])
    || typeof value.color !== 'string'
    || typeof value.highlight !== 'string'
    || (value.background !== undefined && typeof value.background !== 'string')
    || (value.borderColor !== undefined && typeof value.borderColor !== 'string')
    || (value.borderWidth !== undefined && !(isFiniteNumber(value.borderWidth) && value.borderWidth >= 0 && value.borderWidth <= 24))
  ) {
    throw new Error(t('캔버스 블록 서식이 잘못되었습니다.'))
  }
  return {
    level: value.level as TextBlockLevel,
    fontSize: value.fontSize,
    bold: value.bold,
    italic: value.italic,
    underline: value.underline,
    strike: value.strike,
    code: value.code,
    align: value.align as TextBlockStyle['align'],
    list: value.list as TextBlockStyle['list'],
    color: value.color,
    highlight: value.highlight,
    background: typeof value.background === 'string' ? value.background : 'transparent',
    borderColor: typeof value.borderColor === 'string' ? value.borderColor : '#c9ced6',
    ...(isFiniteNumber(value.borderWidth) ? { borderWidth: value.borderWidth } : {}),
  }
}

export function parseCanvasBlock(value: unknown): CanvasBlockData {
  if (!isRecord(value) || typeof value.kind !== 'string' || !BLOCK_KINDS.has(value.kind as CanvasBlockKind)) {
    throw new Error(t('캔버스 블록 형식이 잘못되었습니다.'))
  }
  if (!isPositiveNumber(value.width) || !isPositiveNumber(value.height)) {
    throw new Error(t('캔버스 블록 크기가 잘못되었습니다.'))
  }
  if (value.manualHeight !== undefined && value.manualHeight !== true) {
    throw new Error(t('캔버스 블록 높이 설정이 잘못되었습니다.'))
  }
  const style = parseTextStyle(value.style)
  if (value.kind === 'title' || value.kind === 'paragraph' || value.kind === 'code') {
    if (typeof value.text !== 'string') throw new Error(t('캔버스 텍스트 블록 형식이 잘못되었습니다.'))
    // 메모 카드 필드는 믿을 수 없는 입력이다: 글자와 모양이 맞는 것만 남기고 나머지는 버린다(예전 파일에는 아예 없다)
    const noteHtml = typeof value.noteHtml === 'string' && value.noteHtml.trim() !== '' ? value.noteHtml : undefined
    const ticket = isRecord(value.ticket)
      ? normalizeTicket({
        ...(typeof value.ticket.id === 'string' ? { id: value.ticket.id } : {}),
        ...(typeof value.ticket.title === 'string' ? { title: value.ticket.title } : {}),
      })
      : null
    return {
      kind: value.kind,
      width: value.width,
      height: value.height,
      ...(value.manualHeight === true ? { manualHeight: true as const } : {}),
      style,
      text: value.text,
      ...(noteHtml === undefined ? {} : { noteHtml }),
      ...(ticket === null ? {} : { ticket }),
    }
  }
  if (SHAPE_KINDS.has(value.kind as CanvasShapeKind)) {
    return { kind: value.kind as CanvasShapeKind, width: value.width, height: value.height, style }
  }
  if (value.kind === 'image') {
    if (typeof value.src !== 'string' || !/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=]+$/iu.test(value.src) || typeof value.alt !== 'string') {
      throw new Error(t('캔버스 이미지 형식이 잘못되었습니다.'))
    }
    return { kind: 'image', width: value.width, height: value.height, style, src: value.src, alt: value.alt }
  }
  if (value.kind === 'arrow') {
    if (value.direction !== 'right') throw new Error(t('화살표 블록 형식이 잘못되었습니다.'))
    return { kind: 'arrow', width: value.width, height: value.height, style, direction: 'right' }
  }
  if (value.kind === 'pdfExcerpt') {
    if (!isPdfExcerptBlock(value.excerpt) || !isRecord(value.source) || value.source.relation !== 'excerpt' || !isAnchor(value.source.anchor)) {
      throw new Error(t('PDF 발췌 블록 형식이 잘못되었습니다.'))
    }
    if (!anchorsEqual(value.excerpt.iwae.anchor, value.source.anchor)) {
      throw new Error(t('PDF 발췌 블록 출처가 일치하지 않습니다.'))
    }
    const highlights = parseExcerptHighlights(value.highlights)
    return {
      kind: 'pdfExcerpt',
      width: value.width,
      height: value.height,
      style,
      ...(isPositiveNumber(value.visualAspectRatio) ? { visualAspectRatio: value.visualAspectRatio } : {}),
      excerpt: structuredClone(value.excerpt),
      ...(highlights === undefined ? {} : { highlights }),
      source: { relation: 'excerpt', anchor: structuredClone(value.source.anchor) },
    }
  }
  if (value.kind === 'markdownExcerpt') {
    if (
      !isMarkdownExcerptSelection(value.selection)
      || !isRecord(value.source)
      || value.source.relation !== 'markdown-excerpt'
      || !isMarkdownExcerptSelection(value.source.selection)
      || !markdownExcerptSelectionsEqual(value.selection, value.source.selection)
    ) {
      throw new Error(t('Markdown 발췌 블록 형식이 잘못되었습니다.'))
    }
    return {
      kind: 'markdownExcerpt',
      width: value.width,
      height: value.height,
      style,
      selection: structuredClone(value.selection),
      ...(value.capture === undefined || !isMarkdownCaptureBlockData(value.capture)
        ? {}
        : { capture: structuredClone(value.capture) }),
      source: {
        relation: 'markdown-excerpt',
        selection: structuredClone(value.source.selection),
      },
    }
  }
  if (
    typeof value.text !== 'string'
    || typeof value.sourceBlockId !== 'string'
    || value.sourceBlockId.length === 0
    || typeof value.targetLanguage !== 'string'
    || typeof value.model !== 'string'
    || !isRecord(value.source)
    || value.source.relation !== 'translation'
    || (value.source.anchor !== undefined && !isAnchor(value.source.anchor))
  ) {
    throw new Error(t('번역 블록 형식이 잘못되었습니다.'))
  }
  return {
    kind: 'translation',
    width: value.width,
    height: value.height,
    ...(value.manualHeight === true ? { manualHeight: true as const } : {}),
    style,
    text: value.text,
    sourceBlockId: value.sourceBlockId,
    targetLanguage: value.targetLanguage,
    model: value.model,
    source: {
      relation: 'translation',
      ...(value.source.anchor === undefined ? {} : { anchor: structuredClone(value.source.anchor) }),
    },
  }
}

function parseLegacyNode(value: unknown): PersistedCanvasNodeV1 {
  if (!isRecord(value)) throw new Error(t('캔버스 노드 형식이 잘못되었습니다.'))
  const { id, type, position, data, style, className } = value
  if (typeof id !== 'string' || id.length === 0) throw new Error(t('캔버스 노드 id가 잘못되었습니다.'))
  if (type !== undefined && typeof type !== 'string') throw new Error(t('캔버스 노드 type이 잘못되었습니다.'))
  if (!isRecord(position) || !isFiniteNumber(position.x) || !isFiniteNumber(position.y)) {
    throw new Error(t('캔버스 노드 좌표가 잘못되었습니다.'))
  }
  if (!isRecord(data) || !isJsonValue(data)) {
    throw new Error(t('캔버스 노드 data는 직렬화 가능한 값이어야 합니다.'))
  }
  if (type === 'pdfExcerpt' && !isPdfExcerptBlock(data.block)) {
    throw new Error(t('PDF 발췌 블록 형식이 잘못되었습니다.'))
  }
  if (style !== undefined) {
    if (!isRecord(style)) throw new Error(t('캔버스 노드 크기가 잘못되었습니다.'))
    for (const dimension of [style.width, style.height]) {
      if (dimension !== undefined && !isPositiveNumber(dimension)) {
        throw new Error(t('캔버스 노드 크기가 잘못되었습니다.'))
      }
    }
  }
  if (className !== undefined && typeof className !== 'string') {
    throw new Error(t('캔버스 노드 className이 잘못되었습니다.'))
  }
  return {
    id,
    ...(type === undefined ? {} : { type }),
    position: { x: position.x, y: position.y },
    data: structuredClone(data),
    ...(style === undefined ? {} : {
      style: {
        ...(isFiniteNumber(style.width) ? { width: style.width } : {}),
        ...(isFiniteNumber(style.height) ? { height: style.height } : {}),
      },
    }),
    ...(className === undefined ? {} : { className }),
  }
}

function parseNode(value: unknown): PersistedCanvasNode {
  if (!isRecord(value)) throw new Error(t('캔버스 노드 형식이 잘못되었습니다.'))
  const { id, type, position, data, className } = value
  if (typeof id !== 'string' || id.length === 0) throw new Error(t('캔버스 노드 id가 잘못되었습니다.'))
  if (type !== undefined && typeof type !== 'string') throw new Error(t('캔버스 노드 type이 잘못되었습니다.'))
  if (!isRecord(position) || !isFiniteNumber(position.x) || !isFiniteNumber(position.y)) {
    throw new Error(t('캔버스 노드 좌표가 잘못되었습니다.'))
  }
  if (!isRecord(data) || !isJsonValue(data)) {
    throw new Error(t('캔버스 노드 data는 직렬화 가능한 값이어야 합니다.'))
  }
  if (className !== undefined && typeof className !== 'string') {
    throw new Error(t('캔버스 노드 className이 잘못되었습니다.'))
  }
  return {
    id,
    ...(type === undefined ? {} : { type }),
    position: { x: position.x, y: position.y },
    data: { block: parseCanvasBlock(data.block) },
    ...(className === undefined ? {} : { className }),
  }
}

function parseEdge(value: unknown): PersistedCanvasEdge {
  if (!isRecord(value)) throw new Error(t('캔버스 edge 형식이 잘못되었습니다.'))
  const { id, source, target, sourceHandle, targetHandle, startMarker, endMarker } = value
  if (
    typeof id !== 'string'
    || id.length === 0
    || typeof source !== 'string'
    || source.length === 0
    || typeof target !== 'string'
    || target.length === 0
  ) {
    throw new Error(t('캔버스 edge 연결 정보가 잘못되었습니다.'))
  }
  if (sourceHandle !== undefined && sourceHandle !== null && typeof sourceHandle !== 'string') {
    throw new Error(t('캔버스 edge sourceHandle이 잘못되었습니다.'))
  }
  if (targetHandle !== undefined && targetHandle !== null && typeof targetHandle !== 'string') {
    throw new Error(t('캔버스 edge targetHandle이 잘못되었습니다.'))
  }
  if (startMarker !== undefined && startMarker !== 'none' && startMarker !== 'arrow') {
    throw new Error(t('캔버스 edge 시작 마커가 잘못되었습니다.'))
  }
  if (endMarker !== undefined && endMarker !== 'none' && endMarker !== 'arrow') {
    throw new Error(t('캔버스 edge 끝 마커가 잘못되었습니다.'))
  }
  return {
    id,
    source,
    target,
    ...(sourceHandle === undefined ? {} : { sourceHandle: migrateCanvasHandleId(sourceHandle) }),
    ...(targetHandle === undefined ? {} : { targetHandle: migrateCanvasHandleId(targetHandle) }),
    ...(startMarker === undefined ? {} : { startMarker }),
    ...(endMarker === undefined ? {} : { endMarker }),
  }
}

function migrateCanvasHandleId(handleId: string | null): string | null {
  if (handleId === null) return null
  const side = /^(?:source-|target-)?(top|right|bottom|left)$/u.exec(handleId)?.[1]
  return side ?? handleId
}

export function applyCanvasBlockCommand(block: CanvasBlockData, command: CanvasBlockCommand): CanvasBlockData {
  if (command.type === 'setBlockBackground') {
    if (block.style.background === command.background) return block
    return { ...block, style: { ...block.style, background: command.background } }
  }
  if (command.type === 'setBlockBorderWidth') {
    if (block.style.borderWidth === command.borderWidth) return block
    return { ...block, style: { ...block.style, borderWidth: command.borderWidth } }
  }
  if (block.style.borderColor === command.borderColor) return block
  return { ...block, style: { ...block.style, borderColor: command.borderColor } }
}

function parseViewport(value: unknown): CanvasViewport {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isPositiveNumber(value.zoom)) {
    throw new Error(t('캔버스 viewport가 잘못되었습니다.'))
  }
  return { x: value.x, y: value.y, zoom: value.zoom }
}

function validateGraph(nodes: readonly { id: string }[], edges: readonly PersistedCanvasEdge[]): void {
  const nodeIds = new Set<string>()
  for (const node of nodes) {
    if (nodeIds.has(node.id)) throw new Error(t('중복된 캔버스 노드 id입니다: {id}', { id: node.id }))
    nodeIds.add(node.id)
  }
  const edgeIds = new Set<string>()
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) throw new Error(t('중복된 캔버스 edge id입니다: {id}', { id: edge.id }))
    edgeIds.add(edge.id)
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new Error(t('캔버스 edge가 존재하지 않는 노드를 가리킵니다: {id}', { id: edge.id }))
    }
  }
}

function legacyDimension(node: PersistedCanvasNodeV1, key: 'width' | 'height', fallback: number): number {
  const block = node.data.block
  if (isPdfExcerptBlock(block)) return block[key]
  return node.style?.[key] ?? fallback
}

export function migrateCanvasDocumentV1(document: CanvasDocumentV1): CanvasDocumentV2 {
  const nodes = document.nodes.map((node): PersistedCanvasNode => {
    const legacyBlock = node.data.block
    if (node.type === 'pdfExcerpt' && isPdfExcerptBlock(legacyBlock)) {
      return {
        id: node.id,
        type: 'pdfExcerpt',
        position: { ...node.position },
        data: {
          block: {
            kind: 'pdfExcerpt',
            width: legacyDimension(node, 'width', 320),
            height: legacyDimension(node, 'height', 160),
            style: createDefaultTextBlockStyle(),
            excerpt: structuredClone(legacyBlock),
            source: { relation: 'excerpt', anchor: structuredClone(legacyBlock.iwae.anchor) },
          },
        },
        ...(node.className === undefined ? {} : { className: node.className }),
      }
    }
    const kind = node.type === 'title' || node.id === 'note-title' ? 'title' : 'paragraph'
    const level = kind === 'title' ? 'h1' : 'paragraph'
    return {
      id: node.id,
      position: { ...node.position },
      data: {
        block: {
          kind,
          width: legacyDimension(node, 'width', kind === 'title' ? 320 : 280),
          height: legacyDimension(node, 'height', kind === 'title' ? 96 : 120),
          style: createDefaultTextBlockStyle(level),
          text: typeof node.data.label === 'string' ? node.data.label : '',
        },
      },
      ...(node.className === undefined ? {} : { className: node.className }),
    }
  })
  return {
    version: 2,
    nodes,
    edges: document.edges.map((edge) => ({ ...edge })),
    viewport: { ...document.viewport },
  }
}

export function parseCanvasDocument(raw: unknown): CanvasDocumentV2 {
  if (!isRecord(raw) || (raw.version !== 1 && raw.version !== 2)) {
    throw new Error(t('지원하지 않는 캔버스 문서 버전입니다.'))
  }
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new Error(t('캔버스 노드 또는 edge 목록이 잘못되었습니다.'))
  }
  const edges = raw.edges.map(parseEdge)
  const viewport = parseViewport(raw.viewport)
  if (raw.version === 1) {
    const legacy: CanvasDocumentV1 = {
      version: 1,
      nodes: raw.nodes.map(parseLegacyNode),
      edges,
      viewport,
    }
    validateGraph(legacy.nodes, legacy.edges)
    return migrateCanvasDocumentV1(legacy)
  }
  const document: CanvasDocumentV2 = {
    version: 2,
    nodes: raw.nodes.map(parseNode),
    edges,
    viewport,
  }
  validateGraph(document.nodes, document.edges)
  return document
}
