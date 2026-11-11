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
  readonly id: number
  entries: UndoEntry[]
  at: number
  /** 이름이 붙은 묶음(MCP 가 한 번에 한 변경). 합치지 않는다 */
  label?: string
}

const LIMIT = 200
/** 같은 대상 고침을 하나로 합치는 시간 */
const MERGE_MS = 1200

let past: Group[] = []
let future: Group[] = []
let applying = false
let openGroup: Group | null = null
let nextGroupId = 1
/** beginUndoGroup 가 연 이름 있는 묶음. 닫을 때까지 이어지는 동작(await 를 건너도)이 모두 이 묶음으로 들어간다 */
let labeled: { label: string; group: Group | null } | null = null

function newGroup(entry: UndoEntry, now: number): Group {
  return { id: nextGroupId++, entries: [entry], at: now }
}

export function recordUndo(entry: UndoEntry): void {
  if (applying) return
  future = []
  const now = Date.now()
  if (labeled !== null) {
    if (labeled.group === null) {
      const group = newGroup(entry, now)
      group.label = labeled.label
      labeled.group = group
      past.push(group)
      if (past.length > LIMIT) past = past.slice(-LIMIT)
    } else {
      mergeInto(labeled.group, entry)
    }
    return
  }
  // 같은 순간(한 번의 동작)에 남긴 것은 한 묶음
  if (openGroup !== null) {
    mergeInto(openGroup, entry)
    return
  }
  // 바로 앞 묶음이 같은 대상 하나만 고친 것이고 잠깐 전이면 합친다(글자를 칠 때마다 한 칸씩 되돌리지 않게)
  const last = past.at(-1)
  if (last !== undefined && now - last.at < MERGE_MS && last.label === undefined && last.entries.length === 1 && last.entries[0]!.key === entry.key) {
    mergeInto(last, entry)
    last.at = now
    return
  }
  const group = newGroup(entry, now)
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

/** 이름 있는 묶음을 연다. endUndoGroup 까지 기록되는 되돌리기는 모두 이 묶음 하나로 들어간다(안에 아무것도 남지 않으면 묶음이 생기지 않는다) */
export function beginUndoGroup(label: string): void {
  labeled = { label, group: null }
}

export interface UndoGroupInfo {
  readonly id: number
  readonly label: string
  /** 이 묶음이 바꾼 대상들(되돌리기 열쇠. 같은 대상의 여러 열쇠는 하나로 센다) */
  readonly objects: readonly string[]
}

/** 대상 이름: 같은 형광펜을 고치는 열쇠(pdf-hl:edit:id)와 만드는 열쇠(pdf-hl:id)를 같게 본다 */
function objectOf(key: string): string {
  return key.replace(/^pdf-hl:edit:/u, 'pdf-hl:')
}

export function endUndoGroup(): UndoGroupInfo | null {
  const group = labeled?.group ?? null
  const label = labeled?.label ?? ''
  labeled = null
  if (group === null) return null
  return { id: group.id, label, objects: [...new Set(group.entries.map((entry) => objectOf(entry.key)))] }
}

/** 묶음이 지금 어디 있는가: past 되돌릴 수 있음, future 되돌려 둠(다시 하기 가능), gone 사라짐 */
export function undoGroupState(id: number): 'past' | 'future' | 'gone' {
  if (past.some((group) => group.id === id)) return 'past'
  if (future.some((group) => group.id === id)) return 'future'
  return 'gone'
}

/** 이 묶음 뒤에, 같은 대상을 건드린 다른 묶음이 쌓였는가(사람이 고쳤거나 되돌려지지 않은 뒤의 변경) */
export function touchedAfter(id: number, ownIds: ReadonlySet<number>): boolean {
  const index = past.findIndex((group) => group.id === id)
  if (index < 0) return false
  const mine = new Set(past[index]!.entries.map((entry) => objectOf(entry.key)))
  return past.slice(index + 1).some((group) => !ownIds.has(group.id) && group.entries.some((entry) => mine.has(objectOf(entry.key))))
}

/** 이름 있는 묶음 하나만 되돌린다(맨 위가 아니어도). 되돌렸으면 true */
export function undoLabeled(id: number): boolean {
  const index = past.findIndex((group) => group.id === id)
  if (index < 0) return false
  const [group] = past.splice(index, 1)
  run(() => { for (const entry of [...group!.entries].reverse()) entry.undo() })
  future.push(group!)
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
  labeled = null
}

function run(apply: () => void) {
  applying = true
  try {
    apply()
  } finally {
    applying = false
  }
}
