import { EMPTY_PDF_OVERLAYS, parsePdfOverlays, type PdfOverlaysFile } from '../core/pdfOverlays'
import { EMPTY_VERSION_GROUPS, parseVersionGroups, type VersionGroupsFile } from '../core/versionGroups'
import { EMPTY_DOC_SOURCES, parseDocSources, type DocSourcesFile } from '../core/docSources'
import { EMPTY_BIBLIOGRAPHY, parseBibliographyFile, type BibliographyFile } from '../core/bibliography'
import { errorText } from '../core/errorText'
import { parseTranslationCache, serializeTranslationCache, type TranslationCacheEntry } from '../core/translationCache'
import { createSerialByKey } from '../core/serialByKey'
import { emptyCanvasDoc, serializeCanvasDoc } from '../core/canvasSerialize'
import { parseCanvasDocument, type CanvasDocument, type CanvasDocumentV2 } from '../core/canvasDocument'
import type { SessionState } from '../core/session'
import {
  createVaultIndexEntry,
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
import { isDesktop } from './window'
import { t } from '../i18n'

const REGISTRY_VERSION = 1
const TREE_ORDER_VERSION = 1
const MAX_RECENT_VAULTS = 10
const observedFileHashes = new Map<string, string>()

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

/** 파일마다 저장을 한 줄로 세운다. 이전 저장이 끝나 기대 해시가 갱신된 뒤에 다음 저장이 해시를 읽는다 */
const serialWrite = createSerialByKey()

/**
 * 같은 파일에 저장이 겹치면(예: MCP 가 메모를 잇달아 추가) 두 번째 저장이 첫 저장 전의 해시를
 * 기대값으로 보내 자기 저장을 '외부 변경 충돌'로 오인한다. 그래서 파일마다 차례로 쓴다.
 */
function writeVaultFile(
  vault: VaultHandle,
  targetPath: string,
  contents: string,
  fileId: string,
): Promise<void> {
  return serialWrite(targetPath, () => writeVaultFileNow(vault, targetPath, contents, fileId))
}

/** Vault 안 상대 경로의 글 파일을 저널 원자 쓰기로 저장한다(메모 노트 등) */
export async function writeVaultRelativeText(vault: VaultHandle, relativePath: string, contents: string): Promise<void> {
  const { join } = await import('@tauri-apps/api/path')
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  const parts = relativePath.replaceAll('\\', '/').split('/').filter((part) => part !== '')
  if (parts.length === 0 || parts.some((part) => part === '..' || part === '.')) throw new Error(t('Vault 상대 경로가 올바르지 않습니다.'))
  const directory = await join(vault.root, ...parts.slice(0, -1))
  await mkdir(directory, { recursive: true })
  await writeVaultFile(vault, await join(vault.root, ...parts), contents, `vault:${parts.join('/')}`)
}

async function writeVaultFileNow(
  vault: VaultHandle,
  targetPath: string,
  contents: string,
  fileId: string,
): Promise<void> {
  if (isDesktop()) {
    const receipt = await atomicWriteText({
      targetPath,
      contents,
      expectedHash: observedFileHashes.get(targetPath) ?? null,
      journalRoot: await iwaePath(vault, 'journal'),
      historyRoot: await iwaePath(vault, 'history'),
      fileId,
    })
    observedFileHashes.set(targetPath, receipt.contentHash)
    return
  }
  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  await writeTextFile(targetPath, contents)
  observedFileHashes.set(targetPath, await sha256Text(contents))
}

/**
 * 앱이 옮기거나(휴지통·이름 바꾸기) 지운 파일의 「마지막으로 쓴 내용」 기억을 지운다. 남겨 두면 같은 이름으로
 * 새로 쓸 때 「앱이 쓴 뒤 밖에서 바뀌었다(없어졌다)」로 보고 저장 대신 충돌 기록만 남긴다
 * (노트를 지운 뒤 「새 노트」를 다시 만들면 만들어지지 않던 까닭).
 */
export function forgetObservedFile(absolutePath: string): void {
  observedFileHashes.delete(absolutePath)
}

/**
 * 디스크의 파일이 이 앱이 마지막으로 쓴 내용과 같은가. 파일 감시는 앱 자신의 저장도 알려 오므로,
 * 저장 중에 또 고친 파일(예: MCP 가 잇달아 고친 캔버스)을 '외부 변경 충돌'로 오인하지 않게 쓴다.
 */
export async function isOwnLatestWrite(vault: VaultHandle, relativePath: string): Promise<boolean> {
  const { join } = await import('@tauri-apps/api/path')
  const path = await join(vault.root, ...relativePath.replaceAll('\\', '/').split('/'))
  const expected = observedFileHashes.get(path)
  if (expected === undefined) return false
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    return await sha256Text(await readTextFile(path)) === expected
  } catch {
    return false
  }
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
  return vault
}

