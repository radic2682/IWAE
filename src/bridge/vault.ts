import { EMPTY_PDF_OVERLAYS, parsePdfOverlays, type PdfOverlaysFile } from '../core/pdfOverlays'
import { EMPTY_VERSION_GROUPS, parseVersionGroups, type VersionGroupsFile } from '../core/versionGroups'
import { EMPTY_DOC_SOURCES, parseDocSources, type DocSourcesFile } from '../core/docSources'
import { EMPTY_BIBLIOGRAPHY, parseBibliographyFile, type BibliographyFile } from '../core/bibliography'
import { errorText } from '../core/errorText'
import { parseTranslationCache, serializeTranslationCache, type TranslationCacheEntry } from '../core/translationCache'
import { VaultFileSync, isMergeableVaultPath, normalizeSyncKey, type DiskInspection, type RemoteChange, type SyncCodec, type VaultWriteMessage, type WriteTicket } from '../core/vaultSync'
import { emptyCanvasDoc, serializeCanvasDoc } from '../core/canvasSerialize'
import { parseCanvasDocument, type CanvasDocument, type CanvasDocumentV2 } from '../core/canvasDocument'
import type { SessionState } from '../core/session'
import {
  createVaultIndexEntry,
  libraryEntryVaultPath,
  migrateLibraryToIndex,
  parseVaultIndex,
  type VaultIndexEntry,
  type VaultIndexFile,
} from '../core/vaultIndex'
import { parseVaultMetadata, type VaultMetadata } from '../core/vaultMetadata'
import {
  emptyVaultSearchTextCache,
  parseVaultSearchTextCache,
  type VaultSearchTextCache,
} from '../core/vaultSearchCache'
import { parsePdfBookmarks, pdfBookmarkFile, type PdfBookmark } from '../core/pdfBookmarks'
import { parseUserBlockPresets, userBlockPresetFile, type UserBlockPreset } from '../core/blockPresets'
import type { PdfAttachmentPolicy, VaultTreeEntry, VaultTreeOrder } from '../core/vaultTree'
import {
  parsePersistentPdfHighlights,
  persistentPdfHighlightFile,
  type PersistentPdfHighlight,
} from '../pdf/persistentHighlight'
import {
  markdownHighlightFile,
  parsePersistentMarkdownHighlights,
  type PersistentMarkdownHighlight,
} from '../core/markdownHighlight'
import { openPdf } from './pdf'
import { atomicWriteText } from './storage'
import { currentWindowLabel, isDesktop } from './window'
import { t } from '../i18n'

const REGISTRY_VERSION = 1
const TREE_ORDER_VERSION = 1
const MAX_RECENT_VAULTS = 10

