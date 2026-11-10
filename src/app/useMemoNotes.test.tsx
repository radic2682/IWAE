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

vi.mock('../bridge/memoNotes', () => ({
  listMemoNoteTree: vi.fn(async () => ({
    entries: [...files.keys()].map((path) => ({ path, title: path.split('/').at(-1)!.replace('.iwnote', '') })),
    folders: [...dirs],
  })),
  readMemoNote: vi.fn(async (_vault: unknown, path: string) => files.get(path)),
  writeMemoNote: vi.fn(async () => undefined),
  trashMemoNote: vi.fn(async () => undefined),
  memoNoteCodec: {},
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

  it('노트 닫기: 오른쪽 바를 비우고, 다시 켜도 닫힌 채 두며, 노트를 열면 풀린다', async () => {
    const vault = { root: 'C:/vault-close' } as never
    const first = renderHook(() => useMemoNotes(vault, [], () => '', () => {}))
    await waitFor(() => expect(first.result.current.openPath).toBe('노트/TODO.iwnote'))
    act(() => first.result.current.close())
    expect(first.result.current.openPath).toBeNull()
    expect(first.result.current.closed).toBe(true)
    first.unmount()

    const again = renderHook(() => useMemoNotes(vault, [], () => '', () => {}))
    await waitFor(() => expect(again.result.current.closed).toBe(true))
    expect(again.result.current.openPath).toBeNull()
    act(() => again.result.current.open('노트/TODO.iwnote'))
    expect(again.result.current.closed).toBe(false)
    expect(again.result.current.openPath).toBe('노트/TODO.iwnote')
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
