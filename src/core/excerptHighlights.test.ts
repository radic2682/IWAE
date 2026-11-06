import { describe, expect, it } from 'vitest'
import {
  highlightBounds,
  highlightHandleId,
  highlightIdFromHandle,
  highlightRectsFromDrag,
  parseExcerptHighlights,
} from './excerptHighlights'

const glyph = (c: string, x: number, y: number) => ({ c, x, y, w: 6, h: 10 })
// 두 줄: y=100 줄에 "ABCD", y=114 줄에 "EFGH"
const selection = {
  crop: { x: 90, y: 95, w: 60, h: 35 },
  glyphs: [
    glyph('A', 100, 100), glyph('B', 106, 100), glyph(' ', 112, 100), glyph('C', 118, 100), glyph('D', 124, 100),
    glyph('E', 100, 114), glyph('F', 106, 114), glyph('G', 112, 114), glyph('H', 118, 114),
  ],
}

describe('highlightRectsFromDrag', () => {
  it('snaps a sweep over one line to the glyphs it crossed', () => {
    const rects = highlightRectsFromDrag(selection, { x: 104, y: 103, w: 18, h: 3 })
    expect(rects).toHaveLength(1)
    expect(rects[0]).toEqual({ x: 105, y: 99.5, w: 20, h: 11 })
  })

  it('makes one rectangle per line for a drag across lines', () => {
    const rects = highlightRectsFromDrag(selection, { x: 98, y: 98, w: 40, h: 30 })
    expect(rects.map((rect) => rect.y)).toEqual([99.5, 113.5])
  })

  it('ignores a line that the drag only grazes', () => {
    const rects = highlightRectsFromDrag(selection, { x: 98, y: 108.5, w: 40, h: 12 })
    expect(rects).toHaveLength(1)
    expect(rects[0]!.y).toBe(113.5)
  })

  it('keeps the dragged box where there is no text, clipped to the excerpt', () => {
    const rects = highlightRectsFromDrag({ ...selection, glyphs: [] }, { x: 80, y: 120, w: 30, h: 30 })
    expect(rects).toEqual([{ x: 90, y: 120, w: 20, h: 10 }])
  })

  it('returns nothing for a drag outside the excerpt', () => {
    expect(highlightRectsFromDrag(selection, { x: 0, y: 0, w: 10, h: 10 })).toEqual([])
  })
})

describe('highlight helpers', () => {
  it('round-trips handle ids for both sides', () => {
    expect(highlightIdFromHandle(highlightHandleId('h1'))).toBe('h1')
    expect(highlightIdFromHandle(highlightHandleId('h1', 'left'))).toBe('h1')
    expect(highlightIdFromHandle('right')).toBeNull()
    expect(highlightIdFromHandle(null)).toBeNull()
  })

  it('parses stored highlights and drops broken ones', () => {
    expect(parseExcerptHighlights([
      { id: 'a', color: 'green', rects: [{ x: 1, y: 2, w: 3, h: 4 }, { x: 1, y: 2, w: 0, h: 4 }] },
      { id: 'b', color: 'purple', rects: [{ x: 1, y: 2, w: 3, h: 4 }] },
      { id: '', color: 'yellow', rects: [] },
    ])).toEqual([{ id: 'a', color: 'green', rects: [{ x: 1, y: 2, w: 3, h: 4 }] }])
    expect(parseExcerptHighlights(undefined)).toBeUndefined()
  })

  it('bounds every rect of a highlight', () => {
    expect(highlightBounds({ rects: [{ x: 10, y: 10, w: 5, h: 5 }, { x: 2, y: 20, w: 4, h: 2 }] })).toEqual({ x: 2, y: 10, w: 13, h: 12 })
  })
})
