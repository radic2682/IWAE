/**
 * 앱 전체 되돌리기(Ctrl+Z)·다시 하기(Ctrl+Shift+Z, Ctrl+Y).
 *
 * 형광펜·메모·박스 메모(usePdfHighlights, useMarkdownHighlights), PDF 위 그림(usePdfOverlays),
 * 노트 블록(useMemoNotes)이 바꾸기 전·후 상태를 여기에 남긴다. 되돌리면 그 저장소가 전 상태를 다시 쓴다.
 *
 * - 한 번의 동작이 여러 저장소를 바꾸면(메모 = 형광펜 + 노트 블록) 같은 순간에 남긴 것을 한 묶음으로 되돌린다.
 * - 같은 대상을 잇달아 고치면(글자 치기) 잠깐 사이의 것은 하나로 합친다.
 * - 되돌리는 동안 저장소가 다시 남기는 것은 받지 않는다.
 */

export interface UndoEntry {
  /** 같은 대상을 잇달아 고칠 때 합치는 열쇠(예: note:경로) */
  readonly key: string
  readonly undo: () => void
  readonly redo: () => void
}

interface Group {
  entries: UndoEntry[]
  at: number
}

const LIMIT = 200
/** 같은 대상 고침을 하나로 합치는 시간 */
const MERGE_MS = 1200

let past: Group[] = []
let future: Group[] = []
let applying = false
let openGroup: Group | null = null

export function recordUndo(entry: UndoEntry): void {
  if (applying) return
  future = []
  const now = Date.now()
  // 같은 순간(한 번의 동작)에 남긴 것은 한 묶음
  if (openGroup !== null) {
    mergeInto(openGroup, entry)
    return
  }
  // 바로 앞 묶음이 같은 대상 하나만 고친 것이고 잠깐 전이면 합친다(글자를 칠 때마다 한 칸씩 되돌리지 않게)
  const last = past.at(-1)
  if (last !== undefined && now - last.at < MERGE_MS && last.entries.length === 1 && last.entries[0]!.key === entry.key) {
    mergeInto(last, entry)
    last.at = now
    return
  }
  const group: Group = { entries: [entry], at: now }
  past.push(group)
  if (past.length > LIMIT) past = past.slice(-LIMIT)
  openGroup = group
  queueMicrotask(() => { openGroup = null })
}

/** 같은 열쇠가 이미 묶음에 있으면 처음 것의 되돌리기와 나중 것의 다시 하기를 쓴다 */
function mergeInto(group: Group, entry: UndoEntry) {
  const index = group.entries.findIndex((item) => item.key === entry.key)
  if (index < 0) {
    group.entries.push(entry)
    return
  }
  const first = group.entries[index]!
  group.entries[index] = { key: entry.key, undo: first.undo, redo: entry.redo }
}

export function undo(): boolean {
  const group = past.pop()
  if (group === undefined) return false
  run(() => { for (const entry of [...group.entries].reverse()) entry.undo() })
  future.push(group)
  return true
}

export function redo(): boolean {
  const group = future.pop()
  if (group === undefined) return false
  run(() => { for (const entry of group.entries) entry.redo() })
  past.push({ ...group, at: 0 })
  return true
}

export function canUndo(): boolean {
  return past.length > 0
}

export function canRedo(): boolean {
  return future.length > 0
}

/** 다른 Vault 로 바뀌면 지난 기록은 버린다 */
export function clearUndo(): void {
  past = []
  future = []
  openGroup = null
}

function run(apply: () => void) {
  applying = true
  try {
    apply()
  } finally {
    applying = false
  }
}
