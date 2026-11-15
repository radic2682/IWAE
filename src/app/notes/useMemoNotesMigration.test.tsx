// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const files = new Map<string, unknown>()
const writeMemoNote = vi.fn(async (_vault: unknown, path: string, note: unknown) => { files.set(path, note) })
const writeMark = vi.fn(async () => undefined)

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
vi.mock('../../bridge/vault', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../bridge/vault')>()),
  writeVaultRelativeText: writeMark,
}))
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn(async () => false) }))
vi.mock('@tauri-apps/api/path', () => ({ join: async (...parts: string[]) => parts.join('/') }))

const { useMemoNotes } = await import('./useMemoNotes')

const highlight = (id: string) => ({ id, note: '메모', anchor: { docId: 'doc', page: 1, rects: [{ y: 0 }] } })

describe('예전 카테고리 → 노트 옮기기', () => {
  it('이미 노트가 가리키는 형광펜은 옮기지 않아 첫 메모에 같은 이름의 노트가 또 생기지 않는다', async () => {
    files.clear()
    files.set('노트/문서 노트.iwnote', { version: 1, blocks: [{ id: 'b1', kind: 'memo', highlightId: 'h1' }] })
    const vault = { root: 'C:/vault-first' } as never
    renderHook(() => useMemoNotes(vault, [highlight('h1')] as never, () => '문서', () => {}))
    await waitFor(() => expect(writeMark).toHaveBeenCalledTimes(1))
    expect(writeMemoNote).not.toHaveBeenCalled()
  })

  it('노트가 가리키지 않는 옛 형광펜은 노트로 옮긴다', async () => {
    files.clear()
    writeMark.mockClear()
    const vault = { root: 'C:/vault-legacy' } as never
    renderHook(() => useMemoNotes(vault, [highlight('h9')] as never, () => '문서', () => {}))
    await waitFor(() => expect(writeMark).toHaveBeenCalledTimes(1))
    expect(writeMemoNote).toHaveBeenCalledTimes(1)
  })
})
