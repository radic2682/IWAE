import { recordUndo } from './undoStack'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VaultHandle } from '../bridge/vault'
import {
  createMemoNoteFolder,
  listMemoNoteTree,
  readMemoNote,
  renameMemoNote,
  renameMemoNoteFolder,
  trashMemoNote,
  trashMemoNoteFolder,
  writeMemoNote,
} from '../bridge/memoNotes'
import {
  EMPTY_MEMO_NOTE,
  MEMO_NOTES_FOLDER,
  insertBlock,
  isInsideMemoFolder,
  memoParentOf,
  movedMemoPaths,
  memoBlock,
  memoHighlightIds,
  memoNotePath,
  memoNoteTitleOf,
  notesFromCategories,
  safeNoteTitle,
  removeHighlightBlocks,
  uniqueNoteTitle,
  type MemoNote,
  type MemoNoteEntry,
} from '../core/memoNote'
import type { PersistentPdfHighlight } from '../pdf/persistentHighlight'
import type { MemoNoteApi } from '../pdf/memoNoteContext'
import { errorText } from '../core/errorText'
import { t } from '../i18n'

const SAVE_DELAY_MS = 400
/** 예전 카테고리를 노트로 옮겼다는 표시(한 번만 옮긴다) */
const MIGRATION_MARK = '.iwae/memo-notes.json'

function openKey(root: string): string {
  return `iwae:open-memo-note:v1:${root}`
}

/**
 * Vault 의 메모 노트들. 모두 읽어 두고(형광펜이 어느 노트에 있는지 알아야 한다), 고치면 잠시 뒤 그 파일만 쓴다.
 * 처음 한 번은 예전 「카테고리」를 노트로 옮긴다.
 */