export async function readLibrary(vault: VaultHandle): Promise<VaultLibraryEntry[]> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'library.json')
  if (!(await exists(path))) return []

  try {
    const raw: unknown = JSON.parse(await readTextFile(path))
    return parseLibrary(raw)
  } catch (err) {
    throw new Error(t('문서 목록을 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeLibrary(
  vault: VaultHandle,
  entries: readonly VaultLibraryEntry[],
): Promise<void> {
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  await mkdir(await iwaePath(vault, ''), { recursive: true })
  const content = `${JSON.stringify(libraryFile(entries), null, 2)}\n`
  await writeVaultFile(vault, await iwaePath(vault, 'library.json'), content, 'metadata:library.json')
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
      return parseVaultIndex(JSON.parse(contents) as unknown)
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
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  const parsed = parseVaultIndex(index)
  const ordered: VaultIndexFile = {
    version: 1,
    entries: [...parsed.entries].sort((left, right) => left.id.localeCompare(right.id)),
  }
  await mkdir(await iwaePath(vault, ''), { recursive: true })
  await writeVaultFile(
    vault,
    await iwaePath(vault, 'index.json'),
    `${JSON.stringify(ordered, null, 2)}\n`,
    'metadata:index.json',
  )
}

export async function readVaultMetadata(vault: VaultHandle): Promise<VaultMetadata> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'metadata.json')
  if (!(await exists(path))) return parseVaultMetadata(null)
  try {
    return parseVaultMetadata(JSON.parse(await readTextFile(path)) as unknown)
  } catch (err) {
    throw new Error(t('Vault 설정을 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeVaultMetadata(vault: VaultHandle, metadata: VaultMetadata): Promise<void> {
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  await mkdir(await iwaePath(vault, ''), { recursive: true })
  await writeVaultFile(
    vault,
    await iwaePath(vault, 'metadata.json'),
    `${JSON.stringify(parseVaultMetadata(metadata), null, 2)}\n`,
    'metadata:metadata.json',
  )
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
  if (!(await exists(path))) return {}
  try {
    const raw: unknown = JSON.parse(await readTextFile(path))
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
    return parents
  } catch (err) {
    throw new Error(t('트리 순서를 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeVaultTreeOrder(
  vault: VaultHandle,
  order: VaultTreeOrder,
): Promise<void> {
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  const parents = Object.fromEntries(Object.entries(order)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([parentPath, ids]) => [parentPath, [...new Set(ids)]]))
  await mkdir(await iwaePath(vault, ''), { recursive: true })
  await writeVaultFile(
    vault,
    await iwaePath(vault, 'tree-order.json'),
    `${JSON.stringify({ version: TREE_ORDER_VERSION, parents }, null, 2)}\n`,
    'metadata:tree-order.json',
  )
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
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  await mkdir(await iwaePath(vault, ''), { recursive: true })
  await writeVaultFile(
    vault,
    await iwaePath(vault, 'session.json'),
    `${JSON.stringify(session, null, 2)}\n`,
    'metadata:session.json',
  )
}

export async function readPdfHighlights(vault: VaultHandle): Promise<PersistentPdfHighlight[]> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'highlights.json')
  if (!(await exists(path))) return []
  try {
    return parsePersistentPdfHighlights(JSON.parse(await readTextFile(path)) as unknown)
  } catch (err) {
    throw new Error(t('PDF 형광펜을 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writePdfHighlights(
  vault: VaultHandle,
  highlights: readonly PersistentPdfHighlight[],
): Promise<void> {
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  await mkdir(await iwaePath(vault, ''), { recursive: true })
  await writeVaultFile(
    vault,
    await iwaePath(vault, 'highlights.json'),
    `${JSON.stringify(persistentPdfHighlightFile(highlights), null, 2)}\n`,
    'metadata:highlights.json',
  )
}

export async function readMarkdownHighlights(vault: VaultHandle): Promise<PersistentMarkdownHighlight[]> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'markdown-highlights.json')
  if (!(await exists(path))) return []
  try {
    return parsePersistentMarkdownHighlights(JSON.parse(await readTextFile(path)) as unknown)
  } catch (err) {
    throw new Error(t('Markdown 형광펜을 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeMarkdownHighlights(
  vault: VaultHandle,
  highlights: readonly PersistentMarkdownHighlight[],
): Promise<void> {
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  await mkdir(await iwaePath(vault, ''), { recursive: true })
  await writeVaultFile(
    vault,
    await iwaePath(vault, 'markdown-highlights.json'),
    `${JSON.stringify(markdownHighlightFile(highlights), null, 2)}\n`,
    'metadata:markdown-highlights.json',
  )
}

export async function readPdfBookmarks(vault: VaultHandle): Promise<PdfBookmark[]> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'bookmarks.json')
  if (!(await exists(path))) return []
  try {
    return parsePdfBookmarks(JSON.parse(await readTextFile(path)) as unknown)
  } catch (err) {
    throw new Error(t('PDF 책갈피를 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writePdfBookmarks(vault: VaultHandle, bookmarks: readonly PdfBookmark[]): Promise<void> {
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  await mkdir(await iwaePath(vault, ''), { recursive: true })
  await writeVaultFile(
    vault,
    await iwaePath(vault, 'bookmarks.json'),
    `${JSON.stringify(pdfBookmarkFile(bookmarks), null, 2)}\n`,
    'metadata:bookmarks.json',
  )
}

export async function readBibliography(vault: VaultHandle): Promise<BibliographyFile> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'bibliography.json')
  if (!(await exists(path))) return EMPTY_BIBLIOGRAPHY
  try {
    return parseBibliographyFile(JSON.parse(await readTextFile(path)) as unknown)
  } catch (err) {
    throw new Error(t('서지 정보를 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeBibliography(vault: VaultHandle, file: BibliographyFile): Promise<void> {
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  await mkdir(await iwaePath(vault, ''), { recursive: true })
  await writeVaultFile(
    vault,
    await iwaePath(vault, 'bibliography.json'),
    `${JSON.stringify(file, null, 2)}\n`,
    'metadata:bibliography.json',
  )
}

export async function readDocSources(vault: VaultHandle): Promise<DocSourcesFile> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'sources.json')
  if (!(await exists(path))) return EMPTY_DOC_SOURCES
  try {
    return parseDocSources(JSON.parse(await readTextFile(path)) as unknown)
  } catch (err) {
    throw new Error(t('문서 출처를 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeDocSources(vault: VaultHandle, file: DocSourcesFile): Promise<void> {
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  await mkdir(await iwaePath(vault, ''), { recursive: true })
  await writeVaultFile(vault, await iwaePath(vault, 'sources.json'), `${JSON.stringify(file, null, 2)}
`, 'metadata:sources.json')
}

export async function readVersionGroups(vault: VaultHandle): Promise<VersionGroupsFile> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'versions.json')
  if (!(await exists(path))) return EMPTY_VERSION_GROUPS
  try {
    return parseVersionGroups(JSON.parse(await readTextFile(path)) as unknown)
  } catch (err) {
    throw new Error(t('문서 버전 묶음을 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeVersionGroups(vault: VaultHandle, file: VersionGroupsFile): Promise<void> {
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  await mkdir(await iwaePath(vault, ''), { recursive: true })
  await writeVaultFile(vault, await iwaePath(vault, 'versions.json'), `${JSON.stringify(file, null, 2)}
`, 'metadata:versions.json')
}

export async function readPdfOverlays(vault: VaultHandle): Promise<PdfOverlaysFile> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'pdf-overlays.json')
  if (!(await exists(path))) return EMPTY_PDF_OVERLAYS
  try {
    return parsePdfOverlays(JSON.parse(await readTextFile(path)) as unknown)
  } catch (err) {
    throw new Error(t('PDF 편집 내용을 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writePdfOverlays(vault: VaultHandle, file: PdfOverlaysFile): Promise<void> {
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  await mkdir(await iwaePath(vault, ''), { recursive: true })
  await writeVaultFile(vault, await iwaePath(vault, 'pdf-overlays.json'), `${JSON.stringify(file, null, 2)}
`, 'metadata:pdf-overlays.json')
}

export async function readBlockPresets(vault: VaultHandle): Promise<UserBlockPreset[]> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'block-presets.json')
  if (!(await exists(path))) return []
  try {
    return parseUserBlockPresets(JSON.parse(await readTextFile(path)) as unknown)
  } catch (err) {
    throw new Error(t('블록 프리셋을 읽지 못했습니다: {error}', { error: errorText(err) }))
  }
}

export async function writeBlockPresets(vault: VaultHandle, presets: readonly UserBlockPreset[]): Promise<void> {
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  await mkdir(await iwaePath(vault, ''), { recursive: true })
  await writeVaultFile(
    vault,
    await iwaePath(vault, 'block-presets.json'),
    `${JSON.stringify(userBlockPresetFile(presets), null, 2)}\n`,
    'metadata:block-presets.json',
  )
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
    observedFileHashes.set(path, await sha256Text(contents))
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
/** 이번 실행에서 이미 살펴본(등록할 것이 없던) Vault PDF 경로. 새로고침마다 다시 해시를 재지 않게 */
const checkedUnlistedPaths = new Set<string>()

export async function registerUnlistedVaultPdfs(vault: VaultHandle): Promise<string[]> {
  const { join } = await import('@tauri-apps/api/path')
  const [tree, library, index] = await Promise.all([listVaultTree(vault), readLibrary(vault), readVaultIndex(vault)])
  const known = new Set(index.entries.filter((entry) => entry.kind === 'pdf').map((entry) => entry.path.replaceAll('\\', '/').toLocaleLowerCase()))
  const knownHashes = new Set(library.map((entry) => entry.sha256))
  const candidates = tree.filter((entry) => !entry.isDirectory
    && /\.pdf$/iu.test(entry.path)
    && !known.has(entry.path.replaceAll('\\', '/').toLocaleLowerCase()))
  const added: VaultLibraryEntry[] = []
  const indexEntries = [...index.entries]
  const now = new Date()
  for (const [order, candidate] of candidates.entries()) {
    const relative = candidate.path.replaceAll('\\', '/')
    const absolute = await join(vault.root, ...relative.split('/'))
    // 이미 본 파일(같은 크기·같은 내용이라 등록할 것이 없던 것)은 다시 보지 않는다
    if (checkedUnlistedPaths.has(absolute)) continue
    // 먼저 해시만 잰다. 이미 등록된 PDF 와 내용이 같으면(다른 폴더의 사본 등) 열지 않는다.
    // PDF 를 열면 열린 문서 캐시(8개)에서 사용자가 보고 있는 문서가 밀려나 쪽이 빈칸이 된다
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const identity = await invoke<{ sha256: string }>('pdf_file_hash', { path: absolute })
      if (knownHashes.has(identity.sha256)) {
        checkedUnlistedPaths.add(absolute)
        continue
      }
    } catch {
      // 아직 복사 중이거나 읽을 수 없으면 다음 새로고침에 다시 본다
      continue
    }
    let meta: Awaited<ReturnType<typeof openPdf>>
    try {
      meta = await openPdf(absolute, undefined, { askPassword: false })
    } catch {
      continue
    }
    checkedUnlistedPaths.add(absolute)
    if (knownHashes.has(meta.sha256)) continue
    knownHashes.add(meta.sha256)
    const folderPath = relative.split('/').slice(0, -1).join('/')
    const title = relative.split('/').at(-1)!.replace(/\.pdf$/iu, '')
    const addedAt = new Date(now.getTime() + order).toISOString()
    added.push({
      docId: meta.docId,
      path: absolute,
      sha256: meta.sha256,
      size: meta.size,
      pages: meta.pageCount,
      title,
      addedAt,
      folderPath,
      attachmentPolicy: { kind: 'copy-current-folder', folderPath },
    })
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
  if (added.length === 0) return []
  await writeLibrary(vault, [...library, ...added])
  await writeVaultIndex(vault, { version: 1, entries: indexEntries })
  return added.map((entry) => `${entry.folderPath ? `${entry.folderPath}/` : ''}${entry.title}.pdf`)
}

/** 번역 캐시(번역 기록): `.iwae/translations.json`. 없거나 깨졌으면 빈 목록 */
export async function readTranslationCache(vault: VaultHandle): Promise<TranslationCacheEntry[]> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await iwaePath(vault, 'translations.json')
  if (!(await exists(path))) return []
  try {
    return parseTranslationCache(JSON.parse(await readTextFile(path)))
  } catch {
    return []
  }
}

export async function writeTranslationCache(vault: VaultHandle, entries: readonly TranslationCacheEntry[]): Promise<void> {
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  await mkdir(await iwaePath(vault, ''), { recursive: true })
  await writeVaultFile(vault, await iwaePath(vault, 'translations.json'), serializeTranslationCache(entries), 'metadata:translations.json')
}
