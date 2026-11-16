import { t } from '../i18n'
import { atomicWriteText, scanStorageRecovery } from './storage'
import { createVaultIndexEntry, kindFromPath, parseVaultIndex, type VaultIndexEntry } from '../core/vaultIndex'
import { moveDirectory } from './vaultFiles'
import { readLibrary, readVaultIndex, writeLibrary, writeVaultIndex, type VaultHandle, type VaultLibraryEntry } from './vault'

const TRASH_VERSION = 1
const TRASH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export interface HistorySnapshot {
  id: string
  fileId: string
  path: string
  createdAt: number
  size: number | null
  preview: string | null
}

export interface TrashEntry {
  id: string
  originalPath: string
  trashedPath: string
  deletedAt: string
  /** 휴지통으로 옮긴 화면·동작(진단용). 예전 항목에는 없다 */
  source?: string
  indexEntry?: VaultIndexEntry | null
  /** 폴더를 통째로 지운 항목. 안에 있던 색인·Library 항목을 함께 들고 있다 */
  kind?: 'file' | 'folder'
  indexEntries?: VaultIndexEntry[]
  libraryEntries?: VaultLibraryEntry[]
}

export interface ConflictRecord {
  version: 1
  id: string
  targetPath: string
  currentPath: string
  incomingPath: string
  createdAt: number
  recordPath: string
}

interface TrashFile {
  version: 1
  entries: TrashEntry[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeSegment(value: string, label: string): string {
  if (value.trim() === '' || value === '.' || value === '..' || /[\\/]/u.test(value)) {
    throw new Error(t('{label}이 올바르지 않습니다.', { label: t(label) }))
  }
  return value
}

function pathParts(path: string): string[] {
  const normalized = path.replaceAll('\\', '/')
  const parts = normalized.split('/')
  if (
    normalized === ''
    || normalized.startsWith('/')
    || /^[A-Za-z]:/u.test(normalized)
    || parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(t('Vault 상대 경로가 올바르지 않습니다.'))
  }
  return parts
}

async function joinVault(vault: VaultHandle, path: string): Promise<string> {
  const { join } = await import('@tauri-apps/api/path')
  return join(vault.root, ...pathParts(path))
}

async function metadataPath(vault: VaultHandle, ...parts: string[]): Promise<string> {
  const { join } = await import('@tauri-apps/api/path')
  return join(vault.root, '.iwae', ...parts)
}

export async function hasPendingVaultRecovery(vault: VaultHandle): Promise<boolean> {
  const [journals, conflicts] = await Promise.all([
    scanStorageRecovery(await metadataPath(vault, 'journal')),
    listConflicts(vault),
  ])
  return journals.length > 0 || conflicts.length > 0
}

/** 휴지통 항목 하나를 읽는다. 모양이 틀리면 던진다(호출한 쪽이 그 항목만 건너뛴다) */
function parseTrashEntry(entry: unknown): TrashEntry {
  {
    if (
      !isRecord(entry)
      || typeof entry.id !== 'string'
      || typeof entry.originalPath !== 'string'
      || typeof entry.trashedPath !== 'string'
      || typeof entry.deletedAt !== 'string'
    ) {
      throw new Error(t('휴지통 항목 형식이 올바르지 않습니다.'))
    }
    pathParts(entry.originalPath)
    pathParts(entry.trashedPath)
    const indexEntry = entry.indexEntry === undefined || entry.indexEntry === null
      ? null
      : parseVaultIndex({ version: 1, entries: [entry.indexEntry] }).entries[0] ?? null
    if (indexEntry !== null && indexEntry.id !== entry.id) {
      throw new Error(t('휴지통 항목의 파일 ID가 일치하지 않습니다.'))
    }
    const source = typeof entry.source === 'string' ? { source: entry.source } : {}
    if (entry.kind === 'folder') {
      return {
        ...source,
        id: entry.id,
        kind: 'folder' as const,
        originalPath: entry.originalPath,
        trashedPath: entry.trashedPath,
        deletedAt: entry.deletedAt,
        indexEntry: null,
        indexEntries: Array.isArray(entry.indexEntries)
          ? parseVaultIndex({ version: 1, entries: entry.indexEntries }).entries
          : [],
        // Library 항목은 쓸 때 그대로 되돌려 쓴다. 모양 검사는 readLibrary 가 한다
        libraryEntries: Array.isArray(entry.libraryEntries)
          ? entry.libraryEntries.filter((item): item is VaultLibraryEntry => isRecord(item) && typeof item.docId === 'string')
          : [],
      }
    }
    return {
      ...source,
      id: entry.id,
      originalPath: entry.originalPath,
      trashedPath: entry.trashedPath,
      deletedAt: entry.deletedAt,
      indexEntry,
    }
  }
}

/** 휴지통 인덱스를 읽은 결과: 읽을 수 있는 항목과, 읽지 못해 건너뛴 항목(원래 모양 그대로 — 다시 쓸 때 되돌려 쓴다) */
interface TrashLoad {
  readonly entries: TrashEntry[]
  readonly unreadable: unknown[]
  /** 인덱스 파일 전체를 읽지 못했을 때의 원문. 덮어쓰기 전에 따로 복사해 둔다 */
  readonly damagedText: string | null
}

async function loadTrash(vault: VaultHandle): Promise<TrashLoad> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await trashIndexPath(vault)
  if (!(await exists(path))) return { entries: [], unreadable: [], damagedText: null }
  const text = await readTextFile(path)
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    return { entries: [], unreadable: [], damagedText: text }
  }
  if (!isRecord(value) || value.version !== TRASH_VERSION || !Array.isArray(value.entries)) {
    return { entries: [], unreadable: [], damagedText: text }
  }
  const entries: TrashEntry[] = []
  const unreadable: unknown[] = []
  for (const raw of value.entries) {
    try {
      entries.push(parseTrashEntry(raw))
    } catch {
      unreadable.push(raw)
    }
  }
  return { entries, unreadable, damagedText: null }
}

