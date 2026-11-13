// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { VaultExternalChangeError } from '../core/vaultSync'
import type { MemoNote } from '../core/memoNote'

/** 디스크(disk)와 앱이 마지막으로 읽거나 쓴 내용(known)을 흉내 낸다 */
const disk = new Map<string, string>()
const known = new Map<string, string>()
const watchers = vi.hoisted(() => ({ callback: null as null | ((change: { notePaths: string[]; rescan: boolean }) => void) }))

const note = (...ids: string[]): MemoNote => ({ version: 1, blocks: ids.map((id) => ({ id, kind: 'section', title: id })) }) as unknown as MemoNote
const text = (value: MemoNote): string => JSON.stringify(value)
const blockIds = (value: MemoNote | null): string[] => (value?.blocks ?? []).map((block) => block.id)

const bridge = vi.hoisted(() => ({ writes: [] as string[] }))

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
    bridge.writes.push(path)
  }),
  watchMemoNoteFiles: vi.fn(async (_vault: unknown, callback: (change: { notePaths: string[]; rescan: boolean }) => void) => {
    watchers.callback = callback
    return () => { watchers.callback = null }
  }),
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

const PATH = '노트/Main.iwnote'
const vault = { root: 'C:/vault-external' } as never

function external(path: string, value: MemoNote): void {
  disk.set(path, text(value))
  act(() => watchers.callback?.({ notePaths: [path], rescan: false }))
}

async function open() {
  const messages: string[] = []
  const view = renderHook(() => useMemoNotes(vault, [], () => '', (message) => messages.push(message)))
  await waitFor(() => expect(view.result.current.loaded).toBe(true))
  // 마지막으로 만진 노트가 이 노트다(처음에는 아무도 만지지 않았다)
  act(() => view.result.current.open(PATH))
  expect(view.result.current.openPath).toBe(PATH)
  await waitFor(() => expect(watchers.callback).not.toBeNull())
  return { ...view, messages }
}

