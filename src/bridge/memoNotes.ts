import { t } from '../i18n'
import { forgetObservedFile, inspectVaultRelativeFile, trackVaultRelativeRead, writeVaultRelativeText, type VaultHandle } from './vault'
import type { SyncCodec } from '../core/vaultSync'
import type { TrashSource } from './vaultFiles'
import {
  MEMO_NOTES_FOLDER_CANDIDATES,
  detectMemoNotesFolder,
  rememberMemoNotesFolder,
  MEMO_NOTE_EXTENSION,
  memoNoteTitleOf,
  parseMemoNote,
  serializeMemoNote,
  type MemoNote,
  type MemoNoteEntry,
} from '../core/memoNote'

/**
 * Vault 의 노트 폴더(「노트」 또는 「Notes」, 하위 폴더 포함)에 있는 메모 노트 파일(*.iwnote). 쓰기는 저널 원자 쓰기,
 * 지우기는 바로 지우지 않고 .iwae/trash/notes 로 옮긴다.
 */

async function absolute(vault: VaultHandle, relativePath: string): Promise<string> {
  const { join } = await import('@tauri-apps/api/path')
  return join(vault.root, ...relativePath.replaceAll('\\', '/').split('/').filter((part) => part !== ''))
}

/** 이만큼 깊이까지만 하위 폴더를 읽는다(고리처럼 잘못 걸린 폴더에서 멈추려고) */
const MAX_FOLDER_DEPTH = 8

/** 노트 폴더 아래의 노트 파일과 하위 폴더(Vault 상대 경로). 점(.)으로 시작하는 폴더는 건너뛴다 */
export async function listMemoNoteTree(vault: VaultHandle): Promise<{ entries: MemoNoteEntry[]; folders: string[] }> {
  const { exists, readDir } = await import('@tauri-apps/plugin-fs')
  const entries: MemoNoteEntry[] = []
  const folders: string[] = []
  const root = await detectMemoNotesFolder(async (name) => exists(await absolute(vault, name)))
  if (!(await exists(await absolute(vault, root)))) return { entries, folders }
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
  await walk(root, 0)
  entries.sort((a, b) => a.title.localeCompare(b.title, 'ko-KR'))
  folders.sort((a, b) => a.localeCompare(b, 'ko-KR'))
  return { entries, folders }
}

export async function listMemoNotes(vault: VaultHandle): Promise<MemoNoteEntry[]> {
  return (await listMemoNoteTree(vault)).entries
}

export async function readMemoNote(vault: VaultHandle, path: string): Promise<MemoNote> {
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  const text = await readTextFile(await absolute(vault, path))
  const note = parseMemoNote(JSON.parse(text) as unknown)
  // 다음 저장에서 다른 창의 변경과 합칠 때의 바탕
  trackVaultRelativeRead(vault, path, text)
  return note
}

/** 창 사이 동기화용: 저장할 때의 글 모양과 같다 */
export const memoNoteCodec: SyncCodec<MemoNote> = {
  serialize: serializeMemoNote,
  parse: (text) => parseMemoNote(JSON.parse(text) as unknown),
}

/** 노트를 옮기거나 지우거나 폴더를 바꿨다: 다른 창이 목록을 다시 맞추게 알린다 */
export const MEMO_NOTES_CHANGED_EVENT = 'iwae:memo-notes-changed'

async function announceNotesChanged(vault: VaultHandle): Promise<void> {
  try {
    const { isDesktop, currentWindowLabel } = await import('./window')
    if (!isDesktop()) return
    const { emit } = await import('@tauri-apps/api/event')
    await emit(MEMO_NOTES_CHANGED_EVENT, { root: vault.root, source: currentWindowLabel() })
  } catch {
    // 알리지 못해도 이 창의 일은 끝났다
  }
}

/** 다른 창이 노트 목록을 바꿨을 때 부른다. 돌려주는 함수로 끊는다 */
export async function onMemoNotesChanged(vault: VaultHandle, handler: () => void): Promise<() => void> {
  const { isDesktop, currentWindowLabel } = await import('./window')
  if (!isDesktop()) return () => undefined
  const { listen } = await import('@tauri-apps/api/event')
  return listen<{ root: string; source: string }>(MEMO_NOTES_CHANGED_EVENT, (event) => {
    if (event.payload.source === currentWindowLabel()) return
    if (event.payload.root.replaceAll('\\', '/').toLowerCase() !== vault.root.replaceAll('\\', '/').toLowerCase()) return
    handler()
  })
}

