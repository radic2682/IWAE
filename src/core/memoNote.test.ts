import { describe, expect, it } from 'vitest'
import {
  insertBlock,
  moveMemoNote,
  orderMemoNoteEntries,
  memoBlock,
  memoNotePath,
  memoNoteTitleOf,
  memoParentOf,
  movedMemoPaths,
  moveBlock,
  moveBlockBefore,
  notesFromCategories,
  parseMemoNote,
  removeHighlightBlocks,
  sectionBlock,
  sectionRange,
  updateSection,
  serializeMemoNote,
  textBlock,
  uniqueNoteTitle,
  updateTextBlock,
} from './memoNote'

const anchor = (docId: string, page: number, y: number) => ({ docId, page, rects: [{ y }] })

describe('memoNote', () => {
  it('블록을 끼우고 옮기고 빼며, 같은 형광펜은 한 번만', () => {
    const a = memoBlock('h-a')
    const b = memoBlock('h-b')
    const t = textBlock('머리말')
    let note = insertBlock({ version: 1, blocks: [] }, a, 0)
    note = insertBlock(note, b, 1)
    note = insertBlock(note, t, 1)
    expect(note.blocks.map((block) => block.id)).toEqual([a.id, t.id, b.id])
    expect(insertBlock(note, memoBlock('h-a'), 0)).toBe(note)
    note = moveBlock(note, a.id, 3)
    expect(note.blocks.map((block) => block.id)).toEqual([t.id, b.id, a.id])
    expect(moveBlockBefore(note, a.id, t.id).blocks.map((block) => block.id)).toEqual([a.id, t.id, b.id])
    expect(moveBlockBefore(note, t.id, null).blocks.map((block) => block.id)).toEqual([b.id, a.id, t.id])
    note = updateTextBlock(note, t.id, '고친 글', '<b>고친 글</b>')
    expect(note.blocks[0]).toMatchObject({ kind: 'text', text: '고친 글', html: '<b>고친 글</b>' })
    note = removeHighlightBlocks(note, 'h-b')
    expect(note.blocks.map((block) => block.id)).toEqual([t.id, a.id])
  })

  it('소제목은 다음 소제목 앞까지 묶고, 옮기면 묶음째, 자기 묶음 안으로는 못 옮긴다', () => {
    const s1 = sectionBlock('타이밍')
    const m1 = memoBlock('h1')
    const m2 = memoBlock('h2')
    const s2 = sectionBlock('핀')
    const m3 = memoBlock('h3')
    const note = { version: 1 as const, blocks: [s1, m1, m2, s2, m3] }
    expect(sectionRange(note, s1.id)).toEqual([0, 3])
    expect(sectionRange(note, s2.id)).toEqual([3, 5])
    expect(moveBlockBefore(note, s1.id, null).blocks.map((block) => block.id)).toEqual([s2.id, m3.id, s1.id, m1.id, m2.id])
    expect(moveBlockBefore(note, s1.id, m2.id)).toBe(note)
    const renamed = updateSection(note, s1.id, { title: '타이밍 요구', collapsed: true })
    expect(renamed.blocks[0]).toEqual({ id: s1.id, kind: 'section', title: '타이밍 요구', collapsed: true })
    expect(parseMemoNote(JSON.parse(serializeMemoNote(renamed)))).toEqual(renamed)
  })

  it('저장했다가 그대로 읽고, 모르는 블록은 버린다', () => {
    const note = { version: 1 as const, blocks: [memoBlock('h'), textBlock('글', '<i>글</i>')] }
    expect(parseMemoNote(JSON.parse(serializeMemoNote(note)))).toEqual(note)
    expect(parseMemoNote({ blocks: [{ id: 'x', kind: 'image' }, 3] }).blocks).toEqual([])
  })

  it('제목·경로: 쓸 수 없는 글자를 바꾸고, 겹치면 번호를 붙인다', () => {
    expect(memoNotePath('A/B: 노트')).toBe('노트/A B 노트.iwnote')
    expect(memoNoteTitleOf('노트/TODO.iwnote')).toBe('TODO')
    expect(uniqueNoteTitle('TODO', ['todo', 'TODO 2'])).toBe('TODO 3')
  })

  it('하위 폴더: 폴더 안 경로, 든 폴더, 폴더를 옮길 때 바뀌는 경로', () => {
    expect(memoNotePath('회의록', '노트/회의')).toBe('노트/회의/회의록.iwnote')
    expect(memoNoteTitleOf('노트/회의/회의록.iwnote')).toBe('회의록')
    expect(memoParentOf('노트/회의/회의록.iwnote')).toBe('노트/회의')
    const moved = movedMemoPaths('노트/회의', '노트/자료/회의', ['노트/회의', '노트/회의/A.iwnote', '노트/회의/2026', '노트/회의록/B.iwnote', '노트/C.iwnote'])
    expect([...moved]).toEqual([
      ['노트/회의', '노트/자료/회의'],
      ['노트/회의/A.iwnote', '노트/자료/회의/A.iwnote'],
      ['노트/회의/2026', '노트/자료/회의/2026'],
    ])
  })

  it('카테고리마다 노트 하나, 카테고리 없는 메모는 PDF 이름 노트로 옮긴다', () => {
    const highlights = [
      { id: 'b-31', note: '주기', topic: 'TODO', anchor: anchor('rfc', 31, 100) },
      { id: 'm-5', note: 'Book', topic: 'TODO', anchor: anchor('book', 5, 10) },
      { id: 'b-15', note: '핀', topic: 'TODO', anchor: anchor('rfc', 15, 50) },
      { id: 'x', note: '분류 없음', anchor: anchor('rfc', 2, 10) },
      { id: 'empty', note: '  ', topic: 'TODO', anchor: anchor('rfc', 1, 10) },
    ]
    const notes = notesFromCategories(highlights, (docId) => (docId === 'rfc' ? 'RFC 8259' : 'Book Notes'))
    expect(notes.map(({ title }) => title)).toEqual(['TODO', 'RFC 8259'])
    const todo = notes[0]!.note.blocks.map((block) => (block.kind === 'memo' ? block.highlightId : ''))
    expect(todo).toEqual(['b-15', 'b-31', 'm-5'])
  })

  it('사람이 정한 차례대로 노트를 놓고, 차례에 없는 새 노트는 뒤에 붙인다', () => {
    const entries = [{ path: 'a', title: 'A' }, { path: 'b', title: 'B' }, { path: 'c', title: 'C' }]
    expect(orderMemoNoteEntries(entries, ['c', 'gone', 'a']).map((entry) => entry.path)).toEqual(['c', 'a', 'b'])
    expect(orderMemoNoteEntries(entries, []).map((entry) => entry.path)).toEqual(['a', 'b', 'c'])
  })

  it('노트를 다른 자리(그 앞)로 옮긴다', () => {
    expect(moveMemoNote(['a', 'b', 'c'], 0, 3)).toEqual(['b', 'c', 'a'])
    expect(moveMemoNote(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveMemoNote(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
  })
})


describe('티켓 블록', () => {
  it('memo 블록에 제목을 붙여 티켓으로 바꾸고, 되돌리고, 파일에서 다시 읽는다', async () => {
    const { memoBlock, setMemoTicket, parseMemoNote, serializeMemoNote } = await import('./memoNote')
    const block = memoBlock('h1')
    const note = { version: 1 as const, blocks: [block] }
    const ticket = setMemoTicket(note, block.id, { title: 'REQ-1' })
    expect(ticket.blocks[0]).toEqual({ id: block.id, kind: 'memo', highlightId: 'h1', ticket: { id: 'REQ-1' } })
    expect(parseMemoNote(JSON.parse(serializeMemoNote(ticket))).blocks[0]).toEqual(ticket.blocks[0])
    expect(setMemoTicket(ticket, block.id, null).blocks[0]).toEqual({ id: block.id, kind: 'memo', highlightId: 'h1' })
  })
})

describe('메모 블록의 여러 원문', () => {
  it('원문을 더하고 떼며, 첫 원문이 지워지면 다음 원문이 잇는다', async () => {
    const { addMemoRef, memoBlock, memoHighlightIds, removeHighlightBlocks, removeMemoRef, setMemoTicket, parseMemoNote, serializeMemoNote } = await import('./memoNote')
    const block = memoBlock('h1')
    let note: import('./memoNote').MemoNote = { version: 1, blocks: [block] }
    note = addMemoRef(note, block.id, 'h2')
    note = addMemoRef(note, block.id, 'h2')
    expect(memoHighlightIds(note.blocks[0]!)).toEqual(['h1', 'h2'])
    // 티켓으로 바꿔도 원문은 남는다
    note = setMemoTicket(note, block.id, { title: 'T' })
    expect(parseMemoNote(JSON.parse(serializeMemoNote(note))).blocks[0]).toEqual(note.blocks[0])
    expect(memoHighlightIds(removeMemoRef(note, block.id, 'h2').blocks[0]!)).toEqual(['h1'])
    const promoted = removeHighlightBlocks(note, 'h1').blocks[0]!
    expect(memoHighlightIds(promoted)).toEqual(['h2'])
    expect(removeHighlightBlocks(removeHighlightBlocks(note, 'h1'), 'h2').blocks).toHaveLength(0)
  })
})

describe('memoNote — 자유 ID', () => {
  it('예전 「REQ-01 제목」 한 줄을 ID 와 제목으로 나누고, 둘 다 비면 그냥 메모다', async () => {
    const { normalizeTicket, splitLeadingTicketId, suggestTicketIds, ticketLabel } = await import('./memoNote')
    expect(normalizeTicket({ title: 'REQ-01 노트는 남는다' })).toEqual({ id: 'REQ-01', title: '노트는 남는다' })
    expect(normalizeTicket({ title: 'Vault 폴더' })).toEqual({ title: 'Vault 폴더' })
    expect(normalizeTicket({ id: ' ', title: '' })).toBeNull()
    expect(normalizeTicket({ id: 'TODO' })).toEqual({ id: 'TODO' })
    expect(ticketLabel({ id: 'Q-1', title: '왜?' })).toBe('Q-1 왜?')
    expect(splitLeadingTicketId('REQ-04 할 일')).toEqual({ id: 'REQ-04', rest: '할 일' })
    expect(splitLeadingTicketId('Vault 는 폴더')).toBeNull()
    expect(suggestTicketIds(['REQ-01', 'REQ-03', 'BUG-2', 'REQ-02'])).toEqual(['REQ-04', 'BUG-3'])
  })
})
