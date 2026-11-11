import {
  moveIndexEntry,
  renameDisplayName,
  type VaultIndexEntry,
  type VaultIndexFile,
} from '../core/vaultIndex'
import {
  readLibrary,
  readVaultIndex,
  writeLibrary,
  writeVaultIndex,
  type VaultHandle,
  type VaultLibraryEntry,
} from './vault'
import { errorText } from '../core/errorText'
import { t } from '../i18n'

export type RenameMode = 'display' | 'original'

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu

/**
 * 사용자가 친 이름을 파일·폴더 이름으로 다듬는다. Windows 는 이름 끝의 마침표·공백을 허용하지
 * 않으므로 탐색기처럼 조용히 떼고, 그 밖에 못 쓰는 이름은 이유를 말해 준다.
 */
export function cleanEntryName(value: string): string {
  const name = value.trim().replace(/[. ]+$/u, '')
  if (name === '' || name === '.' || name === '..') throw new Error(t('이름을 입력해 주세요.'))
  const bad = name.match(/[<>:"/\\|?*]/u)
  if (bad !== null) throw new Error(t(`이름에 '{char}' 는 쓸 수 없습니다 (< > : " / \\ | ? * 는 Windows 에서 못 씁니다).`, { char: bad[0] }))
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/u.test(name)) throw new Error(t('이름에 제어 문자가 들어 있습니다.'))
  if (WINDOWS_RESERVED.test(name)) throw new Error(t("'{name}' 은 Windows 가 예약한 이름이라 쓸 수 없습니다 (CON, NUL, COM1 등).", { name }))
  return name
}

function safeName(value: string): string {
  return cleanEntryName(value)
}

function safeRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '')
  if (normalized === '') return ''
  const parts = normalized.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..' || safeName(part) !== part)) {
    throw new Error(t('Vault 경로가 올바르지 않습니다.'))
  }
  return parts.join('/')
}

function filename(path: string): string {
  const name = path.replaceAll('\\', '/').split('/').at(-1)
  if (name === undefined || name === '') throw new Error(t('파일 이름을 확인할 수 없습니다.'))
  return name
}

function relativeParent(path: string): string {
  return path.replaceAll('\\', '/').split('/').slice(0, -1).join('/')
}

function replaceEntry(index: VaultIndexFile, updated: VaultIndexEntry): VaultIndexFile {
  return {
    version: 1,
    entries: index.entries.map((entry) => entry.id === updated.id ? updated : entry),
  }
}

function requireEntry(index: VaultIndexFile, id: string): VaultIndexEntry {
  const entry = index.entries.find((candidate) => candidate.id === id)
  if (entry === undefined) throw new Error(t('Vault 파일을 찾지 못했습니다.'))
  return entry
}

async function vaultAbsolutePath(vault: VaultHandle, relativePath: string): Promise<string> {
  const { join } = await import('@tauri-apps/api/path')
  const normalized = safeRelativePath(relativePath)
  return normalized === '' ? vault.root : join(vault.root, ...normalized.split('/'))
}

async function ensureAvailable(path: string): Promise<void> {
  const { exists } = await import('@tauri-apps/plugin-fs')
  if (await exists(path)) throw new Error(t('대상 위치에 같은 이름의 파일이 이미 있습니다.'))
}

function updatePdfLibrary(
  library: readonly VaultLibraryEntry[],
  id: string,
  update: (entry: VaultLibraryEntry) => VaultLibraryEntry,
): VaultLibraryEntry[] | null {
  if (!library.some((entry) => entry.docId === id)) return null
  return library.map((entry) => entry.docId === id ? update(entry) : entry)
}

async function rollbackFailure(error: unknown, actions: readonly (() => Promise<void>)[]): Promise<never> {
  const rollbackErrors: string[] = []
  for (const action of actions) {
    try {
      await action()
    } catch (rollbackError) {
      rollbackErrors.push(errorText(rollbackError))
    }
  }
  if (rollbackErrors.length > 0) {
    throw new Error(t('파일 작업 실패 후 원상 복구하지 못했습니다: {error} / {rollback}', { error: errorText(error), rollback: rollbackErrors.join(' / ') }))
  }
  throw error
}