function legacyTrashIndexEntry(entry: TrashEntry): VaultIndexEntry {
  const name = entry.originalPath.replaceAll('\\', '/').split('/').at(-1) ?? entry.originalPath
  return createVaultIndexEntry({
    id: entry.id,
    kind: kindFromPath(entry.originalPath),
    storage: 'vault',
    path: entry.originalPath,
    displayName: name.replace(/\.[^.]+$/u, ''),
    addedAt: entry.deletedAt,
  })
}

function parseConflict(value: unknown, recordPath: string): ConflictRecord {
  if (
    !isRecord(value)
    || value.version !== 1
    || typeof value.id !== 'string'
    || typeof value.targetPath !== 'string'
    || typeof value.currentPath !== 'string'
    || typeof value.incomingPath !== 'string'
    || typeof value.createdAt !== 'number'
  ) {
    throw new Error(t('충돌 기록 형식이 올바르지 않습니다.'))
  }
  return {
    version: 1,
    id: value.id,
    targetPath: value.targetPath,
    currentPath: value.currentPath,
    incomingPath: value.incomingPath,
    createdAt: value.createdAt,
    recordPath,
  }
}

async function trashIndexPath(vault: VaultHandle): Promise<string> {
  return metadataPath(vault, 'trash', 'index.json')
}

async function writeTrash(vault: VaultHandle, entries: readonly TrashEntry[], load: Pick<TrashLoad, 'unreadable' | 'damagedText'> = { unreadable: [], damagedText: null }): Promise<void> {
  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await trashIndexPath(vault)
  // 인덱스를 통째로 읽지 못했던 것을 덮어쓰기 전에 따로 복사해 둔다
  if (load.damagedText !== null) await writeTextFile(path.replace(/index\.json$/u, `index.unreadable-${Date.now()}.json`), load.damagedText)
  // 읽지 못해 건너뛴 항목은 지우지 않고 그대로 되돌려 쓴다
  await writeTextFile(path, `${JSON.stringify({ version: 1, entries: [...entries, ...load.unreadable] }, null, 2)}\n`)
}

