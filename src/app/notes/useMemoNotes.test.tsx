// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const files = new Map<string, unknown>([['노트/TODO.iwnote', { version: 1, blocks: [] }]])
const dirs = new Set<string>()

const bridge = vi.hoisted(() => ({
  renameMemoNote: vi.fn(async () => undefined),
  renameMemoNoteFolder: vi.fn(async () => undefined),
  trashMemoNoteFolder: vi.fn(async () => undefined),
  createMemoNoteFolder: vi.fn(async () => undefined),
}))

vi.mock('../../bridge/memoNotes', () => ({
  listMemoNoteTree: vi.fn(async () => ({
    entries: [...files.keys()].map((path) => ({ path, title: path.split('/').at(-1)!.replace('.iwnote', '') })),
    folders: [...dirs],
  })),
  readMemoNote: vi.fn(async (_vault: unknown, path: string) => files.get(path)),
  writeMemoNote: vi.fn(async () => undefined),
  trashMemoNote: vi.fn(async () => undefined),
  memoNoteCodec: {},
  inspectMemoNote: vi.fn(async () => ({ state: 'same' })),
  adoptMemoNoteText: vi.fn(),
  watchMemoNoteFiles: vi.fn(async () => () => undefined),
  onMemoNotesChanged: vi.fn(async () => () => undefined),
  ...bridge,
}))

const { useMemoNotes } = await import('./useMemoNotes')

describe('useMemoNotes', () => {
  it('앱 밖에서 「노트」 폴더에 넣은 노트는 창으로 돌아오면 목록에 더한다', async () => {
    const vault = { root: 'C:/vault' } as never
    const { result } = renderHook(() => useMemoNotes(vault, [], () => '', () => {}))
    await waitFor(() => expect(result.current.entries.map((entry) => entry.title)).toEqual(['TODO']))

    files.set('노트/Design Review.iwnote', { version: 1, blocks: [{ id: 's1', kind: 'section', title: '결론' }] })
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(result.current.entries.map((entry) => entry.title)).toEqual(['Design Review', 'TODO']))
  })

  it('openPath 는 마지막으로 만진 노트다: 처음엔 없고, 열거나 고치면 그 노트가 되며, 다음 실행에도 기억한다', async () => {
    files.clear()
    dirs.clear()
    files.set('노트/A.iwnote', { version: 1, blocks: [] })
    files.set('노트/TODO.iwnote', { version: 1, blocks: [] })
    const vault = { root: 'C:/vault-touched' } as never
    const first = renderHook(() => useMemoNotes(vault, [], () => '', () => {}))
    await waitFor(() => expect(first.result.current.loaded).toBe(true))
    // 아무 노트나 고르지 않는다
    expect(first.result.current.openPath).toBeNull()
    act(() => first.result.current.open('노트/TODO.iwnote'))
    expect(first.result.current.openPath).toBe('노트/TODO.iwnote')
    // 다른 노트를 고치면 그 노트가 마지막으로 만진 노트가 된다
    act(() => first.result.current.updateNoteAt('노트/A.iwnote', (note) => ({ ...note, blocks: [{ id: 't', kind: 'text', text: 'x' }] })))
    expect(first.result.current.openPath).toBe('노트/A.iwnote')
    first.unmount()

    const again = renderHook(() => useMemoNotes(vault, [], () => '', () => {}))
    await waitFor(() => expect(again.result.current.loaded).toBe(true))
    expect(again.result.current.openPath).toBe('노트/A.iwnote')
    // 지운 노트는 마지막으로 만진 노트에서 빠진다
    await act(async () => { await again.result.current.trash('노트/A.iwnote') })
    expect(again.result.current.openPath).toBeNull()
  })

  it('노트 폴더: 만들고, 노트를 옮기고, 폴더 이름을 바꾸면 안의 노트 경로와 열린 노트가 따라간다', async () => {
    files.clear()
    dirs.clear()
    files.set('노트/A.iwnote', { version: 1, blocks: [] })
    dirs.add('노트/회의')
    files.set('노트/회의/B.iwnote', { version: 1, blocks: [] })
    const vault = { root: 'C:/vault-folders' } as never
    const { result } = renderHook(() => useMemoNotes(vault, [], () => '', () => {}))
    await waitFor(() => expect(result.current.folders).toEqual(['노트/회의']))
    expect(result.current.entries.map((entry) => entry.path).sort()).toEqual(['노트/A.iwnote', '노트/회의/B.iwnote'])

    await act(async () => { await result.current.createFolder('노트/회의', '2026') })
    expect(bridge.createMemoNoteFolder).toHaveBeenCalledWith(vault, '노트/회의/2026')
    expect(result.current.folders).toEqual(['노트/회의', '노트/회의/2026'])

    act(() => result.current.open('노트/A.iwnote'))
    let moved = ''
    await act(async () => { moved = await result.current.move('노트/A.iwnote', '노트/회의/2026') })
    expect(moved).toBe('노트/회의/2026/A.iwnote')
    expect(bridge.renameMemoNote).toHaveBeenLastCalledWith(vault, '노트/A.iwnote', '노트/회의/2026/A.iwnote')
    expect(result.current.openPath).toBe('노트/회의/2026/A.iwnote')

    let map: ReadonlyMap<string, string> = new Map()
    await act(async () => { map = await result.current.renameFolder('노트/회의', '회의록') })
    expect(bridge.renameMemoNoteFolder).toHaveBeenCalledWith(vault, '노트/회의', '노트/회의록', expect.arrayContaining(['노트/회의/B.iwnote', '노트/회의/2026/A.iwnote']))
    expect(map.get('노트/회의/2026')).toBe('노트/회의록/2026')
    expect(result.current.folders).toEqual(['노트/회의록', '노트/회의록/2026'])
    expect(result.current.openPath).toBe('노트/회의록/2026/A.iwnote')
    expect(result.current.entries.map((entry) => entry.path).sort()).toEqual(['노트/회의록/2026/A.iwnote', '노트/회의록/B.iwnote'])

    await expect(result.current.moveFolder('노트/회의록', '노트/회의록/2026')).rejects.toThrow('자기 안')

    let removed: readonly string[] = []
    await act(async () => { removed = await result.current.trashFolder('노트/회의록/2026') })
    expect(removed).toEqual(['노트/회의록/2026/A.iwnote'])
    expect(result.current.folders).toEqual(['노트/회의록'])
    expect(result.current.entries.map((entry) => entry.path)).toEqual(['노트/회의록/B.iwnote'])
  })

  it('폴더 안의 노트도 제목이 겹치지 않게 만들고, 폴더 안에 새 노트를 만든다', async () => {
    files.clear()
    dirs.clear()
    dirs.add('노트/회의')
    files.set('노트/회의/TODO.iwnote', { version: 1, blocks: [] })
    const vault = { root: 'C:/vault-create-in' } as never
    const { result } = renderHook(() => useMemoNotes(vault, [], () => '', () => {}))
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    let created: string | null = null
    await act(async () => { created = await result.current.createIn('노트/회의', 'TODO') })
    expect(created).toBe('노트/회의/TODO 2.iwnote')
    expect(result.current.openPath).toBe('노트/회의/TODO 2.iwnote')
  })
})