function copiedPolicy(folderPath: string) {
  return { kind: 'copy-another-folder' as const, folderPath }
}

export async function createVaultFolder(
  vault: VaultHandle,
  parentPath: string,
  requestedName: string,
): Promise<string> {
  const parent = safeRelativePath(parentPath)
  const name = safeName(requestedName)
  const relativePath = [parent, name].filter(Boolean).join('/')
  const path = await vaultAbsolutePath(vault, relativePath)
  await ensureAvailable(path)
  const { mkdir } = await import('@tauri-apps/plugin-fs')
  await mkdir(path, { recursive: false })
  return relativePath
}

export async function renameVaultEntry(
  vault: VaultHandle,
  id: string,
  requestedName: string,
  requestedMode?: RenameMode,
): Promise<VaultIndexEntry> {
  const index = await readVaultIndex(vault)
  const entry = requireEntry(index, id)
  const mode = requestedMode ?? (entry.storage === 'reference' ? 'display' : 'original')
  if (mode === 'display') {
    const updatedIndex = renameDisplayName(index, id, requestedName)
    await writeVaultIndex(vault, updatedIndex)
    return requireEntry(updatedIndex, id)
  }

  const name = safeName(requestedName)
  const { dirname, join } = await import('@tauri-apps/api/path')
  const sourcePath = entry.storage === 'vault'
    ? await vaultAbsolutePath(vault, entry.path)
    : entry.path
  const targetPath = await join(await dirname(sourcePath), name)
  await ensureAvailable(targetPath)
  const { rename } = await import('@tauri-apps/plugin-fs')
  const originalLibrary = entry.kind === 'pdf' ? await readLibrary(vault) : null
  await rename(sourcePath, targetPath)

  try {
    const indexedPath = entry.storage === 'vault'
      ? [relativeParent(entry.path), name].filter(Boolean).join('/')
      : targetPath
    const movedIndex = moveIndexEntry(index, id, indexedPath)
    const updatedIndex = renameDisplayName(movedIndex, id, name.replace(/\.[^.]+$/u, ''))
    if (originalLibrary !== null) {
      const updatedLibrary = updatePdfLibrary(originalLibrary, id, (libraryEntry) => ({
        ...libraryEntry,
        path: targetPath,
        title: name.replace(/\.[^.]+$/u, ''),
      }))
      if (updatedLibrary !== null) await writeLibrary(vault, updatedLibrary)
    }
    await writeVaultIndex(vault, updatedIndex)
    return requireEntry(updatedIndex, id)
  } catch (error) {
    return rollbackFailure(error, [
      () => rename(targetPath, sourcePath),
      ...(originalLibrary === null ? [] : [() => writeLibrary(vault, originalLibrary)]),
    ])
  }
}

export async function moveVaultEntry(
  vault: VaultHandle,
  id: string,
  destinationFolder: string,
): Promise<VaultIndexEntry> {
  const index = await readVaultIndex(vault)
  const entry = requireEntry(index, id)
  const folder = safeRelativePath(destinationFolder)
  if (entry.storage !== 'vault') {
    // 참조 PDF 의 폴더는 Library 안의 정리 위치일 뿐이라, 원본 파일은 그대로 두고 위치만 바꾼다.
    if (entry.kind !== 'pdf') throw new Error(t('외부 참조는 Vault 폴더로 직접 이동할 수 없습니다.'))
    const updatedLibrary = updatePdfLibrary(await readLibrary(vault), id, (libraryEntry) => ({
      ...libraryEntry,
      folderPath: folder,
    }))
    if (updatedLibrary !== null) await writeLibrary(vault, updatedLibrary)
    return entry
  }
  const nextRelativePath = [folder, filename(entry.path)].filter(Boolean).join('/')
  const sourcePath = await vaultAbsolutePath(vault, entry.path)
  const targetPath = await vaultAbsolutePath(vault, nextRelativePath)
  await ensureAvailable(targetPath)
  const { mkdir, rename } = await import('@tauri-apps/plugin-fs')
  const originalLibrary = entry.kind === 'pdf' ? await readLibrary(vault) : null
  await mkdir(await vaultAbsolutePath(vault, folder), { recursive: true })
  await rename(sourcePath, targetPath)
  try {
    const updatedIndex = moveIndexEntry(index, id, nextRelativePath)
    if (originalLibrary !== null) {
      const updatedLibrary = updatePdfLibrary(originalLibrary, id, (libraryEntry) => ({
        ...libraryEntry,
        path: targetPath,
        folderPath: folder,
        attachmentPolicy: copiedPolicy(folder),
      }))
      if (updatedLibrary !== null) await writeLibrary(vault, updatedLibrary)
    }
    await writeVaultIndex(vault, updatedIndex)
    return requireEntry(updatedIndex, id)
  } catch (error) {
    return rollbackFailure(error, [
      () => rename(targetPath, sourcePath),
      ...(originalLibrary === null ? [] : [() => writeLibrary(vault, originalLibrary)]),
    ])
  }
}

