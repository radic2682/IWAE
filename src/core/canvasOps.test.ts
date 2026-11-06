import { describe, expect, it } from 'vitest'
import { parseCanvasDocument, type CanvasDocumentV2 } from './canvasDocument'
import {
  addCanvasBlocks,
  arrangeCanvasBlocks,
  connectCanvasBlocks,
  deleteCanvasBlocks,
  findTextRegion,
  resolveCanvasTarget,
  summarizeCanvas,
  tidyCanvasOverlaps,
  updateCanvasBlocks,
} from './canvasOps'
import { createInitialCanvasDocument } from './initialCanvasDocument'
import { createRegionExcerptSelection } from './pdfExcerpt'
import type { PageTextIndex } from './textIndex'

/** "Table 6-3\nTretry 1 ms" 를 한 줄씩 놓은 가짜 쪽 */
function fakeIndex(): PageTextIndex {
  const lines = ['Table 6-3. Timing', 'Tretry  1 ms', 'Tdelay 8 ms']
  const chars: { c: string; x: number; y: number; w: number; h: number }[] = []
  let text = ''
  lines.forEach((line, row) => {
    for (const [column, c] of [...line].entries()) {
      chars.push({ c, x: 72 + column * 6, y: 100 + row * 14, w: c === ' ' ? 0 : 6, h: 10 })
      text += c
    }
    if (row < lines.length - 1) {
      chars.push({ c: '\n', x: 0, y: 0, w: 0, h: 0 })
      text += '\n'
    }
  })
  return { text, chars }
}

