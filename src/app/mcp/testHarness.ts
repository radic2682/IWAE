import { applySnapshotChange } from '../../core/jsonMerge'
import {
  EMPTY_MEMO_NOTE,
  memoNotePath,
  memoNoteTitleOf,
  removeHighlightBlocks,
  safeNoteTitle,
  uniqueNoteTitle,
  type MemoNote,
} from '../../core/memoNote'
import type { PdfDocMeta } from '../../bridge/pdf'
import { removePersistentPdfHighlight, updatePersistentPdfHighlight, type PersistentPdfHighlight } from '../../pdf/persistentHighlight'
import { recordUndo } from '../undoStack'
import { handleMcpOp } from './index'
import { fakePages, fakeIndex, fakePageTextIndex, setFakePdf } from './testPdf'
import type { McpAppDeps, McpDeps } from './types'

export { fakeIndex, fakePageTextIndex, fakePages, setFakePdf }
export function fakeMeta(docId: string): { meta: PdfDocMeta; title: string } {
  const pages = fakePages.get(docId)
  if (pages === undefined) throw new Error(`없는 문서입니다: ${docId}`)
  return {
    title: `문서 ${docId}`,
    meta: { docId, sha256: docId, size: 1, title: `문서 ${docId}`, pageCount: pages.length, pageSizes: pages.map(() => [595, 842] as const), hasText: true },
  }
}