async function readTrashEntries(vault: VaultHandle): Promise<Record<string, unknown>[]> {
  const { exists, readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await vaultAbsolutePath(vault, '.iwae/trash/index.json')
  if (!(await exists(path))) return []
  const value: unknown = JSON.parse(await readTextFile(path))
  if (typeof value !== 'object' || value === null || !('entries' in value) || !Array.isArray(value.entries)) {
    throw new Error(t('휴지통 인덱스 형식이 올바르지 않습니다.'))
  }
  return value.entries.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
}

async function writeTrashEntries(vault: VaultHandle, entries: readonly Record<string, unknown>[]): Promise<void> {
  const { mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs')
  await mkdir(await vaultAbsolutePath(vault, '.iwae/trash'), { recursive: true })
  await writeTextFile(
    await vaultAbsolutePath(vault, '.iwae/trash/index.json'),
    `${JSON.stringify({ version: 1, entries }, null, 2)}\n`,
  )
}

/**
 * 휴지통으로 옮긴 계기. 휴지통 기록(.iwae/trash/index.json)의 source 에 남겨, 문서가 사라졌다는 보고가 오면
 * 어느 화면의 어떤 동작이었는지 알 수 있게 한다.
 */
export type TrashSource = 'context-menu-confirmed' | 'folder-dialog-confirmed' | 'unspecified'

export async function trashVaultEntry(vault: VaultHandle, id: string, source: TrashSource = 'unspecified'): Promise<void> {
  const index = await readVaultIndex(vault)
  const entry = requireEntry(index, id)
  const originalLibrary = entry.kind === 'pdf' ? await readLibrary(vault) : null
  let trashEntries: Record<string, unknown>[] | null = null
  let sourcePath: string | null = null
  let targetPath: string | null = null
  let moved = false
  try {
    if (entry.storage === 'vault') {
      const trashedPath = `.iwae/trash/${id}-${filename(entry.path)}`
      sourcePath = await vaultAbsolutePath(vault, entry.path)
      targetPath = await vaultAbsolutePath(vault, trashedPath)
      await ensureAvailable(targetPath)
      trashEntries = await readTrashEntries(vault)
      await writeTrashEntries(vault, [...trashEntries, {
        id,
        originalPath: entry.path,
        trashedPath,
        deletedAt: new Date().toISOString(),
        source,
        indexEntry: entry,
      }])
      const { rename } = await import('@tauri-apps/plugin-fs')
      await rename(sourcePath, targetPath)
      moved = true
    }
    if (originalLibrary !== null) {
      await writeLibrary(vault, originalLibrary.filter((candidate) => candidate.docId !== id))
    }
    await writeVaultIndex(vault, {
      version: 1,
      entries: index.entries.filter((candidate) => candidate.id !== id),
    })
  } catch (error) {
    const { rename } = await import('@tauri-apps/plugin-fs')
    const rollbackActions: (() => Promise<void>)[] = []
    if (moved && sourcePath !== null && targetPath !== null) {
      const rollbackSource = targetPath
      const rollbackTarget = sourcePath
      rollbackActions.push(() => rename(rollbackSource, rollbackTarget))
    }
    if (trashEntries !== null) {
      const originalTrashEntries = trashEntries
      rollbackActions.push(() => writeTrashEntries(vault, originalTrashEntries))
    }
    if (originalLibrary !== null) rollbackActions.push(() => writeLibrary(vault, originalLibrary))
    return rollbackFailure(error, rollbackActions)
  }
}

async function quietly(action: () => Promise<unknown>): Promise<void> {
  try {
    await action()
  } catch {
    // 되돌리기·정리 단계의 실패는 원래 오류를 가리지 않게 삼킨다
  }
}

/**
 * 디렉터리를 옮긴다. Windows 는 안의 파일 하나라도 열려 있으면(PDFium 이 읽고 있는 PDF 등)
 * 디렉터리 이름 바꾸기를 거절하지만, 열린 파일 자체는 옮길 수 있다(공유 삭제 모드).
 * 그래서 통째 이동이 실패하면 파일을 하나씩 옮기고 빈 디렉터리를 지운다.
 * 도중에 실패하면 옮긴 파일을 되돌리고 그 오류를 던진다.
 */
export async function moveDirectory(source: string, target: string, vaultRoot?: string): Promise<void> {
  // 데스크톱: Rust 가 한 번에 옮긴다(파일마다 부르면 그림·작업 폴더가 많은 폴더에서 아주 느리다)
  if (vaultRoot !== undefined && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('vault_move_dir', { vaultRoot, from: source, to: target })
    return
  }
  const { mkdir, readDir, remove, rename } = await import('@tauri-apps/plugin-fs')
  const { join } = await import('@tauri-apps/api/path')
  try {
    await rename(source, target)
    return
  } catch (directoryError) {
    const moved: [string, string][] = []
    const createdDirectories: string[] = []
    const sourceDirectories: string[] = []
    const visit = async (from: string, to: string): Promise<void> => {
      await mkdir(to, { recursive: true })
      createdDirectories.push(to)
      sourceDirectories.push(from)
      for (const child of await readDir(from)) {
        const childFrom = await join(from, child.name)
        const childTo = await join(to, child.name)
        if (child.isDirectory) {
          await visit(childFrom, childTo)
        } else {
          await rename(childFrom, childTo)
          moved.push([childFrom, childTo])
        }
      }
    }
    try {
      await visit(source, target)
    } catch (fileError) {
      for (const [from, to] of moved.reverse()) {
        await quietly(() => rename(to, from))
      }
      for (const directory of createdDirectories.reverse()) {
        await quietly(() => remove(directory))
      }
      throw fileError ?? directoryError
    }
    // 이제 비어 있는 원래 디렉터리들을 안쪽부터 지운다. 재귀 삭제는 쓰지 않는다 —
    // 그사이 누가 파일을 넣었다면 지우지 않고 남기는 편이 안전하다.
    for (const directory of sourceDirectories.reverse()) {
      await quietly(() => remove(directory))
    }
  }
}

function folderRelativeKey(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '').toLocaleLowerCase()
}

/** path 가 folder 자신이거나 그 아래에 있는가. 대소문자는 Windows 처럼 가리지 않는다 */
function isWithinFolder(path: string, folder: string): boolean {
  const candidate = folderRelativeKey(path)
  const parent = folderRelativeKey(folder)
  return parent !== '' && (candidate === parent || candidate.startsWith(`${parent}/`))
}

/** folder 접두어를 nextFolder 로 바꾼다. 아래에 있지 않으면 그대로 돌려준다 */
function replaceFolderPrefix(path: string, folder: string, nextFolder: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '')
  if (!isWithinFolder(normalized, folder)) return path
  return `${nextFolder}${normalized.slice(folder.length)}`
}

