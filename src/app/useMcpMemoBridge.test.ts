// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { handleMcpMemoRequest, type McpMemoBridgeDeps } from './useMcpMemoBridge'
import { EMPTY_MEMO_NOTE, memoNoteTitleOf, memoNotePath, type MemoNote } from '../core/memoNote'
import type { PersistentPdfHighlight } from '../pdf/persistentHighlight'

const highlight = (id: string, note?: string): PersistentPdfHighlight => ({
  id,
  color: 'yellow',
  anchor: { docId: 'abc123abc123', page: 1, coordSpace: 'pdfium-page', rects: [{ x: 1, y: 2, w: 3, h: 4 }], charRange: [0, 3], quote: 'UVLO', prefix: '', suffix: '' },
  ...(note === undefined ? {} : { note }),
})

function harness(highlights: PersistentPdfHighlight[] = []) {
  const notes = new Map<string, MemoNote>()
  const update = vi.fn()
  const deps: McpMemoBridgeDeps = {
    highlights,
    add: vi.fn(),
    update,
    remove: vi.fn(),
    loadPdfById: vi.fn(),
    notes: {
      list: () => [...notes.entries()].map(([path, note]) => ({ path, title: memoNoteTitleOf(path), blocks: note.blocks.length })),
      find: (title) => {
        const path = [...notes.keys()].find((key) => memoNoteTitleOf(key).toLowerCase() === title.toLowerCase())
        return path === undefined ? null : { path, note: notes.get(path)! }
      },
      edit: (title, change, create) => {
        const path = [...notes.keys()].find((key) => memoNoteTitleOf(key).toLowerCase() === title.toLowerCase()) ?? memoNotePath(title)
        if (!notes.has(path) && !create) throw new Error('없음')
        notes.set(path, change(notes.get(path) ?? EMPTY_MEMO_NOTE))
        return path
      },
      trash: async (path) => { notes.delete(path) },
    },
  }
  return { deps, notes, update }
}

describe('MCP note_* 도구', () => {
  it('note_append 는 노트가 없으면 만들고 소제목·서식 글(표 포함)·메모를 차례로 넣는다', async () => {
    const { deps } = harness([highlight('h1', '메모')])
    const result = await handleMcpMemoRequest('note_append', {
      title: '전원',
      blocks: [
        { kind: 'section', title: 'UVLO' },
        { kind: 'text', markdown: '**문턱**\n\n| 항목 | 값 |\n|---|---|\n| 상승 | 2.6 V |' },
        { kind: 'memo', highlight_id: 'h1' },
      ],
    }, deps) as { added: { id: string; kind: string }[] }
    expect(result.added.map((block) => block.kind)).toEqual(['section', 'text', 'memo'])
    const read = await handleMcpMemoRequest('note_read', { title: '전원' }, deps) as { blocks: Record<string, unknown>[] }
    expect(read.blocks[0]).toMatchObject({ kind: 'section', title: 'UVLO' })
    expect(read.blocks[1]).toMatchObject({ kind: 'text' })
    expect(String(read.blocks[1]!.html)).toContain('<table>')
    expect(String(read.blocks[1]!.text)).toContain('2.6 V')
    expect(read.blocks[2]).toMatchObject({ kind: 'memo', highlight_id: 'h1', quote: 'UVLO' })
  })

  it('after 로 블록 뒤에 끼우고, 블록을 고치고 지운다', async () => {
    const { deps } = harness()
    const first = await handleMcpMemoRequest('note_append', { title: 'A', blocks: [{ kind: 'section', title: '하나' }, { kind: 'section', title: '셋' }] }, deps) as { added: { id: string }[] }
    const [one, three] = first.added.map((block) => block.id)
    const middle = await handleMcpMemoRequest('note_append', { title: 'A', after: one, blocks: [{ kind: 'text', markdown: '- 둘' }] }, deps) as { added: { id: string }[] }
    const textId = middle.added[0]!.id
    await handleMcpMemoRequest('note_update_block', { title: 'A', id: textId, markdown: '*바꿈*' }, deps)
    await handleMcpMemoRequest('note_update_block', { title: 'A', id: three, section_title: '셋째' }, deps)
    let read = await handleMcpMemoRequest('note_read', { title: 'A' }, deps) as { blocks: Record<string, unknown>[] }
    expect(read.blocks.map((block) => block.kind)).toEqual(['section', 'text', 'section'])
    expect(read.blocks[1]!.html).toBe('<i>바꿈</i>')
    expect(read.blocks[2]!.title).toBe('셋째')
    await handleMcpMemoRequest('note_delete_blocks', { title: 'A', ids: [textId] }, deps)
    read = await handleMcpMemoRequest('note_read', { title: 'A' }, deps) as { blocks: Record<string, unknown>[] }
    expect(read.blocks).toHaveLength(2)
  })

  it('note_delete 는 노트를 통째로 휴지통으로 옮긴다', async () => {
    const { deps, notes } = harness()
    await handleMcpMemoRequest('note_append', { title: '지울 노트', blocks: [{ kind: 'section', title: 'x' }] }, deps)
    expect(notes.size).toBe(1)
    await handleMcpMemoRequest('note_delete', { title: '지울 노트' }, deps)
    expect(notes.size).toBe(0)
    await expect(handleMcpMemoRequest('note_delete', { title: '지울 노트' }, deps)).rejects.toThrow(/노트가 없습니다/u)
  })

  it('없는 노트를 읽거나 고치면 알려 준다', async () => {
    const { deps } = harness()
    await expect(handleMcpMemoRequest('note_read', { title: '없음' }, deps)).rejects.toThrow(/노트가 없습니다/u)
    await expect(handleMcpMemoRequest('note_append', { title: 'x', blocks: [{ kind: 'memo', highlight_id: 'nope' }] }, deps)).rejects.toThrow(/없는 메모/u)
  })
})