describe('외부에서 바뀐 노트', () => {
  beforeEach(() => {
    disk.clear()
    known.clear()
    bridge.writes.length = 0
    watchers.callback = null
    localStorage.clear()
    disk.set(PATH, text(note()))
  })

  it('저장하지 않은 변경이 없으면 파일의 새 내용으로 그 자리에서 다시 읽고 알린다', async () => {
    const { result, messages } = await open()
    expect(blockIds(result.current.openNote)).toEqual([])

    external(PATH, note('a', 'b', 'c'))
    await waitFor(() => expect(blockIds(result.current.openNote)).toEqual(['a', 'b', 'c']))
    expect(messages).toEqual(['다른 프로그램이 노트를 바꿔 다시 불러왔습니다'])
    expect(result.current.conflict).toBeNull()
    expect(bridge.writes).toEqual([])
  })

  it('열지 않은 노트도 바뀌면 다시 읽고 새로 생긴 노트는 목록에 더하며 지워진 노트는 뺀다', async () => {
    disk.set('노트/Other.iwnote', text(note('x')))
    const { result, messages } = await open()
    expect(result.current.entries.map((entry) => entry.title)).toEqual(['Main', 'Other'])

    external('노트/Other.iwnote', note('x', 'y'))
    await waitFor(() => expect(result.current.listNotes().find((item) => item.title === 'Other')?.blocks).toBe(2))
    expect(messages).toEqual([])

    disk.set('노트/Fresh.iwnote', text(note('z')))
    act(() => watchers.callback?.({ notePaths: ['노트/Fresh.iwnote'], rescan: false }))
    await waitFor(() => expect(result.current.entries.map((entry) => entry.title)).toEqual(['Fresh', 'Main', 'Other']))

    disk.delete('노트/Other.iwnote')
    act(() => watchers.callback?.({ notePaths: ['노트/Other.iwnote'], rescan: false }))
    // 바꿔 끼우는 동안 잠깐 없어 보일 수 있으니 바로 빼지 않고, 다시 확인해도 없으면 뺀다
    expect(result.current.entries.map((entry) => entry.title)).toContain('Other')
    await waitFor(() => expect(result.current.entries.map((entry) => entry.title)).toEqual(['Fresh', 'Main']), { timeout: 3000 })
  })

  it('앱 자신의 저장은 다시 읽기도 충돌도 일으키지 않는다', async () => {
    const { result, messages } = await open()
    act(() => result.current.updateOpen((current) => ({ ...current, blocks: [...current.blocks, ...note('mine').blocks] })))
    await waitFor(() => expect(bridge.writes).toEqual([PATH]), { timeout: 3000 })

    act(() => watchers.callback?.({ notePaths: [PATH], rescan: false }))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 700)) })
    expect(blockIds(result.current.openNote)).toEqual(['mine'])
    expect(messages).toEqual([])
    expect(result.current.conflict).toBeNull()
  })

  it('저장하지 않은 변경이 있는데 파일이 밖에서 바뀌면 충돌로 보여 주고 정할 때까지 덮어쓰지 않는다', async () => {
    const { result } = await open()
    act(() => result.current.updateOpen((current) => ({ ...current, blocks: [...current.blocks, ...note('mine').blocks] })))
    external(PATH, note('theirs-1', 'theirs-2'))

    await waitFor(() => expect(result.current.conflict?.path).toBe(PATH), { timeout: 3000 })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)) })
    expect(bridge.writes).toEqual([])
    expect(disk.get(PATH)).toBe(text(note('theirs-1', 'theirs-2')))
    // 정하기 전에 더 고쳐도 파일에 쓰지 않는다
    act(() => result.current.updateOpen((current) => ({ ...current, blocks: [...current.blocks, ...note('mine-2').blocks] })))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)) })
    expect(bridge.writes).toEqual([])
    expect(blockIds(result.current.openNote)).toEqual(['mine', 'mine-2'])
  })

  it('저장 직전 확인: 읽은 뒤 파일이 바뀌었는데 알림이 없어도 쓰지 않고 충돌로 넘긴다', async () => {
    const { result } = await open()
    // 파일 감시가 놓친 변경(알림 없음)
    disk.set(PATH, text(note('theirs')))
    act(() => result.current.updateOpen((current) => ({ ...current, blocks: [...current.blocks, ...note('mine').blocks] })))
    await waitFor(() => expect(result.current.conflict?.path).toBe(PATH), { timeout: 3000 })
    expect(bridge.writes).toEqual([])
    expect(disk.get(PATH)).toBe(text(note('theirs')))
  })

  it('내 것으로 덮어쓰기: 파일을 내 내용으로 바꾼다', async () => {
    const { result } = await open()
    act(() => result.current.updateOpen((current) => ({ ...current, blocks: [...current.blocks, ...note('mine').blocks] })))
    external(PATH, note('theirs'))
    await waitFor(() => expect(result.current.conflict).not.toBeNull(), { timeout: 3000 })

    await act(async () => { await result.current.resolveConflict('mine') })
    expect(disk.get(PATH)).toBe(text(note('mine')))
    expect(result.current.conflict).toBeNull()
  })

  it('파일의 것으로 되돌리기: 내 변경을 버리고 파일 내용을 쓴다(파일은 그대로)', async () => {
    const { result } = await open()
    act(() => result.current.updateOpen((current) => ({ ...current, blocks: [...current.blocks, ...note('mine').blocks] })))
    external(PATH, note('theirs'))
    await waitFor(() => expect(result.current.conflict).not.toBeNull(), { timeout: 3000 })

    await act(async () => { await result.current.resolveConflict('file') })
    expect(blockIds(result.current.openNote)).toEqual(['theirs'])
    expect(disk.get(PATH)).toBe(text(note('theirs')))
    expect(bridge.writes).toEqual([])
    expect(result.current.conflict).toBeNull()
  })

  it('내 것을 사본으로 저장: 「(충돌 사본)」 노트에 내 내용을 두고 원래 노트는 파일의 것을 보인다', async () => {
    const { result } = await open()
    act(() => result.current.updateOpen((current) => ({ ...current, blocks: [...current.blocks, ...note('mine').blocks] })))
    external(PATH, note('theirs'))
    await waitFor(() => expect(result.current.conflict).not.toBeNull(), { timeout: 3000 })

    await act(async () => { await result.current.resolveConflict('copy') })
    expect(disk.get('노트/Main (충돌 사본).iwnote')).toBe(text(note('mine')))
    expect(disk.get(PATH)).toBe(text(note('theirs')))
    expect(blockIds(result.current.openNote)).toEqual(['theirs'])
    expect(result.current.entries.map((entry) => entry.title)).toContain('Main (충돌 사본)')
  })
})