/** 폴더 안의 vault 파일과 그 폴더로 정리된 PDF 들 */
function folderMembers(
  folder: string,
  index: VaultIndexFile,
  library: readonly VaultLibraryEntry[],
  absoluteFolder: string,
): { indexEntries: VaultIndexEntry[]; libraryEntries: VaultLibraryEntry[] } {
  const absoluteKey = absoluteFolder.replaceAll('\\', '/').toLocaleLowerCase()
  const libraryEntries = library.filter((entry) => (
    isWithinFolder(entry.folderPath ?? '', folder)
    || entry.path.replaceAll('\\', '/').toLocaleLowerCase().startsWith(`${absoluteKey}/`)
  ))
  const libraryIds = new Set(libraryEntries.map((entry) => entry.docId))
  const indexEntries = index.entries.filter((entry) => (
    libraryIds.has(entry.id) || (entry.storage === 'vault' && isWithinFolder(entry.path, folder))
  ))
  return { indexEntries, libraryEntries }
}

/**
 * 폴더를 통째로 Vault 휴지통(.iwae/trash)으로 옮긴다. 지우지 않는다 —
 * 휴지통 항목에 안의 색인·Library 항목을 함께 남겨 복원할 때 되돌린다.
 * 이 폴더로 정리된 참조 PDF 도 목록에서 함께 빠진다(원본 파일은 건드리지 않는다).
 * 돌려주는 값은 목록에서 빠진 항목 id 들이다.
 */
