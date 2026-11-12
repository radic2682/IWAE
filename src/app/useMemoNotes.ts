import { recordSeparately, recordUndo } from './undoStack'
import { applySnapshotChange } from '../core/jsonMerge'
import { registerSaveFlusher } from './useCanvasAutosave'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { subscribeVaultFolder, type VaultHandle } from '../bridge/vault'
import type { TrashSource } from '../bridge/vaultFiles'
import { isVaultExternalChangeError } from '../core/vaultSync'
import {
  adoptMemoNoteText,
  createMemoNoteFolder,
  inspectMemoNote,
  listMemoNoteTree,
  memoNoteCodec,
  onMemoNotesChanged,
  readMemoNote,
  renameMemoNote,
  renameMemoNoteFolder,
  trashMemoNote,
  trashMemoNoteFolder,
  watchMemoNoteFiles,
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
  type MemoTicket,
} from '../core/memoNote'
import { buildTicketIndex, syncTicketEdit } from '../core/memoTickets'
import type { PersistentPdfHighlight } from '../pdf/persistentHighlight'
import type { MemoNoteApi } from '../pdf/memoNoteContext'
import { errorText } from '../core/errorText'
import { t } from '../i18n'

const SAVE_DELAY_MS = 400
/** 외부 변경으로 보이는 차이를 확인하기 전에 기다리는 시간: 다른 창의 저장이 합쳐지는 시간을 준다 */
const SETTLE_MS = 450
/** 예전 카테고리를 노트로 옮겼다는 표시(한 번만 옮긴다) */
const MIGRATION_MARK = '.iwae/memo-notes.json'

