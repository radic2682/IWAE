// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { MemoNote } from '../core/memoNote'

const files = new Map<string, unknown>()
const written: Array<{ path: string; note: MemoNote }> = []

vi.mock('../bridge/memoNotes', () => ({
  listMemoNoteTree: vi.fn(async () => ({ entries: [...files.keys()].map((path) => ({ path, title: path })), folders: [] })),
  readMemoNote: vi.fn(async (_vault: unknown, path: string) => files.get(path)),
  writeMemoNote: vi.fn(async (_vault: unknown, path: string, note: MemoNote) => { written.push({ path, note }) }),
  trashMemoNote: vi.fn(async () => undefined),
  renameMemoNote: vi.fn(async () => undefined),
  renameMemoNoteFolder: vi.fn(async () => undefined),
  trashMemoNoteFolder: vi.fn(async () => undefined),
  createMemoNoteFolder: vi.fn(async () => undefined),
  memoNoteCodec: {},
  inspectMemoNote: vi.fn(async () => ({ state: 'same' })),
  adoptMemoNoteText: vi.fn(),
  watchMemoNoteFiles: vi.fn(async () => () => undefined),
  onMemoNotesChanged: vi.fn(async () => () => undefined),
}))

const { useMemoNotes } = await import('./useMemoNotes')
const { clearUndo, undo, redo } = await import('./undoStack')
const { textBlock } = await import('../core/memoNote')

const memo = (id: string, highlightId: string, ticket?: { id: string; title?: string }) => ({ id, kind: 'memo', highlightId, ...(ticket === undefined ? {} : { ticket }) })

/** vault 는 렌더마다 새로 만들면 노트를 다시 읽는 일이 끝없이 이어진다: 밖에서 한 번만 */
function openHook(root: string) {
  const vault = { root } as never
  return renderHook(() => useMemoNotes(vault, [], () => '', () => {}))
}

beforeEach(() => {
  clearUndo()
  written.length = 0
  files.clear()
  files.set('노트/A.iwnote', { version: 1, blocks: [memo('a1', 'h1', { id: 'REQ-01', title: '옛 제목' }), memo('a2', 'h2', { id: 'REQ-02' })] })
  files.set('노트/B.iwnote', { version: 1, blocks: [memo('b1', 'h1', { id: 'REQ-01', title: '옛 제목' })] })
  files.set('노트/C.iwnote', { version: 1, blocks: [memo('c1', 'h3', { id: 'REQ-01', title: '다른 메모' })] })
})

describe('useMemoNotes — 티켓', () => {
  it('모든 노트의 티켓을 ID 별로 모으고, 같은 ID 에 다른 형광펜이 있으면 충돌로 안다', async () => {
    const { result } = openHook('C:/v-tickets')
    await waitFor(() => expect(result.current.entries).toHaveLength(3))
    const group = result.current.tickets!.groups.get('req-01')!
    expect(group.places.map((place) => place.path)).toEqual(['노트/A.iwnote', '노트/B.iwnote', '노트/C.iwnote'])
    expect(group.conflict).toBe(true)
    expect(result.current.tickets!.groups.get('req-02')!.conflict).toBe(false)
  })

  it('제목을 고치면 같은 ID·같은 형광펜의 다른 노트 블록도 바뀌고, 충돌 중인 다른 메모는 그대로이며, 되돌리기 한 번에 모두 돌아온다', async () => {
    const { result } = openHook('C:/v-tickets-sync')
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.open('노트/A.iwnote'))
    // 바로 앞에 같은 노트를 한 번 고쳐 두어도(1.2초 안) 티켓 고침은 그것과 합쳐지지 않는다
    await act(async () => { result.current.updateOpen((note) => ({ ...note, blocks: [...note.blocks, textBlock('끝 글')] })) })
    act(() => result.current.setTicket!('a1', { id: 'REQ-01', title: '새 제목' }))
    const titleOf = (path: string, index = 0) => (result.current.tickets!.groups.get('req-01')!.places.find((place) => place.path === path && place.index === index)?.ticket.title)
    expect(titleOf('노트/A.iwnote')).toBe('새 제목')
    expect(titleOf('노트/B.iwnote')).toBe('새 제목')
    expect(titleOf('노트/C.iwnote')).toBe('다른 메모')

    // 저장은 바뀐 노트만, 노트마다 한 번
    await waitFor(() => expect(written.map((item) => item.path).sort()).toEqual(['노트/A.iwnote', '노트/B.iwnote']))

    act(() => { undo() })
    expect(titleOf('노트/A.iwnote')).toBe('옛 제목')
    expect(titleOf('노트/B.iwnote')).toBe('옛 제목')
    // 앞서 쓴 글은 아직 남아 있다(그건 따로 한 칸)
    expect(result.current.openNote?.blocks.at(-1)).toMatchObject({ kind: 'text', text: '끝 글' })

    act(() => { redo() })
    expect(titleOf('노트/B.iwnote')).toBe('새 제목')
  })

  it('ID 를 바꾸면 같은 메모의 다른 블록 ID 도 같이 바뀐다', async () => {
    const { result } = openHook('C:/v-tickets-id')
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.open('노트/A.iwnote'))
    act(() => result.current.setTicket!('a1', { id: 'REQ-09', title: '옛 제목' }))
    expect([...result.current.tickets!.groups.keys()].sort()).toEqual(['req-01', 'req-02', 'req-09'])
    expect(result.current.tickets!.groups.get('req-09')!.places.map((place) => place.path)).toEqual(['노트/A.iwnote', '노트/B.iwnote'])
    // 충돌 상대(C)는 REQ-01 로 남는다
    expect(result.current.tickets!.groups.get('req-01')!.places.map((place) => place.path)).toEqual(['노트/C.iwnote'])
  })
})
