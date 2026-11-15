// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const files = new Map<string, unknown>([['노트/A.iwnote', { version: 1, blocks: [] }]])

vi.mock('../../bridge/memoNotes', () => ({
  listMemoNoteTree: vi.fn(async () => ({ entries: [...files.keys()].map((path) => ({ path, title: path.split('/').at(-1)!.replace('.iwnote', '') })), folders: [] })),
  readMemoNote: vi.fn(async (_vault: unknown, path: string) => files.get(path)),
  writeMemoNote: vi.fn(async () => undefined),
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
const { undo, redo, clearUndo } = await import('../undoStack')

describe('note undo after rename', () => {
  it('undo and redo still reach the note after it was renamed', async () => {
    clearUndo()
    const vault = { root: 'C:/vault-undo' } as never
    const { result } = renderHook(() => useMemoNotes(vault, [], () => '', () => {}))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.updateNoteAt('노트/A.iwnote', (note) => ({ ...note, blocks: [{ id: 't', kind: 'text', text: 'x' }] })))
    await act(async () => { await result.current.rename('노트/A.iwnote', 'B') })
    const blocks = () => result.current.noteAt('노트/B.iwnote')?.blocks.length
    expect(blocks()).toBe(1)
    act(() => { undo() })
    expect(blocks()).toBe(0)
    act(() => { redo() })
    expect(blocks()).toBe(1)
  })
})
