import { useEffect, useState } from 'react'
import { isDesktop } from '../../bridge/window'
import { revealInFolder } from '../../bridge/vaultBackup'
import {
  buildFolderThemes,
  isThemeFileName,
  type FolderThemeFile,
  type FolderThemeLoad,
} from '../../core/themeFile'
import { setFolderThemes, useUserThemes } from './userThemeStore'

/**
 * Vault 의 테마 폴더. 여기에 .iwtheme(또는 .json) 파일을 넣으면 목록에 저절로 나타나고, 지우면 사라진다.
 * Vault 폴더를 함께 나누면 테마도 함께 나뉜다. 파일이 원본이라 앱에서는 고치거나 지우지 않는다(고치면 내 테마로 복사된다).
 */
export const THEME_FOLDER = '.iwae/themes'

export function themeFolderPath(vaultRoot: string): string {
  return `${vaultRoot.replace(/[\\/]+$/u, '')}/${THEME_FOLDER}`
}

/** Windows 탐색기는 역슬래시 경로를 받는다 */
function nativePath(path: string): string {
  return /^[A-Za-z]:/u.test(path) ? path.replaceAll('/', '\\') : path
}

/** 파일 감시가 알려 준 경로가 테마 폴더 안(또는 그 폴더 자체)인가 */
export function isThemeFolderPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').toLowerCase()
  return /\/\.iwae\/themes(?:\/|$)/u.test(normalized)
}

/** 폴더의 테마 파일 글자들. 폴더가 없으면 빈 목록(만들지 않는다) */
export async function readThemeFolderFiles(vaultRoot: string): Promise<FolderThemeFile[]> {
  const folder = themeFolderPath(vaultRoot)
  const { exists, readDir, readTextFile } = await import('@tauri-apps/plugin-fs')
  if (!(await exists(folder).catch(() => false))) return []
  const entries = await readDir(folder).catch(() => [])
  const files: FolderThemeFile[] = []
  for (const entry of entries) {
    if (!entry.isFile || !isThemeFileName(entry.name, true)) continue
    try {
      files.push({ name: entry.name, text: await readTextFile(`${folder}/${entry.name}`) })
    } catch {
      files.push({ name: entry.name, text: '' })
    }
  }
  return files
}

export function loadThemeFolder(files: readonly FolderThemeFile[], takenNames: readonly string[]): FolderThemeLoad {
  return buildFolderThemes(files, takenNames)
}

/**
 * 열린 Vault 의 테마 폴더를 읽어 스토어에 알리고, 폴더가 바뀌면(파일 추가·수정·삭제) 다시 읽는다.
 * 저장한 내 테마와 이름이 겹치면 폴더 쪽에 「 (2)」 가 붙으므로 내 테마가 바뀌어도 다시 계산한다.
 */
/** Vault 폴더 아래의 모든 변화를 지켜본다(경로 목록으로 알린다). 돌려준 함수를 부르면 그만 본다 */
export type VaultWatcher = (root: string, onPaths: (paths: string[]) => void) => Promise<() => void>

async function watchVaultTree(root: string, onPaths: (paths: string[]) => void): Promise<() => void> {
  const { watch } = await import('@tauri-apps/plugin-fs')
  return watch(root, (event) => onPaths(event.paths), { recursive: true, delayMs: 100 })
}

export function useThemeFolder(vaultRoot: string | null, watcher: VaultWatcher = watchVaultTree): void {
  const [files, setFiles] = useState<readonly FolderThemeFile[]>([])
  const { themes } = useUserThemes()

  useEffect(() => {
    if (vaultRoot === null || !isDesktop()) {
      setFiles([])
      return
    }
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let unwatch: (() => void) | null = null
    const reload = () => {
      void readThemeFolderFiles(vaultRoot).then((next) => { if (!disposed) setFiles(next) }).catch(() => { if (!disposed) setFiles([]) })
    }
    reload()
    void watcher(vaultRoot, (paths) => {
      if (!paths.some(isThemeFolderPath)) return
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(reload, 120)
    }).then((stop) => {
      if (disposed) stop()
      else unwatch = stop
    }).catch(() => undefined)
    return () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      unwatch?.()
      setFolderThemes([], [])
    }
  }, [vaultRoot, watcher])

  useEffect(() => {
    const load = loadThemeFolder(files, themes.map((theme) => theme.name))
    setFolderThemes(load.themes, load.errors)
  }, [files, themes])
}

/** 테마 폴더를 탐색기·Finder 에서 연다. 폴더가 없으면 만든다. 파일이 있으면 그 파일을 골라 보여 준다 */
export async function openThemeFolder(vaultRoot: string): Promise<void> {
  const folder = themeFolderPath(vaultRoot)
  const { mkdir, readDir } = await import('@tauri-apps/plugin-fs')
  await mkdir(folder, { recursive: true })
  const first = (await readDir(folder).catch(() => [])).find((entry) => entry.isFile && isThemeFileName(entry.name, true))
  await revealInFolder(nativePath(first === undefined ? folder : `${folder}/${first.name}`))
}

/** 테마 파일 하나를 폴더에서 보여 준다 */
export async function revealThemeFile(vaultRoot: string, fileName: string): Promise<void> {
  await revealInFolder(nativePath(`${themeFolderPath(vaultRoot)}/${fileName}`))
}
