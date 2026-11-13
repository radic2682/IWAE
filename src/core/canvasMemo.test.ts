import { describe, expect, it } from 'vitest'
import { createDefaultTextBlockStyle, parseCanvasBlock, type CanvasBlockData, type PdfExcerptCanvasBlock } from './canvasDocument'
import { canvasMemoSources, highlightQuote } from './canvasMemo'
import { highlightHandleId } from './excerptHighlights'

const anchor = {
  docId: 'doc-a',
  page: 2,
  coordSpace: 'pdfium-page' as const,
  rects: [{ x: 60, y: 100, w: 300, h: 120 }],
  charRange: [10, 30] as const,
  quote: 'whole excerpt quote',
  prefix: '',
  suffix: '',
}

function excerpt(highlights: PdfExcerptCanvasBlock['highlights']): PdfExcerptCanvasBlock {
  return {
    kind: 'pdfExcerpt',
    width: 400,
    height: 160,
    style: createDefaultTextBlockStyle(),
    excerpt: {
      id: 'e1',
      type: 'pdfExcerpt',
      x: 0,
      y: 0,
      width: 400,
      height: 160,
      text: '> whole excerpt quote',
      sourceTitle: 'HTTP Semantics',
      selection: {
        mode: 'text',
        anchor,
        pageSize: [600, 800],
        crop: { x: 50, y: 90, w: 400, h: 160 },
        glyphs: [
          { c: 'a', x: 60, y: 100, w: 10, h: 12 },
          { c: 'b', x: 70, y: 100, w: 10, h: 12 },
          { c: ' ', x: 80, y: 100, w: 10, h: 12 },
          { c: 'c', x: 90, y: 100, w: 10, h: 12 },
          { c: 'z', x: 300, y: 200, w: 10, h: 12 },
        ],
      },
      iwae: { kind: 'pdf-excerpt', anchor },
    },
    ...(highlights === undefined ? {} : { highlights }),
    source: { relation: 'excerpt', anchor },
  }
}

const memo = (text = 'note'): CanvasBlockData => ({ kind: 'paragraph', width: 340, height: 40, style: createDefaultTextBlockStyle(), text })
const node = (id: string, block: CanvasBlockData) => ({ id, data: { block } })

describe('canvasMemoSources', () => {
  const highlights = [
    { id: 'h1', color: 'yellow', rects: [{ x: 58, y: 98, w: 24, h: 16 }] },
    { id: 'h2', color: 'green', rects: [{ x: 298, y: 198, w: 14, h: 16 }] },
  ]
  const nodes = [node('e1', excerpt(highlights)), node('m1', memo())]

  it('형광펜에 이어진 글 블록을 메모로 보고 그 형광펜의 색·덮은 글자·쪽을 준다', () => {
    const edges = [{ source: 'e1', sourceHandle: highlightHandleId('h1'), target: 'm1', targetHandle: 'left' }]
    const sources = canvasMemoSources(nodes, edges).get('m1')
    expect(sources).toHaveLength(1)
    const [first] = sources!
    expect(first!.excerptId).toBe('e1')
    expect(first!.highlight.color).toBe('yellow')
    // 노트 카드와 같은 저장된 인용(글자 상자에서 다시 짜 맞추지 않는다)
    expect(first!.highlight.anchor.quote).toBe('whole excerpt quote')
    expect(first!.highlight.anchor.page).toBe(2)
    expect(first!.title).toBe('HTTP Semantics')
    expect(first!.jump.docId).toBe('doc-a')
  })

  it('선을 어느 쪽에서 그었든 같고, 원문을 더하면 이은 차례대로 늘어난다(같은 형광펜은 한 번만)', () => {
    const edges = [
      { source: 'm1', sourceHandle: 'left', target: 'e1', targetHandle: highlightHandleId('h2', 'left') },
      { source: 'e1', sourceHandle: highlightHandleId('h1'), target: 'm1', targetHandle: 'left' },
      { source: 'e1', sourceHandle: highlightHandleId('h1', 'left'), target: 'm1', targetHandle: 'top' },
    ]
    const sources = canvasMemoSources(nodes, edges).get('m1')
    expect(sources?.map((source) => source.highlightId)).toEqual(['h2', 'h1'])
  })

  it('이은 형광펜이 없거나, 지워진 형광펜이거나, 글 블록이 아니면 메모가 아니다', () => {
    expect(canvasMemoSources(nodes, []).size).toBe(0)
    expect(canvasMemoSources(nodes, [{ source: 'e1', sourceHandle: highlightHandleId('gone'), target: 'm1' }]).size).toBe(0)
    expect(canvasMemoSources([...nodes, node('t1', { ...memo(), kind: 'title' } as CanvasBlockData)], [{ source: 'e1', sourceHandle: highlightHandleId('h1'), target: 't1' }]).size).toBe(0)
  })
})

describe('highlightQuote', () => {
  it('발췌에 저장된 인용을 그대로 쓴다: 글자 상자에서 짜 맞추면 글자가 빠진다', () => {
    const block = excerpt(undefined)
    expect(highlightQuote(block, { id: 'x', color: 'yellow', rects: [{ x: 58, y: 98, w: 24, h: 16 }] })).toBe('whole excerpt quote')
  })

  it('저장된 인용이 없을 때만 글자 상자를 잇고, 글자는 버리지 않고 띄어쓰기만 넣는다', () => {
    const block = excerpt(undefined)
    const bare = { ...block, excerpt: { ...block.excerpt, selection: { ...block.excerpt.selection, anchor: { ...anchor, quote: '' } } } }
    expect(highlightQuote(bare, { id: 'x', color: 'yellow', rects: [{ x: 58, y: 98, w: 50, h: 16 }] })).toBe('ab c')
  })
})

describe('캔버스 메모의 저장 모양(예전 파일과 호환)', () => {
  const base = { kind: 'paragraph', width: 340, height: 40, style: createDefaultTextBlockStyle(), text: '메모' }

  it('noteHtml · ticket 이 없는 예전 글 블록도 그대로 읽힌다', () => {
    const parsed = parseCanvasBlock(base)
    expect(parsed).not.toHaveProperty('noteHtml')
    expect(parsed).not.toHaveProperty('ticket')
  })

  it('서식 글과 ID·제목은 다듬어 남기고, 모양이 틀린 값은 버린다', () => {
    const parsed = parseCanvasBlock({ ...base, noteHtml: '<p><b>메모</b></p>', ticket: { id: ' REQ-01 ', title: '  제목   하나 ' } })
    expect(parsed).toMatchObject({ noteHtml: '<p><b>메모</b></p>', ticket: { id: 'REQ-01', title: '제목 하나' } })
    const junk = parseCanvasBlock({ ...base, noteHtml: 7, ticket: { id: 3, title: false } })
    expect(junk).not.toHaveProperty('noteHtml')
    expect(junk).not.toHaveProperty('ticket')
    expect(parseCanvasBlock({ ...base, ticket: { id: '', title: '' } })).not.toHaveProperty('ticket')
  })
})
