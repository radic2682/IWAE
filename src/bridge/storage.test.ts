// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { atomicWriteText, recoverStorageTransaction, scanStorageRecovery } from './storage'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

afterEach(() => {
  invoke.mockReset()
})

describe('storage bridge', () => {
  it('passes an expected revision and storage roots to the atomic writer', async () => {
    invoke.mockResolvedValue({ contentHash: 'next', size: 4, modifiedAt: 1 })
    const request = {
      targetPath: 'C:/Vault/note.canvas',
      contents: 'next',
      expectedHash: 'prior',
      journalRoot: 'C:/Vault/.iwae/journal',
      historyRoot: 'C:/Vault/.iwae/history',
      fileId: 'note-1',
    }

    await expect(atomicWriteText(request)).resolves.toMatchObject({ contentHash: 'next' })
    expect(invoke).toHaveBeenCalledWith('atomic_write_text', { request })
  })

  it('reads unfinished storage transactions', async () => {
    invoke.mockResolvedValue([{ transactionId: 'tx-1', stage: 'temporary-written' }])

    await expect(scanStorageRecovery('C:/Vault/.iwae/journal')).resolves.toHaveLength(1)
    expect(invoke).toHaveBeenCalledWith('scan_storage_recovery', {
      journalRoot: 'C:/Vault/.iwae/journal',
    })
  })

  it('requests an explicit recovery action for an unfinished transaction', async () => {
    invoke.mockResolvedValue({ preservedPath: null })

    await expect(recoverStorageTransaction('C:/Vault/.iwae/journal/tx-1.json', 'retry'))
      .resolves.toEqual({ preservedPath: null })
    expect(invoke).toHaveBeenCalledWith('recover_storage_transaction', {
      request: {
        journalPath: 'C:/Vault/.iwae/journal/tx-1.json',
        action: 'retry',
      },
    })
  })
})
