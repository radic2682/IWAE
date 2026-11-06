import { describe, expect, it } from 'vitest'
import { SAMPLE_DOC_ID } from '../pdf/samplePage'
import { createDevelopmentCanvasDocument } from './developmentCanvasDocument'

describe('development sample canvas', () => {
  it('PDF 발췌·해석·관계선이 포함된 완성형 샘플 노트를 만든다', () => {
    const document = createDevelopmentCanvasDocument()
    const excerpts = document.nodes.filter((node) => node.data.block.kind === 'pdfExcerpt')
    const translations = document.nodes.filter((node) => node.data.block.kind === 'translation')

    expect(document.nodes.length).toBeGreaterThanOrEqual(8)
    expect(excerpts).toHaveLength(3)
    expect(translations).toHaveLength(1)
    expect(document.edges.length).toBeGreaterThanOrEqual(5)
    expect(document.viewport.zoom).toBeLessThan(1)
    for (const node of excerpts) {
      const block = node.data.block
      if (block.kind !== 'pdfExcerpt') throw new Error('PDF excerpt expected')
      expect(block.source.anchor.docId).toBe(SAMPLE_DOC_ID)
      expect(block.source.anchor.quote.length).toBeGreaterThan(30)
    }
  })
})
