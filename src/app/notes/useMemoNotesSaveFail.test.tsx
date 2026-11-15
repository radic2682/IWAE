// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const files = new Map<string, unknown>([['노트/A.iwnote', { version: 1, blocks: [] }]])
let failWrites = true
const writeMemoNote = vi.fn(async () => { if (failWrites) throw new Error('EACCES: permission denied') })

vi.mock('../../bridge/memoNotes', () => ({
  listMemoNoteTree: vi.fn(async () => ({
    entries: [...files.keys()].map((path) => ({ path, title: path.split('/').at(-1)!.replace('.iwnote', '') })),
    folders: [],
  })),
  readMemoNote: vi.fn(async (_vault: unknown, path: string) => files.get(path)),
  writeMemoNote,
  trashMemoNote: vi.fn(async () => undefined),
  memoNoteCodec: {},
  inspectMemoNote: vi.fn(async () => ({ state: 'same' })),
  adoptMemoNoteText: vi.fn(),
  watchMemoNoteFiles: vi.fn(async () => () => undefined),
  onMemoNotesChanged: vi.fn(async () => () => undefined),
  renameMemoNote: vi.fn(async () => undefined),
  renameMemoNoteFolder: vi.fn(async () => undefined),
  trashMemoNoteFolder: vi.fn(async () => undefined),
  createMemoNoteFolder: vi.fn(async () => undefined),
}))

const { useMemoNotes } = await import('./useMemoNotes')
const { flushCanvasSaves } = await import('./useCanvasAutosave')

describe('메모 노트 지연 저장 실패', () => {
  it('실패한 저장은 닫기 전 flush 가 다시 시도하고, 계속 실패하면 실패로 알린다', async () => {
    const errors: string[] = []
    const vault = { root: 'C:/vault-fail' } as never
    const { result } = renderHook(() => useMemoNotes(vault, [], () => '', (message: string) => errors.push(message)))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.updateNoteAt('노트/A.iwnote', (note) => ({ ...note, blocks: [{ id: 't', kind: 'text', text: 'precious' }] })))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)) })
    expect(writeMemoNote).toHaveBeenCalledTimes(1)
    expect(errors.length).toBe(1)

    // 아직 잠겨 있으면 flush 도 실패로 알린다(창을 그대로 닫지 않게)
    await act(async () => { await expect(flushCanvasSaves()).rejects.toThrow('permission denied') })
    expect(writeMemoNote).toHaveBeenCalledTimes(2)

    // 잠금이 풀리면 flush 가 다시 쓴다
    failWrites = false
    await act(async () => { await flushCanvasSaves() })
    expect(writeMemoNote).toHaveBeenCalledTimes(3)
    // 다 썼으면 더 쓰지 않는다
    await act(async () => { await flushCanvasSaves() })
    expect(writeMemoNote).toHaveBeenCalledTimes(3)
    let flushed: boolean | undefined
    await act(async () => { flushed = await result.current.flushNote('노트/A.iwnote') })
    expect(flushed).toBe(true)
    expect(writeMemoNote).toHaveBeenCalledTimes(3)
  })
})