/** 디스크의 노트 파일을 이 앱이 마지막으로 읽거나 쓴 내용과 견준 결과(note 는 읽을 수 있을 때만) */
export type MemoNoteDisk =
  | { readonly state: 'same' }
  | { readonly state: 'missing' }
  | { readonly state: 'changed'; readonly text: string; readonly note: MemoNote | null }

export async function inspectMemoNote(vault: VaultHandle, path: string): Promise<MemoNoteDisk> {
  const result = await inspectVaultRelativeFile(vault, path)
  if (result.state !== 'changed') return result
  let note: MemoNote | null = null
  try { note = parseMemoNote(JSON.parse(result.text) as unknown) } catch { /* 쓰는 도중이거나 깨진 파일 */ }
  return { state: 'changed', text: result.text, note }
}

/** 디스크 내용(text)을 이 앱이 아는 내용으로 받아들인다: 이후 저장의 바탕이 되고 외부 변경 확인이 같다고 본다 */
export function adoptMemoNoteText(vault: VaultHandle, path: string, text: string): void {
  trackVaultRelativeRead(vault, path, text)
}

/**
 * 노트를 쓴다. 디스크의 파일이 이 앱이 마지막으로 읽거나 쓴 내용과 다르면(다른 프로그램이 고쳤다) 쓰지 않고
 * VaultExternalChangeError 를 던진다.
 */
export async function writeMemoNote(vault: VaultHandle, path: string, note: MemoNote): Promise<void> {
  await writeVaultRelativeText(vault, path, serializeMemoNote(note), { guardExternalChange: true })
  rememberMemoNotesFolder(path.replaceAll('\\', '/').split('/')[0] ?? '')
}

/** 이름 바꾸기와 다른 폴더로 옮기기(파일 하나) */
export async function renameMemoNote(vault: VaultHandle, from: string, to: string): Promise<void> {
  const { exists, rename } = await import('@tauri-apps/plugin-fs')
  const target = await absolute(vault, to)
  if (await exists(target)) throw new Error(t('같은 이름의 노트가 이미 있습니다.'))
  const source = await absolute(vault, from)
  await rename(source, target)
  forgetObservedFile(source)
  await announceNotesChanged(vault)
}

/** 노트 하나를 .iwae/trash/notes 로 옮긴다. 어느 화면에서 옮겼는지(source)는 옆에 .why.json 으로 남긴다(진단용, 실패해도 옮기기는 그대로) */
export async function trashMemoNote(vault: VaultHandle, path: string, source: TrashSource = 'unspecified'): Promise<void> {
  const { mkdir, rename } = await import('@tauri-apps/plugin-fs')
  const trash = await absolute(vault, '.iwae/trash/notes')
  await mkdir(trash, { recursive: true })
  const name = path.replaceAll('\\', '/').split('/').at(-1) ?? 'note.iwnote'
  const from = await absolute(vault, path)
  const stamp = Date.now()
  const trashedRelative = `.iwae/trash/notes/${stamp}-${name}`
  await rename(from, await absolute(vault, trashedRelative))
  forgetObservedFile(from)
  if (source !== 'unspecified') {
    try {
      const { writeTextFile } = await import('@tauri-apps/plugin-fs')
      await writeTextFile(await absolute(vault, `${trashedRelative}.why.json`), JSON.stringify({ originalPath: path, deletedAt: new Date(stamp).toISOString(), source }))
    } catch {
      // 기록은 진단용이라 실패해도 노트는 이미 옮겨졌다
    }
  }
  await announceNotesChanged(vault)
}

export async function createMemoNoteFolder(vault: VaultHandle, path: string): Promise<void> {
  const { exists, mkdir } = await import('@tauri-apps/plugin-fs')
  const target = await absolute(vault, path)
  if (await exists(target)) throw new Error(t('같은 이름의 폴더가 이미 있습니다.'))
  await mkdir(target, { recursive: true })
  await announceNotesChanged(vault)
}

