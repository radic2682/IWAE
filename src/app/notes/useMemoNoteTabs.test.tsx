// @vitest-environment jsdom
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { MemoNote } from '../../core/memoNote'
import { emptyTabs, openTabInPanes, type PanesState, type Tab } from '../workspace/tabs'

const disk = new Map<string, MemoNote>()

vi.mock('../../bridge/memoNotes', () => ({
  listMemoNoteTree: vi.fn(async () => ({
    entries: [...disk.keys()].map((path) => ({ path, title: path.split('/').at(-1)!.replace('.iwnote', '') })),
    folders: [],
  })),
  readMemoNote: vi.fn(async (_vault: unknown, path: string) => disk.get(path)),
  writeMemoNote: vi.fn(async () => undefined),
  trashMemoNote: vi.fn(async () => undefined),
  renameMemoNote: vi.fn(async () => undefined),
  renameMemoNoteFolder: vi.fn(async () => undefined),
  trashMemoNoteFolder: vi.fn(async () => undefined),
  createMemoNoteFolder: vi.fn(async () => undefined),
  inspectMemoNote: vi.fn(async () => ({ state: 'same' })),
  adoptMemoNoteText: vi.fn(),
  memoNoteCodec: {},
  watchMemoNoteFiles: vi.fn(async () => () => undefined),
  onMemoNotesChanged: vi.fn(async () => () => undefined),
}))
vi.mock('../../bridge/vault', () => ({ subscribeVaultFolder: () => () => undefined }))

const { useMemoNotes } = await import('./useMemoNotes')
const { useFollowMovedMemoNotes, useSyncMemoNoteTabs } = await import('./useMemoNoteTabs')

const A = '노트/A.iwnote'
const B = '노트/B.iwnote'
const vault = { root: 'C:/vault-tabs' } as never
const empty: MemoNote = { version: 1, blocks: [] }
const tab = (id: string, title: string): Tab => ({ id, title, kind: 'memoNote' })
const pdf: Tab = { id: 'doc-a', title: 'A 문서', kind: 'pdf' }

/** App 과 같은 배선: 창 상태 + 노트 저장소 + 탭 따라가기·맞추기 */
function useWorkspace(initial: PanesState) {
  const [panes, setPanes] = useState<PanesState>(initial)
  const follow = useFollowMovedMemoNotes(setPanes)
  const notes = useMemoNotes(vault, [], () => '', () => undefined, follow)
  useSyncMemoNoteTabs(setPanes, notes.loaded, notes.entries)
  return { panes, setPanes, notes }
}

const start = (): PanesState => ({
  left: { tabs: [pdf], activeId: 'doc-a' },
  right: { tabs: [tab(A, 'A'), tab(B, 'B')], activeId: B },
  third: emptyTabs,
  fourth: emptyTabs,
})

describe('메모 노트 탭이 노트 목록을 따라간다', () => {
  beforeEach(() => {
    disk.clear()
    localStorage.clear()
    disk.set(A, empty)
    disk.set(B, empty)
  })

  it('목록을 다 읽기 전에는 복원한 탭을 닫지 않고, 읽은 뒤 사라진 노트의 탭만 닫는다', async () => {
    const initial: PanesState = { ...start(), right: { tabs: [tab(A, 'A'), tab('노트/없어짐.iwnote', '없어짐')], activeId: '노트/없어짐.iwnote' } }
    const { result } = renderHook(() => useWorkspace(initial))
    // 아직 읽는 중: 그대로
    expect(result.current.notes.loaded).toBe(false)
    expect(result.current.panes.right!.tabs.map((t) => t.id)).toEqual([A, '노트/없어짐.iwnote'])
    await waitFor(() => expect(result.current.notes.loaded).toBe(true))
    expect(result.current.panes.right!.tabs.map((t) => t.id)).toEqual([A])
    expect(result.current.panes.right!.activeId).toBe(A)
    expect(result.current.panes.left!.tabs.map((t) => t.id)).toEqual(['doc-a'])
  })

  it('이름을 바꾸면 그 노트의 탭이 새 경로·새 이름으로 따라가고 활성 탭도 유지된다', async () => {
    const { result } = renderHook(() => useWorkspace(start()))
    await waitFor(() => expect(result.current.notes.loaded).toBe(true))
    await act(async () => { await result.current.notes.rename(B, '새 이름') })
    expect(result.current.panes.right!.tabs.map((t) => [t.id, t.title])).toEqual([[A, 'A'], ['노트/새 이름.iwnote', '새 이름']])
    expect(result.current.panes.right!.activeId).toBe('노트/새 이름.iwnote')
  })

  it('폴더로 옮기면 탭이 새 경로로 따라간다', async () => {
    const { result } = renderHook(() => useWorkspace(start()))
    await waitFor(() => expect(result.current.notes.loaded).toBe(true))
    await act(async () => { await result.current.notes.move(A, '노트/회의') })
    expect(result.current.panes.right!.tabs.map((t) => t.id)).toEqual(['노트/회의/A.iwnote', B])
    expect(result.current.panes.right!.tabs[0]!.title).toBe('A')
  })

  it('휴지통으로 보내면 그 노트의 탭이 닫히고 활성 탭은 이웃으로 물러난다', async () => {
    const { result } = renderHook(() => useWorkspace(start()))
    await waitFor(() => expect(result.current.notes.loaded).toBe(true))
    await act(async () => { await result.current.notes.trash(B) })
    expect(result.current.panes.right!.tabs.map((t) => t.id)).toEqual([A])
    expect(result.current.panes.right!.activeId).toBe(A)
  })

  it('같은 노트가 노트 바에 열려 있어도(열린 노트) 탭은 따로 남고, 열린 노트를 지우면 탭도 닫힌다', async () => {
    const { result } = renderHook(() => useWorkspace(start()))
    await waitFor(() => expect(result.current.notes.loaded).toBe(true))
    act(() => result.current.notes.open(B))
    expect(result.current.panes.right!.tabs.map((t) => t.id)).toEqual([A, B])
    await act(async () => { await result.current.notes.trash(B) })
    expect(result.current.panes.right!.tabs.map((t) => t.id)).toEqual([A])
  })
})
