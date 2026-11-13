import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { createDefaultTextBlockStyle, normalizeCanvasBlockSize, normalizeCanvasNodePosition } from '../../core/canvasDocument'
import { ridingOverlays } from './NoteCanvas'

function node(id: string, kind: string, x: number, y: number, width: number, height: number, selected = false): Node {
  return { id, position: { x, y }, width, height, selected, data: { block: { kind, width, height } } }
}

describe('그리기 도형', () => {
  it('크기와 위치가 격자에 묶이지 않는다', () => {
    const style = createDefaultTextBlockStyle()
    expect(normalizeCanvasBlockSize({ kind: 'rectangle', width: 33.4, height: 17.6, style }, { width: 33.4, height: 17.6 }))
      .toEqual({ width: 33, height: 18 })
    expect(normalizeCanvasBlockSize({ kind: 'rectangle', width: 3, height: 3, style }, { width: 3, height: 3 }))
      .toEqual({ width: 8, height: 8 })
    expect(normalizeCanvasNodePosition({ kind: 'ellipse', width: 40, height: 40, style }, { x: 13.2, y: 27.7 }))
      .toEqual({ x: 13, y: 28 })
    expect(normalizeCanvasNodePosition({ kind: 'paragraph', width: 280, height: 80, style, text: '' }, { x: 13, y: 27 }))
      .toEqual({ x: 20, y: 30 })
  })

  it('블록 위에 절반 이상 올라간 도형만 블록과 함께 움직인다', () => {
    const base = node('excerpt', 'pdfExcerpt', 0, 0, 400, 200)
    const scene = [
      base,
      node('inside', 'rectangle', 50, 50, 100, 40),
      node('half-out', 'rectangle', 350, 150, 100, 100),
      node('mostly-in', 'ellipse', 360, 20, 60, 40),
      node('selected', 'rectangle', 10, 10, 20, 20, true),
      node('text', 'paragraph', 20, 20, 100, 40),
    ]
    expect(ridingOverlays(base, scene).map(({ id }) => id)).toEqual(['inside', 'mostly-in'])
  })
})