async function sha256Text(contents: string): Promise<string> {
  const bytes = new TextEncoder().encode(contents)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface VaultLibraryEntry {
  docId: string
  path: string
  sha256: string
  size: number
  pages: number
  title: string
  addedAt: string
  folderPath?: string
  attachmentPolicy?: PdfAttachmentPolicy
}

export interface PdfAttachmentPayload {
  sourcePath: string
  title: string
  pages: number
  policy: PdfAttachmentPolicy
}

export interface VaultHandle {
  root: string
}

interface LibraryFile {
  version: number
  documents: Record<string, VaultLibraryEntry>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLibraryEntry(value: unknown): value is VaultLibraryEntry {
  if (!isRecord(value)) return false
  return (
    typeof value.docId === 'string' &&
    typeof value.path === 'string' &&
    typeof value.sha256 === 'string' &&
    typeof value.size === 'number' &&
    Number.isFinite(value.size) &&
    typeof value.pages === 'number' &&
    Number.isFinite(value.pages) &&
    typeof value.title === 'string' &&
    typeof value.addedAt === 'string' &&
    (value.folderPath === undefined || typeof value.folderPath === 'string') &&
    (value.attachmentPolicy === undefined || isPdfAttachmentPolicy(value.attachmentPolicy))
  )
}

function isPdfAttachmentPolicy(value: unknown): value is PdfAttachmentPolicy {
  if (!isRecord(value) || typeof value.kind !== 'string') return false
  if (value.kind === 'reference') return true
  return (
    (value.kind === 'copy-current-folder' || value.kind === 'copy-another-folder')
    && typeof value.folderPath === 'string'
  )
}

async function iwaePath(vault: VaultHandle, name: string): Promise<string> {
  const { join } = await import('@tauri-apps/api/path')
  return name === '' ? join(vault.root, '.iwae') : join(vault.root, '.iwae', name)
}

/**
 * 파일 저장·창 사이 동기화(core/vaultSync). 같은 파일에 저장이 겹치면(예: MCP 가 메모를 잇달아 추가)
 * 파일마다 차례로 쓰고, 다른 창이 먼저 고친 내용은 지우지 않고 합쳐서 쓴다.
 */
const VAULT_WRITTEN_EVENT = 'iwae:vault-written'

async function atomicWriteForSync(path: string, contents: string, expectedHash: string | null, fileId: string, root: string, preserveConflict: boolean): Promise<string> {
  if (isDesktop()) {
    const { join } = await import('@tauri-apps/api/path')
    const receipt = await atomicWriteText({
      targetPath: path,
      contents,
      expectedHash,
      journalRoot: await join(root, '.iwae', 'journal'),
      historyRoot: await join(root, '.iwae', 'history'),
      fileId,
      // 기본(true)이면 요청에 싣지 않는다(예전 요청 모양 그대로)
      ...(preserveConflict ? {} : { preserveConflict: false }),
    })
    return receipt.contentHash
  }
  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  await writeTextFile(path, contents)
  return sha256Text(contents)
}

let sessionWriterAllowed = true

/** session.json(탭·패널 배치)은 메인 창만 쓴다. 떼어 낸 창·새 창은 자기 배치를 메모리에만 둔다 */
export function setSessionWriter(allowed: boolean): void {
  sessionWriterAllowed = allowed
}

let activeVaultRoot: string | null = null

const fileSync = new VaultFileSync({
  readText: async (path) => {
    const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
    if (!(await exists(path))) return null
    const text = await readTextFile(path)
    return typeof text === 'string' ? text : null
  },
  atomicWrite: atomicWriteForSync,
  sha256: sha256Text,
  broadcast: (message) => {
    if (!isDesktop()) return
    void import('@tauri-apps/api/event')
      .then(({ emit }) => emit(VAULT_WRITTEN_EVENT, message))
      .catch(() => undefined)
  },
  isConflict: (error) => /conflict|충돌/iu.test(errorText(error)),
}, currentWindowLabel())

let syncListening = false
/** 다른 창의 저장 알림을 듣는다(한 번만). Vault 를 열 때 부른다 */
async function ensureSyncListener(root: string): Promise<void> {
  activeVaultRoot = root
  if (syncListening || !isDesktop()) return
  syncListening = true
  try {
    const { listen } = await import('@tauri-apps/api/event')
    await listen<VaultWriteMessage>(VAULT_WRITTEN_EVENT, (event) => {
      const message = event.payload
      if (activeVaultRoot === null || normalizeSyncKey(message.root) !== normalizeSyncKey(activeVaultRoot)) return
      void fileSync.receive(message).catch(() => undefined)
    })
  } catch {
    syncListening = false
  }
}

function writeVaultFile(
  vault: VaultHandle,
  targetPath: string,
  contents: string,
  fileId: string,
  ticket?: WriteTicket,
): Promise<void> {
  return fileSync.write(targetPath, contents, fileId, {
    mergeable: isDesktop() && isMergeableVaultPath(vault.root, targetPath),
    root: vault.root,
    ...(ticket === undefined ? {} : { ticket }),
  })
}

/** .iwae 안 파일의 동기 키(경로를 비동기로 만들기 전에 저장 요청의 바탕을 잡는 데 쓴다) */
function iwaeKey(vault: VaultHandle, name: string): string {
  return `${vault.root}/.iwae/${name}`
}

/**
 * .iwae 의 JSON 파일을 쓴다. 내용을 만든 직후(동기)에 저장 요청의 바탕을 잡고, 그다음에 폴더·경로를 준비한다 —
 * 요청이 기다리는 사이 다른 창의 변경이 합쳐져도 이 요청은 자기 바탕으로 병합된다.
 */
function writeIwaeFile(vault: VaultHandle, name: string, contents: string, fileId: string): Promise<void> {
  const key = iwaeKey(vault, name)
  const mergeable = isDesktop() && isMergeableVaultPath(vault.root, key)
  const ticket = mergeable ? fileSync.beginWrite(key, contents) : undefined
  // 줄에 서는 것도 지금(동기)이다. 폴더·경로 준비(IPC)를 먼저 기다리면 요청이 줄에 서는 순서가 뒤바뀌어
  // 앞선 저장의 바탕과 디스크가 어긋난다(여러 번 잇달아 지울 때 지운 항목이 되살아나던 까닭)
  return fileSync.enqueue(key, async () => {
    const { mkdir } = await import('@tauri-apps/plugin-fs')
    await mkdir(await iwaePath(vault, ''), { recursive: true })
    await fileSync.writeNow(await iwaePath(vault, name), contents, fileId, { mergeable, root: vault.root, ...(ticket === undefined ? {} : { ticket }) })
  })
}

/** 읽은 내용을 이 창이 아는 디스크 내용으로 기억한다(다음 저장의 병합 바탕). 읽지 못했거나 깨졌으면 부르지 않는다 */
function trackRead(path: string, text: string | null): void {
  if (isDesktop()) fileSync.observeRead(path, text)
}

/** Vault 안 상대 경로의 글 파일을 저널 원자 쓰기로 저장한다(메모 노트 등) */
export function writeVaultRelativeText(
  vault: VaultHandle,
  relativePath: string,
  contents: string,
  options: { readonly guardExternalChange?: boolean } = {},
): Promise<void> {
  const parts = relativePath.replaceAll('\\', '/').split('/').filter((part) => part !== '')
  if (parts.length === 0 || parts.some((part) => part === '..' || part === '.')) return Promise.reject(new Error(t('Vault 상대 경로가 올바르지 않습니다.')))
  const key = `${vault.root}/${parts.join('/')}`
  const mergeable = isDesktop() && isMergeableVaultPath(vault.root, key)
  const ticket = mergeable ? fileSync.beginWrite(key, contents) : undefined
  // writeIwaeFile 과 같다: 줄에 서는 순서를 요청 순서와 맞춘다
  return fileSync.enqueue(key, async () => {
    const { join } = await import('@tauri-apps/api/path')
    const { mkdir } = await import('@tauri-apps/plugin-fs')
    const directory = await join(vault.root, ...parts.slice(0, -1))
    await mkdir(directory, { recursive: true })
    const target = await join(vault.root, ...parts)
    // 다른 프로그램(AI 에이전트·동기화 도구·git)이 파일을 먼저 고쳤으면 쓰지 않는다: 호출한 쪽이 되읽기·충돌 선택으로 이어 간다
    if (options.guardExternalChange === true && isDesktop()) await fileSync.guardWrite(target)
    await fileSync.writeNow(target, contents, `vault:${parts.join('/')}`, { mergeable, root: vault.root, ...(ticket === undefined ? {} : { ticket }) })
  })
}

/** 파일의 디스크 내용을 이 창이 마지막으로 읽거나 쓴 내용과 견준다 */
export async function inspectVaultRelativeFile(vault: VaultHandle, relativePath: string): Promise<DiskInspection> {
  const { join } = await import('@tauri-apps/api/path')
  return fileSync.inspect(await join(vault.root, ...relativePath.replaceAll('\\', '/').split('/').filter((part) => part !== '')))
}

/** 메모 노트처럼 Vault 상대 경로 파일을 읽었다(병합 바탕으로 기억) */
export function trackVaultRelativeRead(vault: VaultHandle, relativePath: string, text: string | null): void {
  trackRead(`${vault.root}/${relativePath.replaceAll('\\', '/')}`, text)
}

/**
 * 앱이 옮기거나(휴지통·이름 바꾸기) 지운 파일의 「마지막으로 쓴 내용」 기억을 지운다. 남겨 두면 같은 이름으로
 * 새로 쓸 때 「앱이 쓴 뒤 밖에서 바뀌었다(없어졌다)」로 보고 저장 대신 충돌 기록만 남긴다
 * (노트를 지운 뒤 「새 노트」를 다시 만들면 만들어지지 않던 까닭).
 */
export function forgetObservedFile(absolutePath: string): void {
  fileSync.forget(absolutePath)
}

/**
 * 디스크의 파일이 이 앱이 마지막으로 쓴 내용과 같은가. 파일 감시는 앱 자신의 저장도 알려 오므로,
 * 저장 중에 또 고친 파일(예: MCP 가 잇달아 고친 캔버스)을 '외부 변경 충돌'로 오인하지 않게 쓴다.
 */
export async function isOwnLatestWrite(vault: VaultHandle, relativePath: string): Promise<boolean> {
  const { join } = await import('@tauri-apps/api/path')
  const path = await join(vault.root, ...relativePath.replaceAll('\\', '/').split('/'))
  const expected = fileSync.observedHash(path)
  if (expected === undefined) return false
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    return await sha256Text(await readTextFile(path)) === expected
  } catch {
    return false
  }
}

/**
 * .iwae 의 JSON 파일을 다른 창이 고치면 알려 준다. 받은 쪽은 rebase(지금 상태) 로 남의 변경을 얹은 새 상태를 얻는다
 * (저장은 하지 않는다 — 알림이 되돌아 울리지 않게). 돌려주는 함수로 끊는다.
 */
export function subscribeVaultFile<T>(
  vault: VaultHandle,
  name: string,
  codec: SyncCodec<T>,
  onRemote: (rebase: (local: T) => T) => void,
): () => void {
  if (!isDesktop()) return () => undefined
  void ensureSyncListener(vault.root)
  return fileSync.subscribe(iwaeKey(vault, name), (change) => onRemote((local) => change.rebase(local, codec)))
}

/** Vault 안 폴더(예: 메모 노트 폴더) 아래 파일의 변경을 듣는다. 받은 쪽에 상대 경로와 rebase 를 준다 */
export function subscribeVaultFolder(
  vault: VaultHandle,
  folder: string,
  onRemote: (relativePath: string, change: RemoteChange) => void,
): () => void {
  if (!isDesktop()) return () => undefined
  void ensureSyncListener(vault.root)
  const root = `${vault.root.replaceAll('\\', '/').replace(/\/+$/u, '')}/`
  return fileSync.subscribePrefix(`${vault.root}/${folder}`, (change) => {
    const normalized = change.path.replaceAll('\\', '/')
    const relative = normalized.toLocaleLowerCase().startsWith(root.toLocaleLowerCase()) ? normalized.slice(root.length) : normalized
    onRemote(relative, change)
  })
}

async function recentVaultsPath(): Promise<string> {
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  return join(await appDataDir(), 'recent-vaults.json')
}

function parseLibrary(raw: unknown): VaultLibraryEntry[] {
  if (!isRecord(raw) || raw.version !== REGISTRY_VERSION || !isRecord(raw.documents)) {
    throw new Error(t('library.json 형식을 읽을 수 없습니다.'))
  }

  const entries = Object.values(raw.documents)
  if (!entries.every(isLibraryEntry)) {
    throw new Error(t('library.json에 잘못된 문서 항목이 있습니다.'))
  }
  return entries.sort((left, right) => left.addedAt.localeCompare(right.addedAt))
}

function libraryFile(entries: readonly VaultLibraryEntry[]): LibraryFile {
  const documents: Record<string, VaultLibraryEntry> = {}
  for (const entry of [...entries].sort((left, right) => left.docId.localeCompare(right.docId))) {
    documents[entry.docId] = entry
  }
  return { version: REGISTRY_VERSION, documents }
}

/** Vault 폴더를 고르게 한다. `defaultPath` 를 주면 그 폴더에서 선택 창이 열린다 */
export async function pickVaultFolder(defaultPath?: string): Promise<string | null> {
  if (!isDesktop()) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({ directory: true, multiple: false, recursive: true, ...(defaultPath === undefined ? {} : { defaultPath }) })
  return typeof selected === 'string' ? selected : null
}

export async function openVault(root: string): Promise<VaultHandle> {
  const { exists, mkdir } = await import('@tauri-apps/plugin-fs')
  if (!(await exists(root))) throw new Error(t('Vault 폴더를 찾을 수 없습니다: {root}', { root }))

  const vault = { root }
  await mkdir(await iwaePath(vault, ''), { recursive: true })
  void ensureSyncListener(root)
  return vault
}

export async function readLibrary(vault: VaultHandle): Promise<VaultLibraryEntry[]> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'library.json')
  if (!(await exists(path))) {
    trackRead(path, null)
    return []
  }

  try {
    const text = await readTextFile(path)
    const parsed = parseLibrary(JSON.parse(text) as unknown)
    trackRead(path, text)
    return parsed
  } catch (err) {
    throw new Error(t('문서 목록을 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeLibrary(
  vault: VaultHandle,
  entries: readonly VaultLibraryEntry[],
): Promise<void> {
  const content = `${JSON.stringify(libraryFile(entries), null, 2)}\n`
  await writeIwaeFile(vault, 'library.json', content, 'metadata:library.json')
}

async function preserveDamagedMetadata(
  vault: VaultHandle,
  name: string,
  contents: string,
): Promise<void> {
  const { join } = await import('@tauri-apps/api/path')
  const { mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs')
  const directory = await iwaePath(vault, 'conflicts/diagnostics')
  await mkdir(directory, { recursive: true })
  await writeTextFile(await join(directory, `${name}-${Date.now()}.json`), contents)
}

const LEGACY_METADATA_FILES = [
  'library.json',
  'tree-order.json',
  'session.json',
  'highlights.json',
  'bookmarks.json',
  'block-presets.json',
  'metadata.json',
] as const

async function preserveLegacyMetadata(vault: VaultHandle): Promise<void> {
  const { copyFile, exists, mkdir } = await import('@tauri-apps/plugin-fs')
  const directory = await iwaePath(vault, 'history/migrations/v1')
  await mkdir(directory, { recursive: true })
  for (const name of LEGACY_METADATA_FILES) {
    const source = await iwaePath(vault, name)
    const destination = await iwaePath(vault, `history/migrations/v1/${name}`)
    if (await exists(source) && !(await exists(destination))) {
      await copyFile(source, destination)
    }
  }
}

export async function readVaultIndex(vault: VaultHandle): Promise<VaultIndexFile> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'index.json')
  if (await exists(path)) {
    const contents = await readTextFile(path)
    try {
      const parsed = parseVaultIndex(JSON.parse(contents) as unknown)
      trackRead(path, contents)
      return parsed
    } catch {
      await preserveDamagedMetadata(vault, 'index', contents)
    }
  }

  const libraryPath = await iwaePath(vault, 'library.json')
  if (!(await exists(libraryPath))) return { version: 1, entries: [] }
  try {
    await preserveLegacyMetadata(vault)
    const index = migrateLibraryToIndex(
      JSON.parse(await readTextFile(libraryPath)) as unknown,
      new Date().toISOString(),
    )
    await writeVaultIndex(vault, index)
    return index
  } catch (err) {
    throw new Error(t('Vault 인덱스를 마이그레이션하지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeVaultIndex(vault: VaultHandle, index: VaultIndexFile): Promise<void> {
  const parsed = parseVaultIndex(index)
  const ordered: VaultIndexFile = {
    version: 1,
    entries: [...parsed.entries].sort((left, right) => left.id.localeCompare(right.id)),
  }
  await writeIwaeFile(vault, 'index.json', `${JSON.stringify(ordered, null, 2)}\n`, 'metadata:index.json')
}

export async function readVaultMetadata(vault: VaultHandle): Promise<VaultMetadata> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'metadata.json')
  if (!(await exists(path))) {
    trackRead(path, null)
    return parseVaultMetadata(null)
  }
  try {
    const text = await readTextFile(path)
    const parsed = parseVaultMetadata(JSON.parse(text) as unknown)
    trackRead(path, text)
    return parsed
  } catch (err) {
    throw new Error(t('Vault 설정을 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeVaultMetadata(vault: VaultHandle, metadata: VaultMetadata): Promise<void> {
  await writeIwaeFile(vault, 'metadata.json', `${JSON.stringify(parseVaultMetadata(metadata), null, 2)}\n`, 'metadata:metadata.json')
}

export async function readVaultSearchTextCache(vault: VaultHandle): Promise<VaultSearchTextCache> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'cache/search-text.json')
  if (!(await exists(path))) return emptyVaultSearchTextCache()
  try {
    return parseVaultSearchTextCache(JSON.parse(await readTextFile(path)) as unknown)
  } catch {
    return emptyVaultSearchTextCache()
  }
}

export async function writeVaultSearchTextCache(
  vault: VaultHandle,
  cache: VaultSearchTextCache,
): Promise<void> {
  // 다시 만들 수 있는 캐시라 저널·버전 기록(이전본 백업)을 거치지 않는다. 예전에는 문서 하나를
  // 뽑을 때마다 수 MB 짜리 이전본이 history 에 쌓였다(50개까지). 들여쓰기도 하지 않는다.
  const parsed = parseVaultSearchTextCache(cache)
  const contents = JSON.stringify(parsed)
  if (!isDesktop()) {
    await writeVaultFile(vault, await iwaePath(vault, 'cache/search-text.json'), contents, 'cache:search-text.json')
    return
  }
  const { mkdir, writeTextFile, rename } = await import('@tauri-apps/plugin-fs')
  await mkdir(await iwaePath(vault, 'cache'), { recursive: true })
  const target = await iwaePath(vault, 'cache/search-text.json')
  const temporary = await iwaePath(vault, 'cache/search-text.json.tmp')
  await writeTextFile(temporary, contents)
  await rename(temporary, target)
}

export async function addToLibrary(
  vault: VaultHandle,
  doc: { path: string; title: string; pages: number },
): Promise<VaultLibraryEntry> {
  const meta = await openPdf(doc.path)
  const entries = await readLibrary(vault)
  const existing = entries.find((entry) => entry.sha256 === meta.sha256)
  if (existing !== undefined) return existing

  const entry: VaultLibraryEntry = {
    docId: meta.docId,
    path: doc.path,
    sha256: meta.sha256,
    size: meta.size,
    pages: doc.pages,
    title: doc.title,
    addedAt: new Date().toISOString(),
  }
  await writeLibrary(vault, [...entries, entry])
  return entry
}

function validatedFolderPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '')
  const parts = normalized === '' ? [] : normalized.split('/')
  if (parts.some((part) => (
    part === ''
    || part === '.'
    || part === '..'
    || /[<>:"|?*]/u.test(part)
  ))) {
    throw new Error(t('PDF를 복사할 vault 폴더 경로가 올바르지 않습니다.'))
  }
  return parts.join('/')
}

function sourceFilename(path: string): string {
  const filename = path.replaceAll('\\', '/').split('/').at(-1)
  if (filename === undefined || filename.length === 0) {
    throw new Error(t('PDF 파일 이름을 확인할 수 없습니다.'))
  }
  return filename
}

export async function attachPdfToLibrary(
  vault: VaultHandle,
  payload: PdfAttachmentPayload,
): Promise<VaultLibraryEntry> {
  const requestedFolderPath = payload.policy.kind === 'reference'
    ? undefined
    : validatedFolderPath(payload.policy.folderPath)
  const meta = await openPdf(payload.sourcePath)
  const entries = await readLibrary(vault)
  const existing = entries.find((entry) => entry.sha256 === meta.sha256)
  if (existing !== undefined) return existing

  let path = payload.sourcePath
  let folderPath = requestedFolderPath
  if (payload.policy.kind !== 'reference') {
    const targetFolderPath = requestedFolderPath ?? ''
    const { join } = await import('@tauri-apps/api/path')
    const { copyFile, exists, mkdir } = await import('@tauri-apps/plugin-fs')
    const directory = targetFolderPath === ''
      ? vault.root
      : await join(vault.root, ...targetFolderPath.split('/'))
    folderPath = targetFolderPath
    path = await join(directory, sourceFilename(payload.sourcePath))
    if (await exists(path)) throw new Error(t('대상 폴더에 같은 이름의 PDF가 이미 있습니다.'))
    await mkdir(directory, { recursive: true })
    await copyFile(payload.sourcePath, path)
  }

  const entry: VaultLibraryEntry = {
    docId: meta.docId,
    path,
    sha256: meta.sha256,
    size: meta.size,
    pages: payload.pages,
    title: payload.title,
    addedAt: new Date().toISOString(),
    folderPath,
    attachmentPolicy: payload.policy,
  }
  await writeLibrary(vault, [...entries, entry])
  return entry
}

function normalizedReferencePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/{2,}/gu, '/').toLocaleLowerCase()
}

