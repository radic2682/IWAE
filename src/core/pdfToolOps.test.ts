import { describe, expect, it } from 'vitest'
import { buildFlattenOp, chapterRanges, countMarks, parsePageRanges, safeFileStem } from './pdfToolOps'
import type { PersistentPdfHighlight } from '../pdf/persistentHighlight'
import type { PdfOverlay } from './pdfOverlays'

const anchor = (page: number, docId = 'doc') => ({ docId, page, rects: [{ x: 10, y: 20, w: 30, h: 12 }], quote: 'q', charStart: 0, charEnd: 1 })
const highlights = [
  { id: 'h1', anchor: anchor(0), color: 'green', note: ' memo ' },
  { id: 'h2', anchor: anchor(1), color: 'yellow', kind: 'region', note: 'figure note' },
  { id: 'h3', anchor: anchor(2), color: 'pink', box: { x: 100, y: 120, w: 80 }, note: 'box memo' },
  { id: 'other', anchor: anchor(0, 'other'), color: 'blue' },
] as unknown as PersistentPdfHighlight[]
const overlays: PdfOverlay[] = [
  { id: 'o1', kind: 'text', page: 0, x: 1, y: 2, w: 100, text: 'hello', size: 10, color: '#111111' },
  { id: 'o2', kind: 'text', page: 0, x: 1, y: 2, w: 100, text: '   ', size: 10, color: '#111111' },
  { id: 'o3', kind: 'shape', shape: 'redact', page: 1, x: 5, y: 6, w: 7, h: 8, color: '#000000', width: 1 },
  { id: 'o4', kind: 'line', page: 1, x1: 0, y1: 0, x2: 9, y2: 9, color: '#d9363e', width: 2, arrow: true },
]

describe('buildFlattenOp', () => {
  it('글자 형광펜은 주석, 영역·박스 메모는 쪽지, 덮개는 그림, 가리기는 가릴 곳으로 나눈다', () => {
    const op = buildFlattenOp('doc', highlights, overlays, { highlights: true, overlays: true, notes: true, redactions: true })
    expect(op.highlights).toEqual([{ page: 0, rects: [{ x: 10, y: 20, w: 30, h: 12 }], color: [110, 200, 120], note: 'memo' }])
    expect(op.notes).toEqual([
      { page: 1, rect: { x: 10, y: 20, w: 30, h: 12 }, text: 'figure note' },
      { page: 2, rect: { x: 100, y: 120, w: 80, h: 40 }, text: 'box memo' },
    ])
    expect(op.overlays.map((overlay) => overlay.kind)).toEqual(['text', 'line'])
    expect(op.redactions).toEqual([{ page: 1, rect: { x: 5, y: 6, w: 7, h: 8 } }])
  })

  it('고르지 않은 것은 넣지 않는다', () => {
    const op = buildFlattenOp('doc', highlights, overlays, { highlights: false, overlays: false, notes: false, redactions: true })
    expect([op.highlights.length, op.notes.length, op.overlays.length, op.redactions.length]).toEqual([0, 0, 0, 1])
  })

  it('종류별로 센다', () => {
    expect(countMarks('doc', highlights, overlays)).toEqual({ highlights: 1, notes: 2, overlays: 3, redactions: 1 })
  })
})

describe('parsePageRanges', () => {
  it('범위·낱쪽·끝까지를 읽고 겹치면 한 번만', () => {
    expect(parsePageRanges('1-3, 5, 2, 9-', 10)).toEqual([0, 1, 2, 4, 8, 9])
    expect(parsePageRanges('4-2', 10)).toEqual([3, 2, 1])
  })

  it('못 읽거나 쪽을 넘으면 null', () => {
    expect(parsePageRanges('', 10)).toBeNull()
    expect(parsePageRanges('a-b', 10)).toBeNull()
    expect(parsePageRanges('11', 10)).toBeNull()
  })
})

describe('chapterRanges', () => {
  it('맨 위 단계 목차로 나누고 첫 장 앞은 앞부분', () => {
    const outline = [
      { title: '1 Intro', page: 2, depth: 0 },
      { title: '1.1 Scope', page: 3, depth: 1 },
      { title: '2 Design', page: 5, depth: 0 },
    ]
    expect(chapterRanges(outline, 9)).toEqual([
      { title: '앞부분', from: 0, to: 1 },
      { title: '1 Intro', from: 2, to: 4 },
      { title: '2 Design', from: 5, to: 8 },
    ])
    expect(chapterRanges([], 9)).toEqual([])
  })
})

describe('safeFileStem', () => {
  it('파일 이름에 못 쓰는 글자를 뺀다', () => {
    expect(safeFileStem('a/b:c*?"<>|d')).toBe('abcd')
    expect(safeFileStem('   ')).toBe('PDF')
  })
})
