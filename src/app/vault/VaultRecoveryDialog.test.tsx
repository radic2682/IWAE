// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VaultRecoveryDialog } from './VaultRecoveryDialog'
import { listConflicts, listHistory, listTrash, resolveConflict, restoreHistory, restoreTrash } from '../../bridge/vaultRecovery'
import { readVaultIndex } from '../../bridge/vault'

const storageMocks = vi.hoisted(() => ({
  scanStorageRecovery: vi.fn(),
  recoverStorageTransaction: vi.fn(),
}))

vi.mock('../../bridge/vaultRecovery', () => ({
  listConflicts: vi.fn(), listHistory: vi.fn(), listTrash: vi.fn(), resolveConflict: vi.fn(), restoreHistory: vi.fn(), restoreTrash: vi.fn(),
}))
vi.mock('../../bridge/vault', () => ({ readVaultIndex: vi.fn() }))
vi.mock('../../bridge/storage', () => storageMocks)
vi.mock('@tauri-apps/api/path', () => ({ join: vi.fn(async (...parts: string[]) => parts.join('/')) }))

describe('VaultRecoveryDialog', () => {
  beforeEach(() => {
    storageMocks.scanStorageRecovery.mockResolvedValue([])
    storageMocks.recoverStorageTransaction.mockResolvedValue({ preservedPath: null })
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [] })
    vi.mocked(listHistory).mockResolvedValue([])
  })

  it('충돌과 휴지통을 보여주고 원본을 지우지 않는 해결 동작을 제공한다', async () => {
    vi.mocked(listConflicts).mockResolvedValue([{
      version: 1, id: 'c1', targetPath: 'C:/Vault/a.canvas', currentPath: 'current', incomingPath: 'incoming',
      createdAt: 1, recordPath: 'record',
    }])
    vi.mocked(listTrash).mockResolvedValue([{ id: 't1', originalPath: 'a.md', trashedPath: '.iwae/trash/a.md', deletedAt: '2026-09-27T00:00:00Z' }])
    vi.mocked(resolveConflict).mockResolvedValue(undefined)
    vi.mocked(restoreTrash).mockResolvedValue(undefined)

    render(<VaultRecoveryDialog vault={{ root: 'C:/Vault' }} />)
    await screen.findByText('C:/Vault/a.canvas')
    fireEvent.click(screen.getByRole('button', { name: '두 버전 모두 보존' }))
    await waitFor(() => expect(resolveConflict).toHaveBeenCalledWith({ root: 'C:/Vault' }, 'c1', 'both'))
    fireEvent.click(screen.getByRole('button', { name: 'a.md 복원' }))
    await waitFor(() => expect(restoreTrash).toHaveBeenCalledWith({ root: 'C:/Vault' }, 't1'))
  })

  it('완료되지 않은 저장을 재시도하거나 사본으로 보존하거나 취소할 수 있다', async () => {
    vi.mocked(listConflicts).mockResolvedValue([])
    vi.mocked(listTrash).mockResolvedValue([])
    storageMocks.scanStorageRecovery
      .mockResolvedValueOnce([{
        version: 1,
        transactionId: 'tx-1',
        targetPath: 'C:/Vault/note.canvas',
        temporaryPath: 'C:/Vault/.iwae-tx-1.tmp',
        backupPath: 'C:/Vault/.iwae-tx-1.bak',
        stage: 'backup-created',
        createdAt: 1,
        journalPath: 'C:/Vault/.iwae/journal/tx-1.json',
      }])
      .mockResolvedValue([])
    storageMocks.recoverStorageTransaction.mockResolvedValue({ preservedPath: null })

    render(<VaultRecoveryDialog vault={{ root: 'C:/Vault' }} />)
    await screen.findByText(/C:\/Vault\/note\.canvas/u)
    fireEvent.click(screen.getByRole('button', { name: '저장 재시도' }))

    await waitFor(() => expect(storageMocks.recoverStorageTransaction).toHaveBeenCalledWith(
      'C:/Vault/.iwae/journal/tx-1.json',
      'retry',
    ))
  })

  it('파일별 버전의 시각·크기·미리보기를 보여주고 현재 파일로 복원한다', async () => {
    vi.mocked(listConflicts).mockResolvedValue([])
    vi.mocked(listTrash).mockResolvedValue([])
    vi.mocked(readVaultIndex).mockResolvedValue({
      version: 1,
      entries: [{
        id: 'note-1', kind: 'canvas', storage: 'vault', path: 'Notes/a.canvas', displayName: 'A note',
        contentHash: null, size: 100, modifiedAt: null, addedAt: '2026-09-27T00:00:00.000Z', missing: false,
      }],
    })
    vi.mocked(listHistory).mockResolvedValue([{
      id: '2000.bak', fileId: 'note-1', path: 'C:/Vault/.iwae/history/note-1/2000.bak',
      createdAt: 2000, size: 18, preview: '{"title":"before"}',
    }])
    vi.mocked(restoreHistory).mockResolvedValue(undefined)

    render(<VaultRecoveryDialog vault={{ root: 'C:/Vault' }} />)
    await screen.findByText('A note')
    expect(screen.getByText('18 B')).toBeDefined()
    expect(screen.getByText('{"title":"before"}')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'A note 버전 복원' }))

    await waitFor(() => expect(restoreHistory).toHaveBeenCalledWith(
      { root: 'C:/Vault' },
      { fileId: 'note-1', snapshotId: '2000.bak', targetPath: 'C:/Vault/Notes/a.canvas' },
    ))
  })
})
