import { buildAnchor, type Anchor, type AnchorRect } from './anchor'
import type { CharBox, PageTextIndex } from './textIndex'

export const PDF_EXCERPT_DRAG_MIME = 'application/x-iwae-pdf-excerpt'

export interface PdfExcerptGlyph {
  readonly c: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface PdfExcerptCrop {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface PdfExcerptSelection {
  readonly mode: 'text' | 'region'
  readonly anchor: Anchor
  readonly pageSize: readonly [number, number]
  readonly crop: PdfExcerptCrop
  readonly glyphs: readonly PdfExcerptGlyph[]
  /** Estimated visible text height in PDF page coordinates when no text layer exists. */
  readonly visualTextHeight?: number
}

export interface PdfExcerptDragPayload {
  readonly selection: PdfExcerptSelection
  readonly sourceTitle: string
  readonly displaySize?: {
    readonly width: number
    readonly height: number
  }
}

/** Keep the source text at a readable on-screen size when its crop becomes a canvas block. */
export function sizePdfExcerptToSelectedText(payload: PdfExcerptDragPayload, canvasZoom: number): { width: number; height: number } | null {
  const { crop, glyphs } = payload.selection
  const heights = glyphs
    .filter((glyph) => glyph.c.trim().length > 0 && Number.isFinite(glyph.h) && glyph.h > 0)
    .map((glyph) => glyph.h)
    .sort((a, b) => a - b)
  if (!Number.isFinite(crop.w) || crop.w <= 0 || !Number.isFinite(crop.h) || crop.h <= 0) return null
  const middle = Math.floor(heights.length / 2)
  const glyphHeight = heights.length > 0
    ? heights.length % 2 === 0 ? ((heights[middle - 1] ?? 0) + (heights[middle] ?? 0)) / 2 : heights[middle]!
    : payload.selection.visualTextHeight
  if (glyphHeight === undefined || !Number.isFinite(glyphHeight) || glyphHeight <= 0) return null
  const sourceScale = payload.displaySize?.width !== undefined && Number.isFinite(payload.displaySize.width) && payload.displaySize.width > 0
    ? payload.displaySize.width / crop.w
    : 1
  const sourceGlyphPixels = glyphHeight * sourceScale
  const targetGlyphPixels = Math.min(40, Math.max(14, sourceGlyphPixels))
  const zoom = Number.isFinite(canvasZoom) && canvasZoom > 0 ? canvasZoom : 1
  const scale = targetGlyphPixels / glyphHeight / zoom
  return { width: rounded(crop.w * scale), height: rounded(crop.h * scale) }
}

export interface CanvasGeometry {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface PdfExcerptBlock {
  readonly id: string
  readonly type: 'pdfExcerpt'
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly text: string
  readonly sourceTitle: string
  readonly selection: PdfExcerptSelection
  readonly iwae: {
    readonly kind: 'pdf-excerpt'
    readonly anchor: Anchor
  }
}

export interface CreatePdfExcerptBlockInput {
  readonly id: string
  readonly selection: PdfExcerptSelection
  readonly sourceTitle: string
  readonly geometry: CanvasGeometry
}

export interface CreateRegionExcerptSelectionInput {
  readonly docId: string
  readonly page: number
  readonly rect: PdfExcerptCrop
  readonly index: PageTextIndex
  readonly pageSize: readonly [number, number]
}

export interface SourceJumpRequest {
  readonly docId: string
  readonly page: number
  readonly anchor: Anchor
}

export interface ClientPoint {
  readonly x: number
  readonly y: number
}

export interface ClientRectBounds {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

const TEXT_CROP_PADDING = 4

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function clampCrop(rect: PdfExcerptCrop, pageSize: readonly [number, number]): PdfExcerptCrop {
  const [pageWidth, pageHeight] = pageSize
  const left = clamp(Math.min(rect.x, rect.x + rect.w), 0, pageWidth)
  const top = clamp(Math.min(rect.y, rect.y + rect.h), 0, pageHeight)
  const right = clamp(Math.max(rect.x, rect.x + rect.w), 0, pageWidth)
  const bottom = clamp(Math.max(rect.y, rect.y + rect.h), 0, pageHeight)
  return {
    x: rounded(left),
    y: rounded(top),
    w: rounded(Math.max(right - left, 1)),
    h: rounded(Math.max(bottom - top, 1)),
  }
}

function textCrop(anchor: Anchor, pageSize: readonly [number, number]): PdfExcerptCrop {
  if (anchor.rects.length === 0) {
    return clampCrop({ x: 0, y: 0, w: pageSize[0], h: pageSize[1] }, pageSize)
  }
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const rect of anchor.rects) {
    const { x, y, w, h } = rect
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x + w)
    bottom = Math.max(bottom, y + h)
  }
  left -= TEXT_CROP_PADDING
  top -= TEXT_CROP_PADDING
  right += TEXT_CROP_PADDING
  bottom += TEXT_CROP_PADDING
  return clampCrop({ x: left, y: top, w: right - left, h: bottom - top }, pageSize)
}

function asGlyph(box: CharBox): PdfExcerptGlyph {
  return { c: box.c, x: box.x, y: box.y, w: box.w, h: box.h }
}

function intersects(box: CharBox, rect: PdfExcerptCrop): boolean {
  return box.w > 0
    && box.h > 0
    && box.x < rect.x + rect.w
    && box.x + box.w > rect.x
    && box.y < rect.y + rect.h
    && box.y + box.h > rect.y
}

export function createTextExcerptSelection(
  anchor: Anchor,
  index: PageTextIndex,
  pageSize: readonly [number, number],
): PdfExcerptSelection {
  const [start, end] = anchor.charRange
  return {
    mode: 'text',
    anchor,
    pageSize: [pageSize[0], pageSize[1]],
    crop: textCrop(anchor, pageSize),
    glyphs: index.chars.slice(start, end).map(asGlyph),
  }
}

export function createRegionExcerptSelection({
  docId,
  page,
  rect,
  index,
  pageSize,
}: CreateRegionExcerptSelectionInput): PdfExcerptSelection {
  const crop = clampCrop(rect, pageSize)
  const indexes: number[] = []
  const glyphs: PdfExcerptGlyph[] = []
  index.chars.forEach((box, charIndex) => {
    if (!intersects(box, crop)) return
    indexes.push(charIndex)
    glyphs.push(asGlyph(box))
  })

  const start = indexes[0] ?? 0
  const end = indexes.length === 0 ? start : (indexes[indexes.length - 1] ?? start) + 1
  const anchor = indexes.length === 0
    ? {
        docId,
        page,
        coordSpace: 'pdfium-page' as const,
        rects: [crop],
        charRange: [0, 0] as const,
        quote: '',
        prefix: '',
        suffix: '',
      }
    : buildAnchor(docId, page, index, start, end)

  return {
    mode: 'region',
    anchor: { ...anchor, rects: [crop] },
    pageSize: [pageSize[0], pageSize[1]],
    crop,
    glyphs,
  }
}

export function createPdfExcerptBlock({
  id,
  selection,
  sourceTitle,
  geometry,
}: CreatePdfExcerptBlockInput): PdfExcerptBlock {
  const { anchor } = selection
  return {
    id,
    type: 'pdfExcerpt',
    ...geometry,
    text: `> ${anchor.quote}\n\n— ${sourceTitle}, p.${anchor.page + 1}`,
    sourceTitle,
    selection,
    iwae: {
      kind: 'pdf-excerpt',
      anchor,
    },
  }
}

export function serializePdfExcerptDrag(payload: PdfExcerptDragPayload): string {
  return JSON.stringify(payload)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isFinitePositive(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}

function isRect(value: unknown): value is AnchorRect {
  if (typeof value !== 'object' || value === null) return false
  const rect = value as Partial<AnchorRect>
  return isFiniteNumber(rect.x) && isFiniteNumber(rect.y) && isFinitePositive(rect.w) && isFinitePositive(rect.h)
}

function isAnchor(value: unknown): value is Anchor {
  if (typeof value !== 'object' || value === null) return false
  const anchor = value as Partial<Anchor>
  return (
    typeof anchor.docId === 'string'
    && Number.isInteger(anchor.page)
    && (anchor.page ?? -1) >= 0
    && anchor.coordSpace === 'pdfium-page'
    && Array.isArray(anchor.rects)
    && anchor.rects.every(isRect)
    && Array.isArray(anchor.charRange)
    && anchor.charRange.length === 2
    && anchor.charRange.every((offset) => Number.isInteger(offset) && offset >= 0)
    && typeof anchor.quote === 'string'
    && typeof anchor.prefix === 'string'
    && typeof anchor.suffix === 'string'
  )
}

function isGlyph(value: unknown): value is PdfExcerptGlyph {
  if (typeof value !== 'object' || value === null) return false
  const glyph = value as Partial<PdfExcerptGlyph>
  return typeof glyph.c === 'string'
    && isFiniteNumber(glyph.x)
    && isFiniteNumber(glyph.y)
    && isFiniteNumber(glyph.w)
    && glyph.w >= 0
    && isFiniteNumber(glyph.h)
    && glyph.h >= 0
}

export function isPdfExcerptSelection(value: unknown): value is PdfExcerptSelection {
  if (typeof value !== 'object' || value === null) return false
  const selection = value as Partial<PdfExcerptSelection>
  if (selection.mode !== 'text' && selection.mode !== 'region') return false
  if (!isAnchor(selection.anchor) || !isRect(selection.crop)) return false
  if (!Array.isArray(selection.pageSize) || selection.pageSize.length !== 2) return false
  const width = selection.pageSize[0]
  const height = selection.pageSize[1]
  if (!isFinitePositive(width) || !isFinitePositive(height)) return false
  if (!Array.isArray(selection.glyphs) || !selection.glyphs.every(isGlyph)) return false
  if (selection.visualTextHeight !== undefined && !isFinitePositive(selection.visualTextHeight)) return false
  return selection.crop.x >= 0
    && selection.crop.y >= 0
    && selection.crop.x + selection.crop.w <= width
    && selection.crop.y + selection.crop.h <= height
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

export function isPdfExcerptBlock(value: unknown): value is PdfExcerptBlock {
  if (typeof value !== 'object' || value === null) return false
  const block = value as Partial<PdfExcerptBlock>
  if (
    typeof block.id !== 'string'
    || block.id.length === 0
    || block.type !== 'pdfExcerpt'
    || !isFiniteNumber(block.x)
    || !isFiniteNumber(block.y)
    || !isFinitePositive(block.width)
    || !isFinitePositive(block.height)
    || typeof block.text !== 'string'
    || typeof block.sourceTitle !== 'string'
    || !isPdfExcerptSelection(block.selection)
    || typeof block.iwae !== 'object'
    || block.iwae === null
    || block.iwae.kind !== 'pdf-excerpt'
    || !isAnchor(block.iwae.anchor)
  ) {
    return false
  }
  return anchorsEqual(block.selection.anchor, block.iwae.anchor)
}

export function parsePdfExcerptDrag(serialized: string): PdfExcerptDragPayload | null {
  try {
    const value: unknown = JSON.parse(serialized)
    if (typeof value !== 'object' || value === null) return null
    const payload = value as Partial<PdfExcerptDragPayload>
    if (!isPdfExcerptSelection(payload.selection) || typeof payload.sourceTitle !== 'string') return null
    const displaySize = payload.displaySize
    if (displaySize !== undefined && (
      typeof displaySize !== 'object'
      || displaySize === null
      || !isFinitePositive(displaySize.width)
      || !isFinitePositive(displaySize.height)
    )) return null
    return {
      selection: payload.selection,
      sourceTitle: payload.sourceTitle,
      ...(displaySize === undefined ? {} : { displaySize }),
    }
  } catch {
    return null
  }
}

export function createSourceJumpRequest(block: PdfExcerptBlock): SourceJumpRequest {
  const { anchor } = block.iwae
  return {
    docId: anchor.docId,
    page: anchor.page,
    anchor,
  }
}

export function isPointInsideRect(point: ClientPoint, bounds: ClientRectBounds): boolean {
  return (
    point.x >= bounds.left
    && point.x <= bounds.right
    && point.y >= bounds.top
    && point.y <= bounds.bottom
  )
}
