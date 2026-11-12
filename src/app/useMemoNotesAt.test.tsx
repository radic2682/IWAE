// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { VaultExternalChangeError } from '../core/vaultSync'
import type { MemoNote } from '../core/memoNote'

/** 디스크(disk)와 앱이 마지막으로 읽거나 쓴 내용(known)을 흉내 낸다 */
const disk = new Map<string, string>()
const known = new Map<string, string>()
const bridge = vi.hoisted(() => ({ writes: [] as { path: string; note: unknown }[] }))

const note = (...ids: string[]): MemoNote => ({ version: 1, blocks: ids.map((id) => ({ id, kind: 'section', title: id })) }) as unknown as MemoNote
const text = (value: MemoNote): string => JSON.stringify(value)
const blockIds = (value: MemoNote | null): string[] => (value?.blocks ?? []).map((block) => block.id)
const add = (...ids: string[]) => (current: MemoNote): MemoNote => ({ ...current, blocks: [...current.blocks, ...note(...ids).blocks] })

vi.mock('../bridge/memoNotes', () => ({
  listMemoNoteTree: vi.fn(async () => ({
    entries: [...disk.keys()].map((path) => ({ path, title: path.split('/').at(-1)!.replace('.iwnote', '') })),
    folders: [],
  })),
  readMemoNote: vi.fn(async (_vault: unknown, path: string) => {
    known.set(path, disk.get(path)!)
    return JSON.parse(disk.get(path)!) as MemoNote
  }),
  inspectMemoNote: vi.fn(async (_vault: unknown, path: string) => {
    const onDisk = disk.get(path)
    if (onDisk === undefined) return { state: 'missing' }
    if (known.get(path) === onDisk) return { state: 'same' }
    return { state: 'changed', text: onDisk, note: JSON.parse(onDisk) as MemoNote }
  }),
  adoptMemoNoteText: vi.fn((_vault: unknown, path: string, value: string) => { known.set(path, value) }),
  writeMemoNote: vi.fn(async (_vault: unknown, path: string, value: MemoNote) => {
    const onDisk = disk.get(path)
    if (onDisk !== undefined && onDisk !== known.get(path)) throw new VaultExternalChangeError(path, onDisk)
    disk.set(path, text(value))
    known.set(path, text(value))
    bridge.writes.push({ path, note: value })
  }),
  watchMemoNoteFiles: vi.fn(async () => () => undefined),
  trashMemoNote: vi.fn(async () => undefined),
  renameMemoNote: vi.fn(async () => undefined),
  renameMemoNoteFolder: vi.fn(async () => undefined),
  trashMemoNoteFolder: vi.fn(async () => undefined),
  createMemoNoteFolder: vi.fn(async () => undefined),
  memoNoteCodec: {},
  onMemoNotesChanged: vi.fn(async () => () => undefined),
}))
vi.mock('../bridge/vault', () => ({ subscribeVaultFolder: () => () => undefined }))

const { useMemoNotes } = await import('./useMemoNotes')

const OPEN = '노트/Open.iwnote'
const OTHER = '노트/Other.iwnote'
const vault = { root: 'C:/vault-at' } as never

async function mount(onMoved?: (moved: ReadonlyMap<string, string>) => void) {
  const view = renderHook(() => useMemoNotes(vault, [], () => '', () => undefined, onMoved))
  await waitFor(() => expect(view.result.current.loaded).toBe(true))
  return view
}

