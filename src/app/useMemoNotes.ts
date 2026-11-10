import { recordUndo } from './undoStack'
import { applySnapshotChange } from '../core/jsonMerge'
import { registerSaveFlusher } from './useCanvasAutosave'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { subscribeVaultFolder, type VaultHandle } from '../bridge/vault'
import {
  createMemoNoteFolder,
  listMemoNoteTree,
  memoNoteCodec,
  onMemoNotesChanged,
  readMemoNote,
  renameMemoNote,
  renameMemoNoteFolder,
  trashMemoNote,
  trashMemoNoteFolder,
  writeMemoNote,
} from '../bridge/memoNotes'
import {
  EMPTY_MEMO_NOTE,
  memoNotesFolder,
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
  readonly createIn: (folder: string, title?: string, docId?: string) => Promise<string | null>
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
  // 노트 목록의 기준은 이 ref 다. 상태(notes)는 화면용 사본이라 한 박자 늦다 — 한 번의 입력 안에서 노트를 두 번 고치거나
  // 다른 창의 변경을 합치는 일이 겹쳐도 서로를 덮지 않게, 모든 갱신이 ref 에서 읽고 ref 에 먼저 쓴다
  const notesRef = useRef<ReadonlyMap<string, MemoNote>>(notes)
  const applyNotes = useCallback((update: (current: ReadonlyMap<string, MemoNote>) => ReadonlyMap<string, MemoNote>) => {
    const next = update(notesRef.current)
    notesRef.current = next
    setNotes(next)
  }, [])
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  // Vault 를 열면 노트를 모두 읽는다
  useEffect(() => {
    applyNotes(() => new Map())
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
        applyNotes(() => new Map(read))
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
          applyNotes((current) => {
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

  // 다른 창이 노트를 고치면 이 창의 노트에 합친다(고치던 글도 지우지 않는다). 새 노트면 읽어 와 더한다
  useEffect(() => {
    if (vault === null || !loaded) return undefined
    return subscribeVaultFolder(vault, memoNotesFolder(), (relativePath, change) => {
      if (!relativePath.toLowerCase().endsWith('.iwnote')) return
      const known = notesRef.current.get(relativePath)
      if (known === undefined) {
        void readMemoNote(vault, relativePath).then((note) => {
          if (notesRef.current.has(relativePath)) return
          const next = new Map(notesRef.current).set(relativePath, note)
          notesRef.current = next
          applyNotes(() => next)
          const parent = memoParentOf(relativePath)
          setFolders((current) => current.includes(parent) || parent === memoNotesFolder() ? current : [...current, parent].sort((a, b) => a.localeCompare(b, 'ko-KR')))
        }).catch(() => undefined)
        return
      }
      const merged = change.rebase(known, memoNoteCodec)
      if (merged === known) return
      const next = new Map(notesRef.current).set(relativePath, merged)
      notesRef.current = next
      applyNotes(() => next)
    })
  }, [vault, loaded])

  // 다른 창이 노트를 옮기거나 지우거나 폴더를 바꿨다: 디스크 목록에 맞춘다(저장을 기다리는 노트는 건드리지 않는다)
  useEffect(() => {
    if (vault === null || !loaded) return undefined
    let stop: (() => void) | undefined
    let alive = true
    void onMemoNotesChanged(vault, () => {
      void (async () => {
        try {
          const tree = await listMemoNoteTree(vault)
          const onDisk = new Set(tree.entries.map((entry) => entry.path))
          const fresh = tree.entries.filter((entry) => !notesRef.current.has(entry.path))
          const read = await Promise.all(fresh.map(async (entry) => [entry.path, await readMemoNote(vault, entry.path).catch(() => EMPTY_MEMO_NOTE)] as const))
          const next = new Map<string, MemoNote>()
          for (const [path, note] of notesRef.current) {
            if (onDisk.has(path) || timersRef.current.has(path)) next.set(path, note)
          }
          for (const [path, note] of read) if (!next.has(path)) next.set(path, note)
          notesRef.current = next
          applyNotes(() => next)
          setFolders(tree.folders)
          setOpenPath((current) => current !== null && !next.has(current) ? [...next.keys()][0] ?? null : current)
        } catch {
          // 다시 읽지 못해도 지금 목록으로 계속 쓴다
        }
      })()
    }).then((unlisten) => {
      if (alive) stop = unlisten
      else unlisten()
    })
    return () => { alive = false; stop?.() }
  }, [vault, loaded])

  const persist = useCallback((path: string, note: MemoNote) => {
    if (vault === null) return
    const timers = timersRef.current
    const previous = timers.get(path)
    if (previous !== undefined) clearTimeout(previous)
    timers.set(path, setTimeout(() => {
      timers.delete(path)
      // 기다리는 사이 다른 창의 변경이 합쳐졌을 수 있으니 지금 상태를 쓴다
      void writeMemoNote(vault, path, notesRef.current.get(path) ?? note).catch((cause: unknown) => onErrorRef.current(t('노트를 저장하지 못했습니다: {error}', { error: errorText(cause) })))
    }, SAVE_DELAY_MS))
  }, [vault])

  const writeNote = useCallback((path: string, note: MemoNote) => {
    applyNotes((current) => new Map(current).set(path, note))
    persist(path, note)
  }, [persist])
  // 노트 블록을 바꾸면 전·후를 되돌리기에 남긴다(지운 노트·옮긴 노트는 남기지 않는다)
  const putNote = useCallback((path: string, note: MemoNote) => {
    const before = notesRef.current.get(path)
    if (before !== undefined && before !== note) {
      recordUndo({
        key: `note:${path}`,
        undo: () => { const current = notesRef.current.get(path); if (current !== undefined) writeNote(path, applySnapshotChange(note, before, current)) },
        redo: () => { const current = notesRef.current.get(path); if (current !== undefined) writeNote(path, applySnapshotChange(before, note, current)) },
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
      applyNotes(() => next)
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

  const createIn = useCallback(async (folder: string, title = t('새 노트'), docId?: string) => {
    if (vault === null) return null
    // 제목은 폴더가 달라도 겹치지 않게 둔다(MCP 가 제목으로 노트를 찾는다)
    const unique = uniqueNoteTitle(title, [...notesRef.current.keys()].map(memoNoteTitleOf))
    const path = memoNotePath(unique, folder === '' ? memoNotesFolder() : folder)
    const fresh: MemoNote = docId === undefined ? EMPTY_MEMO_NOTE : { ...EMPTY_MEMO_NOTE, docId }
    try {
      await writeMemoNote(vault, path, fresh)
    } catch (cause) {
      onErrorRef.current(t('노트를 만들지 못했습니다: {error}', { error: errorText(cause) }))
      return null
    }
    applyNotes((current) => new Map(current).set(path, fresh))
    open(path)
    return path
  }, [open, vault])
  const create = useCallback((title?: string) => createIn(memoNotesFolder(), title), [createIn])

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

  // 창을 닫기·Vault 를 바꾸기 전에 미뤄 둔 노트 저장을 끝낸다
  useEffect(() => registerSaveFlusher('memo-notes', () => flushPending([...timersRef.current.keys()])), [flushPending])

  /** 바뀐 경로대로 노트 목록·폴더·열린 노트를 고친다 */
  const applyMoved = useCallback((moved: ReadonlyMap<string, string>) => {
    if (moved.size === 0) return
    const map = new Map<string, MemoNote>()
    for (const [key, value] of notesRef.current) map.set(moved.get(key) ?? key, value)
    notesRef.current = map
    applyNotes(() => map)
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
    const target = folder === '' ? memoNotesFolder() : folder
    if (memoParentOf(path) === target) return path
    const next = `${target}/${path.split('/').at(-1) ?? ''}`
    await flushPending([path])
    await renameMemoNote(vault, path, next)
    applyMoved(new Map([[path, next]]))
    return next
  }, [applyMoved, flushPending, vault])

  const createFolder = useCallback(async (parent: string, name: string) => {
    if (vault === null) throw new Error(t('Vault 가 열려 있지 않습니다.'))
    const path = `${parent === '' ? memoNotesFolder() : parent}/${safeNoteTitle(name)}`
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
    (path: string, parent: string) => relocateFolder(path, `${parent === '' ? memoNotesFolder() : parent}/${path.split('/').at(-1) ?? ''}`),
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
    applyNotes((current) => {
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
    applyNotes((current) => {
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
    applyNotes((current) => {
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
    () => [...notes].map(([path, note]) => ({ path, title: memoNoteTitleOf(path), ...(note.docId === undefined ? {} : { docId: note.docId }) })).sort((a, b) => a.title.localeCompare(b.title, 'ko-KR')),
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
