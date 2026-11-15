import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsMocks = vi.hoisted(() => ({ exists: vi.fn(), readDir: vi.fn(), readTextFile: vi.fn() }))
const vaultMocks = vi.hoisted(() => ({
  forgetObservedFile: vi.fn(),
  carryObservedFile: vi.fn(),
  inspectVaultRelativeFile: vi.fn(),
  trackVaultRelativeRead: vi.fn(),
  writeVaultRelativeText: vi.fn(async () => undefined),
  isMissingPathError: (cause: unknown) => /not found|os error 3/iu.test(String(cause)),
}))
vi.mock('@tauri-apps/plugin-fs', () => fsMocks)
vi.mock('@tauri-apps/api/path', () => ({ join: vi.fn(async (...parts: string[]) => parts.join('/')) }))
vi.mock('./vault', () => vaultMocks)

import { listMemoNoteTree, readMemoNote, writeMemoNote } from './memoNotes'
import { EMPTY_MEMO_NOTE } from '../core/memoNote'

const vault = { root: 'C:/Vault' }

describe('memo notes: never overwrite a file this version cannot read', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('refuses to save a note written by a newer version and leaves the file alone', async () => {
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({ version: 2, blocks: [{ id: 'a', kind: 'text', text: 'hi' }] }))
    await readMemoNote(vault, '노트/new.iwnote')
    await expect(writeMemoNote(vault, '노트/new.iwnote', EMPTY_MEMO_NOTE)).rejects.toThrow()
    expect(vaultMocks.writeVaultRelativeText).not.toHaveBeenCalled()
  })

  it('refuses to save when blocks is not an array (the note would open empty)', async () => {
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({ version: 1, blocks: { 0: { id: 'a' } } }))
    await readMemoNote(vault, '노트/odd.iwnote')
    await expect(writeMemoNote(vault, '노트/odd.iwnote', EMPTY_MEMO_NOTE)).rejects.toThrow()
    expect(vaultMocks.writeVaultRelativeText).not.toHaveBeenCalled()
  })

  it('refuses to save over a file that is not JSON, but saves once it reads fine again', async () => {
    fsMocks.readTextFile.mockResolvedValue('{"version":1,"blo')
    await expect(readMemoNote(vault, '노트/cut.iwnote')).rejects.toThrow()
    await expect(writeMemoNote(vault, '노트/cut.iwnote', EMPTY_MEMO_NOTE)).rejects.toThrow()
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({ version: 1, blocks: [] }))
    await readMemoNote(vault, '노트/cut.iwnote')
    await expect(writeMemoNote(vault, '노트/cut.iwnote', EMPTY_MEMO_NOTE)).resolves.toBeUndefined()
    expect(vaultMocks.writeVaultRelativeText).toHaveBeenCalledTimes(1)
  })

  it('lists the other notes when a subfolder disappears while scanning', async () => {
    fsMocks.exists.mockResolvedValue(true)
    fsMocks.readDir.mockImplementation(async (path: string) => {
      if (path.endsWith('gone')) throw new Error('os error 3: not found')
      if (path === 'C:/Vault/노트') return [{ name: 'a.iwnote', isDirectory: false }, { name: 'gone', isDirectory: true }, { name: 'keep', isDirectory: true }]
      if (path.endsWith('keep')) return [{ name: 'b.iwnote', isDirectory: false }]
      return []
    })
    const tree = await listMemoNoteTree(vault)
    expect(tree.entries.map((entry) => entry.path).sort()).toEqual(['노트/a.iwnote', '노트/keep/b.iwnote'])
    expect(tree.folders).toEqual(['노트/keep'])
  })
})