export async function trashVaultFolder(vault: VaultHandle, folderPath: string, source: TrashSource = 'unspecified'): Promise<string[]> {
  const folder = safeRelativePath(folderPath)
  if (folder === '') throw new Error(t('Vault 루트 폴더는 삭제할 수 없습니다.'))
  const sourcePath = await vaultAbsolutePath(vault, folder)
  const { exists } = await import('@tauri-apps/plugin-fs')
  if (!(await exists(sourcePath))) throw new Error(t('삭제할 폴더를 찾지 못했습니다.'))
  const index = await readVaultIndex(vault)
  const library = await readLibrary(vault)
  const { indexEntries, libraryEntries } = folderMembers(folder, index, library, sourcePath)
  const removedIds = new Set([...indexEntries.map((entry) => entry.id), ...libraryEntries.map((entry) => entry.docId)])
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`
  const trashedPath = `.iwae/trash/${id}-${filename(folder)}`
  const targetPath = await vaultAbsolutePath(vault, trashedPath)
  await ensureAvailable(targetPath)
  const trashEntries = await readTrashEntries(vault)
  await writeTrashEntries(vault, [...trashEntries, {
    id,
    kind: 'folder',
    originalPath: folder,
    trashedPath,
    deletedAt: new Date().toISOString(),
    source,
    indexEntries,
    libraryEntries,
  }])
  let moved = false
  try {
    await moveDirectory(sourcePath, targetPath, vault.root)
    moved = true
    if (libraryEntries.length > 0) {
      await writeLibrary(vault, library.filter((entry) => !removedIds.has(entry.docId)))
    }
    await writeVaultIndex(vault, {
      version: 1,
      entries: index.entries.filter((entry) => !removedIds.has(entry.id)),
    })
  } catch (error) {
    return rollbackFailure(error, [
      ...(moved ? [() => moveDirectory(targetPath, sourcePath, vault.root)] : []),
      () => writeTrashEntries(vault, trashEntries),
      ...(libraryEntries.length > 0 ? [() => writeLibrary(vault, library)] : []),
    ])
  }
  return [...removedIds]
}

/**
 * 폴더 이름을 바꾼다. 실제 디렉터리 이름을 바꾸고, 그 아래 항목의 색인 경로와
 * Library 의 경로·정리 위치를 새 이름으로 옮긴다. 새 상대 경로를 돌려준다.
 */
export async function renameVaultFolder(
  vault: VaultHandle,
  folderPath: string,
  requestedName: string,
): Promise<string> {
  const folder = safeRelativePath(folderPath)
  if (folder === '') throw new Error(t('Vault 루트 폴더의 이름은 바꿀 수 없습니다.'))
  const name = safeName(requestedName)
  return relocateVaultFolder(vault, folder, [relativeParent(folder), name].filter(Boolean).join('/'))
}

/**
 * 폴더를 다른 폴더 안(빈 문자열이면 Vault 맨 위)으로 옮긴다. 이름은 그대로다. 새 상대 경로를 돌려준다.
 */
export async function moveVaultFolder(
  vault: VaultHandle,
  folderPath: string,
  destinationParent: string,
): Promise<string> {
  const folder = safeRelativePath(folderPath)
  if (folder === '') throw new Error(t('Vault 루트 폴더는 옮길 수 없습니다.'))
  const parent = safeRelativePath(destinationParent)
  const folderKey = folderRelativeKey(folder)
  const parentKey = folderRelativeKey(parent)
  if (parentKey === folderKey || parentKey.startsWith(`${folderKey}/`)) {
    throw new Error(t('폴더를 자기 안으로 옮길 수 없습니다.'))
  }
  const name = folder.split('/').at(-1) ?? folder
  return relocateVaultFolder(vault, folder, [parent, name].filter(Boolean).join('/'))
}

async function relocateVaultFolder(vault: VaultHandle, folder: string, nextFolder: string): Promise<string> {
  if (nextFolder === folder) return folder
  const sourcePath = await vaultAbsolutePath(vault, folder)
  const targetPath = await vaultAbsolutePath(vault, nextFolder)
  // 대소문자만 바꾸는 경우는 같은 폴더라 "이미 있음" 검사를 건너뛴다
  if (folderRelativeKey(nextFolder) !== folderRelativeKey(folder)) await ensureAvailable(targetPath)
  const index = await readVaultIndex(vault)
  const library = await readLibrary(vault)
  const { indexEntries, libraryEntries } = folderMembers(folder, index, library, sourcePath)
  const movedIndexIds = new Set(indexEntries.filter((entry) => entry.storage === 'vault').map((entry) => entry.id))
  const movedLibraryIds = new Set(libraryEntries.map((entry) => entry.docId))
  const absoluteSourceKey = sourcePath.replaceAll('\\', '/').toLocaleLowerCase()
  await moveDirectory(sourcePath, targetPath, vault.root)
  try {
    if (movedLibraryIds.size > 0) {
      await writeLibrary(vault, library.map((entry) => {
        if (!movedLibraryIds.has(entry.docId)) return entry
        const insideOnDisk = entry.path.replaceAll('\\', '/').toLocaleLowerCase().startsWith(`${absoluteSourceKey}/`)
        const nextFolderPath = entry.folderPath === undefined ? undefined : replaceFolderPrefix(entry.folderPath, folder, nextFolder)
        const policy = entry.attachmentPolicy
        return {
          ...entry,
          path: insideOnDisk ? `${targetPath}${entry.path.slice(sourcePath.length)}` : entry.path,
          ...(nextFolderPath === undefined ? {} : { folderPath: nextFolderPath }),
          ...(policy !== undefined && 'folderPath' in policy && typeof policy.folderPath === 'string'
            ? { attachmentPolicy: { ...policy, folderPath: replaceFolderPrefix(policy.folderPath, folder, nextFolder) } }
            : {}),
        }
      }))
    }
    await writeVaultIndex(vault, {
      version: 1,
      entries: index.entries.map((entry) => movedIndexIds.has(entry.id)
        ? { ...entry, path: replaceFolderPrefix(entry.path, folder, nextFolder) }
        : entry),
    })
  } catch (error) {
    return rollbackFailure(error, [
      () => moveDirectory(targetPath, sourcePath, vault.root),
      ...(movedLibraryIds.size > 0 ? [() => writeLibrary(vault, library)] : []),
    ])
  }
  return nextFolder
}

export async function duplicateVaultEntry(
  vault: VaultHandle,
  id: string,
  destinationFolder = '',
): Promise<VaultIndexEntry> {
  const index = await readVaultIndex(vault)
  const entry = requireEntry(index, id)
  const folder = safeRelativePath(destinationFolder)
  const originalName = filename(entry.path)
  const dot = originalName.lastIndexOf('.')
  const stem = dot > 0 ? originalName.slice(0, dot) : originalName
  const extension = dot > 0 ? originalName.slice(dot) : ''
  let copyName = `${stem} copy${extension}`
  let sequence = 2
  while (await (await import('@tauri-apps/plugin-fs')).exists(await vaultAbsolutePath(vault, [folder, copyName].filter(Boolean).join('/')))) {
    copyName = `${stem} copy ${sequence}${extension}`
    sequence += 1
  }
  const relativePath = [folder, copyName].filter(Boolean).join('/')
  const sourcePath = entry.storage === 'vault' ? await vaultAbsolutePath(vault, entry.path) : entry.path
  const targetPath = await vaultAbsolutePath(vault, relativePath)
  const { copyFile, mkdir } = await import('@tauri-apps/plugin-fs')
  const originalLibrary = entry.kind === 'pdf' ? await readLibrary(vault) : null
  await mkdir(await vaultAbsolutePath(vault, folder), { recursive: true })
  await copyFile(sourcePath, targetPath)
  const newEntry: VaultIndexEntry = {
    ...entry,
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${sequence}`,
    storage: 'vault',
    path: relativePath,
    displayName: copyName.replace(/\.[^.]+$/u, ''),
    addedAt: new Date().toISOString(),
  }
  try {
    if (originalLibrary !== null) {
      const source = originalLibrary.find((candidate) => candidate.docId === id)
      if (source !== undefined) {
        await writeLibrary(vault, [...originalLibrary, {
          ...source,
          docId: newEntry.id,
          path: targetPath,
          title: newEntry.displayName,
          folderPath: folder,
          attachmentPolicy: copiedPolicy(folder),
          addedAt: newEntry.addedAt,
        }])
      }
    }
    await writeVaultIndex(vault, { version: 1, entries: [...index.entries, newEntry] })
    return newEntry
  } catch (error) {
    const { remove } = await import('@tauri-apps/plugin-fs')
    return rollbackFailure(error, [
      () => remove(targetPath),
      ...(originalLibrary === null ? [] : [() => writeLibrary(vault, originalLibrary)]),
    ])
  }
}

