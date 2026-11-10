/**
 * 화면 쪽 오류 기록(링 버퍼). 「문제 보고」에서 사용자가 미리 보고 낼 때만 쓰인다 — 어디로도 자동으로 보내지 않는다.
 * 메시지와 스택만 담고(문서 글은 담지 않는다), 보고서를 만들 때 한 번 더 가린다.
 */

export interface RecordedError {
  readonly at: string
  readonly kind: 'error' | 'unhandledrejection'
  readonly message: string
  readonly stack?: string
}

const MAX_ENTRIES = 50
const MAX_TEXT = 1200
const entries: RecordedError[] = []

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text
}

function safeString(value: unknown): string {
  try {
    return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

export function recordError(kind: RecordedError['kind'], cause: unknown, now: Date = new Date()): void {
  const message = cause instanceof Error ? `${cause.name}: ${cause.message}` : typeof cause === 'string' ? cause : safeString(cause)
  const stack = cause instanceof Error && cause.stack !== undefined ? clip(cause.stack) : undefined
  entries.push({ at: now.toISOString(), kind, message: clip(message), ...(stack === undefined ? {} : { stack }) })
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
}

export function recordedErrors(): readonly RecordedError[] {
  return entries.slice()
}

export function clearRecordedErrors(): void {
  entries.length = 0
}

let installed = false

/** window error / unhandledrejection 을 버퍼에 쌓는다(한 번만 건다) */
export function installErrorBuffer(target: Pick<Window, 'addEventListener'> = window): void {
  if (installed) return
  installed = true
  target.addEventListener('error', (event) => {
    const e = event as ErrorEvent
    recordError('error', e.error ?? e.message ?? 'error')
  })
  target.addEventListener('unhandledrejection', (event) => {
    recordError('unhandledrejection', (event as PromiseRejectionEvent).reason)
  })
}
