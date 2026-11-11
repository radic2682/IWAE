import { useSyncExternalStore } from 'react'

/** 바깥 AI 가 지금 일하고 있는가. 상단바 알약(AiActivityPill)이 읽는다 */
export interface AiActivityState {
  readonly active: boolean
  /** 마지막으로 만진 대상(노트·문서 제목) */
  readonly target: string
  /** 이번 작업 동안 바뀐 개수 */
  readonly changes: number
}

/** 마지막 요청이 끝나고 알약이 사라지기까지 */
export const AI_ACTIVITY_LINGER_MS = 3000

const IDLE: AiActivityState = { active: false, target: '', changes: 0 }
let state: AiActivityState = IDLE
let running = 0
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function publish(next: AiActivityState): void {
  state = next
  for (const listener of [...listeners]) listener()
}

export function getAiActivity(): AiActivityState {
  return state
}

export function subscribeAiActivity(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useAiActivity(): AiActivityState {
  return useSyncExternalStore(subscribeAiActivity, getAiActivity, getAiActivity)
}

/** 요청이 시작됐다(쓰기·탐색). 알약을 켠다 */
export function aiActivityBegin(target: string): void {
  running += 1
  if (timer !== null) { clearTimeout(timer); timer = null }
  publish({ active: true, target: target === '' ? state.target : target, changes: state.active ? state.changes : 0 })
}

/** 요청이 끝났다. 마지막 요청 뒤 3초가 지나면 알약이 사라진다 */
export function aiActivityEnd(changes: number, target?: string): void {
  running = Math.max(0, running - 1)
  publish({ active: true, target: target !== undefined && target !== '' ? target : state.target, changes: state.changes + Math.max(0, changes) })
  if (running > 0) return
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    if (running === 0) publish(IDLE)
  }, AI_ACTIVITY_LINGER_MS)
}

/** 시험용 */
export function resetAiActivity(): void {
  running = 0
  if (timer !== null) { clearTimeout(timer); timer = null }
  publish(IDLE)
}
