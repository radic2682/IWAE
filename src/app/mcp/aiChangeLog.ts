import { beginUndoGroup, endUndoGroup, touchedAfter, undoGroupState, undoLabeled } from '../undoStack'
import { aiActivityBegin, aiActivityEnd } from './aiActivityStore'
import type { ChangeNote } from './types'

/** 바깥 AI 가 한 변경 하나(되돌리기 묶음 하나). 최근 200개만 둔다 */
export interface AiChange {
  readonly seq: number
  readonly tool: string
  readonly summary: string
  readonly target: string
  readonly count: number
  readonly at: string
  /** undoStack 의 묶음 */
  readonly groupId: number
}

export interface AiChangeView {
  readonly seq: number
  readonly tool: string
  readonly summary: string
  readonly target: string
  readonly at: string
  readonly undone: boolean
  readonly edited_since: boolean
}

export const AI_CHANGE_LIMIT = 200

let sessionId = newSessionId()
let seq = 0
let log: AiChange[] = []
const pendingUndoWork = new Set<Promise<unknown>>()
const listeners = new Set<() => void>()

function newSessionId(): string {
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function notify(): void {
  for (const listener of [...listeners]) listener()
}

export function subscribeAiChanges(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 새 세션(웹뷰가 시작될 때·시험). 기록을 비운다 */
export function resetAiChangeLog(): string {
  sessionId = newSessionId()
  seq = 0
  log = []
  notify()
  return sessionId
}

export function aiSessionId(): string {
  return sessionId
}

/** 이 세션에서 한 변경 묶음 수 */
export function aiChangeCount(): number {
  return log.length
}

/** 되돌리는 쪽이 비동기 일(노트 파일 만들기·지우기)을 시작하면 알려 둔다. ai_undo 가 끝나기를 기다린다 */
export function trackUndoWork(work: Promise<unknown>): void {
  const tracked: Promise<unknown> = work.catch(() => undefined).finally(() => { pendingUndoWork.delete(tracked) })
  pendingUndoWork.add(tracked)
}

async function settleUndoWork(): Promise<void> {
  while (pendingUndoWork.size > 0) await Promise.all([...pendingUndoWork])
}

/**
 * 쓰기 하나를 되돌리기 묶음 하나로 감싼다. run 이 채운 ChangeNote(대상·개수·요약)가 기록에 남는다.
 * 도중에 실패해도 이미 바뀐 것은 묶음으로 남아 ai_undo 로 되돌릴 수 있다 — 오류에 그 사실을 덧붙인다.
 */
export async function runAiChange<T>(tool: string, run: (note: ChangeNote) => Promise<T> | T, targetHint = ''): Promise<T> {
  const note: ChangeNote = { target: targetHint, count: 0, summary: '' }
  aiActivityBegin(targetHint)
  beginUndoGroup(tool)
  let failure: unknown
  let failed = false
  let result: T | undefined
  try {
    result = await run(note)
  } catch (cause) {
    failure = cause
    failed = true
  }
  const info = endUndoGroup()
  if (info !== null) {
    seq += 1
    log = [...log, {
      seq,
      tool,
      summary: note.summary !== '' ? note.summary : tool,
      target: note.target,
      count: Math.max(note.count, 1),
      at: new Date().toISOString(),
      groupId: info.id,
    }].slice(-AI_CHANGE_LIMIT)
    notify()
  }
  aiActivityEnd(info === null ? 0 : Math.max(note.count, 1), note.target)
  if (failed) {
    const message = failure instanceof Error ? failure.message : String(failure)
    throw new Error(info === null ? message : `${message} (일부는 이미 바뀌었습니다. ai_undo로 되돌릴 수 있습니다 / partial changes were made; ai_undo reverts them)`)
  }
  return result as T
}

function viewOf(change: AiChange): AiChangeView {
  return {
    seq: change.seq,
    tool: change.tool,
    summary: change.summary,
    target: change.target,
    at: change.at,
    undone: undoGroupState(change.groupId) !== 'past',
    edited_since: touchedAfter(change.groupId, new Set()),
  }
}

/** 최근 변경(새것부터) */
export function aiChanges(limit = 50): { session_id: string; changes: AiChangeView[] } {
  const wanted = Math.max(1, Math.min(AI_CHANGE_LIMIT, Math.floor(limit)))
  return { session_id: sessionId, changes: [...log].reverse().slice(0, wanted).map(viewOf) }
}

/** 화면(알약의 변경 목록)이 읽는 목록 */
export function aiChangeViews(): AiChangeView[] {
  return [...log].reverse().map(viewOf)
}

/** 아직 되돌릴 수 있는 변경이 있는가 */
export function hasUndoableAiChange(): boolean {
  return log.some((change) => undoGroupState(change.groupId) === 'past')
}

/**
 * AI 가 한 묶음만 새것부터 되돌린다. 사람이 그 뒤에 같은 대상을 고쳤으면 건너뛴다('edited since').
 * seq 를 주면 그 묶음 하나, 아니면 steps(기본 1)개.
 */
export async function aiUndo(options: { steps?: number; seq?: number } = {}): Promise<{ undone: number[]; skipped: { seq: number; reason: string }[] }> {
  const undone: number[] = []
  const skipped: { seq: number; reason: string }[] = []
  const targets = options.seq !== undefined
    ? log.filter((change) => change.seq === options.seq)
    : [...log].reverse().filter((change) => undoGroupState(change.groupId) === 'past').slice(0, Math.max(1, Math.floor(options.steps ?? 1)))
  if (options.seq !== undefined && targets.length === 0) skipped.push({ seq: options.seq, reason: 'unknown seq' })
  for (const change of targets) {
    const state = undoGroupState(change.groupId)
    if (state !== 'past') {
      skipped.push({ seq: change.seq, reason: state === 'future' ? 'already undone' : 'no longer undoable' })
      continue
    }
    if (touchedAfter(change.groupId, new Set())) {
      skipped.push({ seq: change.seq, reason: 'edited since' })
      continue
    }
    if (undoLabeled(change.groupId)) undone.push(change.seq)
  }
  await settleUndoWork()
  if (undone.length > 0) notify()
  return { undone, skipped }
}

/** 알약의 「모두 되돌리기」: 되돌릴 수 있는 것을 새것부터 모두 */
export async function undoAllAiChanges(): Promise<{ undone: number[]; skipped: { seq: number; reason: string }[] }> {
  return aiUndo({ steps: AI_CHANGE_LIMIT })
}