describe('canvasOps', () => {
  it('글 블록을 기존 내용 아래로 차례로 쌓고, 앱이 읽을 수 있는 문서를 만든다', () => {
    const start = createInitialCanvasDocument('TODO')
    const { document, created } = addCanvasBlocks(start, [
      { type: 'heading', text: '용어 정의', ref: 'h' },
      { type: 'text', text: '첫 줄\n둘째 줄', list: 'bullet', background: '#fff4d6' },
    ])
    expect(created).toHaveLength(2)
    expect(created[0]!.x).toBe(80)
    expect(created[0]!.y).toBeGreaterThan(80 + 100)
    expect(created[1]!.y).toBeGreaterThan(created[0]!.y + created[0]!.height - 1)
    expect(() => parseCanvasDocument(JSON.parse(JSON.stringify(document)))).not.toThrow()
    const second = document.nodes.find((node) => node.id === created[1]!.id)!.data.block
    // 여러 줄 목록은 줄마다 글머리표를 글로 붙인다
    expect(second.style.list).toBe('none')
    expect((second as { text: string }).text).toBe('• 첫 줄\n• 둘째 줄')
    expect(second.style.background).toBe('#fff4d6')
  })

  it('from_text … to_text 로 표 영역을 잡아 원문 연결이 있는 PDF 발췌를 만든다', () => {
    const index = fakeIndex()
    const rect = findTextRegion(index, 'table  6-3', 'tdelay 8 ms', { pageSize: [612, 792], padding: 4 })
    expect(rect.x).toBe(68)
    expect(rect.y).toBe(96)
    expect(rect.y + rect.h).toBe(100 + 2 * 14 + 10 + 4)
    const selection = createRegionExcerptSelection({ docId: 'doc1', page: 30, rect, index, pageSize: [612, 792] })
    const { document, created } = addCanvasBlocks(createInitialCanvasDocument('x'), [
      { type: 'pdf_excerpt', doc_id: 'doc1', page: 31, excerpt: { selection, sourceTitle: 'RFC 8259' } },
    ])
    const block = document.nodes.find((node) => node.id === created[0]!.id)!.data.block
    expect(block.kind).toBe('pdfExcerpt')
    const summary = summarizeCanvas(document).blocks.find((item) => item.id === created[0]!.id)!
    expect(summary.source).toMatchObject({ docId: 'doc1', page: 31, title: 'RFC 8259' })
    expect(() => findTextRegion(index, 'nowhere', undefined, { pageSize: [612, 792] })).toThrow(/찾지 못했습니다/u)
  })

  it('블록을 옮기면 그 위에 그린 네모도 같이 옮기고, 정렬·연결·삭제를 한다', () => {
    const base = addCanvasBlocks(createInitialCanvasDocument('x'), [
      { type: 'text', text: 'A', ref: 'a', x: 100, y: 400, width: 300 },
      { type: 'text', text: 'B', ref: 'b', x: 500, y: 400, width: 300 },
      { type: 'rectangle', x: 120, y: 410, width: 50, height: 20 },
    ], [{ from: 'a', to: 'b' }])
    const [a, b, box] = base.created
    expect(base.edges).toHaveLength(1)

    const moved = updateCanvasBlocks(base.document, [{ id: a!.id, x: 100, y: 600 }]).document
    const boxNode = moved.nodes.find((node) => node.id === box!.id)!
    expect(boxNode.position).toEqual({ x: 120, y: 610 })

    const arranged = arrangeCanvasBlocks(moved, { ids: [b!.id, a!.id], layout: 'column', x: 0, y: 0, gap: 20 })
    expect(arranged.arranged[0]).toEqual({ id: b!.id, x: 0, y: 0 })
    expect(arranged.arranged[1]!.y).toBeGreaterThan(0)

    const connected = connectCanvasBlocks(arranged.document, [{ from: b!.id, to: a!.id, arrow: false }])
    expect(connected.document.edges.at(-1)).toMatchObject({ source: b!.id, target: a!.id, endMarker: 'none' })

    const removed = deleteCanvasBlocks(connected.document, [a!.id]).document
    expect(removed.nodes.some((node) => node.id === a!.id)).toBe(false)
    expect(removed.edges.some((edge) => edge.source === a!.id || edge.target === a!.id)).toBe(false)
    expect(() => deleteCanvasBlocks(removed, ['nope'])).toThrow(/없는 블록/u)
  })

  it('canvas 인자는 경로나 유일한 제목으로 찾는다', () => {
    const list = [
      { path: 'TODO LIST/d.canvas', title: 'TODO' },
      { path: 'a/x.canvas', title: '같음' },
      { path: 'b/x.canvas', title: '같음' },
    ]
    expect(resolveCanvasTarget(list, 'TODO LIST\\d.canvas').title).toBe('TODO')
    expect(resolveCanvasTarget(list, 'todo').path).toBe('TODO LIST/d.canvas')
    expect(() => resolveCanvasTarget(list, '같음')).toThrow(/여럿/u)
    expect(() => resolveCanvasTarget(list, '없음')).toThrow(/찾지 못했습니다/u)
  })

  it('글을 바꾸고 글 없는 블록에는 거절한다', () => {
    const start: CanvasDocumentV2 = createInitialCanvasDocument('제목')
    const next = updateCanvasBlocks(start, [{ id: 'note-title', text: '새 제목', color: '#123456' }]).document
    expect(summarizeCanvas(next).blocks[0]).toMatchObject({ text: '새 제목' })
    const shaped = addCanvasBlocks(next, [{ type: 'rectangle', x: 0, y: 0 }])
    expect(() => updateCanvasBlocks(shaped.document, [{ id: shaped.created[0]!.id, text: 'x' }])).toThrow(/글이 없는/u)
  })

  it('겹친 블록을 단(가로 위치)을 지킨 채 아래로 밀어 푼다', () => {
    const base = addCanvasBlocks(createInitialCanvasDocument('x'), [
      { type: 'text', text: 'A', x: 960, y: 200, width: 420, height: 120 },
      { type: 'text', text: 'B', x: 960, y: 260, width: 420, height: 60 },
      { type: 'rectangle', x: 970, y: 270, width: 40, height: 20 },
      { type: 'text', text: 'C', x: 40, y: 260, width: 420, height: 60 },
    ])
    const [a, b, box, c] = base.created
    const { document, moved } = tidyCanvasOverlaps(base.document, { gap: 20 })
    const at = (id: string) => document.nodes.find((node) => node.id === id)!.position
    expect(at(a!.id)).toEqual({ x: 960, y: 200 })
    expect(at(b!.id)).toEqual({ x: 960, y: 340 })
    expect(at(box!.id)).toEqual({ x: 970, y: 350 })
    expect(at(c!.id)).toEqual({ x: 40, y: 260 })
    expect(moved.map(({ id }) => id)).toEqual([b!.id])
    expect(arrangeCanvasBlocks(document, { layout: 'stack' }).arranged).toEqual([])
  })
})
