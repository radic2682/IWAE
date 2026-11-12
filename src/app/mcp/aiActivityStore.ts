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

/** Rust 가 begin 만 보내고 end 를 못 보냈을 때(패닉 등) 알약이 영영 켜져 있지 않게 하는 한도 */
export const AI_ACTIVITY_SAFETY_MS = 60_000

/** Rust 의 `mcp-tool-activity` 이벤트 내용 */
export interface McpToolActivityEvent {
  readonly phase: 'begin' | 'end'
  readonly tool?: string
  readonly target?: string
}

// 이벤트로 켠 begin 마다 하나씩 쌓이는 안전 타이머. end 가 오면 가장 오래된 것부터 끈다
const guards: ReturnType<typeof setTimeout>[] = []

/** Rust 쪽 MCP tools/call 알림을 알약에 반영한다. 모든 도구(읽기 포함)가 지나간다 */
export function applyMcpToolActivity(event: McpToolActivityEvent): void {
  if (event.phase === 'begin') {
    aiActivityBegin(event.target ?? '')
    const guard = setTimeout(() => {
      const at = guards.indexOf(guard)
      if (at >= 0) guards.splice(at, 1)
      aiActivityEnd(0)
    }, AI_ACTIVITY_SAFETY_MS)
    guards.push(guard)
    return
  }
  const guard = guards.shift()
  if (guard === undefined) return // 짝 없는 end(안전 타이머가 이미 닫았다)
  clearTimeout(guard)
  aiActivityEnd(0)
}

let unlistenActivity: (() => void) | null = null

/** Tauri 이벤트를 듣는다. 돌려주는 함수는 구독 해제(다시 마운트돼도 겹치지 않는다) */
export function initAiActivityListener(): () => void {
  let cancelled = false
  void (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event')
      const stop = await listen<McpToolActivityEvent>('mcp-tool-activity', (event) => applyMcpToolActivity(event.payload))
      if (cancelled) stop()
      else {
        unlistenActivity?.()
        unlistenActivity = stop
      }
    } catch {
      // 브라우저(Tauri 없음)에서는 듣지 않는다
    }
  })()
  return () => {
    cancelled = true
    unlistenActivity?.()
    unlistenActivity = null
  }
}

/** 시험용 */
export function resetAiActivity(): void {
  for (const guard of guards.splice(0)) clearTimeout(guard)
  running = 0
  if (timer !== null) { clearTimeout(timer); timer = null }
  publish(IDLE)
}
