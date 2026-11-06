import { describe, expect, it } from 'vitest'
import type { Anchor } from './anchor'
import {
  createRegionExcerptSelection,
  createPdfExcerptBlock,
  createSourceJumpRequest,
  createTextExcerptSelection,
  isPointInsideRect,
  parsePdfExcerptDrag,
  PDF_EXCERPT_DRAG_MIME,
  serializePdfExcerptDrag,
  sizePdfExcerptToSelectedText,
} from './pdfExcerpt'
import type { PageTextIndex } from './textIndex'

const anchor: Anchor = {
  docId: '5511aa99cc33',
  page: 301,
  coordSpace: 'pdfium-page',
  rects: [
    { x: 72, y: 640.2, w: 379.3, h: 12.1 },
    { x: 72, y: 626, w: 308.5, h: 12.1 },
  ],
  charRange: [1840, 1902],
  quote: 'The OPTIONS response shall be returned by the Controller.',
  prefix: 'Command response: ',
  suffix: ' See Section 5.1.9.3.4.',
}

const textIndex: PageTextIndex = {
  text: 'OPTIONS response',
  chars: [
    { c: 'O', x: 72, y: 100, w: 8, h: 12 },
    { c: 'P', x: 80, y: 100, w: 8, h: 12 },
    { c: 'T', x: 88, y: 100, w: 8, h: 12 },
    { c: 'I', x: 96, y: 100, w: 8, h: 12 },
    { c: 'O', x: 104, y: 100, w: 8, h: 12 },
    { c: 'N', x: 112, y: 100, w: 8, h: 12 },
    { c: 'S', x: 120, y: 100, w: 8, h: 12 },
    { c: ' ', x: 128, y: 100, w: 4, h: 12 },
    { c: 'r', x: 132, y: 100, w: 6, h: 12 },
    { c: 'e', x: 138, y: 100, w: 6, h: 12 },
    { c: 's', x: 144, y: 100, w: 6, h: 12 },
    { c: 'p', x: 150, y: 100, w: 6, h: 12 },
    { c: 'o', x: 156, y: 100, w: 6, h: 12 },
    { c: 'n', x: 162, y: 100, w: 6, h: 12 },
    { c: 's', x: 168, y: 100, w: 6, h: 12 },
    { c: 'e', x: 174, y: 100, w: 6, h: 12 },
  ],
}

const textAnchor: Anchor = {
  docId: '5511aa99cc33',
  page: 3,
  coordSpace: 'pdfium-page',
  rects: [{ x: 72, y: 100, w: 108, h: 12 }],
  charRange: [0, textIndex.text.length],
  quote: textIndex.text,
  prefix: '',
  suffix: '',
}

