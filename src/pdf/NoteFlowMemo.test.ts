import { describe, expect, it } from 'vitest'
import type { PersistentPdfHighlight } from './persistentHighlight'
import { sameItem, sameItems, type NoteFlowItem } from './NoteFlow'

const highlight = (id: string): PersistentPdfHighlight => ({
  id,
  anchor: { docId: 'doc', page: 0, coordSpace: 'pdfium-page', rects: [{ x: 0, y: 0, w: 10, h: 10 }], charRange: [0, 4], quote: 'text', prefix: '', suffix: '' },
  color: 'yellow',
  createdAt: '2026-01-01T00:00:00.000Z',
  source: 'iwae',
}) as PersistentPdfHighlight

describe('sameItem · sameItems (노트 카드를 다시 그릴지 가르는 견줌)', () => {
  const a = highlight('a')

  it('새로 만든 객체라도 내용이 같으면 같은 카드다', () => {
    const one: NoteFlowItem = { kind: 'memo', key: 'k', highlight: a, sourceLabel: 'PDF', ticket: { id: 'REQ-1', title: '제목' }, extraHighlights: [highlight('b')] }
    const extra = one.kind === 'memo' ? one.extraHighlights : undefined
    const two: NoteFlowItem = { kind: 'memo', key: 'k', highlight: a, sourceLabel: 'PDF', ticket: { id: 'REQ-1', title: '제목' }, ...(extra === undefined ? {} : { extraHighlights: [...extra] }) }
    expect(sameItem(one, two)).toBe(true)
  })

  it('형광펜(메모 글)·ID·제목·원문·출처 이름이 바뀌면 다른 카드다', () => {
    const base: NoteFlowItem = { kind: 'memo', key: 'k', highlight: a, sourceLabel: 'PDF', ticket: { id: 'REQ-1' } }
    expect(sameItem(base, { ...base, highlight: { ...a, note: '고침' } } as NoteFlowItem)).toBe(false)
    expect(sameItem(base, { ...base, ticket: { id: 'REQ-2' } } as NoteFlowItem)).toBe(false)
    expect(sameItem(base, { ...base, ticket: undefined } as NoteFlowItem)).toBe(false)
    expect(sameItem(base, { ...base, sourceLabel: '다른 PDF' } as NoteFlowItem)).toBe(false)
    expect(sameItem(base, { ...base, extraHighlights: [highlight('b')] } as NoteFlowItem)).toBe(false)
    expect(sameItem(base, { ...base, draft: true } as NoteFlowItem)).toBe(false)
    expect(sameItem(base, { ...base, key: 'other' } as NoteFlowItem)).toBe(false)
  })

  it('글 블록과 소제목은 글·접힘·묶인 수로 견준다', () => {
    expect(sameItem({ kind: 'text', key: 't', text: '글' }, { kind: 'text', key: 't', text: '글' })).toBe(true)
    expect(sameItem({ kind: 'text', key: 't', text: '글' }, { kind: 'text', key: 't', text: '글', html: '<b>글</b>' })).toBe(false)
    const section: NoteFlowItem = { kind: 'section', key: 's', title: '구역', collapsed: false, count: 3 }
    expect(sameItem(section, { ...section })).toBe(true)
    expect(sameItem(section, { ...section, collapsed: true })).toBe(false)
    expect(sameItem(section, { ...section, count: 4 })).toBe(false)
    expect(sameItem(section, { kind: 'text', key: 's', text: '구역' })).toBe(false)
  })

  it('목록은 길이와 차례까지 같아야 같다', () => {
    const x: NoteFlowItem = { kind: 'text', key: 'x', text: '1' }
    const y: NoteFlowItem = { kind: 'text', key: 'y', text: '2' }
    expect(sameItems([x, y], [{ ...x }, { ...y }])).toBe(true)
    expect(sameItems([x, y], [y, x])).toBe(false)
    expect(sameItems([x], [x, y])).toBe(false)
  })
})