export async function attachMarkdownReference(
  vault: VaultHandle,
  sourcePath: string,
): Promise<VaultIndexEntry> {
  if (!/\.(?:md|markdown)$/iu.test(sourcePath) || /[\\/]$/u.test(sourcePath)) {
    throw new Error(t('Markdown 파일 경로가 올바르지 않습니다.'))
  }

  const index = await readVaultIndex(vault)
  const normalized = normalizedReferencePath(sourcePath)
  const existing = index.entries.find((entry) => (
    entry.kind === 'markdown'
    && entry.storage === 'reference'
    && normalizedReferencePath(entry.path) === normalized
  ))
  if (existing !== undefined) return existing

  const { readTextFile, stat } = await import('@tauri-apps/plugin-fs')
  const contents = await readTextFile(sourcePath)
  const info = await stat(sourcePath).catch(() => null)
  const entry = createVaultIndexEntry({
    id: globalThis.crypto.randomUUID(),
    kind: 'markdown',
    storage: 'reference',
    path: sourcePath,
    displayName: sourceFilename(sourcePath),
    contentHash: await sha256Text(contents),
    size: info?.size ?? null,
    modifiedAt: info?.mtime?.toISOString() ?? null,
    addedAt: new Date().toISOString(),
  })
  await writeVaultIndex(vault, { version: 1, entries: [...index.entries, entry] })
  return entry
}

