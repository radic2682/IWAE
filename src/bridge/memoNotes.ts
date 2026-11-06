import { t } from '../i18n'
import { forgetObservedFile, writeVaultRelativeText, type VaultHandle } from './vault'
import {
  MEMO_NOTES_FOLDER,
  MEMO_NOTE_EXTENSION,
  memoNoteTitleOf,
  parseMemoNote,
  serializeMemoNote,
  type MemoNote,
  type MemoNoteEntry,
} from '../core/memoNote'

/**
 * Vault 의 「노트」 폴더(하위 폴더 포함)에 있는 메모 노트 파일(*.iwnote). 쓰기는 저널 원자 쓰기,
 * 지우기는 바로 지우지 않고 .iwae/trash/notes 로 옮긴다.
 */

async function absolute(vault: VaultHandle, relativePath: string): Promise<string> {
  const { join } = await import('@tauri-apps/api/path')
  return join(vault.root, ...relativePath.replaceAll('\\', '/').split('/').filter((part) => part !== ''))
}

/** 이만큼 깊이까지만 하위 폴더를 읽는다(고리처럼 잘못 걸린 폴더에서 멈추려고) */
const MAX_FOLDER_DEPTH = 8

/** 「노트」 아래의 노트 파일과 하위 폴더(Vault 상대 경로). 점(.)으로 시작하는 폴더는 건너뛴다 */
export async function listMemoNoteTree(vault: VaultHandle): Promise<{ entries: MemoNoteEntry[]; folders: string[] }> {
  const { exists, readDir } = await import('@tauri-apps/plugin-fs')
  const entries: MemoNoteEntry[] = []
  const folders: string[] = []
  if (!(await exists(await absolute(vault, MEMO_NOTES_FOLDER)))) return { entries, folders }
  const walk = async (folder: string, depth: number): Promise<void> => {
    for (const entry of await readDir(await absolute(vault, folder))) {
      const path = `${folder}/${entry.name}`
      if (entry.isDirectory) {
        if (entry.name.startsWith('.') || depth >= MAX_FOLDER_DEPTH) continue
        folders.push(path)
        await walk(path, depth + 1)
      } else if (entry.name.toLowerCase().endsWith(MEMO_NOTE_EXTENSION)) {
        entries.push({ path, title: memoNoteTitleOf(path) })
      }
    }
  }
  await walk(MEMO_NOTES_FOLDER, 0)
  entries.sort((a, b) => a.title.localeCompare(b.title, 'ko-KR'))
  folders.sort((a, b) => a.localeCompare(b, 'ko-KR'))
  return { entries, folders }
}

export async function listMemoNotes(vault: VaultHandle): Promise<MemoNoteEntry[]> {
  return (await listMemoNoteTree(vault)).entries
}

export async function readMemoNote(vault: VaultHandle, path: string): Promise<MemoNote> {
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  return parseMemoNote(JSON.parse(await readTextFile(await absolute(vault, path))) as unknown)
}

export async function writeMemoNote(vault: VaultHandle, path: string, note: MemoNote): Promise<void> {
  await writeVaultRelativeText(vault, path, serializeMemoNote(note))
}

/** 이름 바꾸기와 다른 폴더로 옮기기(파일 하나) */
export async function renameMemoNote(vault: VaultHandle, from: string, to: string): Promise<void> {
  const { exists, rename } = await import('@tauri-apps/plugin-fs')
  const target = await absolute(vault, to)
  if (await exists(target)) throw new Error(t('같은 이름의 노트가 이미 있습니다.'))
  const source = await absolute(vault, from)
  await rename(source, target)
  forgetObservedFile(source)
}

export async function trashMemoNote(vault: VaultHandle, path: string): Promise<void> {
  const { mkdir, rename } = await import('@tauri-apps/plugin-fs')
  const trash = await absolute(vault, '.iwae/trash/notes')
  await mkdir(trash, { recursive: true })
  const name = path.replaceAll('\\', '/').split('/').at(-1) ?? 'note.iwnote'
  const source = await absolute(vault, path)
  await rename(source, await absolute(vault, `.iwae/trash/notes/${Date.now()}-${name}`))
  forgetObservedFile(source)
}

export async function createMemoNoteFolder(vault: VaultHandle, path: string): Promise<void> {
  const { exists, mkdir } = await import('@tauri-apps/plugin-fs')
  const target = await absolute(vault, path)
  if (await exists(target)) throw new Error(t('같은 이름의 폴더가 이미 있습니다.'))
  await mkdir(target, { recursive: true })
}

/** 폴더 이름 바꾸기와 다른 폴더로 옮기기. notePaths 는 그 안에 있던 노트들(감시 기록을 지운다) */
export async function renameMemoNoteFolder(vault: VaultHandle, from: string, to: string, notePaths: readonly string[] = []): Promise<void> {
  const { exists, rename } = await import('@tauri-apps/plugin-fs')
  const target = await absolute(vault, to)
  if (await exists(target)) throw new Error(t('같은 이름의 폴더가 이미 있습니다.'))
  await rename(await absolute(vault, from), target)
  for (const path of notePaths) forgetObservedFile(await absolute(vault, path))
}

/** 폴더를 통째로 .iwae/trash/notes 로 옮긴다 */
export async function trashMemoNoteFolder(vault: VaultHandle, path: string, notePaths: readonly string[] = []): Promise<void> {
  const { mkdir, rename } = await import('@tauri-apps/plugin-fs')
  await mkdir(await absolute(vault, '.iwae/trash/notes'), { recursive: true })
  const name = path.replaceAll('\\', '/').split('/').at(-1) ?? 'folder'
  await rename(await absolute(vault, path), await absolute(vault, `.iwae/trash/notes/${Date.now()}-${name}`))
  for (const notePath of notePaths) forgetObservedFile(await absolute(vault, notePath))
}

/** 탐색기에서 그 노트(폴더)를 골라 보인다 */
export async function revealMemoNote(vault: VaultHandle, path: string): Promise<void> {
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(await absolute(vault, path))
}

export async function memoNoteAbsolutePath(vault: VaultHandle, path: string): Promise<string> {
  return absolute(vault, path)
}