function conflictError(): string {
  return t('이 노트는 다른 프로그램이 바꾼 내용과 부딪쳐 있어 저장하지 않았습니다. 어느 쪽을 남길지 먼저 정하세요.')
}

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
  /** 노트 경로가 바뀌었다(이름 바꾸기·옮기기·폴더 바꾸기: 옛 → 새). 탭처럼 경로를 기억하는 곳이 따라가게 한다 */
  onMoved?: (moved: ReadonlyMap<string, string>) => void,
): MemoNoteApi & {
  readonly close: () => void
  readonly closed: boolean
  /** 처음 목록을 다 읽었는가(그 전에는 없는 노트와 아직 못 읽은 노트를 가릴 수 없다) */
  readonly loaded: boolean
  readonly rename: (path: string, title: string) => Promise<string>
  readonly trash: (path: string, source?: TrashSource) => Promise<void>
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
  /** 다른 프로그램이 바꾼 파일과 저장하지 않은 내 변경이 부딪친 노트(없으면 null). 정할 때까지 그 노트는 파일에 저장하지 않는다 */
  readonly conflict: { readonly path: string; readonly title: string } | null
  /** 충돌을 푼다: mine 내 것으로 덮어쓰기, file 파일의 것으로 되돌리기(내 변경 버림), copy 내 것을 「(충돌 사본)」 노트로 따로 두고 파일의 것으로 */
  readonly resolveConflict: (choice: 'mine' | 'file' | 'copy') => Promise<void>
} {
  const [notes, setNotes] = useState<ReadonlyMap<string, MemoNote>>(new Map())
  const [folders, setFolders] = useState<readonly string[]>([])
  const foldersRef = useRef(folders)
  foldersRef.current = folders
  const [loaded, setLoaded] = useState(false)
  // 어느 Vault 의 목록을 읽었는가. Vault 를 바꾼 첫 그리기에서 옛 Vault 의 loaded 가 새 Vault 의 것으로 보이지 않게 한다
  const [loadedRoot, setLoadedRoot] = useState<string | null>(null)
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
  const openPathRef = useRef(openPath)
  openPathRef.current = openPath
  // 지금 쓰는 중인 노트(우리 자신의 쓰기가 파일 감시에 잡혀 외부 변경으로 보이지 않게 한다)
  const inflightRef = useRef(new Set<string>())
  // 쓰는 동안 파일 변경 알림이 온 노트: 쓰기가 끝난 뒤 다시 확인한다
  const deferredRef = useRef(new Set<string>())
  // 외부 변경과 저장하지 않은 내 변경이 부딪친 노트. shown 이 false 면 다른 창의 저장이 합쳐지길 잠시 기다리는 중이다
  const heldRef = useRef(new Map<string, { shown: boolean; copied: boolean }>())
  const [conflicts, setConflicts] = useState<readonly { readonly path: string; readonly title: string }[]>([])
  const syncChainRef = useRef<Promise<void>>(Promise.resolve())
  // 파일이 한 번 안 보인 노트. 저장 프로그램이 임시 파일로 바꿔 끼우는 동안 잠깐 없어 보일 수 있어, 두 번째 확인에서도 없을 때 뺀다
  const absentRef = useRef(new Set<string>())
  const recheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRecheckRef = useRef<() => void>(() => undefined)
  const holdForSettleRef = useRef<(path: string) => void>(() => undefined)
  const persistRef = useRef<(path: string, note: MemoNote) => void>(() => undefined)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onMovedRef = useRef(onMoved)
  onMovedRef.current = onMoved

  // Vault 를 열면 노트를 모두 읽는다
  useEffect(() => {
    applyNotes(() => new Map())
    setFolders([])
    setLoaded(false)
    setLoadedRoot(null)
    setOpenPath(null)
    setClosed(false)
    heldRef.current.clear()
    deferredRef.current.clear()
    absentRef.current.clear()
    setConflicts([])
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
        setLoadedRoot(vault.root)
      } catch (cause) {
        if (alive) onErrorRef.current(t('노트를 읽지 못했습니다: {error}', { error: errorText(cause) }))
      }
    })()
    return () => { alive = false }
  }, [vault])

  const isBusy = (path: string): boolean => timersRef.current.has(path) || inflightRef.current.has(path) || heldRef.current.has(path)

  const publishConflicts = useCallback(() => {
    setConflicts([...heldRef.current].filter(([, state]) => state.shown).map(([path]) => ({ path, title: memoNoteTitleOf(path) })))
  }, [])

  /** 디스크 목록에 맞춘다: 새 노트를 읽어 더하고, 파일이 없어진 노트는 뺀다(쓰기를 기다리는·충돌 중인 노트는 건드리지 않는다) */
  const rescanTree = useCallback(async () => {
    if (vault === null) return
    const tree = await listMemoNoteTree(vault)
    const onDisk = new Set(tree.entries.map((entry) => entry.path))
    const fresh = tree.entries.filter((entry) => !notesRef.current.has(entry.path))
    const read = await Promise.all(fresh.map(async (entry) => [entry.path, await readMemoNote(vault, entry.path).catch(() => EMPTY_MEMO_NOTE)] as const))
    const next = new Map<string, MemoNote>()
    let recheck = false
    for (const [path, note] of notesRef.current) {
      if (onDisk.has(path)) {
        absentRef.current.delete(path)
        next.set(path, note)
      } else if (isBusy(path)) {
        next.set(path, note)
      } else if (!absentRef.current.has(path)) {
        absentRef.current.add(path)
        next.set(path, note)
        recheck = true
      } else {
        absentRef.current.delete(path)
      }
    }
    if (recheck) scheduleRecheckRef.current()
    for (const [path, note] of read) if (!next.has(path)) next.set(path, note)
    const changed = next.size !== notesRef.current.size || [...next.keys()].some((path) => !notesRef.current.has(path))
    if (changed) {
      notesRef.current = next
      applyNotes(() => next)
      setOpenPath((current) => current !== null && !next.has(current) ? [...next.keys()][0] ?? null : current)
    }
    setFolders((current) => current.length === tree.folders.length && current.every((folder, index) => folder === tree.folders[index]) ? current : tree.folders)
  }, [vault])

  /** 다른 프로그램이 바꾼 노트 하나를 디스크와 맞춘다 */
  const reconcilePath = useCallback(async (path: string) => {
    if (vault === null || !notesRef.current.has(path) || heldRef.current.has(path)) return
    if (inflightRef.current.has(path)) { deferredRef.current.add(path); return }
    const result = await inspectMemoNote(vault, path)
    if (result.state !== 'missing') absentRef.current.delete(path)
    if (result.state === 'same') return
    // 기다리는 사이 쓰기가 시작됐거나 충돌로 넘어갔다면 그쪽이 맡는다. 이 아래는 await 없이 끝까지 한 번에 간다
    if (inflightRef.current.has(path)) { deferredRef.current.add(path); return }
    if (heldRef.current.has(path) || !notesRef.current.has(path)) return
    const pending = timersRef.current.has(path)
    if (result.state === 'missing') {
      if (pending) return
      if (!absentRef.current.has(path)) {
        absentRef.current.add(path)
        scheduleRecheckRef.current()
        return
      }
      absentRef.current.delete(path)
      const next = new Map(notesRef.current)
      next.delete(path)
      notesRef.current = next
      applyNotes(() => next)
      setOpenPath((current) => current === path ? [...next.keys()][0] ?? null : current)
      return
    }
    if (pending) {
      holdForSettleRef.current(path)
      return
    }
    // 읽을 수 없는 내용(쓰는 도중일 수 있다)은 다음 변경 알림을 기다린다
    if (result.note === null) return
    adoptMemoNoteText(vault, path, result.text)
    const note = result.note
    applyNotes((current) => new Map(current).set(path, note))
    if (openPathRef.current === path) onErrorRef.current(t('다른 프로그램이 이 노트를 바꿔서 다시 읽었습니다'))
  }, [vault])

  /** 파일 감시·창 복귀가 알려 온 변경을 차례로 처리한다. paths 가 null 이면 모든 노트를 디스크와 견준다 */
  const syncFromDisk = useCallback((paths: readonly string[] | null, rescan: boolean): Promise<void> => {
    const run = async () => {
      try {
        if (paths === null || rescan || paths.some((path) => !notesRef.current.has(path))) await rescanTree()
        for (const path of paths ?? [...notesRef.current.keys()]) await reconcilePath(path)
      } catch {
        // 다시 읽지 못해도 지금 목록으로 계속 쓴다(다음 변경 알림에서 다시 맞춘다)
      }
    }
    syncChainRef.current = syncChainRef.current.then(run, run)
    return syncChainRef.current
  }, [reconcilePath, rescanTree])
  const syncFromDiskRef = useRef(syncFromDisk)
  syncFromDiskRef.current = syncFromDisk
  scheduleRecheckRef.current = () => {
    if (recheckTimerRef.current !== null) clearTimeout(recheckTimerRef.current)
    recheckTimerRef.current = setTimeout(() => { recheckTimerRef.current = null; void syncFromDiskRef.current(null, true) }, 700)
  }

  // 앱 밖에서 노트 파일을 만들거나 고치거나 옮기거나 지우면(다른 프로그램·AI 에이전트·동기화·git) 1~2초 안에 목록과 열린 노트에 반영한다.
  // 창으로 돌아올 때도 한 번 더 디스크와 맞춘다(파일 감시가 놓친 경우)
  useEffect(() => {
    if (vault === null || !loaded) return undefined
    let stop: (() => void) | undefined
    let alive = true
    void watchMemoNoteFiles(vault, (change) => { void syncFromDiskRef.current(change.notePaths, change.rescan) })
      .then((unwatch) => { if (alive) stop = unwatch; else unwatch() })
      .catch(() => undefined)
    const onFocus = () => { void syncFromDiskRef.current(null, true) }
    window.addEventListener('focus', onFocus)
    return () => { alive = false; stop?.(); window.removeEventListener('focus', onFocus) }
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
    void onMemoNotesChanged(vault, () => { void syncFromDiskRef.current(null, true) }    ).then((unlisten) => {
      if (alive) stop = unlisten
      else unlisten()
    })
    return () => { alive = false; stop?.() }
  }, [vault, loaded])

  /** 충돌을 확인하는 동안(또는 정할 때까지) 이 노트는 파일에 쓰지 않는다. 잠시 뒤 정말 달라졌는지 다시 보고 보여 준다 */
  const holdForSettle = useCallback((path: string) => {
    const timer = timersRef.current.get(path)
    if (timer !== undefined) { clearTimeout(timer); timersRef.current.delete(path) }
    if (heldRef.current.has(path) || vault === null) return
    heldRef.current.set(path, { shown: false, copied: false })
    window.setTimeout(() => {
      void (async () => {
        let result: Awaited<ReturnType<typeof inspectMemoNote>> | null = null
        try { result = await inspectMemoNote(vault, path) } catch { /* 읽지 못하면 사용자가 고르게 한다 */ }
        const state = heldRef.current.get(path)
        if (state === undefined) return
        if (result !== null && result.state !== 'changed') {
          // 다른 창의 저장이 합쳐졌거나 파일이 없어졌다: 충돌이 아니다. 내 변경을 그대로 저장한다
          heldRef.current.delete(path)
          const note = notesRef.current.get(path)
          if (note !== undefined) persistRef.current(path, note)
          return
        }
        state.shown = true
        publishConflicts()
      })()
    }, SETTLE_MS)
  }, [publishConflicts, vault])
  holdForSettleRef.current = holdForSettle

  /** 노트를 쓴다. 파일이 밖에서 바뀌었으면 쓰지 않고 충돌로 넘긴다(false) */
  const saveNote = useCallback(async (path: string, note: MemoNote): Promise<boolean> => {
    if (vault === null) return false
    inflightRef.current.add(path)
    try {
      await writeMemoNote(vault, path, note)
      return true
    } catch (cause) {
      if (isVaultExternalChangeError(cause)) {
        holdForSettle(path)
        return false
      }
      throw cause
    } finally {
      inflightRef.current.delete(path)
      if (deferredRef.current.delete(path)) void syncFromDiskRef.current([path], false)
    }
  }, [holdForSettle, vault])

  const persist = useCallback((path: string, note: MemoNote) => {
    if (vault === null) return
    // 충돌을 정하기 전에는 파일에 쓰지 않는다(메모리의 내 변경은 그대로 둔다)
    if (heldRef.current.has(path)) return
    const timers = timersRef.current
    const previous = timers.get(path)
    if (previous !== undefined) clearTimeout(previous)
    timers.set(path, setTimeout(() => {
      timers.delete(path)
      // 기다리는 사이 다른 창의 변경이 합쳐졌을 수 있으니 지금 상태를 쓴다
      void saveNote(path, notesRef.current.get(path) ?? note).catch((cause: unknown) => onErrorRef.current(t('노트를 저장하지 못했습니다: {error}', { error: errorText(cause) })))
    }, SAVE_DELAY_MS))
  }, [saveNote, vault])
  persistRef.current = persist

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

  /** 쓰기를 기다리는 노트를 먼저 쓴다(옮기기·이름 바꾸기 전). 밖에서 바뀐 노트는 쓰지 않고 오류를 던진다 */
  const flushPending = useCallback(async (paths: readonly string[]) => {
    if (vault === null) return
    for (const path of paths) {
      const pending = timersRef.current.get(path)
      if (pending === undefined) continue
      clearTimeout(pending)
      timersRef.current.delete(path)
      if (!(await saveNote(path, notesRef.current.get(path) ?? EMPTY_MEMO_NOTE))) throw new Error(conflictError())
    }
  }, [saveNote, vault])

  const assertNoConflict = (paths: readonly string[]) => {
    if (paths.some((path) => heldRef.current.has(path))) throw new Error(conflictError())
  }

  /** 내 변경을 「(충돌 사본)」 노트로 따로 저장한다. 새 노트의 경로 */
  const saveConflictCopy = useCallback(async (path: string, note: MemoNote): Promise<string> => {
    if (vault === null) throw new Error(t('Vault 가 열려 있지 않습니다.'))
    const taken = [...notesRef.current.keys()].map(memoNoteTitleOf)
    const copyPath = memoNotePath(uniqueNoteTitle(t('{name} (충돌 사본)', { name: memoNoteTitleOf(path) }), taken), memoParentOf(path))
    await writeMemoNote(vault, copyPath, note)
    applyNotes((current) => new Map(current).set(copyPath, note))
    return copyPath
  }, [vault])

  // 창을 닫기·Vault 를 바꾸기·앱을 끝내기 전에 미뤄 둔 노트 저장을 끝낸다. 밖에서 바뀐 파일은 덮어쓰지 않고,
  // 저장하지 못한 내 변경은 「(충돌 사본)」 노트로 남긴다
  useEffect(() => registerSaveFlusher('memo-notes', async () => {
    for (const path of [...timersRef.current.keys()]) {
      try { await flushPending([path]) } catch (cause) { if (!heldRef.current.has(path)) throw cause }
    }
    for (const [path, state] of heldRef.current) {
      if (state.copied) continue
      state.copied = true
      try { await saveConflictCopy(path, notesRef.current.get(path) ?? EMPTY_MEMO_NOTE) } catch { /* 사본을 못 만들어도 파일은 그대로다 */ }
    }
  }), [flushPending, saveConflictCopy])

  const resolveConflict = useCallback(async (choice: 'mine' | 'file' | 'copy') => {
    const first = conflicts[0]
    if (first === undefined || vault === null) return
    const path = first.path
    const local = notesRef.current.get(path) ?? EMPTY_MEMO_NOTE
    try {
      const disk = await inspectMemoNote(vault, path)
      if (choice === 'mine') {
        if (disk.state === 'changed') adoptMemoNoteText(vault, path, disk.text)
        heldRef.current.delete(path)
        publishConflicts()
        await saveNote(path, notesRef.current.get(path) ?? local)
        return
      }
      if (disk.state === 'changed' && disk.note === null) throw new Error(t('다른 프로그램이 바꾼 파일을 읽을 수 없습니다. 「내 것으로 덮어쓰기」를 고르거나 파일을 고친 뒤 다시 해 보세요.'))
      let copyPath: string | null = null
      if (choice === 'copy') copyPath = await saveConflictCopy(path, local)
      heldRef.current.delete(path)
      publishConflicts()
      if (disk.state === 'changed' && disk.note !== null) {
        adoptMemoNoteText(vault, path, disk.text)
        const note = disk.note
        applyNotes((current) => new Map(current).set(path, note))
      } else if (disk.state === 'missing') {
        const next = new Map(notesRef.current)
        next.delete(path)
        notesRef.current = next
        applyNotes(() => next)
        setOpenPath((current) => current === path ? copyPath ?? [...next.keys()][0] ?? null : current)
      }
      if (copyPath !== null) onErrorRef.current(t('내 변경은 「{name}」 노트로 따로 저장했습니다', { name: memoNoteTitleOf(copyPath) }))
    } catch (cause) {
      onErrorRef.current(errorText(cause))
    }
  }, [conflicts, publishConflicts, saveConflictCopy, saveNote, vault])

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
    onMovedRef.current?.(moved)
  }, [vault])

  const move = useCallback(async (path: string, folder: string) => {
    if (vault === null) return path
    const target = folder === '' ? memoNotesFolder() : folder
    if (memoParentOf(path) === target) return path
    const next = `${target}/${path.split('/').at(-1) ?? ''}`
    assertNoConflict([path])
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
    assertNoConflict(notePaths)
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
    assertNoConflict([path])
    await flushPending([path])
    await renameMemoNote(vault, path, next)
    applyNotes((current) => {
      const map = new Map<string, MemoNote>()
      for (const [key, value] of current) map.set(key === path ? next : key, value)
      return map
    })
    setOpenPath((current) => (current === path ? next : current))
    if (openPath === path) open(next)
    onMovedRef.current?.(new Map([[path, next]]))
    return next
  }, [flushPending, open, openPath, vault])

  const trash = useCallback(async (path: string, source: TrashSource = 'unspecified') => {
    if (vault === null) return
    const pending = timersRef.current.get(path)
    if (pending !== undefined) {
      clearTimeout(pending)
      timersRef.current.delete(path)
    }
    heldRef.current.delete(path)
    publishConflicts()
    await trashMemoNote(vault, path, source)
    const rest = [...notesRef.current.keys()].filter((item) => item !== path)
    applyNotes((current) => {
      const map = new Map(current)
      map.delete(path)
      return map
    })
    if (openPath === path) open(rest[0] ?? null)
  }, [open, openPath, publishConflicts, vault])

  /**
   * path 노트를 고친다(열린 노트든 탭으로 연 노트든 같은 길: 되돌리기 기록·저장 대기·충돌 확인이 그대로 지켜진다).
   * 목록에 없는 노트는 만들지 않고 무시한다 — 지워진 노트의 탭이 파일을 되살리지 않게
   */
  const updateNoteAt = useCallback((path: string, change: (note: MemoNote) => MemoNote) => {
    const current = notesRef.current.get(path)
    if (current === undefined) return
    const next = change(current)
    if (next !== current) putNote(path, next)
  }, [putNote])
  /** path 노트의 지금 내용(그리기용: 노트가 바뀌면 이 함수도 새로 만들어져 다시 그린다). 목록에 없으면 null */
  const noteAt = useCallback((path: string): MemoNote | null => notes.get(path) ?? null, [notes])
  const updateOpen = useCallback((change: (note: MemoNote) => MemoNote) => {
    if (openPath === null) return
    updateNoteAt(openPath, change)
  }, [openPath, updateNoteAt])

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

  /**
   * 열린 노트의 블록 하나의 ID·제목을 바꾸고, 같은 메모(같은 ID + 같은 형광펜)의 다른 블록들도 같은 값으로 맞춘다.
   * 모든 노트는 notesRef(저장 전 최신)에서 읽고 putNote 로 쓰므로 노트마다 저장 대기·충돌 확인이 그대로 지켜지고,
   * 한 번의 동작으로 남겨 Ctrl+Z 한 번에 모든 노트가 돌아온다
   */
  const setTicket = useCallback((blockId: string, ticket: MemoTicket | null, at?: string) => {
    const path = at ?? openPathRef.current
    if (path === null) return
    const changed = syncTicketEdit(notesRef.current, path, blockId, ticket)
    if (changed.size === 0) return
    recordSeparately(() => { for (const [changedPath, note] of changed) putNote(changedPath, note) })
  }, [putNote])
  const tickets = useMemo(() => buildTicketIndex(notes), [notes])
  const highlightById = useMemo(() => new Map(highlights.map((highlight) => [highlight.id, highlight])), [highlights])
  const highlightOf = useCallback((highlightId: string) => highlightById.get(highlightId), [highlightById])

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
    loaded: vault !== null && loadedRoot === vault.root,
    create,
    updateOpen,
    noteAt,
    updateNoteAt,
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
    conflict: conflicts[0] ?? null,
    resolveConflict,
    tickets,
    setTicket,
    highlightOf,
  }
}
