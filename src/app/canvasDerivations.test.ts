import { describe, expect, it } from 'vitest'
import { createDefaultTextBlockStyle, type CanvasBlockData } from '../core/canvasDocument'
import type { Anchor } from '../core/anchor'
import type { CanvasNode } from './PdfExcerptNode'
import { deriveCanvasNodeState } from './canvasDerivations'

const anchor: Anchor = {
  docId: 'doc-1',
  page: 2,
  coordSpace: 'pdfium-page',
  rects: [{ x: 10, y: 20, w: 30, h: 12 }],
  charRange: [4, 12],
  quote: 'selected text',
  prefix: '',
  suffix: '',
}

function canvasNode(id: string, block: CanvasBlockData, selected = false): CanvasNode {
  return {
    id,
    type: block.kind === 'pdfExcerpt' ? 'pdfExcerpt' : block.kind === 'translation' ? 'translation' : 'textBlock',
    position: { x: 0, y: 0 },
    selected,
    data: { block },
  } as CanvasNode
}

describe('deriveCanvasNodeState', () => {
  it('한 번의 파생 결과로 선택 블록과 PDF 출처 상태를 함께 만든다', () => {
    const style = createDefaultTextBlockStyle()
    const nodes = [
      canvasNode('paragraph-1', { kind: 'paragraph', width: 240, height: 80, style, text: 'note' }, true),
      canvasNode('excerpt-1', {
        kind: 'pdfExcerpt',
        width: 240,
        height: 80,
        style,
        source: { relation: 'excerpt', anchor },
        excerpt: {},
      } as unknown as CanvasBlockData, true),
      canvasNode('translation-1', {
        kind: 'translation',
        width: 240,
        height: 80,
        style,
        text: 'translation',
        sourceBlockId: 'excerpt-1',
        targetLanguage: 'ko',
        model: 'test',
        source: { relation: 'translation', anchor: { ...anchor, page: 3 } },
      }, false),
      canvasNode('arrow-1', { kind: 'arrow', width: 180, height: 40, style, direction: 'right' }, true),
    ]

    const result = deriveCanvasNodeState(nodes)

    expect([...result.selectedIds]).toEqual(['paragraph-1', 'excerpt-1', 'arrow-1'])
    expect(result.selectedTextNodes.map(({ id }) => id)).toEqual(['paragraph-1'])
    expect(result.selectionStyle).toBe(style)
    expect(result.sourceReferences).toEqual([
      { blockId: 'excerpt-1', anchor, relation: 'excerpt' },
      { blockId: 'translation-1', anchor: { ...anchor, page: 3 }, relation: 'translation' },
    ])
    expect([...result.selectedSourceIds]).toEqual(['excerpt-1'])
  })
})
