import { describe, expect, it } from 'vitest'
import { stackMemoCards, type MemoTarget } from './MemoColumn'

const target = (id: string, top: number): MemoTarget => ({
  highlight: {
    id,
    color: 'yellow',
    anchor: {
      docId: 'd', page: 0, coordSpace: 'pdfium-page', rects: [{ x: 0, y: 0, w: 1, h: 1 }],
      charRange: [0, 1], quote: id, prefix: '', suffix: '',
    },
    note: id,
  },
  top,
  anchorX: 0,
  anchorY: top,
})

describe('stackMemoCards', () => {
  it('puts each card at its highlight when there is room', () => {
    const tops = stackMemoCards([target('a', 100), target('b', 400)], new Map([['a', 60], ['b', 60]]))
    expect(tops.get('a')).toBe(94)
    expect(tops.get('b')).toBe(394)
  })

  it('pushes a card down below the one above instead of overlapping', () => {
    const tops = stackMemoCards([target('b', 120), target('a', 100)], new Map([['a', 80], ['b', 60]]))
    expect(tops.get('a')).toBe(94)
    expect(tops.get('b')).toBe(94 + 80 + 8)
  })
})