describe('MCP source_* 도구', () => {
  it('출처를 더하고, 중복·잘못된 주소는 건너뛰고, 고치고, 지운다', async () => {
    const store: Record<string, { id: string; label: string; target: string }[]> = {}
    const { deps } = harness()
    const withSources: McpMemoBridgeDeps = {
      ...deps,
      docSources: {
        all: () => store as never,
        add: (docId, input) => {
          if ((store[docId] ?? []).some((item) => item.target === input.target)) return false
          store[docId] = [...(store[docId] ?? []), { id: `s${(store[docId]?.length ?? 0) + 1}`, label: input.label ?? '', target: input.target }]
          return true
        },
        update: (docId, id, patch) => { store[docId] = (store[docId] ?? []).map((item) => item.id === id ? { ...item, ...patch } as never : item) },
        remove: (docId, id) => { store[docId] = (store[docId] ?? []).filter((item) => item.id !== id) },
      },
    }
    const added = await handleMcpMemoRequest('source_add', {
      doc_id: 'd1',
      sources: [{ target: 'www.example.com/a', label: '원본' }, { target: 'javascript:x' }, { target: 'www.example.com/a' }, { target: 'G:\docs\a.pdf' }],
    }, withSources) as { added: string[]; skipped: unknown[] }
    expect(added.added).toEqual(['https://www.example.com/a', 'G:\docs\a.pdf'])
    expect(added.skipped).toHaveLength(2)
    const listed = await handleMcpMemoRequest('source_list', { doc_id: 'd1' }, withSources) as { documents: { sources: { id: string }[] }[] }
    expect(listed.documents[0]!.sources).toHaveLength(2)
    await handleMcpMemoRequest('source_update', { doc_id: 'd1', id: 's1', label: '최신판' }, withSources)
    expect(store.d1![0]!.label).toBe('최신판')
    await expect(handleMcpMemoRequest('source_update', { doc_id: 'd1', id: 'nope' }, withSources)).rejects.toThrow(/없는 출처/u)
    await handleMcpMemoRequest('source_remove', { doc_id: 'd1', ids: ['s1'] }, withSources)
    expect(store.d1).toHaveLength(1)
  })
})

describe('MCP memo_* 고친 점', () => {
  it('memo_list 는 메모 글이 없는 형광펜도 보이고, only_with_note 면 뺀다', async () => {
    const { deps } = harness([highlight('a', '글'), highlight('b')])
    const all = await handleMcpMemoRequest('memo_list', {}, deps) as { memos: { id: string }[] }
    expect(all.memos.map((memo) => memo.id).sort()).toEqual(['a', 'b'])
    const noted = await handleMcpMemoRequest('memo_list', { only_with_note: true }, deps) as { memos: { id: string }[] }
    expect(noted.memos.map((memo) => memo.id)).toEqual(['a'])
  })

  it('memo_update 의 note:"" 는 메모 글과 서식을 지운다', async () => {
    const { deps, update } = harness([highlight('a', '글')])
    await handleMcpMemoRequest('memo_update', { updates: [{ id: 'a', note: '' }] }, deps)
    expect(update).toHaveBeenCalledWith('a', { note: '', noteHtml: '' })
  })
})