/** 폴더 이름 바꾸기와 다른 폴더로 옮기기. notePaths 는 그 안에 있던 노트들(감시 기록을 지운다) */
export async function renameMemoNoteFolder(vault: VaultHandle, from: string, to: string, notePaths: readonly string[] = []): Promise<void> {
  const { exists, rename } = await import('@tauri-apps/plugin-fs')
  const target = await absolute(vault, to)
  if (await exists(target)) throw new Error(t('같은 이름의 폴더가 이미 있습니다.'))
  await rename(await absolute(vault, from), target)
  for (const path of notePaths) forgetObservedFile(await absolute(vault, path))
  await announceNotesChanged(vault)
}

/** 폴더를 통째로 .iwae/trash/notes 로 옮긴다 */
export async function trashMemoNoteFolder(vault: VaultHandle, path: string, notePaths: readonly string[] = []): Promise<void> {
  const { mkdir, rename } = await import('@tauri-apps/plugin-fs')
  await mkdir(await absolute(vault, '.iwae/trash/notes'), { recursive: true })
  const name = path.replaceAll('\\', '/').split('/').at(-1) ?? 'folder'
  await rename(await absolute(vault, path), await absolute(vault, `.iwae/trash/notes/${Date.now()}-${name}`))
  for (const notePath of notePaths) forgetObservedFile(await absolute(vault, notePath))
  await announceNotesChanged(vault)
}

/** 탐색기에서 그 노트(폴더)를 골라 보인다 */
export async function revealMemoNote(vault: VaultHandle, path: string): Promise<void> {
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(await absolute(vault, path))
}

export async function memoNoteAbsolutePath(vault: VaultHandle, path: string): Promise<string> {
  return absolute(vault, path)
}

export interface MemoNoteFileChange {
  /** 바뀐 노트 파일(Vault 상대 경로, 노트 폴더 안의 *.iwnote) */
  readonly notePaths: readonly string[]
  /** 노트 폴더 안의 폴더·이름 바뀜처럼 목록을 다시 맞춰야 하는 변경이 섞였다 */
  readonly rescan: boolean
}

/**
 * 앱 밖에서(다른 프로그램·AI 에이전트·동기화 도구·git) 노트 파일이 만들어지거나 바뀌거나 이름이 바뀌거나 지워지면 알린다.
 * Vault 를 재귀로 감시하고(0.3초 묶음) 노트 폴더(「노트」·「Notes」, 하위 폴더 포함)의 *.iwnote 만 걸러 낸다.
 * 앱 자신의 쓰기도 알려 오므로 받는 쪽이 디스크 내용을 견주어 거른다. 돌려주는 함수로 끊는다.
 */
export async function watchMemoNoteFiles(vault: VaultHandle, onChange: (change: MemoNoteFileChange) => void): Promise<() => void> {
  const { isDesktop } = await import('./window')
  if (!isDesktop()) return () => undefined
  const { watch } = await import('@tauri-apps/plugin-fs')
  const root = `${vault.root.replaceAll('\\', '/').replace(/\/+$/u, '')}/`
  return watch(vault.root, (event) => {
    const change = memoNoteChangeOf(event.paths, root)
    if (change !== null) onChange(change)
  }, { recursive: true, delayMs: 300 })
}

/** 파일 감시 이벤트의 경로들 중 노트에 관한 것만 추린다(순수 함수: 시험용으로 내보낸다) */
export function memoNoteChangeOf(paths: readonly string[], rootWithSlash: string): MemoNoteFileChange | null {
  const notePaths = new Set<string>()
  let rescan = false
  for (const raw of paths) {
    const normalized = raw.replaceAll('\\', '/')
    if (!normalized.toLocaleLowerCase().startsWith(rootWithSlash.toLocaleLowerCase())) continue
    const relative = normalized.slice(rootWithSlash.length).replace(/\/+$/u, '')
    const parts = relative.split('/')
    const top = MEMO_NOTES_FOLDER_CANDIDATES.find((name) => name.toLocaleLowerCase() === (parts[0] ?? '').toLocaleLowerCase())
    if (top === undefined || parts.some((part) => part.startsWith('.'))) continue
    const canonical = [top, ...parts.slice(1)].join('/')
    if (canonical.toLowerCase().endsWith(MEMO_NOTE_EXTENSION)) notePaths.add(canonical)
    else if (!/\.(?:part|swp|temp|tmp)$/iu.test(canonical)) rescan = true
  }
  return notePaths.size === 0 && !rescan ? null : { notePaths: [...notePaths], rescan }
}
