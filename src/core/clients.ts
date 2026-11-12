import { t } from '../i18n'

/**
 * 앱 창(tmux 의 client) 목록. 앱 창은 `{ 세션, 보는 화면 }` 을 가진다(docs/design/workspace-tmux.md 7).
 * 목록은 창들이 서로 알리는 「나 여기 있다」 알림(presence)으로 각 창이 따로 만든다 — 순수 함수만 둔다.
 */
export interface ClientInfo {
  /** 창 label('main' · 'window-<시각>') */
  readonly id: string
  /** 사용자에게 보이는 이름. 메인 창은 A, 나머지는 B · C … */
  readonly letter: string
  readonly role: 'main' | 'extra'
  /** 붙어 있는 세션 이름 */
  readonly session: string
  /** 보는 화면 번호(0부터) */
  readonly screen: number
  /** 숨겨 둔 창(메인 창을 떼면 숨긴 채 남아 MCP · 백업을 맡는다) */
  readonly hidden: boolean
  /** 열린 시각(ms). 소유자를 정하는 차례에 쓴다 */
  readonly joinedAt: number
}

export type ClientRegistry = readonly ClientInfo[]

export const MAIN_CLIENT_LETTER = 'A'

/** 같은 세션에 붙은 앱 창들 가운데 누가 먼저인가: 메인 창, 그다음 먼저 열린 창 */
export function clientRank(a: ClientInfo, b: ClientInfo): number {
  if (a.role !== b.role) return a.role === 'main' ? -1 : 1
  return a.joinedAt - b.joinedAt || a.id.localeCompare(b.id)
}

/** 알림을 목록에 반영한다(같은 창이면 바꾼다). 차례대로 정렬해 돌려준다 */
export function upsertClient(registry: ClientRegistry, info: ClientInfo): ClientRegistry {
  const next = [...registry.filter((client) => client.id !== info.id), info]
  return next.sort(clientRank)
}

export function removeClient(registry: ClientRegistry, id: string): ClientRegistry {
  return registry.some((client) => client.id === id) ? registry.filter((client) => client.id !== id) : registry
}

export function sessionClients(registry: ClientRegistry, session: string): ClientInfo[] {
  return registry.filter((client) => client.session === session)
}

/**
 * 세션 파일을 쓰는 창(소유자): 그 세션에 붙은 창 가운데 첫째(메인 창이 있으면 메인 창).
 * 모든 창이 같은 목록에서 같은 답을 내므로 따로 뽑지 않아도 된다 — 소유자가 닫히면 목록에서 빠져 다음 창이 이어받는다.
 */
export function ownerOf(registry: ClientRegistry, session: string): ClientInfo | null {
  return sessionClients(registry, session).sort(clientRank)[0] ?? null
}

/** 보이는 앱 창(숨긴 메인 창은 뺀다) */
export function visibleClients(registry: ClientRegistry): ClientInfo[] {
  return registry.filter((client) => !client.hidden)
}

/** 새 앱 창에 줄 이름: 쓰지 않은 가장 앞 글자(B부터). 메인 창은 늘 A 다 */
export function nextClientLetter(registry: ClientRegistry): string {
  const used = new Set(registry.map((client) => client.letter))
  for (let code = 'B'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
    const letter = String.fromCharCode(code)
    if (!used.has(letter)) return letter
  }
  return `${registry.length + 1}`
}

/** 「B」 · 「b」 · 창 label 로 앱 창을 찾는다(MCP · 명령). 없으면 null */
export function findClient(registry: ClientRegistry, ref: string): ClientInfo | null {
  const wanted = ref.trim()
  if (wanted === '') return null
  return registry.find((client) => client.id === wanted)
    ?? registry.find((client) => client.letter.toLowerCase() === wanted.toLowerCase())
    ?? null
}

/** 세션 메뉴에 보일 「앱 창 2개」 */
export function clientCountText(count: number): string {
  return t('앱 창 {n}개', { n: count })
}

/** 세션별 붙은 앱 창 수 */
export function attachedCounts(registry: ClientRegistry): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const client of registry) counts.set(client.session, (counts.get(client.session) ?? 0) + 1)
  return counts
}

/** detach 가 할 일: 다른 앱 창이 보이면 이 창을 닫고(메인 창은 숨는다), 마지막 앱 창이면 앱을 닫을지 묻는다 */
export function detachPlan(registry: ClientRegistry, selfId: string): 'close' | 'confirm-quit' {
  return visibleClients(registry).some((client) => client.id !== selfId) ? 'close' : 'confirm-quit'
}

/**
 * 창을 닫으려 할 때(× · detach) 무엇이 되는가.
 * - hide: 메인 창인데 다른 앱 창이 보인다 → 숨긴 채 남는다(MCP · 백업을 맡는다)
 * - quit: 앱 전체를 끝낸다(마지막 앱 창이다)
 * - quit-via-main: 이 창이 마지막으로 보이는 창이고 숨긴 메인 창이 남아 있다 → 메인 창에게 끝내 달라고 한다
 * - close: 이 창만 닫는다(세션은 남는다)
 */
export type CloseAction = 'hide' | 'quit' | 'quit-via-main' | 'close'

export function closePlan(registry: ClientRegistry, selfId: string, isMain: boolean, quitting: boolean): CloseAction {
  const othersVisible = visibleClients(registry).some((client) => client.id !== selfId)
  if (isMain) return !quitting && othersVisible ? 'hide' : 'quit'
  if (!quitting && !othersVisible && registry.some((client) => client.hidden && client.id !== selfId)) return 'quit-via-main'
  return 'close'
}

/** new-client 가 열 창: 같은 세션이면 다음 화면(없으면 같은 화면), 다른 세션이면 그 세션이 보던 화면(null). 세션 이름을 못 찾으면 null */
export function newClientPlan(input: {
  readonly wanted: string | undefined
  readonly current: string
  readonly resolve: (name: string) => string | null
  readonly screenCount: number
  readonly activeIndex: number
  readonly registry: ClientRegistry
}): { readonly session: string; readonly screen: number | null; readonly letter: string } | null {
  const session = input.wanted === undefined ? input.current : input.resolve(input.wanted)
  if (session === null) return null
  const sameSession = session === input.current
  const next = input.activeIndex + 1 < input.screenCount ? input.activeIndex + 1 : Math.max(input.activeIndex, 0)
  return { session, screen: sameSession ? next : null, letter: nextClientLetter(input.registry) }
}
