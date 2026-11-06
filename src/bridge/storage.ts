export interface AtomicWriteRequest {
  targetPath: string
  contents: string
  expectedHash: string | null
  journalRoot: string
  historyRoot: string
  fileId: string
}

export interface WriteReceipt {
  contentHash: string
  size: number
  modifiedAt: number
}

export interface RecoveryRecord {
  version: number
  transactionId: string
  targetPath: string
  temporaryPath: string
  backupPath: string | null
  stage: string
  createdAt: number
  journalPath: string
}

export type RecoveryAction = 'retry' | 'preserve-copy' | 'cancel'

export interface RecoveryResult {
  preservedPath: string | null
}

export async function atomicWriteText(request: AtomicWriteRequest): Promise<WriteReceipt> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<WriteReceipt>('atomic_write_text', { request })
}

export async function scanStorageRecovery(journalRoot: string): Promise<RecoveryRecord[]> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<RecoveryRecord[]>('scan_storage_recovery', { journalRoot })
}

export async function recoverStorageTransaction(
  journalPath: string,
  action: RecoveryAction,
): Promise<RecoveryResult> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<RecoveryResult>('recover_storage_transaction', {
    request: { journalPath, action },
  })
}