export async function convertReferenceToCopy(
  vault: VaultHandle,
  id: string,
  destinationFolder = '',
): Promise<VaultIndexEntry> {
  const index = await readVaultIndex(vault)
  const entry = requireEntry(index, id)
  if (entry.storage !== 'reference') return entry
  const folder = safeRelativePath(destinationFolder)
  const relativePath = [folder, filename(entry.path)].filter(Boolean).join('/')
  const targetPath = await vaultAbsolutePath(vault, relativePath)
  await ensureAvailable(targetPath)
  const { copyFile, mkdir } = await import('@tauri-apps/plugin-fs')
  const originalLibrary = entry.kind === 'pdf' ? await readLibrary(vault) : null
  await mkdir(await vaultAbsolutePath(vault, folder), { recursive: true })
  await copyFile(entry.path, targetPath)
  const updated = { ...entry, storage: 'vault' as const, path: relativePath }
  try {
    if (originalLibrary !== null) {
      const updatedLibrary = updatePdfLibrary(originalLibrary, id, (libraryEntry) => ({
        ...libraryEntry,
        path: targetPath,
        folderPath: folder,
        attachmentPolicy: copiedPolicy(folder),
      }))
      if (updatedLibrary !== null) await writeLibrary(vault, updatedLibrary)
    }
    await writeVaultIndex(vault, replaceEntry(index, updated))
    return updated
  } catch (error) {
    const { remove } = await import('@tauri-apps/plugin-fs')
    return rollbackFailure(error, [
      () => remove(targetPath),
      ...(originalLibrary === null ? [] : [() => writeLibrary(vault, originalLibrary)]),
    ])
  }
}

export async function copyVaultEntryPath(vault: VaultHandle, id: string): Promise<string> {
  const entry = requireEntry(await readVaultIndex(vault), id)
  return entry.storage === 'vault' ? vaultAbsolutePath(vault, entry.path) : entry.path
}
