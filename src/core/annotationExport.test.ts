import { describe, expect, it } from 'vitest'
import { annotationsToMarkdown, sortAnnotations, filterAnnotations } from './annotationExport'
import type { PersistentPdfHighlight } from '../pdf/persistentHighlight'

const make = (page: number, y: number, quote: string, extra: Partial<PersistentPdfHighlight> = {}): PersistentPdfHighlight => ({
  id: `d:${page}:${y}`,
  color: 'yellow',
  anchor: {
    docId: 'd', page, coordSpace: 'pdfium-page', rects: [{ x: 0, y, w: 10, h: 10 }],
    charRange: [y, y + 1], quote, prefix: '', suffix: '',
  },
  ...extra,
})

describe('annotationExport', () => {
  it('sorts by page, then top to bottom', () => {
    const sorted = sortAnnotations([make(2, 50, 'c'), make(0, 300, 'b'), make(0, 20, 'a')])
    expect(sorted.map((h) => h.anchor.quote)).toEqual(['a', 'b', 'c'])
  })

  it('filters by color and by text in the quote or the note', () => {
    const items = [make(0, 1, 'Dynamic address'), make(0, 2, 'Bus init', { color: 'blue', note: '중요한 정의' })]
    expect(filterAnnotations(items, { colors: ['blue'], query: '' }).map((h) => h.anchor.quote)).toEqual(['Bus init'])
    expect(filterAnnotations(items, { colors: [], query: 'dynamic' }).map((h) => h.anchor.quote)).toEqual(['Dynamic address'])
    expect(filterAnnotations(items, { colors: [], query: '정의' }).map((h) => h.anchor.quote)).toEqual(['Bus init'])
  })

  it('writes a Markdown digest grouped by page with color markers and notes', () => {
    const markdown = annotationsToMarkdown('HTTP 사양', [
      make(4, 10, 'second page quote', { color: 'green' }),
      make(0, 10, 'first\nline', { note: '메모 한 줄\n두 줄' }),
    ])
    expect(markdown).toBe([
      '# HTTP 사양: 주석',
      '',
      '## p.1',
      '',
      '🟨 > first',
      '> line',
      '',
      '메모 한 줄',
      '두 줄',
      '',
      '## p.5',
      '',
      '🟩 > second page quote',
      '',
    ].join('\n'))
  })

  it('says so when there is nothing to export', () => {
    expect(annotationsToMarkdown('빈 문서', [])).toBe('# 빈 문서: 주석\n\n_주석이 없습니다._\n')
  })
})
