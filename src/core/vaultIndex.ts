import { t } from '../i18n'

export type VaultFileKind = 'pdf' | 'markdown' | 'canvas' | 'image' | 'other'
export type VaultStorageKind = 'vault' | 'reference'

export interface VaultIndexEntry {
  id: string
  kind: VaultFileKind
  storage: VaultStorageKind
  path: string
  displayName: string
  contentHash: string | null
  size: number | null
  modifiedAt: string | null
  addedAt: string
  missing: boolean
}

export interface VaultIndexFile {
  version: 1
  entries: VaultIndexEntry[]
}

interface IndexedTreeEntry {
  path: string
  isDirectory: boolean
}

interface LegacyPdfEntry {
  docId: string
  path: string
  sha256: string
  size: number
  pages: number
  title: string
  addedAt: string
  folderPath?: string
  attachmentPolicy?: { kind: string; folderPath?: string }
}

interface CreateVaultIndexEntryInput {
  id: string
  kind: VaultFileKind
  storage: VaultStorageKind
  path: string
  displayName?: string
  contentHash?: string | null
  size?: number | null
  modifiedAt?: string | null
  addedAt: string
  missing?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/{2,}/gu, '/')
}

function filename(path: string): string {
  return normalizePath(path).split('/').filter(Boolean).at(-1) ?? path
}

function legacyPdfLocation(legacy: Record<string, unknown>): {
  storage: VaultStorageKind
  path: string
} {
  const policy = isRecord(legacy.attachmentPolicy) && typeof legacy.attachmentPolicy.kind === 'string'
    ? legacy.attachmentPolicy
    : null
  if (policy?.kind !== 'copy-current-folder' && policy?.kind !== 'copy-another-folder') {
    return { storage: 'reference', path: legacy.path as string }
  }
  const folder = typeof legacy.folderPath === 'string'
    ? normalizePath(legacy.folderPath).replace(/^\/+|\/+$/gu, '')
    : typeof policy.folderPath === 'string'
      ? normalizePath(policy.folderPath).replace(/^\/+|\/+$/gu, '')
      : ''
  return {
    storage: 'vault',
    path: [folder, filename(legacy.path as string)].filter(Boolean).join('/'),
  }
}

function isFileKind(value: unknown): value is VaultFileKind {
  return value === 'pdf' || value === 'markdown' || value === 'canvas' || value === 'image' || value === 'other'
}

function isStorageKind(value: unknown): value is VaultStorageKind {
  return value === 'vault' || value === 'reference'
}

function kindFromPath(path: string): VaultFileKind {
  const normalized = path.toLowerCase()
  if (normalized.endsWith('.pdf')) return 'pdf'
  if (normalized.endsWith('.md') || normalized.endsWith('.markdown')) return 'markdown'
  if (normalized.endsWith('.canvas')) return 'canvas'
  if (/\.(?:avif|gif|jpe?g|png|svg|webp)$/u.test(normalized)) return 'image'
  return 'other'
}

export function createVaultIndexEntry(input: CreateVaultIndexEntryInput): VaultIndexEntry {
  // 표시 이름이 없으면 파일 이름에서 확장자를 뗀 것(노트 'a.canvas' → 'a')
  const displayName = (input.displayName ?? filename(input.path).replace(/\.(?:canvas|md|markdown|pdf)$/iu, '')).trim()
  if (input.id.trim() === '') throw new Error(t('Vault 파일 ID가 비어 있습니다.'))
  if (displayName === '') throw new Error(t('Vault 표시 이름이 비어 있습니다.'))
  return {
    id: input.id,
    kind: input.kind,
    storage: input.storage,
    path: normalizePath(input.path),
    displayName,
    contentHash: input.contentHash ?? null,
    size: input.size ?? null,
    modifiedAt: input.modifiedAt ?? null,
    addedAt: input.addedAt,
    missing: input.missing ?? false,
  }
}