export async function listHistory(vault: VaultHandle, fileId: string): Promise<HistorySnapshot[]> {
  const safeFileId = safeSegment(fileId, '파일 ID')
  const { exists, readDir, readTextFile } = await import('@tauri-apps/plugin-fs')
  const directory = await metadataPath(vault, 'history', safeFileId)
  if (!(await exists(directory))) return []
  const snapshots = await Promise.all((await readDir(directory))
    .filter((entry) => !entry.isDirectory && /^\d+\.bak$/u.test(entry.name))
    .map(async (entry) => {
      const path = `${directory}/${entry.name}`
      try {
        const contents = await readTextFile(path)
        return {
          id: entry.name,
          fileId,
          path,
          createdAt: Number(entry.name.slice(0, -'.bak'.length)),
          size: new TextEncoder().encode(contents).byteLength,
          preview: contents.replace(/\s+/gu, ' ').trim().slice(0, 180),
        }
      } catch {
        return {
          id: entry.name,
          fileId,
          path,
          createdAt: Number(entry.name.slice(0, -'.bak'.length)),
          size: null,
          preview: null,
        }
      }
    }))
  return snapshots.sort((left, right) => right.createdAt - left.createdAt)
}

export async function restoreHistory(
  vault: VaultHandle,
  input: { fileId: string; snapshotId: string; targetPath: string },
): Promise<void> {
  const fileId = safeSegment(input.fileId, '파일 ID')
  const snapshotId = safeSegment(input.snapshotId, '스냅샷 ID')
  if (!/^\d+\.bak$/u.test(snapshotId)) throw new Error(t('스냅샷 ID가 올바르지 않습니다.'))
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  const contents = await readTextFile(await metadataPath(vault, 'history', fileId, snapshotId))
  await atomicWriteText({
    targetPath: input.targetPath,
    contents,
    expectedHash: null,
    journalRoot: await metadataPath(vault, 'journal'),
    historyRoot: await metadataPath(vault, 'history'),
    fileId,
  })
}

export async function listTrash(vault: VaultHandle): Promise<TrashEntry[]> {
  return (await loadTrash(vault)).entries
}

/** 휴지통 목록과, 읽지 못해 건너뛴 항목 수(인덱스 파일을 통째로 못 읽었으면 1) */
export async function listTrashReport(vault: VaultHandle): Promise<{ readonly entries: TrashEntry[]; readonly skipped: number }> {
  const load = await loadTrash(vault)
  return { entries: load.entries, skipped: load.unreadable.length + (load.damagedText === null ? 0 : 1) }
}

export async function restoreTrash(vault: VaultHandle, id: string): Promise<void> {
  const trash = await loadTrash(vault)
  const entries = trash.entries
  const entry = entries.find((candidate) => candidate.id === id)
  if (entry === undefined) throw new Error(t('복원할 휴지통 항목을 찾지 못했습니다.'))
  const index = await readVaultIndex(vault)
  if (index.entries.some((candidate) => candidate.id === id)) {
    throw new Error(t('같은 ID의 Vault 항목이 이미 있습니다.'))
  }
  if (entry.kind === 'folder') {
    const { exists } = await import('@tauri-apps/plugin-fs')
    const target = await joinVault(vault, entry.originalPath)
    if (await exists(target)) throw new Error(t('같은 이름의 폴더가 이미 있어 복원할 수 없습니다.'))
    // 폴더는 Rust 가 옮긴다(디렉터리째 이름 바꾸기가 막히면 파일별로, 없는 윗 폴더도 만든다)
    await moveDirectory(await joinVault(vault, entry.trashedPath), target, vault.root)
    const knownIds = new Set(index.entries.map((candidate) => candidate.id))
    await writeVaultIndex(vault, {
      version: 1,
      entries: [...index.entries, ...(entry.indexEntries ?? []).filter((candidate) => !knownIds.has(candidate.id))],
    })
    const libraryEntries = entry.libraryEntries ?? []
    if (libraryEntries.length > 0) {
      const library = await readLibrary(vault)
      const libraryIds = new Set(library.map((candidate) => candidate.docId))
      await writeLibrary(vault, [...library, ...libraryEntries.filter((candidate) => !libraryIds.has(candidate.docId))])
    }
    await writeTrash(vault, entries.filter((candidate) => candidate.id !== id), trash)
    return
  }
  const restoredEntry = entry.indexEntry ?? legacyTrashIndexEntry(entry)
  const { rename } = await import('@tauri-apps/plugin-fs')
  await rename(
    await joinVault(vault, entry.trashedPath),
    await joinVault(vault, entry.originalPath),
  )
  await writeVaultIndex(vault, { version: 1, entries: [...index.entries, restoredEntry] })
  await writeTrash(vault, entries.filter((candidate) => candidate.id !== id), trash)
}

