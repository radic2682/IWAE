import { EMPTY_MEMO_NOTE, memoNotePath, memoNoteTitleOf, memoParentOf, safeNoteTitle, type MemoNote } from '../../core/memoNote'
import { applySnapshotChange } from '../../core/jsonMerge'
import { isVaultExternalChangeError } from '../../core/vaultSync'
import { recordUndo } from '../undoStack'
import { trackUndoWork } from './aiChangeLog'

/**
 * MCP 가 노트를 만지는 유일한 길. useMemoNotes 의 members(createIn·editNoteTitled·findNoteTitled·listNotes·trash·rename)를 감싼다.
 * - 노트 파일은 앱이 가진 상태를 거쳐서만 고친다(밖에서 .iwnote 를 쓰지 않는다).
 * - 쓰기는 모두 await 한다. 다른 프로그램이 파일을 바꿔 저장이 거부되면(VaultExternalChangeError)·충돌이 잡혀 있으면
 *   「디스크에서 바뀌었다」고 알려 준다 — 그 보호를 약하게 하지 않는다.
 * - 노트 고침·만들기·지우기·이름 바꾸기는 되돌리기(undoStack)에 남긴다(AI 변경 묶음 안에서 불리면 그 묶음에 들어간다).
 */
export interface NoteStoreDeps {
  readonly list: () => { path: string; title: string; blocks: number }[]
  readonly find: (title: string) => { path: string; note: MemoNote } | null
  readonly edit: (title: string, change: (note: MemoNote) => MemoNote, create: boolean) => string | Promise<string>
  /** 노트를 통째로 휴지통으로 */
  readonly trash: (path: string) => Promise<void>
  /** 폴더에 새 노트를 만든다(docId 가 있으면 그 PDF 의 노트). 만든 경로, 실패하면 null */
  readonly createIn?: (folder: string, title?: string, docId?: string) => Promise<string | null>
  /** 노트 이름 바꾸기. 새 경로 */
  readonly rename?: (path: string, title: string) => Promise<string>
  /** 다른 프로그램이 바꾼 파일과 부딪쳐 저장이 멈춘 노트(없으면 null) */
  readonly conflict?: () => { readonly path: string; readonly title: string } | null
  /** 새 노트를 둘 폴더(기본: 노트 폴더) */
  readonly folder?: () => string
}

export interface NoteRef {
  readonly path: string
  readonly title: string
  readonly note: MemoNote
}

export class NoteNotFoundError extends Error {
  constructor(title: string) {
    super(`「${title}」 노트가 없습니다(note not found). note_list로 제목을 확인하거나 note_create로 만드세요.`)
    this.name = 'NoteNotFoundError'
  }
}

/** 저장이 거부된 노트: 다시 읽고 다시 시도하라고 알린다 */
export function changedOnDiskError(title: string): Error {
  return new Error(`「${title}」 노트가 디스크에서 다른 프로그램에 의해 바뀌었습니다(note changed on disk). note_read로 다시 읽고 다시 시도하세요. 앱의 충돌 안내를 사용자가 먼저 정해야 할 수도 있습니다.`)
}

function isStaleWrite(cause: unknown): boolean {
  return isVaultExternalChangeError(cause) || (cause instanceof Error && /다른 프로그램이 바꾼|External change/u.test(cause.message))
}