export interface FakeEnv {
  readonly deps: McpDeps
  readonly notes: Map<string, MemoNote>
  readonly highlights: () => readonly PersistentPdfHighlight[]
  readonly trashed: string[]
  /** 다음 노트 저장을 「디스크가 바뀌었다」로 거부하게 한다 */
  readonly state: { conflictPath: string | null; refuseEdits: boolean }
  call(op: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>
}

/** 앱의 형광펜·노트 저장소와 같은 되돌리기 기록을 남기는 가짜 저장소 */
export function makeEnv(options: { app?: McpAppDeps; pdfs?: Record<string, string[]> } = {}): FakeEnv {
  for (const [docId, pages] of Object.entries(options.pdfs ?? {})) setFakePdf(docId, pages)
  let list: readonly PersistentPdfHighlight[] = []
  const notes = new Map<string, MemoNote>()
  const trashed: string[] = []
  const state = { conflictPath: null as string | null, refuseEdits: false }

  const restore = (next: readonly PersistentPdfHighlight[]) => { list = next }
  const remember = (before: readonly PersistentPdfHighlight[], after: readonly PersistentPdfHighlight[], key: string) => {
    recordUndo({ key: `pdf-hl:${key}`, undo: () => restore(applySnapshotChange(after, before, list)), redo: () => restore(applySnapshotChange(before, after, list)) })
  }
  const pathOf = (title: string) => [...notes.keys()].find((key) => memoNoteTitleOf(key).toLowerCase() === safeNoteTitle(title).toLowerCase())

  const deps: McpDeps = {
    get highlights() { return list },
    add: (highlight) => {
      if (list.some(({ id }) => id === highlight.id)) return
      const next = [...list, highlight]
      remember(list, next, highlight.id)
      list = next
    },
    update: (id, patch) => {
      if (!list.some((item) => item.id === id)) return
      const next = list.map((item) => item.id === id ? updatePersistentPdfHighlight(item, patch) : item)
      remember(list, next, `edit:${id}`)
      list = next
    },
    remove: (id) => {
      const next = removePersistentPdfHighlight(list, id)
      remember(list, next, id)
      list = next
      for (const [path, note] of notes) {
        const stripped = removeHighlightBlocks(note, id)
        if (stripped === note) continue
        recordUndo({
          key: `note:${path}`,
          undo: () => { const current = notes.get(path); if (current !== undefined) notes.set(path, applySnapshotChange(stripped, note, current)) },
          redo: () => { const current = notes.get(path); if (current !== undefined) notes.set(path, applySnapshotChange(note, stripped, current)) },
        })
        notes.set(path, stripped)
      }
    },
    loadPdfById: async (docId) => fakeMeta(docId),
    notes: {
      list: () => [...notes.entries()].map(([path, note]) => ({ path, title: memoNoteTitleOf(path), blocks: note.blocks.length })),
      find: (title) => {
        const path = pathOf(title)
        return path === undefined ? null : { path, note: notes.get(path)! }
      },
      // 실제 useMemoNotes.editNoteTitled 처럼: 메모리 상태를 먼저 바꾸고 되돌리기는 남기지 않는다
      edit: (title, change, create) => {
        if (state.refuseEdits) throw Object.assign(new Error('External change: x'), { name: 'VaultExternalChangeError' })
        const path = pathOf(title) ?? memoNotePath(title)
        if (!notes.has(path) && !create) throw new Error(`「${title}」 노트가 없습니다.`)
        notes.set(path, change(notes.get(path) ?? EMPTY_MEMO_NOTE))
        return path
      },
      createIn: async (folder, title = '새 노트', docId) => {
        const unique = uniqueNoteTitle(title, [...notes.keys()].map(memoNoteTitleOf))
        const path = memoNotePath(unique, folder === '' ? '노트' : folder)
        notes.set(path, docId === undefined ? EMPTY_MEMO_NOTE : { ...EMPTY_MEMO_NOTE, docId })
        return path
      },
      trash: async (path) => { notes.delete(path); trashed.push(path) },
      rename: async (path, title) => {
        const note = notes.get(path)!
        const next = memoNotePath(title, path.slice(0, path.lastIndexOf('/')))
        notes.delete(path)
        notes.set(next, note)
        return next
      },
      conflict: () => (state.conflictPath === null ? null : { path: state.conflictPath, title: memoNoteTitleOf(state.conflictPath) }),
    },
    ...(options.app === undefined ? {} : { app: options.app }),
  }
  return {
    deps,
    notes,
    highlights: () => list,
    trashed,
    state,
    call: (op, args = {}) => handleMcpOp(op, args, deps) as Promise<Record<string, unknown>>,
  }
}

/** 시험용 App 상태. 필요한 칸만 덮어쓴다 */
export function fakeApp(overrides: Partial<McpAppDeps> = {}): McpAppDeps {
  return {
    vaultRoot: 'C:/vault',
    paneCount: 1,
    layout: { kind: 'pane', paneId: 'p1' },
    activePane: 'p1',
    panes: [{ index: 0, id: 'p1', tabs: [], activeId: null, channel: 'blue' }],
    screens: [{ index: 0, id: 'w1', name: '읽기', active: true, panes: [{ index: 0, id: 'p1', tabs: [], activeId: null, channel: 'blue' }], floats: [] }],
    floats: [],
    docViews: {},
    selection: () => null,
    docs: [],
    bookmarks: [],
    openDocument: async (_docId, options) => ({ pane: 'p1', page: options.page ?? null }),
    openNote: () => ({ pane: 'p1' }),
    setLayout: (paneCount, focus) => ({ paneCount, activePane: focus ?? 0 }),
    goto: async (input) => ({ flashed: input.flash }),
    closeTab: () => true,
    workspaceCommand: async () => ({ ok: true, message: '', state: { active_screen: 0, active_pane: 0, active_float: null, screens: [] } }),
    clients: () => [{ id: 'main', label: 'A', session: '기본', screen: 0 }],
    session: async () => ({ name: '기본', sessions: [{ name: '기본', active: true, screens: 1, last_used_at: null }] }),
    addBookmark: () => 'bm-1',
    updateBookmark: (id) => id,
    removeBookmark: () => undefined,
    restoreBookmarks: () => undefined,
    setFavorite: () => undefined,
    translation: { enabled: true, executionMode: 'auto', externalProvider: 'google', targetLanguage: 'ko', ready: true, translate: async (text) => `번역: ${text}` },
    runPdfTool: async () => ({ path: 'C:/vault/new.pdf', docId: 'newdoc', pageCount: 2 }),
    exportNoteMarkdownFile: async () => 'C:/vault/export/a.md',
    settings: () => ({ language: 'ko', theme: 'light' }),
    ...overrides,
  }
}