function parseEntry(value: unknown): VaultIndexEntry {
  if (!isRecord(value)) throw new Error(t('Vault 인덱스 항목 형식이 올바르지 않습니다.'))
  if (
    typeof value.id !== 'string'
    || !isFileKind(value.kind)
    || !isStorageKind(value.storage)
    || typeof value.path !== 'string'
    || typeof value.displayName !== 'string'
    || (value.contentHash !== null && typeof value.contentHash !== 'string')
    || (value.size !== null && (typeof value.size !== 'number' || !Number.isFinite(value.size)))
    || (value.modifiedAt !== null && typeof value.modifiedAt !== 'string')
    || typeof value.addedAt !== 'string'
    || typeof value.missing !== 'boolean'
  ) {
    throw new Error(t('Vault 인덱스 항목 형식이 올바르지 않습니다.'))
  }
  return createVaultIndexEntry({
    id: value.id,
    kind: value.kind,
    storage: value.storage,
    path: value.path,
    displayName: value.displayName,
    contentHash: value.contentHash,
    size: value.size,
    modifiedAt: value.modifiedAt,
    addedAt: value.addedAt,
    missing: value.missing,
  })
}

export function parseVaultIndex(value: unknown): VaultIndexFile {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)) {
    throw new Error(t('Vault 인덱스 형식을 읽을 수 없습니다.'))
  }
  const entries = value.entries.map(parseEntry)
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new Error(t('Vault 인덱스에 중복 ID가 있습니다.'))
  }
  return { version: 1, entries }
}

export function migrateLibraryToIndex(value: unknown, now: string): VaultIndexFile {
  if (isRecord(value) && value.version === 1 && Array.isArray(value.entries)) {
    return parseVaultIndex(value)
  }
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.documents)) {
    throw new Error(t('library.json 형식을 읽을 수 없습니다.'))
  }
  const entries = Object.values(value.documents).map((legacy) => {
    if (!isRecord(legacy) || typeof legacy.docId !== 'string' || typeof legacy.path !== 'string') {
      throw new Error(t('library.json에 잘못된 문서 항목이 있습니다.'))
    }
    const location = legacyPdfLocation(legacy)
    return createVaultIndexEntry({
      id: legacy.docId,
      kind: kindFromPath(legacy.path),
      storage: location.storage,
      path: location.path,
      displayName: typeof legacy.title === 'string' && legacy.title.trim() !== '' ? legacy.title : undefined,
      contentHash: typeof legacy.sha256 === 'string' ? legacy.sha256 : null,
      size: typeof legacy.size === 'number' && Number.isFinite(legacy.size) ? legacy.size : null,
      modifiedAt: null,
      addedAt: typeof legacy.addedAt === 'string' ? legacy.addedAt : now,
      missing: false,
    })
  })
  return parseVaultIndex({ version: 1, entries })
}

export function reconcileLibraryPdfEntries(
  index: VaultIndexFile,
  libraryEntries: readonly LegacyPdfEntry[],
  now: string,
): VaultIndexFile {
  const parsed = parseVaultIndex(index)
  const libraryById = new Map(libraryEntries.map((entry) => [entry.docId, entry]))
  const entries = parsed.entries.map((entry) => {
    if (entry.kind !== 'pdf') return entry
    const legacy = libraryById.get(entry.id)
    if (legacy === undefined) return entry
    const location = legacyPdfLocation(legacy as unknown as Record<string, unknown>)
    return {
      ...entry,
      storage: location.storage,
      path: normalizePath(location.path),
      contentHash: legacy.sha256,
      size: legacy.size,
      missing: false,
    }
  })
  const knownIds = new Set(entries.map((entry) => entry.id))
  for (const legacy of libraryEntries) {
    if (knownIds.has(legacy.docId)) continue
    const location = legacyPdfLocation(legacy as unknown as Record<string, unknown>)
    entries.push(createVaultIndexEntry({
      id: legacy.docId,
      kind: 'pdf',
      storage: location.storage,
      path: location.path,
      displayName: legacy.title,
      contentHash: legacy.sha256,
      size: legacy.size,
      modifiedAt: null,
      addedAt: legacy.addedAt || now,
      missing: false,
    }))
  }
  return parseVaultIndex({ version: 1, entries })
}