export function cleanTitle(title: string): string {
  return title.replace(/^#/u, '').trim()
}

export interface NoteAdapter {
  readonly available: boolean
  list(): NoteRef[]
  /** 제목으로 찾는다(대소문자 무시). 없으면 null */
  find(title: string): NoteRef | null
  /** 없으면 「노트가 없습니다」 오류 */
  require(title: string): NoteRef
  /** 노트를 만든다. 같은 제목이 있고 unique 가 아니면 있던 노트를 돌려준다 */
  create(input: { title: string; docId?: string; folder?: string; unique?: boolean }): Promise<{ ref: NoteRef; created: boolean }>
  /** 노트를 고친다(await). create 면 없을 때 만든다. 고치기 전·후 노트를 돌려준다 */
  edit(title: string, change: (note: MemoNote) => MemoNote, options?: { create?: boolean; docId?: string }): Promise<{ ref: NoteRef; before: MemoNote; created: boolean }>
  rename(title: string, newTitle: string): Promise<NoteRef>
  trash(title: string): Promise<NoteRef>
}

export function noteAdapter(store: NoteStoreDeps | undefined): NoteAdapter {
  const need = (): NoteStoreDeps => {
    if (store === undefined) throw new Error('노트를 다룰 수 없습니다(Vault가 열려 있지 않습니다).')
    return store
  }
  const refOf = (path: string, note: MemoNote): NoteRef => ({ path, title: memoNoteTitleOf(path), note })
  const find = (title: string): NoteRef | null => {
    const found = need().find(cleanTitle(title))
    return found === null ? null : refOf(found.path, found.note)
  }
  const byPath = (path: string): NoteRef | null => find(memoNoteTitleOf(path))?.path === path ? find(memoNoteTitleOf(path)) : null
  const guardConflict = (path: string, title: string) => {
    const held = need().conflict?.() ?? null
    if (held !== null && held.path === path) throw changedOnDiskError(title)
  }

  /** 되돌리기·다시 하기용: 지금 노트에 from→to 의 변화를 얹는다 */
  const applyChange = (path: string, from: MemoNote, to: MemoNote) => {
    const current = byPath(path)
    if (current === null) return
    trackUndoWork(Promise.resolve(need().edit(current.title, (note) => applySnapshotChange(from, to, note), false)))
  }

  const create: NoteAdapter['create'] = async ({ title, docId, folder, unique }) => {
    const wanted = cleanTitle(title)
    if (wanted === '') throw new Error('title(노트 제목)이 필요합니다.')
    const existing = unique === true ? null : find(wanted)
    if (existing !== null) return { ref: existing, created: false }
    const deps = need()
    const target = folder ?? deps.folder?.() ?? ''
    let path: string | null
    if (deps.createIn !== undefined) {
      path = await deps.createIn(target, wanted, docId)
    } else {
      path = await deps.edit(wanted, (note) => (docId === undefined ? note : { ...note, docId }), true)
    }
    if (path === null) throw new Error('노트를 만들지 못했습니다(Vault를 확인하세요).')
    const made = byPath(path) ?? { path, title: memoNoteTitleOf(path), note: docId === undefined ? EMPTY_MEMO_NOTE : { ...EMPTY_MEMO_NOTE, docId } }
    const snapshot = made.note
    recordUndo({
      key: `notefile:${path}`,
      undo: () => { trackUndoWork(deps.trash(path!)) },
      redo: () => {
        trackUndoWork((async () => {
          const again = await (deps.createIn?.(memoParentOf(path!), memoNoteTitleOf(path!), docId) ?? Promise.resolve(null))
          if (again !== null) await deps.edit(memoNoteTitleOf(again), () => snapshot, false)
        })())
      },
    })
    return { ref: made, created: true }
  }

  return {
    available: store !== undefined,
    list: () => need().list().flatMap((item) => {
      const found = need().find(item.title)
      return found === null || found.path !== item.path ? [] : [refOf(found.path, found.note)]
    }),
    find,
    require(title) {
      const found = find(title)
      if (found === null) throw new NoteNotFoundError(cleanTitle(title))
      return found
    },
    create,
    async edit(title, change, options = {}) {
      const wanted = cleanTitle(title)
      let found = find(wanted)
      let createdNow = false
      if (found === null) {
        if (options.create !== true) throw new NoteNotFoundError(wanted)
        // 새 노트는 createIn 으로 만들어야 PDF(docId)에 붙는다
        const made = await create({ title: wanted, ...(options.docId === undefined ? {} : { docId: options.docId }) })
        found = made.ref
        createdNow = made.created
      }
      const { path } = found
      guardConflict(path, found.title)
      const before = found.note
      try {
        await need().edit(found.title, change, false)
      } catch (cause) {
        if (isStaleWrite(cause)) throw changedOnDiskError(found.title)
        throw cause
      }
      guardConflict(path, found.title)
      const after = byPath(path)
      if (after === null) throw changedOnDiskError(found.title)
      if (after.note !== before) {
        recordUndo({
          key: `note:${path}`,
          undo: () => applyChange(path, after.note, before),
          redo: () => applyChange(path, before, after.note),
        })
      }
      return { ref: after, before, created: createdNow }
    },
    async rename(title, newTitle) {
      const deps = need()
      const found = this.require(title)
      if (deps.rename === undefined) throw new Error('이 앱 버전에서는 노트 이름을 바꿀 수 없습니다.')
      guardConflict(found.path, found.title)
      const next = safeNoteTitle(cleanTitle(newTitle))
      let path: string
      try {
        path = await deps.rename(found.path, next)
      } catch (cause) {
        if (isStaleWrite(cause)) throw changedOnDiskError(found.title)
        throw cause
      }
      const from = found.path
      recordUndo({
        key: `notefile:${from}`,
        undo: () => { trackUndoWork(deps.rename!(path, memoNoteTitleOf(from))) },
        redo: () => { trackUndoWork(deps.rename!(from, memoNoteTitleOf(path))) },
      })
      return byPath(path) ?? refOf(path, found.note)
    },
    async trash(title) {
      const deps = need()
      const found = this.require(title)
      const snapshot = found.note
      const { path } = found
      await deps.trash(path)
      recordUndo({
        key: `notefile:${path}`,
        undo: () => {
          trackUndoWork((async () => {
            const again = await (deps.createIn?.(memoParentOf(path), memoNoteTitleOf(path), snapshot.docId) ?? Promise.resolve(null))
            if (again !== null) await deps.edit(memoNoteTitleOf(again), () => snapshot, false)
          })())
        },
        redo: () => { const current = byPath(path); if (current !== null) trackUndoWork(deps.trash(current.path)) },
      })
      return found
    },
  }
}

/** 노트 경로 만들기(시험·표시용) */
export { memoNotePath }
