import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emptyExpiredTrash,
  hasPendingVaultRecovery,
  listConflicts,
  listHistory,
  listTrash,
  resolveConflict,
  restoreHistory,
  restoreTrash,
} from './vaultRecovery'
import { readLibrary, readVaultIndex, writeLibrary, writeVaultIndex } from './vault'

const fsMocks = vi.hoisted(() => ({
  exists: vi.fn(),
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  copyFile: vi.fn(),
}))
const atomicWriteText = vi.hoisted(() => vi.fn())
const scanStorageRecovery = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/plugin-fs', () => fsMocks)
vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn(async (...parts: string[]) => parts.join('/').replaceAll('//', '/')),
}))
vi.mock('./storage', () => ({ atomicWriteText, scanStorageRecovery }))
vi.mock('./vault', () => ({
  readVaultIndex: vi.fn(),
  readLibrary: vi.fn(),
  writeLibrary: vi.fn(),
  writeVaultIndex: vi.fn(),
}))

const vault = { root: 'C:/Vault' }

describe('vault recovery bridge', () => {
  beforeEach(() => {
    Object.values(fsMocks).forEach((mock) => mock.mockReset())
    atomicWriteText.mockReset()
    scanStorageRecovery.mockReset()
    vi.mocked(readVaultIndex).mockReset()
    vi.mocked(writeVaultIndex).mockReset()
    fsMocks.exists.mockResolvedValue(true)
  })

  it('lists newest history snapshots first and restores through the atomic writer', async () => {
    fsMocks.readDir.mockResolvedValue([
      { name: '1000.bak', isDirectory: false },
      { name: '2000.bak', isDirectory: false },
    ])
    fsMocks.readTextFile.mockResolvedValue('{"version":2}')
    atomicWriteText.mockResolvedValue({ contentHash: 'hash', size: 13, modifiedAt: 3 })

    await expect(listHistory(vault, 'note-1')).resolves.toEqual([
      expect.objectContaining({ id: '2000.bak', createdAt: 2000, size: 13, preview: '{"version":2}' }),
      expect.objectContaining({ id: '1000.bak', createdAt: 1000, size: 13, preview: '{"version":2}' }),
    ])
    await restoreHistory(vault, {
      fileId: 'note-1',
      snapshotId: '2000.bak',
      targetPath: 'C:/Vault/Notes/a.canvas',
    })

    expect(atomicWriteText).toHaveBeenCalledWith(expect.objectContaining({
      fileId: 'note-1',
      targetPath: 'C:/Vault/Notes/a.canvas',
      contents: '{"version":2}',
    }))
  })

  it('detects unfinished journals before the user starts editing', async () => {
    fsMocks.readDir.mockResolvedValue([])
    scanStorageRecovery.mockResolvedValue([{
      transactionId: 'tx-1',
      targetPath: 'C:/Vault/Notes/a.canvas',
    }])

    await expect(hasPendingVaultRecovery(vault)).resolves.toBe(true)
    expect(scanStorageRecovery).toHaveBeenCalledWith('C:/Vault/.iwae/journal')
  })

  it('restores a trashed file to its original path and retains other entries', async () => {
    const restoredEntry = {
      id: 'a', kind: 'canvas' as const, storage: 'vault' as const, path: 'Notes/a.canvas', displayName: 'A',
      contentHash: 'a'.repeat(64), size: 100, modifiedAt: '2026-09-27T00:00:00.000Z',
      addedAt: '2026-09-20T00:00:00.000Z', missing: false,
    }
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({
      version: 1,
      entries: [
        { id: 'a', originalPath: 'Notes/a.canvas', trashedPath: '.iwae/trash/a.canvas', deletedAt: '2026-09-27T00:00:00.000Z', indexEntry: restoredEntry },
        { id: 'b', originalPath: 'Notes/b.canvas', trashedPath: '.iwae/trash/b.canvas', deletedAt: '2026-09-27T00:00:00.000Z' },
      ],
    }))
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [] })

    await restoreTrash(vault, 'a')

    expect(fsMocks.rename).toHaveBeenCalledWith(
      'C:/Vault/.iwae/trash/a.canvas',
      'C:/Vault/Notes/a.canvas',
    )
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      'C:/Vault/.iwae/trash/index.json',
      expect.not.stringContaining('"id": "a"'),
    )
    expect(writeVaultIndex).toHaveBeenCalledWith(vault, { version: 1, entries: [restoredEntry] })
  })

  it('지운 폴더를 원래 자리로 되돌리고 안의 색인·Library 항목을 복원한다', async () => {
    const inner = {
      id: 'pdf-1', kind: 'pdf' as const, storage: 'vault' as const, path: 'Specs/spec.pdf', displayName: 'Spec',
      contentHash: 'a'.repeat(64), size: 100, modifiedAt: null, addedAt: '2026-09-20T00:00:00.000Z', missing: false,
    }
    const libraryEntry = { docId: 'pdf-1', path: 'C:/Vault/Specs/spec.pdf', sha256: 'a'.repeat(64), size: 100, pages: 3, title: 'Spec', addedAt: '2026-09-20T00:00:00.000Z', folderPath: 'Specs' }
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({
      version: 1,
      entries: [{
        id: 'f1', kind: 'folder', originalPath: 'Specs', trashedPath: '.iwae/trash/f1-Specs', deletedAt: '2026-09-27T00:00:00.000Z',
        indexEntries: [inner], libraryEntries: [libraryEntry],
      }],
    }))
    fsMocks.exists.mockImplementation(async (path: string) => path.endsWith('index.json'))
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [] })
    vi.mocked(readLibrary).mockResolvedValue([])

    await restoreTrash(vault, 'f1')

    expect(fsMocks.rename).toHaveBeenCalledWith('C:/Vault/.iwae/trash/f1-Specs', 'C:/Vault/Specs')
    expect(writeVaultIndex).toHaveBeenCalledWith(vault, { version: 1, entries: [inner] })
    expect(writeLibrary).toHaveBeenCalledWith(vault, [libraryEntry])
    expect(fsMocks.writeTextFile).toHaveBeenLastCalledWith(
      'C:/Vault/.iwae/trash/index.json',
      `${JSON.stringify({ version: 1, entries: [] }, null, 2)}\n`,
    )
  })

  it('deletes only trash entries older than 30 days', async () => {
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({
      version: 1,
      entries: [
        { id: 'old', originalPath: 'old.canvas', trashedPath: '.iwae/trash/old.canvas', deletedAt: '2026-08-01T00:00:00.000Z' },
        { id: 'new', originalPath: 'new.canvas', trashedPath: '.iwae/trash/new.canvas', deletedAt: '2026-09-20T00:00:00.000Z' },
      ],
    }))

    await expect(emptyExpiredTrash(vault, new Date('2026-09-27T00:00:00.000Z'))).resolves.toBe(1)
    expect(fsMocks.remove).toHaveBeenCalledWith('C:/Vault/.iwae/trash/old.canvas')
    await expect(listTrash(vault)).resolves.toHaveLength(2)
  })

  it('lists conflict records and can apply the preserved incoming version', async () => {
    fsMocks.readDir.mockResolvedValue([{ name: 'tx-1.json', isDirectory: false }])
    fsMocks.readTextFile.mockImplementation(async (path: string) => (
      path.endsWith('.json') ? JSON.stringify({
        version: 1,
        id: 'tx-1',
        targetPath: 'C:/Vault/Notes/a.canvas',
        currentPath: 'C:/Vault/.iwae/conflicts/tx-1.current',
        incomingPath: 'C:/Vault/.iwae/conflicts/tx-1.incoming',
        createdAt: 1,
      }) : '{"local":true}'
    ))
    atomicWriteText.mockResolvedValue({ contentHash: 'hash', size: 14, modifiedAt: 2 })

    await expect(listConflicts(vault)).resolves.toEqual([
      expect.objectContaining({ id: 'tx-1', targetPath: 'C:/Vault/Notes/a.canvas' }),
    ])
    await resolveConflict(vault, 'tx-1', 'incoming')

    expect(atomicWriteText).toHaveBeenCalledWith(expect.objectContaining({
      targetPath: 'C:/Vault/Notes/a.canvas',
      contents: '{"local":true}',
    }))
    expect(fsMocks.remove).toHaveBeenCalledTimes(3)
  })
})