describe('PDF excerpt block model', () => {
  it('keeps text glyphs and uses a tight four-point crop', () => {
    const selection = createTextExcerptSelection(textAnchor, textIndex, [612, 792])

    expect(selection.mode).toBe('text')
    expect(selection.glyphs.map(({ c }) => c).join('')).toBe('OPTIONS response')
    expect(selection.crop).toEqual({ x: 68, y: 96, w: 116, h: 20 })
  })

  it('reads each text rectangle coordinate once while calculating the crop', () => {
    const reads = { x: 0, y: 0, w: 0, h: 0 }
    const values = { x: 72, y: 100, w: 108, h: 12 }
    const rect = Object.fromEntries(Object.keys(values).map((key) => [key, {
      enumerable: true,
      get: () => {
        const coordinate = key as keyof typeof values
        reads[coordinate] += 1
        return values[coordinate]
      },
    }]))
    const trackedRect = Object.defineProperties({}, rect) as Anchor['rects'][number]

    const selection = createTextExcerptSelection({ ...textAnchor, rects: [trackedRect] }, textIndex, [612, 792])

    expect(selection.crop).toEqual({ x: 68, y: 96, w: 116, h: 20 })
    expect(reads).toEqual({ x: 1, y: 1, w: 1, h: 1 })
  })

  it('keeps an exact rectangular region and captures intersecting glyphs', () => {
    const selection = createRegionExcerptSelection({
      docId: textAnchor.docId,
      page: textAnchor.page,
      rect: { x: 90, y: 96, w: 52, h: 20 },
      index: textIndex,
      pageSize: [612, 792],
    })

    expect(selection.mode).toBe('region')
    expect(selection.crop).toEqual({ x: 90, y: 96, w: 52, h: 20 })
    expect(selection.glyphs.map(({ c }) => c).join('')).toBe('TIONS re')
  })

  it('keeps the complete anchor and writes a human-readable source line', () => {
    const selection = createTextExcerptSelection(textAnchor, textIndex, [612, 792])
    const block = createPdfExcerptBlock({
      id: 'n-8f3a',
      selection,
      sourceTitle: 'HTTP Semantics Guide v1.1',
      geometry: { x: 120, y: -40, width: 420, height: 180 },
    })

    expect(block).toEqual({
      id: 'n-8f3a',
      type: 'pdfExcerpt',
      x: 120,
      y: -40,
      width: 420,
      height: 180,
      text: '> OPTIONS response\n\n— HTTP Semantics Guide v1.1, p.4',
      sourceTitle: 'HTTP Semantics Guide v1.1',
      selection,
      iwae: {
        kind: 'pdf-excerpt',
        anchor: textAnchor,
      },
    })
  })

  it('builds an exact-location source jump request from block metadata', () => {
    const selection = createTextExcerptSelection(textAnchor, textIndex, [612, 792])
    const block = createPdfExcerptBlock({
      id: 'n-8f3a',
      selection,
      sourceTitle: 'HTTP Semantics Guide v1.1',
      geometry: { x: 120, y: -40, width: 420, height: 180 },
    })

    expect(createSourceJumpRequest(block)).toEqual({
      docId: '5511aa99cc33',
      page: 3,
      anchor: textAnchor,
    })
  })

  it('serializes the exact PDF selection for native drag and drop', () => {
    const selection = createTextExcerptSelection(textAnchor, textIndex, [612, 792])
    const payload = {
      selection,
      sourceTitle: 'HTTP Semantics Guide v1.1',
      displaySize: { width: 420, height: 96 },
    }

    expect(PDF_EXCERPT_DRAG_MIME).toBe('application/x-iwae-pdf-excerpt')
    expect(parsePdfExcerptDrag(serializePdfExcerptDrag(payload))).toEqual(payload)
    expect(parsePdfExcerptDrag('{"anchor":null}')).toBeNull()
    expect(parsePdfExcerptDrag('not json')).toBeNull()
  })
})

describe('PDF excerpt drop boundary', () => {
  it('accepts points on the canvas edge and rejects points outside it', () => {
    const bounds = { left: 600, top: 100, right: 1000, bottom: 700 }

    expect(isPointInsideRect({ x: 600, y: 700 }, bounds)).toBe(true)
    expect(isPointInsideRect({ x: 599, y: 700 }, bounds)).toBe(false)
    expect(isPointInsideRect({ x: 600, y: 701 }, bounds)).toBe(false)
  })
})

describe('PDF text size matching', () => {
  it('uses the median selected glyph height and compensates for canvas zoom', () => {
    const selection = createTextExcerptSelection(textAnchor, textIndex, [612, 792])
    const payload = {
      sourceTitle: 'Source',
      selection: { ...selection, crop: { x: 0, y: 0, w: 200, h: 40 }, glyphs: [
        { c: 'A', x: 0, y: 0, w: 8, h: 10 },
        { c: 'B', x: 8, y: 0, w: 8, h: 10 },
        { c: 'C', x: 16, y: 0, w: 8, h: 40 },
      ] },
      displaySize: { width: 400, height: 80 },
    }
    expect(sizePdfExcerptToSelectedText(payload, 0.5)).toEqual({ width: 800, height: 160 })
  })

  it('brings tiny source text up to a readable size and skips selections without glyphs', () => {
    const selection = createTextExcerptSelection(textAnchor, textIndex, [612, 792])
    const payload = { sourceTitle: 'Source', selection: { ...selection, crop: { x: 0, y: 0, w: 200, h: 40 }, glyphs: [{ c: 'a', x: 0, y: 0, w: 5, h: 5 }] }, displaySize: { width: 200, height: 40 } }
    expect(sizePdfExcerptToSelectedText(payload, 1)).toEqual({ width: 560, height: 112 })
    expect(sizePdfExcerptToSelectedText({ ...payload, selection: { ...payload.selection, glyphs: [] } }, 1)).toBeNull()
    expect(sizePdfExcerptToSelectedText({ ...payload, selection: { ...payload.selection, glyphs: [], visualTextHeight: 5 } }, 1)).toEqual({ width: 560, height: 112 })
  })
})
