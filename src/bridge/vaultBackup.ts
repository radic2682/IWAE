/**
 * 전체 Vault 백업(zip)·복원·휴지통 비우기(Rust `vault_backup`). 대상 Vault 는 Rust 가
 * 들고 있는 열린 Vault 다 — 화면은 저장할 위치만 넘긴다.
 */

export interface BackupEstimate {
  files: number
  bytes: number
  /** 다시 만들 수 있는 검색 색인·캐시 크기 */
  rebuildableBytes: number
}

export interface BackupResult {
  path: string
  files: number
  bytes: number
  archiveBytes: number
  millis: number
}

export interface RestoreResult {
  path: string
  files: number
  bytes: number
}

export interface BackupProgress {
  phase: 'write' | 'restore'
  filesDone: number
  filesTotal: number
  bytesDone: number
  bytesTotal: number
  current: string
}

export interface TrashStats {
  entries: number
  files: number
  bytes: number
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(command, args)
}

export function backupEstimate(includeIndex: boolean): Promise<BackupEstimate> {
  return invoke('vault_backup_estimate', { includeIndex })
}

export function backupCreate(dest: string, includeIndex: boolean): Promise<BackupResult> {
  // zip 안 시각은 현지 시각으로 적는다(getTimezoneOffset 은 UTC−현지라 부호를 뒤집는다)
  return invoke('vault_backup_create', { dest, includeIndex, utcOffsetMinutes: -new Date().getTimezoneOffset() })
}

export function backupRestore(archive: string, dest: string): Promise<RestoreResult> {
  return invoke('vault_backup_restore', { archive, dest })
}

export function backupCancel(): Promise<void> {
  return invoke('vault_backup_cancel')
}

export function trashStats(): Promise<TrashStats> {
  return invoke('vault_trash_stats')
}

export function trashEmpty(): Promise<TrashStats> {
  return invoke('vault_trash_empty')
}

export async function listenBackupProgress(handler: (progress: BackupProgress) => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event')
  return listen<BackupProgress>('vault-backup-progress', (event) => handler(event.payload))
}

export async function revealInFolder(path: string): Promise<void> {
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(path)
}

/** 1536 → "1.5 KB". 사람이 읽는 크기 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** power
  return `${power === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)} ${units[power]}`
}

/** 백업 파일 기본 이름 — `<Vault 폴더 이름>-backup-2026-10-13-1015.zip` */
export function backupFileName(vaultName: string, now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  const safe = vaultName.replace(/[\\/:*?"<>|]+/gu, '_').trim() || 'IWAE-Vault'
  return `${safe}-backup-${stamp}.zip`
}

export interface AutoBackupResult {
  readonly backup: BackupResult
  /** 보관 개수를 넘어 지운 옛 자동 백업 */
  readonly removed: readonly string[]
}

/** 자동 백업 한 번: dir 에 `<Vault>-auto-<stamp>.zip` 을 만들고 자동 백업을 keep 개만 남긴다 */
export function backupAuto(dir: string, stamp: string, keep: number, includeIndex: boolean): Promise<AutoBackupResult> {
  return invoke('vault_backup_auto', { dir, stamp, keep, includeIndex, utcOffsetMinutes: -new Date().getTimezoneOffset() })
}

/** 파일을 클립보드에 「파일」로 올린다(탐색기·메일에 붙여 넣으면 파일이 들어간다) */
export async function copyFileToClipboard(path: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('copy_file_to_clipboard', { path })
}