export async function readVaultTreeOrder(vault: VaultHandle): Promise<Record<string, string[]>> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'tree-order.json')
  if (!(await exists(path))) {
    trackRead(path, null)
    return {}
  }
  try {
    const text = await readTextFile(path)
    const raw: unknown = JSON.parse(text)
    if (!isRecord(raw) || raw.version !== TREE_ORDER_VERSION || !isRecord(raw.parents)) {
      throw new Error(t('트리 순서 형식이 올바르지 않습니다.'))
    }
    const parents: Record<string, string[]> = {}
    for (const [parentPath, ids] of Object.entries(raw.parents)) {
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
        throw new Error(t('트리 순서 항목이 올바르지 않습니다.'))
      }
      parents[parentPath] = [...new Set(ids)]
    }
    trackRead(path, text)
    return parents
  } catch (err) {
    throw new Error(t('트리 순서를 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeVaultTreeOrder(
  vault: VaultHandle,
  order: VaultTreeOrder,
): Promise<void> {
  const parents = Object.fromEntries(Object.entries(order)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([parentPath, ids]) => [parentPath, [...new Set(ids)]]))
  await writeIwaeFile(vault, 'tree-order.json', `${JSON.stringify({ version: TREE_ORDER_VERSION, parents }, null, 2)}
`, 'metadata:tree-order.json')
}

export async function recentVaults(): Promise<readonly string[]> {
  if (!isDesktop()) return []
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await recentVaultsPath()
  if (!(await exists(path))) return []

  try {
    const raw: unknown = JSON.parse(await readTextFile(path))
    if (!Array.isArray(raw) || !raw.every((value) => typeof value === 'string')) return []
    return raw
  } catch {
    return []
  }
}

export async function rememberVault(root: string): Promise<void> {
  if (!isDesktop()) return
  const { appDataDir } = await import('@tauri-apps/api/path')
  const { mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs')
  const remembered = (await recentVaults()).filter((candidate) => candidate !== root)
  await mkdir(await appDataDir(), { recursive: true })
  await writeTextFile(
    await recentVaultsPath(),
    `${JSON.stringify([root, ...remembered].slice(0, MAX_RECENT_VAULTS), null, 2)}\n`,
  )
}

/** 최근 Vault 목록에서 뺀다(폴더와 그 안의 파일은 그대로) */
export async function forgetVault(root: string): Promise<void> {
  if (!isDesktop()) return
  const { exists, writeTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await recentVaultsPath()
  if (!(await exists(path))) return
  const remaining = (await recentVaults()).filter((candidate) => candidate !== root)
  await writeTextFile(path, `${JSON.stringify(remaining, null, 2)}
`)
}

/** 첫 화면 「예시로 시작하기」: 문서 폴더에 빈 예시 Vault 폴더를 만들고 그 경로를 돌려준다(Rust create_example_vault) */
export async function createExampleVaultFolder(name: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('create_example_vault', { name })
}

export async function readSession(vault: VaultHandle): Promise<unknown> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'session.json')
  if (!(await exists(path))) return null

  const content = await readTextFile(path)
  try {
    const raw: unknown = JSON.parse(content)
    return raw
  } catch {
    return null
  }
}

export async function writeSession(vault: VaultHandle, session: SessionState): Promise<void> {
  // 탭·패널 배치는 메인 창만 남긴다(다른 창의 배치가 메인의 것을 덮지 않게)
  if (!sessionWriterAllowed) return
  await writeIwaeFile(vault, 'session.json', `${JSON.stringify(session, null, 2)}\n`, 'metadata:session.json')
}

export async function readPdfHighlights(vault: VaultHandle): Promise<PersistentPdfHighlight[]> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'highlights.json')
  if (!(await exists(path))) {
    trackRead(path, null)
    return []
  }
  try {
    const text = await readTextFile(path)
    const parsed = parsePersistentPdfHighlights(JSON.parse(text) as unknown)
    trackRead(path, text)
    return parsed
  } catch (err) {
    throw new Error(t('PDF 형광펜을 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writePdfHighlights(
  vault: VaultHandle,
  highlights: readonly PersistentPdfHighlight[],
): Promise<void> {
  await writeIwaeFile(vault, 'highlights.json', `${JSON.stringify(persistentPdfHighlightFile(highlights), null, 2)}\n`, 'metadata:highlights.json')
}

export async function readMarkdownHighlights(vault: VaultHandle): Promise<PersistentMarkdownHighlight[]> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'markdown-highlights.json')
  if (!(await exists(path))) {
    trackRead(path, null)
    return []
  }
  try {
    const text = await readTextFile(path)
    const parsed = parsePersistentMarkdownHighlights(JSON.parse(text) as unknown)
    trackRead(path, text)
    return parsed
  } catch (err) {
    throw new Error(t('Markdown 형광펜을 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeMarkdownHighlights(
  vault: VaultHandle,
  highlights: readonly PersistentMarkdownHighlight[],
): Promise<void> {
  await writeIwaeFile(vault, 'markdown-highlights.json', `${JSON.stringify(markdownHighlightFile(highlights), null, 2)}\n`, 'metadata:markdown-highlights.json')
}

export async function readPdfBookmarks(vault: VaultHandle): Promise<PdfBookmark[]> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'bookmarks.json')
  if (!(await exists(path))) {
    trackRead(path, null)
    return []
  }
  try {
    const text = await readTextFile(path)
    const parsed = parsePdfBookmarks(JSON.parse(text) as unknown)
    trackRead(path, text)
    return parsed
  } catch (err) {
    throw new Error(t('PDF 책갈피를 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writePdfBookmarks(vault: VaultHandle, bookmarks: readonly PdfBookmark[]): Promise<void> {
  await writeIwaeFile(vault, 'bookmarks.json', `${JSON.stringify(pdfBookmarkFile(bookmarks), null, 2)}\n`, 'metadata:bookmarks.json')
}

export async function readBibliography(vault: VaultHandle): Promise<BibliographyFile> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'bibliography.json')
  if (!(await exists(path))) {
    trackRead(path, null)
    return EMPTY_BIBLIOGRAPHY
  }
  try {
    const text = await readTextFile(path)
    const parsed = parseBibliographyFile(JSON.parse(text) as unknown)
    trackRead(path, text)
    return parsed
  } catch (err) {
    throw new Error(t('서지 정보를 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeBibliography(vault: VaultHandle, file: BibliographyFile): Promise<void> {
  await writeIwaeFile(vault, 'bibliography.json', `${JSON.stringify(file, null, 2)}\n`, 'metadata:bibliography.json')
}

export async function readDocSources(vault: VaultHandle): Promise<DocSourcesFile> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'sources.json')
  if (!(await exists(path))) {
    trackRead(path, null)
    return EMPTY_DOC_SOURCES
  }
  try {
    const text = await readTextFile(path)
    const parsed = parseDocSources(JSON.parse(text) as unknown)
    trackRead(path, text)
    return parsed
  } catch (err) {
    throw new Error(t('문서 출처를 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeDocSources(vault: VaultHandle, file: DocSourcesFile): Promise<void> {
  await writeIwaeFile(vault, 'sources.json', `${JSON.stringify(file, null, 2)}
`, 'metadata:sources.json')
}

export async function readVersionGroups(vault: VaultHandle): Promise<VersionGroupsFile> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'versions.json')
  if (!(await exists(path))) {
    trackRead(path, null)
    return EMPTY_VERSION_GROUPS
  }
  try {
    const text = await readTextFile(path)
    const parsed = parseVersionGroups(JSON.parse(text) as unknown)
    trackRead(path, text)
    return parsed
  } catch (err) {
    throw new Error(t('문서 버전 묶음을 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeVersionGroups(vault: VaultHandle, file: VersionGroupsFile): Promise<void> {
  await writeIwaeFile(vault, 'versions.json', `${JSON.stringify(file, null, 2)}
`, 'metadata:versions.json')
}

export async function readPdfOverlays(vault: VaultHandle): Promise<PdfOverlaysFile> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'pdf-overlays.json')
  if (!(await exists(path))) {
    trackRead(path, null)
    return EMPTY_PDF_OVERLAYS
  }
  try {
    const text = await readTextFile(path)
    const parsed = parsePdfOverlays(JSON.parse(text) as unknown)
    trackRead(path, text)
    return parsed
  } catch (err) {
    throw new Error(t('PDF 편집 내용을 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writePdfOverlays(vault: VaultHandle, file: PdfOverlaysFile): Promise<void> {
  await writeIwaeFile(vault, 'pdf-overlays.json', `${JSON.stringify(file, null, 2)}
`, 'metadata:pdf-overlays.json')
}

export async function readBlockPresets(vault: VaultHandle): Promise<UserBlockPreset[]> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'block-presets.json')
  if (!(await exists(path))) {
    trackRead(path, null)
    return []
  }
  try {
    const text = await readTextFile(path)
    const parsed = parseUserBlockPresets(JSON.parse(text) as unknown)
    trackRead(path, text)
    return parsed
  } catch (err) {
    throw new Error(t('블록 프리셋을 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeBlockPresets(vault: VaultHandle, presets: readonly UserBlockPreset[]): Promise<void> {
  await writeIwaeFile(vault, 'block-presets.json', `${JSON.stringify(userBlockPresetFile(presets), null, 2)}\n`, 'metadata:block-presets.json')
}

/** 파일·폴더가 없어서 난 오류인가(옮기거나 이름을 바꾼 직후 등) */
export function isMissingPathError(err: unknown): boolean {
  const text = errorText(err)
  return /os error (2|3)|not found|No such file|cannot find|찾을 수 없습니다/iu.test(text)
}

export async function listVaultTree(vault: VaultHandle): Promise<VaultTreeEntry[]> {
  const { join } = await import('@tauri-apps/api/path')
  const { readDir } = await import('@tauri-apps/plugin-fs')
  const entries: VaultTreeEntry[] = []

  async function visit(absolute: string, relativeParts: readonly string[]): Promise<void> {
    let children: Awaited<ReturnType<typeof readDir>>
    try {
      children = await readDir(absolute)
    } catch (err) {
      // 훑는 사이에 하위 폴더가 사라졌으면(이름 바꾸기·이동 중 감시자가 다시 훑음) 건너뛴다.
      // 다 끝나면 감시자가 한 번 더 훑어 새 이름으로 잡는다. Vault 맨 위를 못 읽는 것은 진짜 오류다.
      if (relativeParts.length > 0 && isMissingPathError(err)) return
      throw err
    }
    for (const child of children) {
      if (child.name === '.iwae' || child.name === 'assets') continue
      // git 저장소 정보(.git, .github 등 점으로 시작하는 폴더)는 목록에 넣지 않는다 — GitHub 에서 가져온 문서 폴더 안에 있다
      if (child.isDirectory && child.name.startsWith('.')) continue
      const childParts = [...relativeParts, child.name]
      entries.push({ path: childParts.join('/'), isDirectory: child.isDirectory })
      if (child.isDirectory) await visit(await join(absolute, child.name), childParts)
    }
  }

  await visit(vault.root, [])
  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

function safeName(value: string): string | null {
  const trimmed = value.trim()
  if (
    trimmed.length === 0 ||
    trimmed === '.' ||
    trimmed === '..' ||
    /[<>:"/\\|?*]/u.test(trimmed)
  ) {
    return null
  }
  return trimmed
}

export async function createNote(
  vault: VaultHandle,
  notebookName: string,
  noteName: string,
): Promise<string> {
  // 폴더는 Vault 상대 경로다. 비어 있으면 Vault 맨 위, 'a/b' 면 하위 폴더 안에 만든다
  const folderParts = notebookName.replaceAll('\\', '/').split('/').map((part) => part.trim()).filter((part) => part !== '')
  const safeParts = folderParts.map(safeName)
  const requestedNote = safeName(noteName)
  if (safeParts.some((part) => part === null) || requestedNote === null) {
    throw new Error(t('폴더와 노트 이름에는 경로 문자를 쓸 수 없습니다.'))
  }
  const notebook = (safeParts as string[]).join('/')

  const title = requestedNote.endsWith('.canvas')
    ? requestedNote.slice(0, -'.canvas'.length)
    : requestedNote
  if (title.length === 0) throw new Error(t('노트 이름을 입력해 주세요.'))

  const { join } = await import('@tauri-apps/api/path')
  const { exists, mkdir } = await import('@tauri-apps/plugin-fs')
  const directory = await join(vault.root, ...(safeParts as string[]))
  const filename = `${title}.canvas`
  const path = await join(directory, filename)
  if (await exists(path)) throw new Error(t('같은 이름의 노트가 이미 있습니다.'))

  const relative = notebook === '' ? filename : `${notebook}/${filename}`
  await mkdir(directory, { recursive: true })
  await writeVaultFile(vault, path, serializeCanvasDoc(emptyCanvasDoc()), `canvas:${relative}`)
  return relative
}

/**
 * Vault 안에 Markdown 파일을 새로 만든다(주석 내보내기 등). 같은 이름이 있으면
 * 덮어쓰지 않고 " (2)", " (3)" … 을 붙인다 — 내보낸 요약을 다시 내보내다가 사용자가
 * 손으로 고친 앞 파일을 지우는 일이 없게. 돌려주는 값은 Vault 기준 상대 경로다.
 */
export async function createMarkdownFile(
  vault: VaultHandle,
  folderName: string,
  fileName: string,
  content: string,
): Promise<string> {
  const folder = safeName(folderName)
  const requested = safeName(fileName.replace(/\.md$/iu, ''))
  if (folder === null || requested === null) {
    throw new Error(t('폴더와 파일 이름에는 경로 문자를 쓸 수 없습니다.'))
  }

  const { join } = await import('@tauri-apps/api/path')
  const { exists, mkdir } = await import('@tauri-apps/plugin-fs')
  const directory = await join(vault.root, folder)
  let filename = `${requested}.md`
  for (let copy = 2; await exists(await join(directory, filename)); copy += 1) {
    filename = `${requested} (${copy}).md`
  }
  await mkdir(directory, { recursive: true })
  await writeVaultFile(vault, await join(directory, filename), content, `markdown:${folder}/${filename}`)
  return `${folder}/${filename}`
}

function validateCanvasPath(notePath: string): readonly string[] {
  const normalized = notePath.replaceAll('\\', '/')
  const parts = normalized.split('/')
  if (
    normalized.length === 0
    || normalized.startsWith('/')
    || /^[A-Za-z]:/u.test(normalized)
    || parts.some((part) => part === '' || part === '.' || part === '..')
    || !normalized.toLowerCase().endsWith('.canvas')
  ) {
    throw new Error(t('올바른 vault 캔버스 경로가 아닙니다.'))
  }
  return parts
}

async function canvasPath(vault: VaultHandle, notePath: string): Promise<string> {
  const { join } = await import('@tauri-apps/api/path')
  return join(vault.root, ...validateCanvasPath(notePath))
}

function validateMarkdownPath(markdownPath: string): readonly string[] {
  const normalized = markdownPath.replaceAll('\\', '/')
  const parts = normalized.split('/')
  if (
    normalized.length === 0
    || normalized.startsWith('/')
    || /^[A-Za-z]:/u.test(normalized)
    || parts.some((part) => part === '' || part === '.' || part === '..')
    || !normalized.toLowerCase().endsWith('.md')
  ) {
    throw new Error(t('올바른 vault Markdown 경로가 아닙니다.'))
  }
  return parts
}

export async function readMarkdown(vault: VaultHandle, markdownPath: string): Promise<string> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  if (!/\.(?:md|markdown)$/iu.test(markdownPath)) {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(markdownPath)) {
      throw new Error(t('Markdown 파일 경로가 올바르지 않습니다.'))
    }
    const index = await readVaultIndex(vault)
    const entry = index.entries.find((candidate) => candidate.id === markdownPath)
    if (entry?.kind !== 'markdown' || entry.storage !== 'reference') {
      throw new Error(t('Markdown 참조를 찾을 수 없습니다.'))
    }
    if (!(await exists(entry.path))) throw new Error(t('Markdown 파일을 찾을 수 없습니다.'))
    return readTextFile(entry.path)
  }

  const { join } = await import('@tauri-apps/api/path')
  const path = await join(vault.root, ...validateMarkdownPath(markdownPath))
  if (!(await exists(path))) throw new Error(t('Markdown 파일을 찾을 수 없습니다.'))
  return readTextFile(path)
}

export async function readCanvas(
  vault: VaultHandle,
  notePath: string,
): Promise<CanvasDocumentV2 | null> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await canvasPath(vault, notePath)
  if (!(await exists(path))) return null
  try {
    const contents = await readTextFile(path)
    const raw: unknown = JSON.parse(contents)
    fileSync.observeHash(path, await sha256Text(contents))
    return parseCanvasDocument(raw)
  } catch (err) {
    throw new Error(t('캔버스를 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeCanvas(
  vault: VaultHandle,
  notePath: string,
  document: CanvasDocument,
): Promise<void> {
  const parsed = parseCanvasDocument(document)
  const path = await canvasPath(vault, notePath)
  const content = serializeCanvasDoc(parsed)
  if (isDesktop()) {
    const { dirname } = await import('@tauri-apps/api/path')
    const { mkdir } = await import('@tauri-apps/plugin-fs')
    await mkdir(await dirname(path), { recursive: true })
    await writeVaultFile(vault, path, content, `canvas:${notePath}`)
    return
  }
  const { mkdir, remove, rename, writeTextFile } = await import('@tauri-apps/plugin-fs')
  const { dirname } = await import('@tauri-apps/api/path')
  const temporaryPath = `${path}.tmp`
  await mkdir(await dirname(path), { recursive: true })
  await writeTextFile(temporaryPath, content)
  try {
    await rename(temporaryPath, path)
  } catch (err) {
    try {
      await remove(temporaryPath)
    } catch {}
    throw err
  }
}

export async function relinkDocument(
  vault: VaultHandle,
  docId: string,
  newPath: string,
): Promise<VaultLibraryEntry> {
  const entries = await readLibrary(vault)
  const current = entries.find((entry) => entry.docId === docId)
  if (current === undefined) throw new Error(t('다시 연결할 문서를 Library에서 찾지 못했습니다.'))

  const meta = await openPdf(newPath)
  if (meta.docId !== current.docId || meta.sha256 !== current.sha256) {
    throw new Error(t('고른 파일은 같은 문서가 아닙니다.'))
  }

  const updated = { ...current, path: newPath }
  await writeLibrary(
    vault,
    entries.map((entry) => (entry.docId === docId ? updated : entry)),
  )
  return updated
}

/**
 * Vault 폴더에 넣기만 하고 앱에 등록하지 않은 PDF 를 찾아 문서 목록·색인에 올린다.
 * 파일은 그 자리에 둔다(복사하지 않음). 이미 같은 내용(SHA-256)의 PDF 가 있으면 건너뛴다.
 * 등록한 상대 경로 목록을 돌려준다.
 */
/**
 * 이번 실행에서 이미 살펴본(등록할 것이 없던) Vault PDF 경로 → 그 내용의 SHA-256. 새로고침마다 다시 해시를 재지 않게.
 * 같은 내용을 가진 등록 문서가 사라지면(원본을 지우거나 옮김) 다시 살펴야 하므로 해시를 같이 기억한다
 */
const checkedUnlistedPaths = new Map<string, string>()

export async function registerUnlistedVaultPdfs(vault: VaultHandle): Promise<string[]> {
  const { join } = await import('@tauri-apps/api/path')
  const tree = await listVaultTree(vault)
  const library = await readLibrary(vault)
  const index = await readVaultIndex(vault)
  const known = new Set(index.entries.filter((entry) => entry.kind === 'pdf').map((entry) => entry.path.replaceAll('\\', '/').toLocaleLowerCase()))
  const nextLibrary = [...library]
  const presentPaths = new Set(tree.filter((entry) => !entry.isDirectory).map((entry) => entry.path.replaceAll('\\', '/').toLocaleLowerCase()))
  const ownerOf = (sha256: string) => nextLibrary.find((entry) => entry.sha256 === sha256)
  // 같은 내용으로 등록된 문서의 파일이 아직 Vault 에 있나(Vault 밖을 가리키는 참조 문서는 있는 것으로 본다)
  const ownerFileExists = (owner: VaultLibraryEntry) => {
    const ownerPath = libraryEntryVaultPath(owner)
    return ownerPath === null || presentPaths.has(ownerPath.toLocaleLowerCase())
  }
  const candidates = tree.filter((entry) => !entry.isDirectory
    && /\.pdf$/iu.test(entry.path)
    && !known.has(entry.path.replaceAll('\\', '/').toLocaleLowerCase()))
  const added: VaultLibraryEntry[] = []
  const relinked: string[] = []
  const indexEntries = [...index.entries]
  const now = new Date()
  for (const [order, candidate] of candidates.entries()) {
    const relative = candidate.path.replaceAll('\\', '/')
    const absolute = await join(vault.root, ...relative.split('/'))
    // 이미 본 파일(같은 크기·같은 내용이라 등록할 것이 없던 것)은 다시 보지 않는다
    const checkedHash = checkedUnlistedPaths.get(absolute)
    if (checkedHash !== undefined) {
      const checkedOwner = ownerOf(checkedHash)
      if (checkedOwner !== undefined && ownerFileExists(checkedOwner)) continue
    }
    // 먼저 해시만 잰다. 이미 등록된 PDF 와 내용이 같으면(다른 폴더의 사본 등) 열지 않는다.
    // PDF 를 열면 열린 문서 캐시(8개)에서 사용자가 보고 있는 문서가 밀려나 쪽이 빈칸이 된다
    let identity: { docId: string; sha256: string; size: number }
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      identity = await invoke<{ docId: string; sha256: string; size: number }>('pdf_file_hash', { path: absolute })
      const owner = ownerOf(identity.sha256)
      if (owner !== undefined) {
        if (ownerFileExists(owner)) {
          checkedUnlistedPaths.set(absolute, identity.sha256)
        } else {
          // 등록된 문서의 파일이 사라지고 같은 내용의 파일이 새로 보인다 = 탐색기에서 옮기거나 이름을 바꾼 것.
          // 새 문서로 올리면 같은 docId 가 겹치고 하이라이트·책갈피가 옛 항목에 남으므로, 그 문서를 새 자리로 잇는다
          relinkMovedPdf(owner, relative, absolute, nextLibrary, indexEntries)
          relinked.push(relative)
        }
        continue
      }
    } catch {
      // 아직 복사 중이거나 읽을 수 없으면 다음 새로고침에 다시 본다
      continue
    }
    let meta: { docId: string; sha256: string; size: number; pageCount: number }
    try {
      meta = await openPdf(absolute, undefined, { askPassword: false })
    } catch (error) {
      // 암호 PDF 는 열 수 없지만 목록에는 올린다(쪽 수는 모름 — 처음 열 때 암호를 묻고 고친다)
      if (!(error instanceof Error) || error.name !== 'PdfPasswordError') continue
      meta = { docId: identity.docId, sha256: identity.sha256, size: identity.size, pageCount: 0 }
    }
    if (ownerOf(meta.sha256) !== undefined) {
      checkedUnlistedPaths.set(absolute, meta.sha256)
      continue
    }
    checkedUnlistedPaths.set(absolute, meta.sha256)
    const folderPath = relative.split('/').slice(0, -1).join('/')
    const title = relative.split('/').at(-1)!.replace(/\.pdf$/iu, '')
    const addedAt = new Date(now.getTime() + order).toISOString()
    const addedEntry: VaultLibraryEntry = {
      docId: meta.docId,
      path: absolute,
      sha256: meta.sha256,
      size: meta.size,
      pages: meta.pageCount,
      title,
      addedAt,
      folderPath,
      attachmentPolicy: { kind: 'copy-current-folder', folderPath },
    }
    added.push(addedEntry)
    nextLibrary.push(addedEntry)
    indexEntries.push(createVaultIndexEntry({
      id: meta.docId,
      kind: 'pdf',
      storage: 'vault',
      path: relative,
      displayName: title,
      contentHash: meta.sha256,
      size: meta.size,
      addedAt,
    }))
  }
  if (added.length === 0 && relinked.length === 0) return []
  await writeLibrary(vault, nextLibrary)
  await writeVaultIndex(vault, { version: 1, entries: indexEntries })
  return [...relinked, ...added.map((entry) => `${entry.folderPath ? `${entry.folderPath}/` : ''}${entry.title}.pdf`)]
}

/** 파일이 Vault 안 다른 자리로 옮겨진 문서를 새 자리로 잇는다(제자리 수정: 문서 목록·색인 항목). 이름을 따로 붙이지 않았다면 새 파일 이름을 따른다 */
function relinkMovedPdf(
  owner: VaultLibraryEntry,
  relative: string,
  absolute: string,
  library: VaultLibraryEntry[],
  indexEntries: VaultIndexEntry[],
): void {
  const fileStem = (path: string) => (path.replaceAll('\\', '/').split('/').at(-1) ?? path).replace(/\.pdf$/iu, '')
  const oldVaultPath = libraryEntryVaultPath(owner)
  const oldStem = oldVaultPath === null ? owner.title : fileStem(oldVaultPath)
  const newStem = fileStem(relative)
  const folderPath = relative.split('/').slice(0, -1).join('/')
  const libraryAt = library.findIndex((entry) => entry.docId === owner.docId)
  if (libraryAt >= 0) {
    library[libraryAt] = {
      ...owner,
      path: absolute,
      title: owner.title === oldStem ? newStem : owner.title,
      folderPath,
      attachmentPolicy: { kind: 'copy-current-folder', folderPath },
    }
  }
  const indexAt = indexEntries.findIndex((entry) => entry.id === owner.docId && entry.kind === 'pdf')
  const current = indexEntries[indexAt]
  if (current !== undefined) {
    indexEntries[indexAt] = {
      ...current,
      storage: 'vault',
      path: relative,
      displayName: current.displayName === oldStem ? newStem : current.displayName,
      missing: false,
    }
  }
}

/** 쪽 수를 모르고 등록한 문서(암호 PDF)를 연 뒤 실제 쪽 수로 고친다. 바뀐 항목이 없으면 null */
export async function updateLibraryPageCount(
  vault: VaultHandle,
  docId: string,
  pages: number,
): Promise<VaultLibraryEntry[] | null> {
  const entries = await readLibrary(vault)
  if (!entries.some((entry) => entry.docId === docId && entry.pages !== pages)) return null
  const updated = entries.map((entry) => entry.docId === docId ? { ...entry, pages } : entry)
  await writeLibrary(vault, updated)
  return updated
}

/** 접두키 설정 `.iwae/keys.conf`(설계 8.3). 없거나 못 읽으면 null */
export async function readKeysConf(vault: VaultHandle): Promise<string | null> {
  try {
    const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
    const path = await iwaePath(vault, 'keys.conf')
    return (await exists(path)) ? await readTextFile(path) : null
  } catch {
    return null
  }
}

/** 번역 캐시(번역 기록): `.iwae/translations.json`. 없거나 깨졌으면 빈 목록 */
export async function readTranslationCache(vault: VaultHandle): Promise<TranslationCacheEntry[]> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'translations.json')
  if (!(await exists(path))) {
    trackRead(path, null)
    return []
  }
  try {
    const text = await readTextFile(path)
    const parsed = parseTranslationCache(JSON.parse(text))
    trackRead(path, text)
    return parsed
  } catch {
    return []
  }
}

export async function writeTranslationCache(vault: VaultHandle, entries: readonly TranslationCacheEntry[]): Promise<void> {
  await writeIwaeFile(vault, 'translations.json', serializeTranslationCache(entries), 'metadata:translations.json')
}

/**
 * 창 사이 동기화에 쓰는 코덱: 저장할 때의 글 모양과 같아야 병합 결과가 저장 모양과 어긋나지 않는다.
 * 각 저장소 훅(app/use*.ts)이 subscribeVaultFile 에 넘긴다.
 */
const pretty = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

export const pdfHighlightsCodec: SyncCodec<readonly PersistentPdfHighlight[]> = {
  serialize: (highlights) => pretty(persistentPdfHighlightFile(highlights)),
  parse: (text) => parsePersistentPdfHighlights(JSON.parse(text) as unknown),
}
export const markdownHighlightsCodec: SyncCodec<readonly PersistentMarkdownHighlight[]> = {
  serialize: (highlights) => pretty(markdownHighlightFile(highlights)),
  parse: (text) => parsePersistentMarkdownHighlights(JSON.parse(text) as unknown),
}
export const pdfBookmarksCodec: SyncCodec<readonly PdfBookmark[]> = {
  serialize: (bookmarks) => pretty(pdfBookmarkFile(bookmarks)),
  parse: (text) => parsePdfBookmarks(JSON.parse(text) as unknown),
}
export const blockPresetsCodec: SyncCodec<readonly UserBlockPreset[]> = {
  serialize: (presets) => pretty(userBlockPresetFile(presets)),
  parse: (text) => parseUserBlockPresets(JSON.parse(text) as unknown),
}
export const bibliographyCodec: SyncCodec<BibliographyFile> = {
  serialize: pretty,
  parse: (text) => parseBibliographyFile(JSON.parse(text) as unknown),
}
export const docSourcesCodec: SyncCodec<DocSourcesFile> = {
  serialize: pretty,
  parse: (text) => parseDocSources(JSON.parse(text) as unknown),
}
export const versionGroupsCodec: SyncCodec<VersionGroupsFile> = {
  serialize: pretty,
  parse: (text) => parseVersionGroups(JSON.parse(text) as unknown),
}
export const pdfOverlaysCodec: SyncCodec<PdfOverlaysFile> = {
  serialize: pretty,
  parse: (text) => parsePdfOverlays(JSON.parse(text) as unknown),
}
export const translationCacheCodec: SyncCodec<readonly TranslationCacheEntry[]> = {
  serialize: (entries) => serializeTranslationCache(entries),
  parse: (text) => parseTranslationCache(JSON.parse(text)),
}
