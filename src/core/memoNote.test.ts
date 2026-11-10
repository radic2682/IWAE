import { describe, expect, it } from 'vitest'
import { setLocale } from '../i18n'
import {
  detectMemoNotesFolder,
  forgetMemoNotesFolder,
  memoNotesFolder,
  pickMemoNotesFolder,
  rememberMemoNotesFolder,
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

describe('노트 폴더 이름', () => {
  const exists = (...present: string[]) => async (name: string) => present.includes(name)

  it('「노트」가 있으면 그것, 없고 「Notes」가 있으면 그것, 둘 다 없으면 화면 언어를 따른다', async () => {
    expect(await detectMemoNotesFolder(exists('노트', 'Notes'))).toBe('노트')
    expect(await detectMemoNotesFolder(exists('Notes'))).toBe('Notes')
    setLocale('ko')
    expect(await detectMemoNotesFolder(exists())).toBe('노트')
    setLocale('en')
    expect(await detectMemoNotesFolder(exists())).toBe('Notes')
    // 영어 화면이어도 옛 한국어 Vault 는 그대로
    expect(await detectMemoNotesFolder(exists('노트'))).toBe('노트')
    expect(memoNotePath('Plan')).toBe('노트/Plan.iwnote')
    forgetMemoNotesFolder()
  })

  it('폴더가 없는 동안 화면 언어가 바뀌면 이름도 따라가고, 노트를 만든 뒤에는 고정된다', async () => {
    await detectMemoNotesFolder(exists())
    setLocale('en')
    expect(memoNotePath('Plan')).toBe('Notes/Plan.iwnote')
    rememberMemoNotesFolder('Notes')
    setLocale('ko')
    expect(memoNotesFolder()).toBe('Notes')
    forgetMemoNotesFolder()
    expect(memoNotesFolder()).toBe('노트')
  })

  it('맨 위 폴더 이름에서 고른다', () => {
    expect(pickMemoNotesFolder(['Notes', 'PDF'])).toBe('Notes')
    expect(pickMemoNotesFolder(['Notes', '노트'])).toBe('노트')
    expect(pickMemoNotesFolder(['PDF'])).toBeNull()
  })
})

describe('빈 글 블록은 파일에 남기지 않는다', () => {
  it('저장할 때 빼고, 읽을 때도 버린다. 글·서식이 있는 블록과 다른 블록은 그대로', () => {
    const empty = textBlock()
    const spacer = textBlock('', '<p><br></p>')
    const divider = textBlock('', '<hr>')
    const text = textBlock('본문')
    const note = { version: 1 as const, blocks: [text, empty, spacer, divider, memoBlock('h1')] }
    const saved = JSON.parse(serializeMemoNote(note)) as { blocks: { id: string }[] }
    expect(saved.blocks.map((block) => block.id)).toEqual([text.id, divider.id, note.blocks[4]!.id])
    // 예전에 빈 채로 저장된 파일
    const legacy = parseMemoNote({ version: 1, blocks: [{ id: 'a', kind: 'text', text: '' }, { id: 'b', kind: 'text', text: ' ', html: '<p></p>' }, { id: 'c', kind: 'text', text: '글' }] })
    expect(legacy.blocks.map((block) => block.id)).toEqual(['c'])
  })
})

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

describe('memoNote — PDF 별 노트', () => {
  it('docId 는 파일에 저장되고 다시 읽히며, docId 없는 예전 파일도 그대로 읽힌다', async () => {
    const { docNoteTitle, EMPTY_MEMO_NOTE } = await import('./memoNote')
    const owned = { ...EMPTY_MEMO_NOTE, docId: 'abc123', blocks: [textBlock('hi')] }
    const text = serializeMemoNote(owned)
    expect(JSON.parse(text)).toMatchObject({ version: 1, docId: 'abc123' })
    expect(parseMemoNote(JSON.parse(text))).toEqual(owned)
    const legacy = { version: 1, blocks: [{ id: 'x', kind: 'text', text: 'old' }] }
    expect(parseMemoNote(legacy).docId).toBeUndefined()
    expect('docId' in parseMemoNote(legacy)).toBe(false)
    expect(JSON.parse(serializeMemoNote(parseMemoNote(legacy)))).not.toHaveProperty('docId')
    // 이상한 값은 버린다
    expect(parseMemoNote({ blocks: [], docId: 3 }).docId).toBeUndefined()
    expect(parseMemoNote({ blocks: [], docId: '  ' }).docId).toBeUndefined()
    // 블록을 고쳐도 docId 는 남는다
    const edited = updateTextBlock(owned, owned.blocks[0]!.id, 'new', '')
    expect(edited.docId).toBe('abc123')
    expect(moveBlock(edited, edited.blocks[0]!.id, 0).docId).toBe('abc123')
    // 기본 제목: 「<문서 이름> 노트」, 겹치면 번호
    expect(docNoteTitle('Sleep', [])).toBe('Sleep 노트')
    expect(docNoteTitle('Sleep', ['Sleep 노트'])).toBe('Sleep 노트 2')
    expect(docNoteTitle('Sleep', ['sleep 노트', 'Sleep 노트 2'])).toBe('Sleep 노트 3')
  })

  it('노트를 PDF 별로 나눈다: 있는 PDF 의 노트는 그 PDF 아래, 일반 노트와 사라진 PDF 의 노트는 아래 구역', async () => {
    const { groupMemoNotesByDoc, memoNoteOwner } = await import('./memoNote')
    const entries = [
      { path: '노트/일반.iwnote', title: '일반' },
      { path: '노트/A1.iwnote', title: 'A1', docId: 'docA' },
      { path: '노트/A2.iwnote', title: 'A2', docId: 'docA' },
      { path: '노트/B1.iwnote', title: 'B1', docId: 'docB-v2' },
      { path: '노트/고아.iwnote', title: '고아', docId: 'deleted' },
    ]
    const known = new Set(['docA', 'docB'])
    const groups = [{ anchorDocId: 'docB', versions: [{ docId: 'docB' }, { docId: 'docB-v2' }] }]
    const owner = (docId: string) => memoNoteOwner(docId, known, groups)
    const { byDoc, general } = groupMemoNotesByDoc(entries, owner)
    expect([...byDoc.keys()]).toEqual(['docA', 'docB'])
    expect(byDoc.get('docA')!.map((entry) => entry.title)).toEqual(['A1', 'A2'])
    // 버전 묶음의 다른 버전에 속한 노트는 묶음 줄(대표 문서) 아래
    expect(byDoc.get('docB')!.map((entry) => entry.title)).toEqual(['B1'])
    expect(general.map((entry) => entry.title)).toEqual(['일반', '고아'])
    // 소유자 함수가 없으면 모두 일반 노트
    expect(groupMemoNotesByDoc(entries, undefined).general).toHaveLength(5)
  })

  it('memoNoteOwner: 대표 문서가 사라졌거나 PDF 가 아니면 null', async () => {
    const { memoNoteOwner } = await import('./memoNote')
    const groups = [{ anchorDocId: 'gone', versions: [{ docId: 'gone' }, { docId: 'v2' }] }]
    expect(memoNoteOwner('v2', new Set(['v2']), groups)).toBeNull()
    expect(memoNoteOwner('x', new Set(['x']), [])).toBe('x')
    expect(memoNoteOwner('y', new Set(['x']), [])).toBeNull()
  })
})
