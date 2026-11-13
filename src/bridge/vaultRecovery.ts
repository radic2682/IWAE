import { t } from '../i18n'
import { atomicWriteText, scanStorageRecovery } from './storage'
import { createVaultIndexEntry, parseVaultIndex, type VaultFileKind, type VaultIndexEntry } from '../core/vaultIndex'
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

function parseTrash(value: unknown): TrashFile {
  if (!isRecord(value) || value.version !== TRASH_VERSION || !Array.isArray(value.entries)) {
    throw new Error(t('휴지통 인덱스 형식이 올바르지 않습니다.'))
  }
  const entries = value.entries.map((entry) => {
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
    const indexEntry = entry.indexEntry === undefined
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
  })
  return { version: 1, entries }
}

function kindFromPath(path: string): VaultFileKind {
  const normalized = path.toLowerCase()
  if (normalized.endsWith('.pdf')) return 'pdf'
  if (normalized.endsWith('.md') || normalized.endsWith('.markdown')) return 'markdown'
  if (normalized.endsWith('.canvas')) return 'canvas'
  if (/\.(?:avif|gif|jpe?g|png|svg|webp)$/u.test(normalized)) return 'image'
  return 'other'
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

async function writeTrash(vault: VaultHandle, entries: readonly TrashEntry[]): Promise<void> {
  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  await writeTextFile(
    await trashIndexPath(vault),
    `${JSON.stringify({ version: 1, entries }, null, 2)}\n`,
  )
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
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await trashIndexPath(vault)
  if (!(await exists(path))) return []
  return parseTrash(JSON.parse(await readTextFile(path)) as unknown).entries
}

export async function restoreTrash(vault: VaultHandle, id: string): Promise<void> {
  const entries = await listTrash(vault)
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
    await writeTrash(vault, entries.filter((candidate) => candidate.id !== id))
    return
  }
  const restoredEntry = entry.indexEntry ?? legacyTrashIndexEntry(entry)
  const { rename } = await import('@tauri-apps/plugin-fs')
  await rename(
    await joinVault(vault, entry.trashedPath),
    await joinVault(vault, entry.originalPath),
  )
  await writeVaultIndex(vault, { version: 1, entries: [...index.entries, restoredEntry] })
  await writeTrash(vault, entries.filter((candidate) => candidate.id !== id))
}

export async function emptyExpiredTrash(vault: VaultHandle, now: Date): Promise<number> {
  const entries = await listTrash(vault)
  const expired = entries.filter((entry) => {
    const deletedAt = Date.parse(entry.deletedAt)
    return Number.isFinite(deletedAt) && now.getTime() - deletedAt > TRASH_MAX_AGE_MS
  })
  const { remove } = await import('@tauri-apps/plugin-fs')
  for (const entry of expired) {
    await remove(await joinVault(vault, entry.trashedPath))
  }
  await writeTrash(vault, entries.filter((entry) => !expired.includes(entry)))
  return expired.length
}

export async function listConflicts(vault: VaultHandle): Promise<ConflictRecord[]> {
  const { exists, readDir, readTextFile } = await import('@tauri-apps/plugin-fs')
  const directory = await metadataPath(vault, 'conflicts')
  if (!(await exists(directory))) return []
  const records: ConflictRecord[] = []
  for (const entry of await readDir(directory)) {
    if (entry.isDirectory || !entry.name.endsWith('.json')) continue
    const recordPath = `${directory}/${entry.name}`
    records.push(parseConflict(JSON.parse(await readTextFile(recordPath)) as unknown, recordPath))
  }
  return records.sort((left, right) => right.createdAt - left.createdAt)
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
