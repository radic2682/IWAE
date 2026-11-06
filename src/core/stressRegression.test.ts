import { describe, expect, it } from 'vitest'
import { createDefaultTextBlockStyle, parseCanvasDocument, type CanvasBlockData } from './canvasDocument'
import { serializeCanvasDoc } from './canvasSerialize'
import { searchPageIndex } from './pdfSearch'
import type { PageTextIndex } from './textIndex'

function textIndex(text: string): PageTextIndex {
  return {
    text,
    chars: [...text].map((character, index) => ({
      c: character, x: index * 6, y: 0, w: 6, h: 10,
    })),
  }
}

function stressBlock(index: number): CanvasBlockData {
  const style = createDefaultTextBlockStyle()
  switch (index % 5) {
    case 0:
      return { kind: 'paragraph', width: 280, height: 80, style, text: `Block ${index}` }
    case 1:
      return { kind: 'rectangle', width: 240, height: 100, style }
    case 2: {
      const anchor = {
        docId: 'stress-doc', page: index, coordSpace: 'pdfium-page' as const,
        rects: [{ x: 10, y: 20, w: 120, h: 24 }], charRange: [0, 5] as const,
        quote: 'quote', prefix: '', suffix: '',
      }
      const selection = {
        mode: 'text' as const, anchor, pageSize: [612, 792] as const,
        crop: { x: 8, y: 18, w: 124, h: 28 },
        glyphs: [{ c: 'quote', x: 10, y: 20, w: 120, h: 24 }],
      }
      const excerpt = {
        id: `excerpt-${index}`, type: 'pdfExcerpt' as const, x: 0, y: 0,
        width: 300, height: 68, text: '> quote', sourceTitle: 'Stress PDF', selection,
        iwae: { kind: 'pdf-excerpt' as const, anchor },
      }
      return {
        kind: 'pdfExcerpt', width: 300, height: 68, style, excerpt,
        source: { relation: 'excerpt', anchor },
      }
    }
    case 3: {
      const selection = {
        path: 'docs/stress.md', title: 'Stress', quote: `Markdown ${index}`,
        prefix: '', suffix: '', startOffset: index, endOffset: index + 4,
        format: 'paragraph' as const,
      }
      return {
        kind: 'markdownExcerpt', width: 280, height: 70, style, selection,
        source: { relation: 'markdown-excerpt', selection },
      }
    }
    default:
      return {
        kind: 'translation', width: 280, height: 80, style, text: `번역 ${index}`,
        sourceBlockId: `node-${index - 1}`, targetLanguage: 'ko', model: 'stress-model',
        source: { relation: 'translation' },
      }
  }
}

describe('deterministic stress regressions', () => {
  it('searches 1,000 pages with complete ordered unique results under five seconds', () => {
    const startedAt = performance.now()
    const matches = Array.from({ length: 1_000 }, (_, page) => {
      const text = page % 10 === 0 ? `page ${page} STRESS marker` : `page ${page}`
      return searchPageIndex('stress-doc', page, textIndex(text), 'STRESS', {
        caseSensitive: true,
        wholeWord: true,
      })
    }).flat()

    expect(matches).toHaveLength(100)
    expect(matches.map((match) => match.page)).toEqual(Array.from({ length: 100 }, (_, index) => index * 10))
    expect(new Set(matches.map((match) => match.id)).size).toBe(matches.length)
    expect(matches.at(-1)?.page).toBe(990)
    expect(performance.now() - startedAt).toBeLessThan(5_000)
  })

  it('round-trips 500 mixed blocks and their source-aware edges deterministically', () => {
    const nodes = Array.from({ length: 500 }, (_, index) => ({
      id: `node-${index.toString().padStart(3, '0')}`,
      position: { x: (index % 20) * 320, y: Math.floor(index / 20) * 140 },
      data: { block: stressBlock(index) },
    }))
    const edges = nodes.slice(1).map((node, index) => ({
      id: `edge-${index.toString().padStart(3, '0')}`,
      source: nodes[index]!.id,
      target: node.id,
      sourceHandle: 'right',
      targetHandle: 'left',
      endMarker: 'arrow' as const,
    }))
    const serialized = serializeCanvasDoc({
      version: 2, nodes: [...nodes].reverse(), edges: [...edges].reverse(),
      viewport: { x: -120, y: 40, zoom: 0.8 },
    })

    const parsed = parseCanvasDocument(JSON.parse(serialized))

    expect(parsed.nodes).toHaveLength(500)
    expect(parsed.edges).toHaveLength(499)
    expect(new Set(parsed.nodes.map((node) => node.id)).size).toBe(500)
    expect(parsed.nodes.find((node) => node.data.block.kind === 'pdfExcerpt')?.data.block)
      .toMatchObject({ source: { relation: 'excerpt', anchor: { docId: 'stress-doc' } } })
    expect(serializeCanvasDoc(parsed)).toBe(serialized)
  })
})