describe('noteAt / updateNoteAt: 열린 노트가 아닌 노트도 같은 저장소로', () => {
  beforeEach(() => {
    disk.clear()
    known.clear()
    bridge.writes.length = 0
    localStorage.clear()
    disk.set(OPEN, text(note('open-1')))
    disk.set(OTHER, text(note('other-1')))
  })

  it('noteAt 은 어느 노트든 내용을 돌려주고 모르는 경로는 null', async () => {
    const { result } = await mount()
    expect(blockIds(result.current.noteAt(OTHER))).toEqual(['other-1'])
    expect(blockIds(result.current.noteAt(OPEN))).toEqual(['open-1'])
    expect(result.current.noteAt('노트/없음.iwnote')).toBeNull()
  })

  it('updateNoteAt 은 열려 있지 않은 노트를 고치고 그 노트만 저장한다', async () => {
    const { result } = await mount()
    const other = result.current.openPath === OTHER ? OPEN : OTHER
    const before = blockIds(result.current.noteAt(other))
    act(() => result.current.updateNoteAt(other, add('edited')))
    expect(blockIds(result.current.noteAt(other))).toEqual([...before, 'edited'])
    await waitFor(() => expect(bridge.writes.map((write) => write.path)).toEqual([other]), { timeout: 3000 })
  })

  it('저장은 잠시 늦춰 모은다: 연달아 고쳐도 마지막 내용 한 번만 쓴다', async () => {
    const { result } = await mount()
    act(() => result.current.updateNoteAt(OTHER, add('a')))
    act(() => result.current.updateNoteAt(OTHER, add('b')))
    act(() => result.current.updateNoteAt(OTHER, add('c')))
    expect(bridge.writes).toEqual([])
    await waitFor(() => expect(bridge.writes.length).toBe(1), { timeout: 3000 })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)) })
    expect(bridge.writes.length).toBe(1)
    expect(blockIds(bridge.writes[0]!.note as MemoNote)).toEqual(['other-1', 'a', 'b', 'c'])
  })

  it('열린 노트(updateOpen)와 탭의 노트(updateNoteAt)를 번갈아 고쳐도 하나로 합쳐진다', async () => {
    const { result } = await mount()
    act(() => result.current.open(OPEN))
    const path = result.current.openPath!
    act(() => result.current.updateOpen(add('from-bar')))
    act(() => result.current.updateNoteAt(path, add('from-tab')))
    act(() => result.current.updateOpen(add('from-bar-2')))
    expect(blockIds(result.current.noteAt(path)).slice(-3)).toEqual(['from-bar', 'from-tab', 'from-bar-2'])
    expect(blockIds(result.current.openNote).slice(-3)).toEqual(['from-bar', 'from-tab', 'from-bar-2'])
    await waitFor(() => expect(bridge.writes.length).toBe(1), { timeout: 3000 })
  })

  it('목록에 없는 노트는 고치지도 만들지도 않는다(지운 노트의 탭이 파일을 되살리지 않게)', async () => {
    const { result } = await mount()
    act(() => result.current.updateNoteAt('노트/없음.iwnote', add('ghost')))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)) })
    expect(bridge.writes).toEqual([])
    expect(result.current.noteAt('노트/없음.iwnote')).toBeNull()
  })

  it('밖에서 바뀐 파일과 부딪치면 열려 있지 않은 노트도 충돌로 넘기고 덮어쓰지 않는다', async () => {
    const { result } = await mount()
    // 파일 감시가 놓친 변경
    disk.set(OTHER, text(note('theirs')))
    act(() => result.current.updateNoteAt(OTHER, add('mine')))
    await waitFor(() => expect(result.current.conflict?.path).toBe(OTHER), { timeout: 3000 })
    expect(bridge.writes).toEqual([])
    expect(disk.get(OTHER)).toBe(text(note('theirs')))
    // 정하기 전에 더 고쳐도 파일에는 쓰지 않는다
    act(() => result.current.updateNoteAt(OTHER, add('mine-2')))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)) })
    expect(bridge.writes).toEqual([])
    expect(blockIds(result.current.noteAt(OTHER))).toEqual(['other-1', 'mine', 'mine-2'])
  })

  it('이름 바꾸기·옮기기는 onMoved 로 옛 → 새 경로를 알린다', async () => {
    const onMoved = vi.fn()
    const { result } = await mount(onMoved)
    await act(async () => { await result.current.rename(OTHER, '새 이름') })
    expect(onMoved).toHaveBeenLastCalledWith(new Map([[OTHER, '노트/새 이름.iwnote']]))
    await act(async () => { await result.current.move('노트/새 이름.iwnote', '노트/회의') })
    expect(onMoved).toHaveBeenLastCalledWith(new Map([['노트/새 이름.iwnote', '노트/회의/새 이름.iwnote']]))
  })
})
