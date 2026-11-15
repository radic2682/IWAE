/**
 * 웹뷰를 새로 고치거나 닫을 때 Rust 쪽에 남는 구독을 걷는다.
 *
 * 파일 감시(plugin:fs|watch, 끌 때는 plugin:resources|close)와 이벤트 듣기(plugin:event|listen)는 Rust 가 웹뷰 밖에서 들고 있다. 화면이 다시 읽히면
 * React 정리 함수는 돌지 않으므로 감시·듣기가 쌓이고, 죽은 콜백으로 이벤트를 보내 "Couldn't find callback id" 가 늘어난다.
 * 호출 한 곳씩 고치는 대신, 열려 있는 구독을 세어 두었다가 pagehide 때 한꺼번에 푼다.
 * (beforeunload 는 「나갈까요?」 확인에서 취소될 수 있어 쓰지 않는다)
 */

interface TauriInternals { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }

/** invoke 의 명령 이름이 fetch 주소에 이렇게 들어간다(http://ipc.localhost/plugin%3Aevent%7Clisten) */
const COMMAND = /\/\/ipc\.localhost\/([^/?#]+)|^ipc:\/\/localhost\/([^/?#]+)/u

function commandOf(input: RequestInfo | URL): string | null {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const match = COMMAND.exec(url)
  const raw = match?.[1] ?? match?.[2]
  if (raw === undefined) return null
  try { return decodeURIComponent(raw) } catch { return null }
}

function jsonBody(init?: RequestInit): Record<string, unknown> | null {
  if (typeof init?.body !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(init.body)
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
  } catch { return null }
}

/**
 * Tauri 의 invoke 는 고칠 수 없어서(읽기 전용) 그 전달 길인 fetch 에서 구독 명령을 세어 둔다.
 * target 은 시험에서 바꿔 끼운다.
 */
export function installUnloadCleanup(target: Window = window): () => void {
  const internals = (target as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__
  if (internals === undefined || typeof internals.invoke !== 'function') return () => undefined
  const originalFetch = target.fetch
  const listeners = new Map<number, string>()
  const watchers = new Set<number>()

  const wrapped: typeof fetch = async (input, init) => {
    const response = await originalFetch.call(target, input, init)
    try {
      const cmd = commandOf(input)
      if (cmd === 'plugin:event|listen' || cmd === 'plugin:fs|watch') {
        const body = jsonBody(init)
        void response.clone().json().then((id: unknown) => {
          if (typeof id !== 'number') return
          if (cmd === 'plugin:fs|watch') watchers.add(id)
          else if (typeof body?.event === 'string') listeners.set(id, body.event)
        }, () => undefined)
      } else if (cmd === 'plugin:event|unlisten') {
        const id = jsonBody(init)?.eventId
        if (typeof id === 'number') listeners.delete(id)
      } else if (cmd === 'plugin:resources|close') {
        const rid = jsonBody(init)?.rid
        if (typeof rid === 'number') watchers.delete(rid)
      }
    } catch { /* 세지 못해도 요청은 그대로 간다 */ }
    return response
  }
  target.fetch = wrapped

  // 닫히는 웹뷰에서는 fetch 길이 막혀 Tauri 가 호출마다 "IPC custom protocol failed" 를 찍고 postMessage 길로 넘어간다(호출은 그대로 간다).
  // 구독 수만큼 경고가 쌓이므로 풀어 내는 동안만 그 경고를 거른다. 다른 경고는 그대로 둔다
  const quietIpcWarnings = () => {
    const consoleRef = target.console
    const originalWarn = consoleRef.warn
    consoleRef.warn = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].startsWith('IPC custom protocol failed')) return
      originalWarn.apply(consoleRef, args)
    }
    let restored = false
    const restore = () => {
      if (restored) return
      restored = true
      if (consoleRef.warn !== originalWarn) consoleRef.warn = originalWarn
    }
    // 웹뷰가 닫히지 않고 되살아나는 경우(pageshow)와, 닫히지 않은 채 늦게 실패하는 호출을 위해 잠시 뒤에 되돌린다
    target.addEventListener('pageshow', restore, { once: true })
    target.setTimeout(restore, 3000)
  }
  const release = () => {
    const openWatchers = [...watchers]
    const openListeners = [...listeners]
    watchers.clear()
    listeners.clear()
    if (openWatchers.length + openListeners.length > 0) quietIpcWarnings()
    for (const rid of openWatchers) void internals.invoke('plugin:resources|close', { rid }).catch(() => undefined)
    for (const [eventId, event] of openListeners) void internals.invoke('plugin:event|unlisten', { event, eventId }).catch(() => undefined)
  }
  target.addEventListener('pagehide', release)
  return () => {
    target.removeEventListener('pagehide', release)
    if (target.fetch === wrapped) target.fetch = originalFetch
  }
}