export function renameDisplayName(index: VaultIndexFile, id: string, displayName: string): VaultIndexFile {
  const trimmed = displayName.trim()
  if (trimmed === '') throw new Error(t('표시 이름을 입력하세요.'))
  return {
    version: 1,
    entries: index.entries.map((entry) => entry.id === id ? { ...entry, displayName: trimmed } : entry),
  }
}

export function moveIndexEntry(index: VaultIndexFile, id: string, path: string): VaultIndexFile {
  return {
    version: 1,
    entries: index.entries.map((entry) => entry.id === id ? { ...entry, path: normalizePath(path) } : entry),
  }
}

export function reconcileVaultIndexFiles(
  index: VaultIndexFile,
  treeEntries: readonly IndexedTreeEntry[],
  now: string,
  createId: () => string = () => globalThis.crypto.randomUUID(),
): VaultIndexFile {
  const parsed = parseVaultIndex(index)
  const userFiles = treeEntries
    .filter((entry) => !entry.isDirectory)
    .map((entry) => ({ path: normalizePath(entry.path), kind: kindFromPath(entry.path) }))
    .filter((entry) => entry.kind !== 'pdf')
  const presentPaths = new Set(userFiles.map((entry) => entry.path.toLocaleLowerCase()))
  const indexedPaths = new Set(parsed.entries
    .filter((entry) => entry.storage === 'vault')
    .map((entry) => entry.path.toLocaleLowerCase()))
  const entries = parsed.entries.map((entry) => {
    if (entry.storage !== 'vault' || entry.kind === 'pdf') return entry
    return { ...entry, missing: !presentPaths.has(entry.path.toLocaleLowerCase()) }
  })

  for (const file of userFiles) {
    if (indexedPaths.has(file.path.toLocaleLowerCase())) continue
    entries.push(createVaultIndexEntry({
      id: createId(),
      kind: file.kind,
      storage: 'vault',
      path: file.path,
      addedAt: now,
    }))
  }
  return parseVaultIndex({ version: 1, entries })
}

/**
 * 디스크와 맞추기: Vault 안에 둔 PDF 파일이 사라졌을 때(앱이 꺼진 사이 지웠거나 다른 곳으로 옮김).
 * 하이라이트·메모가 없는 문서는 목록(library.json)·색인에서 지우고, 있는 문서는 목록에 남겨 「찾을 수 없음」으로 보인다.
 * `hasUserData(docId)` 가 true 인 문서만 남긴다. 파일이 돌아오면 다음 맞추기에서 missing 이 풀린다.
 */
export function reconcileMissingVaultPdfs(
  index: VaultIndexFile,
  libraryEntries: readonly LegacyPdfEntry[],
  treeEntries: readonly IndexedTreeEntry[],
  hasUserData: (docId: string) => boolean,
): { index: VaultIndexFile; library: LegacyPdfEntry[]; absentDocIds: string[] } {
  const present = new Set(treeEntries
    .filter((entry) => !entry.isDirectory)
    .map((entry) => normalizePath(entry.path).toLocaleLowerCase()))
  const drop = new Set<string>()
  const absent: string[] = []
  const entries = index.entries.map((entry) => {
    if (entry.kind !== 'pdf' || entry.storage !== 'vault') return entry
    const gone = !present.has(entry.path.toLocaleLowerCase())
    if (gone && !hasUserData(entry.id)) {
      drop.add(entry.id)
      return entry
    }
    if (gone) absent.push(entry.id)
    return entry.missing === gone ? entry : { ...entry, missing: gone }
  }).filter((entry) => !drop.has(entry.id))
  return {
    index: { version: 1, entries },
    library: libraryEntries.filter((entry) => !drop.has(entry.docId)) as LegacyPdfEntry[],
    absentDocIds: absent,
  }
}

/** 문서 목록 항목이 Vault 안 파일이면 그 Vault 상대 경로, Vault 밖을 가리키는(참조) 항목이면 null */
export function libraryEntryVaultPath(entry: LegacyPdfEntry): string | null {
  const location = legacyPdfLocation(entry as unknown as Record<string, unknown>)
  return location.storage === 'vault' ? normalizePath(location.path) : null
}
