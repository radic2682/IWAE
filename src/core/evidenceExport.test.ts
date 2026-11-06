import { describe, expect, it } from 'vitest'
import type { Anchor } from './anchor'
import type { CanvasBlockData, PersistedCanvasEdge, PersistedCanvasNode, TextBlockStyle } from './canvasDocument'
import { canvasMapSvg, collectEvidence, readingOrder, renderEvidenceHtml } from './evidenceExport'

const style: TextBlockStyle = {
  level: 'paragraph', fontSize: 16, bold: false, italic: false, underline: false, strike: false, code: false,
  align: 'left', list: 'none', color: '', highlight: '', background: '', borderColor: '',
}

const anchor = (docId: string, page: number, quote: string, y = 10): Anchor => ({
  docId, page, coordSpace: 'pdfium-page', rects: [{ x: 10, y, w: 100, h: 12 }], charRange: [0, quote.length], quote, prefix: '', suffix: '',
})

function node(id: string, x: number, y: number, block: CanvasBlockData, type = 'note'): PersistedCanvasNode {
  return { id, type, position: { x, y }, data: { block } }
}

const text = (kind: 'title' | 'paragraph', value: string): CanvasBlockData => ({ kind, text: value, width: 200, height: 40, style })

function excerpt(docId: string, page: number, quote: string, title: string, y = 10): CanvasBlockData {
  const a = anchor(docId, page, quote, y)
  return {
    kind: 'pdfExcerpt', width: 240, height: 80, style,
    excerpt: {
      id: `${docId}-${page}-${quote}`, type: 'pdfExcerpt', x: 0, y: 0, width: 240, height: 80, text: quote, sourceTitle: title,
      selection: { mode: 'text', anchor: a, pageSize: [612, 792], crop: { x: 10, y, w: 100, h: 12 }, glyphs: [] },
      iwae: { kind: 'pdf-excerpt', anchor: a },
    },
    source: { relation: 'excerpt', anchor: a },
  } as unknown as CanvasBlockData
}

const markdownExcerpt: CanvasBlockData = {
  kind: 'markdownExcerpt', width: 240, height: 60, style,
  selection: { path: 'notes/memo.md', title: '메모', quote: '마크다운 인용', prefix: '', suffix: '', startOffset: 0, endOffset: 7, format: 'text' },
  source: { relation: 'markdown-excerpt', selection: { path: 'notes/memo.md', title: '메모', quote: '마크다운 인용', prefix: '', suffix: '', startOffset: 0, endOffset: 7, format: 'text' } },
} as unknown as CanvasBlockData

const nodes: PersistedCanvasNode[] = [
  node('e1', 300, 95, excerpt('docA', 2, 'Dynamic address <assignment>', '논문 A'), 'pdfExcerpt'),
  node('t1', 0, 0, text('title', '주소 할당 정리')),
  node('p1', 0, 100, text('paragraph', '첫 문단 & 요약')),
  node('m1', 0, 300, markdownExcerpt, 'markdownExcerpt'),
  node('s1', 600, 0, { kind: 'rectangle', width: 100, height: 100, style } as CanvasBlockData),
  node('e2', 0, 500, excerpt('docB', 0, 'Other paper', '논문 B'), 'pdfExcerpt'),
  node('e3', 300, 500, excerpt('docA', 2, 'Same page again', '논문 A', 200), 'pdfExcerpt'),
  node('e4', 0, 700, excerpt('docA', 5, 'Later page', '논문 A'), 'pdfExcerpt'),
]
const edges: PersistedCanvasEdge[] = [{ id: 'x', source: 't1', target: 'p1', endMarker: 'arrow' }]

describe('evidenceExport', () => {
  it('orders blocks in rows top to bottom, left to right, and skips shapes', () => {
    expect(readingOrder(nodes).map((item) => item.id)).toEqual(['t1', 'p1', 'e1', 'm1', 'e2', 'e3', 'e4'])
  })

  it('groups cited PDF pages per document in order of first citation', () => {
    const groups = collectEvidence(readingOrder(nodes))
    expect(groups.map((group) => group.docId)).toEqual(['docA', 'docB'])
    expect(groups[0]!.pages.map((page) => page.page)).toEqual([2, 5])
    expect(groups[0]!.pages[0]!.anchors).toHaveLength(2)
    expect(groups[0]!.title).toBe('논문 A')
  })

  it('draws a canvas map with text, crops, and arrowed edges', () => {
    const svg = canvasMapSvg(nodes, edges, { e1: 'data:image/png;base64,AAA' })
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('주소 할당 정리')
    expect(svg).toContain('data:image/png;base64,AAA')
    expect(svg).toContain('marker-end="url(#arrow)"')
  })

  it('cuts map labels to the block width, counting Hangul as wide', () => {
    const korean = '공간 배치는 인용문 목록을 눈으로 검토할 수 있는 논증 구조로 바꿉니다'
    const svg = canvasMapSvg([node('k', 0, 0, { ...text('paragraph', korean), width: 200 })], [], {})
    const label = /<text[^>]*>([^<]*)<\/text>/u.exec(svg)?.[1] ?? ''
    expect(label.endsWith('…')).toBe(true)
    expect(label.length).toBeLessThanOrEqual(13)
    const short = canvasMapSvg([node('s', 0, 0, text('paragraph', 'question → evidence'))], [], {})
    expect(short).toContain('>question → evidence</text>')
  })

  it('keeps a hostile document id out of the anchor attributes', () => {
    const hostile = 'x"><script>alert(1)</script>'
    const html = renderEvidenceHtml({
      title: '노트', exportedAt: '', edges: [], crops: {}, pages: {}, docs: {},
      nodes: [node('h', 0, 0, excerpt(hostile, 0, '인용', '논문'), 'pdfExcerpt')],
    })
    expect(html).not.toContain('<script')
    expect(html).toContain('href="#evidence-x___script_alert_1___script_-p1"')
  })

  it('renders an escaped, linked HTML document with an evidence section', () => {
    const html = renderEvidenceHtml({
      title: '노트 <제목>',
      exportedAt: '2026. 10. 2.',
      nodes,
      edges,
      crops: { e1: 'data:image/png;base64,CROP' },
      pages: { 'docA:2': 'data:image/jpeg;base64,PAGE', 'docB:0': null },
      docs: { docA: { title: '논문 A', authors: ['Ada Lovelace'], year: 1843, doi: '10.1/x' } },
    })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>노트 &lt;제목&gt;</title>')
    expect(html).toContain('Dynamic address &lt;assignment&gt;')
    expect(html).toContain('첫 문단 &amp; 요약')
    expect(html).toContain('href="#evidence-docA-p3"')
    expect(html).toContain('id="evidence-docA-p3"')
    expect(html).toContain('Ada Lovelace · 1843 · doi:10.1/x')
    expect(html).toContain('data:image/jpeg;base64,PAGE')
    expect(html).toContain('원본 쪽을 불러오지 못했습니다')
    expect(html).toContain('마크다운 인용')
    expect(html).not.toContain('<script')
  })
})