export async function emptyExpiredTrash(vault: VaultHandle, now: Date): Promise<number> {
  const trash = await loadTrash(vault)
  const entries = trash.entries
  // 지운 시각이 지금보다 뒤인 항목이 있으면 시계가 틀렸다는 뜻이라(autoBackupDue 와 같다: 미래 시각은 믿지 않는다), 아무것도 영구히 지우지 않는다
  if (entries.some((entry) => Date.parse(entry.deletedAt) > now.getTime())) return 0
  const expired = entries.filter((entry) => {
    const deletedAt = Date.parse(entry.deletedAt)
    return Number.isFinite(deletedAt) && deletedAt <= now.getTime() && now.getTime() - deletedAt > TRASH_MAX_AGE_MS
  })
  const { remove } = await import('@tauri-apps/plugin-fs')
  const removed: TrashEntry[] = []
  try {
    for (const entry of expired) {
      await remove(await joinVault(vault, entry.trashedPath))
      removed.push(entry)
    }
  } finally {
    // 중간에 실패해도 이미 지운 항목은 인덱스에서 뺀다(그대로 두면 없는 파일을 가리킨다)
    if (removed.length > 0) await writeTrash(vault, entries.filter((entry) => !removed.includes(entry)), trash)
  }
  return removed.length
}

export async function listConflicts(vault: VaultHandle): Promise<ConflictRecord[]> {
  return (await listConflictsReport(vault)).records
}

/** 충돌 기록 목록과, 읽지 못해 건너뛴 기록 수(0바이트·깨진 파일 하나가 목록 전체를 막지 않게) */
export async function listConflictsReport(vault: VaultHandle): Promise<{ readonly records: ConflictRecord[]; readonly skipped: number }> {
  const { exists, readDir, readTextFile } = await import('@tauri-apps/plugin-fs')
  const directory = await metadataPath(vault, 'conflicts')
  if (!(await exists(directory))) return { records: [], skipped: 0 }
  const records: ConflictRecord[] = []
  let skipped = 0
  for (const entry of await readDir(directory)) {
    if (entry.isDirectory || !entry.name.endsWith('.json')) continue
    const recordPath = `${directory}/${entry.name}`
    try {
      records.push(parseConflict(JSON.parse(await readTextFile(recordPath)) as unknown, recordPath))
    } catch {
      skipped += 1
    }
  }
  return { records: records.sort((left, right) => right.createdAt - left.createdAt), skipped }
}

export async function resolveConflict(
  vault: VaultHandle,
  id: string,
  choice: 'current' | 'incoming' | 'both',
): Promise<void> {
  const conflict = (await listConflicts(vault)).find((record) => record.id === id)
  if (conflict === undefined) throw new Error(t('해결할 충돌 기록을 찾지 못했습니다.'))
  const conflictRoot = (await metadataPath(vault, 'conflicts')).replaceAll('\\', '/')
  for (const path of [conflict.currentPath, conflict.incomingPath, conflict.recordPath]) {
    if (!path.replaceAll('\\', '/').startsWith(`${conflictRoot}/`)) {
      throw new Error(t('충돌 사본 경로가 Vault 밖을 가리킵니다.'))
    }
  }

  const { copyFile, readTextFile, remove } = await import('@tauri-apps/plugin-fs')
  if (choice === 'incoming') {
    await atomicWriteText({
      targetPath: conflict.targetPath,
      contents: await readTextFile(conflict.incomingPath),
      expectedHash: null,
      journalRoot: await metadataPath(vault, 'journal'),
      historyRoot: await metadataPath(vault, 'history'),
      fileId: conflict.id,
    })
  } else if (choice === 'both') {
    await copyFile(conflict.incomingPath, `${conflict.targetPath}.local-conflict-${conflict.id}`)
  }

  await remove(conflict.currentPath)
  await remove(conflict.incomingPath)
  await remove(conflict.recordPath)
}