export function useMemoNotes(
  vault: VaultHandle | null,
  highlights: readonly PersistentPdfHighlight[],
  docTitle: (docId: string) => string,
  onError: (message: string) => void,
): MemoNoteApi & {
  readonly close: () => void
  readonly closed: boolean
  readonly rename: (path: string, title: string) => Promise<string>
  readonly trash: (path: string) => Promise<void>
  /** 「노트」 아래 하위 폴더들(Vault 상대 경로, 예: 노트/회의) */
  readonly folders: readonly string[]
  /** 새 노트를 그 폴더에 만든다(빈 문자열이면 「노트」 맨 위) */
  readonly createIn: (folder: string, title?: string) => Promise<string | null>
  /** 노트를 다른 폴더로 옮긴다. 새 경로 */
  readonly move: (path: string, folder: string) => Promise<string>
  readonly createFolder: (parent: string, name: string) => Promise<string>
  /** 폴더 이름 바꾸기·옮기기. 바뀐 경로들(옛 → 새, 폴더와 안의 노트·폴더) */
  readonly renameFolder: (path: string, name: string) => Promise<ReadonlyMap<string, string>>
  readonly moveFolder: (path: string, parent: string) => Promise<ReadonlyMap<string, string>>
  /** 폴더를 통째로 휴지통(.iwae/trash/notes)으로. 지운 노트 경로들 */
  readonly trashFolder: (path: string) => Promise<readonly string[]>
  /** 형광펜을 지웠을 때 모든 노트에서 뺀다 */
  readonly forgetHighlight: (highlightId: string) => void
  /** 제목으로 노트를 찾아(없으면 만들어) 끝에 메모를 붙인다(MCP) */
  readonly addToNoteTitled: (title: string, highlightId: string) => void
  /** MCP note_*: 제목으로 노트 찾기·고치기·목록 */
  readonly findNoteTitled: (title: string) => { path: string; note: MemoNote } | null
  readonly editNoteTitled: (title: string, change: (note: MemoNote) => MemoNote, create: boolean) => string
  readonly listNotes: () => { path: string; title: string; blocks: number }[]
} {
  const [notes, setNotes] = useState<ReadonlyMap<string, MemoNote>>(new Map())
  const [folders, setFolders] = useState<readonly string[]>([])
  const foldersRef = useRef(folders)
  foldersRef.current = folders
  const [loaded, setLoaded] = useState(false)
  const [openPath, setOpenPath] = useState<string | null>(null)
  // 사용자가 「노트 닫기」로 닫아 두었는가(저장값 '' 로 다음 실행에도 이어진다)
  const [closed, setClosed] = useState(false)
  const closedRef = useRef(closed)
  closedRef.current = closed
  const notesRef = useRef(notes)
  notesRef.current = notes
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  // Vault 를 열면 노트를 모두 읽는다
  useEffect(() => {
    setNotes(new Map())
    setFolders([])
    setLoaded(false)
    setOpenPath(null)
    setClosed(false)
    if (vault === null) return
    let alive = true
    void (async () => {
      try {
        const tree = await listMemoNoteTree(vault)
        const read = await Promise.all(tree.entries.map(async (entry) => [entry.path, await readMemoNote(vault, entry.path).catch(() => EMPTY_MEMO_NOTE)] as const))
        if (!alive) return
        setNotes(new Map(read))
        setFolders(tree.folders)
        let remembered: string | null = null
        try { remembered = localStorage.getItem(openKey(vault.root)) } catch { /* 없음 */ }
        if (remembered === '') {
          setOpenPath(null)
          setClosed(true)
        } else {
          setOpenPath(remembered !== null && read.some(([path]) => path === remembered) ? remembered : read[0]?.[0] ?? null)
        }
        setLoaded(true)
      } catch (cause) {
        if (alive) onErrorRef.current(t('노트를 읽지 못했습니다: {error}', { error: errorText(cause) }))
      }
    })()
    return () => { alive = false }
  }, [vault])

  // 앱 밖에서 「노트」 폴더에 넣은 노트 파일은 창으로 돌아올 때 목록에 더한다(이미 읽은 노트는 그대로 둔다)
  useEffect(() => {
    if (vault === null || !loaded) return
    let busy = false
    const rescan = () => {
      if (busy) return
      busy = true
      void (async () => {
        try {
          const tree = await listMemoNoteTree(vault)
          const knownFolders = new Set(foldersRef.current)
          if (tree.folders.some((folder) => !knownFolders.has(folder))) {
            setFolders((current) => [...new Set([...current, ...tree.folders])].sort((a, b) => a.localeCompare(b, 'ko-KR')))
          }
          const fresh = tree.entries.filter((entry) => !notesRef.current.has(entry.path))
          if (fresh.length === 0) return
          const read = await Promise.all(fresh.map(async (entry) => [entry.path, await readMemoNote(vault, entry.path).catch(() => EMPTY_MEMO_NOTE)] as const))
          setNotes((current) => {
            const next = new Map(current)
            for (const [path, note] of read) if (!next.has(path)) next.set(path, note)
            return next
          })
        } catch {
          // 다시 읽지 못해도 지금 목록으로 계속 쓴다
        } finally {
          busy = false
        }
      })()
    }
    window.addEventListener('focus', rescan)
    return () => window.removeEventListener('focus', rescan)
  }, [vault, loaded])

  const persist = useCallback((path: string, note: MemoNote) => {
    if (vault === null) return
    const timers = timersRef.current
    const previous = timers.get(path)
    if (previous !== undefined) clearTimeout(previous)
    timers.set(path, setTimeout(() => {
      timers.delete(path)
      void writeMemoNote(vault, path, note).catch((cause: unknown) => onErrorRef.current(t('노트를 저장하지 못했습니다: {error}', { error: errorText(cause) })))
    }, SAVE_DELAY_MS))
  }, [vault])

  const writeNote = useCallback((path: string, note: MemoNote) => {
    setNotes((current) => new Map(current).set(path, note))
    persist(path, note)
  }, [persist])
  // 노트 블록을 바꾸면 전·후를 되돌리기에 남긴다(지운 노트·옮긴 노트는 남기지 않는다)
  const putNote = useCallback((path: string, note: MemoNote) => {
    const before = notesRef.current.get(path)
    if (before !== undefined && before !== note) {
      recordUndo({
        key: `note:${path}`,
        undo: () => { if (notesRef.current.has(path)) writeNote(path, before) },
        redo: () => { if (notesRef.current.has(path)) writeNote(path, note) },
      })
    }
    writeNote(path, note)
  }, [writeNote])

  // 처음 한 번: 예전 카테고리 → 노트
  const migratingRef = useRef(false)
  useEffect(() => {
    if (vault === null || !loaded || migratingRef.current || highlights.length === 0) return
    migratingRef.current = true
    void (async () => {
      const { exists } = await import('@tauri-apps/plugin-fs')
      const { join } = await import('@tauri-apps/api/path')
      if (await exists(await join(vault.root, ...MIGRATION_MARK.split('/')))) return
      const created = notesFromCategories(highlights, docTitle)
      const taken = [...notesRef.current.keys()].map(memoNoteTitleOf)
      const next = new Map(notesRef.current)
      for (const { title, note } of created) {
        const unique = uniqueNoteTitle(title, taken)
        taken.push(unique)
        const path = memoNotePath(unique)
        await writeMemoNote(vault, path, note)
        next.set(path, note)
      }
      const { writeVaultRelativeText } = await import('../bridge/vault')
      await writeVaultRelativeText(vault, MIGRATION_MARK, `${JSON.stringify({ version: 1, migratedAt: new Date().toISOString(), notes: created.map(({ title }) => title) }, null, 2)}\n`)
      setNotes(next)
      setOpenPath((current) => current ?? (closedRef.current ? null : [...next.keys()][0] ?? null))
    })().catch((cause: unknown) => onErrorRef.current(t('카테고리를 노트로 옮기지 못했습니다: {error}', { error: errorText(cause) })))
  }, [docTitle, highlights, loaded, vault])

  const open = useCallback((path: string | null) => {
    setOpenPath(path)
    if (path !== null) setClosed(false)
    if (vault !== null && path !== null) {
      try { localStorage.setItem(openKey(vault.root), path) } catch { /* 이번 실행만 */ }
    }
  }, [vault])

  const close = useCallback(() => {
    setOpenPath(null)
    setClosed(true)
    if (vault !== null) {
      try { localStorage.setItem(openKey(vault.root), '') } catch { /* 이번 실행만 */ }
    }
  }, [vault])

  const createIn = useCallback(async (folder: string, title = t('새 노트')) => {
    if (vault === null) return null
    // 제목은 폴더가 달라도 겹치지 않게 둔다(MCP 가 제목으로 노트를 찾는다)
    const unique = uniqueNoteTitle(title, [...notesRef.current.keys()].map(memoNoteTitleOf))
    const path = memoNotePath(unique, folder === '' ? MEMO_NOTES_FOLDER : folder)
    try {
      await writeMemoNote(vault, path, EMPTY_MEMO_NOTE)
    } catch (cause) {
      onErrorRef.current(t('노트를 만들지 못했습니다: {error}', { error: errorText(cause) }))
      return null
    }
    setNotes((current) => new Map(current).set(path, EMPTY_MEMO_NOTE))
    open(path)
    return path
  }, [open, vault])
  const create = useCallback((title?: string) => createIn(MEMO_NOTES_FOLDER, title), [createIn])

  /** 쓰기를 기다리는 노트를 먼저 쓴다(옮기기·이름 바꾸기 전) */
  const flushPending = useCallback(async (paths: readonly string[]) => {
    if (vault === null) return
    for (const path of paths) {
      const pending = timersRef.current.get(path)
      if (pending === undefined) continue
      clearTimeout(pending)
      timersRef.current.delete(path)
      await writeMemoNote(vault, path, notesRef.current.get(path) ?? EMPTY_MEMO_NOTE)
    }
  }, [vault])

  /** 바뀐 경로대로 노트 목록·폴더·열린 노트를 고친다 */
  const applyMoved = useCallback((moved: ReadonlyMap<string, string>) => {
    if (moved.size === 0) return
    const map = new Map<string, MemoNote>()
    for (const [key, value] of notesRef.current) map.set(moved.get(key) ?? key, value)
    notesRef.current = map
    setNotes(map)
    setFolders((current) => current.map((folder) => moved.get(folder) ?? folder).sort((a, b) => a.localeCompare(b, 'ko-KR')))
    setOpenPath((current) => {
      const next = current === null ? null : moved.get(current) ?? current
      if (next !== current && vault !== null && next !== null) {
        try { localStorage.setItem(openKey(vault.root), next) } catch { /* 이번 실행만 */ }
      }
      return next
    })
  }, [vault])

  const move = useCallback(async (path: string, folder: string) => {
    if (vault === null) return path
    const target = folder === '' ? MEMO_NOTES_FOLDER : folder
    if (memoParentOf(path) === target) return path
    const next = `${target}/${path.split('/').at(-1) ?? ''}`
    await flushPending([path])
    await renameMemoNote(vault, path, next)
    applyMoved(new Map([[path, next]]))
    return next
  }, [applyMoved, flushPending, vault])

  const createFolder = useCallback(async (parent: string, name: string) => {
    if (vault === null) throw new Error(t('Vault 가 열려 있지 않습니다.'))
    const path = `${parent === '' ? MEMO_NOTES_FOLDER : parent}/${safeNoteTitle(name)}`
    if (foldersRef.current.some((folder) => folder.toLowerCase() === path.toLowerCase())) throw new Error(t('같은 이름의 폴더가 이미 있습니다.'))
    await createMemoNoteFolder(vault, path)
    setFolders((current) => [...current, path].sort((a, b) => a.localeCompare(b, 'ko-KR')))
    return path
  }, [vault])

  const relocateFolder = useCallback(async (path: string, next: string) => {
    if (vault === null || next === path) return new Map<string, string>()
    if (isInsideMemoFolder(next, path)) throw new Error(t('폴더를 자기 안으로 옮길 수 없습니다.'))
    const notePaths = [...notesRef.current.keys()].filter((note) => isInsideMemoFolder(note, path))
    await flushPending(notePaths)
    await renameMemoNoteFolder(vault, path, next, notePaths)
    const moved = movedMemoPaths(path, next, [...foldersRef.current, ...notesRef.current.keys()])
    applyMoved(moved)
    return moved
  }, [applyMoved, flushPending, vault])

  const renameFolder = useCallback(
    (path: string, name: string) => relocateFolder(path, `${memoParentOf(path)}/${safeNoteTitle(name)}`),
    [relocateFolder],
  )
  const moveFolder = useCallback(
    (path: string, parent: string) => relocateFolder(path, `${parent === '' ? MEMO_NOTES_FOLDER : parent}/${path.split('/').at(-1) ?? ''}`),
    [relocateFolder],
  )

  const trashFolder = useCallback(async (path: string) => {
    if (vault === null) return []
    const notePaths = [...notesRef.current.keys()].filter((note) => isInsideMemoFolder(note, path))
    for (const note of notePaths) {
      const pending = timersRef.current.get(note)
      if (pending === undefined) continue
      clearTimeout(pending)
      timersRef.current.delete(note)
    }
    await trashMemoNoteFolder(vault, path, notePaths)
    const removed = new Set(notePaths)
    const rest = [...notesRef.current.keys()].filter((note) => !removed.has(note))
    setNotes((current) => {
      const map = new Map(current)
      for (const note of notePaths) map.delete(note)
      return map
    })
    setFolders((current) => current.filter((folder) => folder !== path && !isInsideMemoFolder(folder, path)))
    if (openPath !== null && removed.has(openPath)) open(rest[0] ?? null)
    return notePaths
  }, [open, openPath, vault])

  const rename = useCallback(async (path: string, title: string) => {
    if (vault === null) return path
    const others = [...notesRef.current.keys()].filter((item) => item !== path).map(memoNoteTitleOf)
    const next = memoNotePath(uniqueNoteTitle(title, others), memoParentOf(path))
    if (next === path) return path
    // 쓰기 대기 중이면 먼저 쓴다
    const pending = timersRef.current.get(path)
    if (pending !== undefined) {
      clearTimeout(pending)
      timersRef.current.delete(path)
      await writeMemoNote(vault, path, notesRef.current.get(path) ?? EMPTY_MEMO_NOTE)
    }
    await renameMemoNote(vault, path, next)
    setNotes((current) => {
      const map = new Map<string, MemoNote>()
      for (const [key, value] of current) map.set(key === path ? next : key, value)
      return map
    })
    setOpenPath((current) => (current === path ? next : current))
    if (openPath === path) open(next)
    return next
  }, [open, openPath, vault])

  const trash = useCallback(async (path: string) => {
    if (vault === null) return
    const pending = timersRef.current.get(path)
    if (pending !== undefined) {
      clearTimeout(pending)
      timersRef.current.delete(path)
    }
    await trashMemoNote(vault, path)
    const rest = [...notesRef.current.keys()].filter((item) => item !== path)
    setNotes((current) => {
      const map = new Map(current)
      map.delete(path)
      return map
    })
    if (openPath === path) open(rest[0] ?? null)
  }, [open, openPath, vault])

  const updateOpen = useCallback((change: (note: MemoNote) => MemoNote) => {
    if (openPath === null) return
    const current = notesRef.current.get(openPath) ?? EMPTY_MEMO_NOTE
    const next = change(current)
    if (next !== current) putNote(openPath, next)
  }, [openPath, putNote])

  const forgetHighlight = useCallback((highlightId: string) => {
    for (const [path, note] of notesRef.current) {
      const next = removeHighlightBlocks(note, highlightId)
      if (next !== note) putNote(path, next)
    }
  }, [putNote])

  const addToNoteTitled = useCallback((title: string, highlightId: string) => {
    const wanted = safeNoteTitle(title).toLowerCase()
    const path = [...notesRef.current.keys()].find((key) => memoNoteTitleOf(key).toLowerCase() === wanted) ?? memoNotePath(title)
    const current = notesRef.current.get(path) ?? EMPTY_MEMO_NOTE
    const next = insertBlock(current, memoBlock(highlightId), current.blocks.length)
    notesRef.current = new Map(notesRef.current).set(path, next)
    if (next !== current) putNote(path, next)
  }, [putNote])

  /** 제목으로 노트를 찾는다(대소문자 무시). 없으면 null */
  const findNoteTitled = useCallback((title: string): { path: string; note: MemoNote } | null => {
    const wanted = safeNoteTitle(title).toLowerCase()
    const path = [...notesRef.current.keys()].find((key) => memoNoteTitleOf(key).toLowerCase() === wanted)
    return path === undefined ? null : { path, note: notesRef.current.get(path) ?? EMPTY_MEMO_NOTE }
  }, [])

  /**
   * 제목으로 노트를 고친다(MCP note_*). create 면 없을 때 새로 만든다. 앱이 가진 노트를 고쳐 저장하므로
   * 앱이 켜져 있어도 덮어쓰기 충돌이 없다. 고친 노트의 경로를 돌려준다
   */
  const editNoteTitled = useCallback((title: string, change: (note: MemoNote) => MemoNote, create: boolean): string => {
    const found = findNoteTitled(title)
    if (found === null && !create) throw new Error(`「${title}」 노트가 없습니다. note_list 로 제목을 확인하세요.`)
    const path = found?.path ?? memoNotePath(title)
    const current = found?.note ?? EMPTY_MEMO_NOTE
    const next = change(current)
    notesRef.current = new Map(notesRef.current).set(path, next)
    if (next !== current || found === null) putNote(path, next)
    return path
  }, [findNoteTitled, putNote])

  const listNotes = useCallback(() => [...notesRef.current.entries()]
    .map(([path, note]) => ({ path, title: memoNoteTitleOf(path), blocks: note.blocks.length }))
    .sort((a, b) => a.title.localeCompare(b.title, 'ko-KR')), [])

  const membership = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const [path, note] of notes) {
      for (const block of note.blocks) {
        for (const id of memoHighlightIds(block)) map.set(id, [...(map.get(id) ?? []), path])
      }
    }
    return map
  }, [notes])
  const notesOf = useCallback((highlightId: string) => membership.get(highlightId) ?? [], [membership])

  const entries = useMemo<MemoNoteEntry[]>(
    () => [...notes.keys()].map((path) => ({ path, title: memoNoteTitleOf(path) })).sort((a, b) => a.title.localeCompare(b.title, 'ko-KR')),
    [notes],
  )

  return {
    entries,
    openPath,
    openTitle: openPath === null ? null : memoNoteTitleOf(openPath),
    openNote: openPath === null ? null : notes.get(openPath) ?? EMPTY_MEMO_NOTE,
    open,
    close,
    closed,
    create,
    updateOpen,
    notesOf,
    rename,
    trash,
    forgetHighlight,
    addToNoteTitled,
    findNoteTitled,
    editNoteTitled,
    listNotes,
    folders,
    createIn,
    move,
    createFolder,
    renameFolder,
    moveFolder,
    trashFolder,
  }
}
