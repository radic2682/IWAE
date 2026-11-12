import { leaves } from '../core/layoutTree'
import { findClient, ownerOf, removeClient, upsertClient, type ClientInfo, type ClientRegistry } from '../core/clients'
import type { SessionState } from '../core/session'
import type { Screen, ScreensState } from './screens'

/**
 * 세션에 붙은 앱 창들의 동기화(docs/design/workspace-tmux.md 7). 구조는 하나다.
 *
 * - 세션 상태의 **소유자는 한 창**이다(그 세션에 붙은 창 가운데 메인 창, 없으면 먼저 열린 창). 세션 파일은 소유자만 쓴다.
 * - 소유자가 아닌 창이 공유 상태를 바꾸면 바뀐 상태 전체를 소유자에게 보내고(intent), 소유자가 그것을 자기 상태에 반영한 뒤
 *   세션에 붙은 모든 창에 새 상태를 알린다(state). 소유자가 바꾼 것도 같은 알림으로 퍼진다. 마지막에 온 것이 이긴다.
 * - 공유하지 않는 것(창마다 따로): 보는 화면 · 칸 포커스 · 스크롤 · 배율 · 열린 메뉴 · 접두키/명령줄 상태 ·
 *   화면의 「크게」 · 떠 있는 칸 숨김. 이것들은 알림에 실려 오지 않고, 받는 창이 자기 값을 지킨다(mergeRemoteScreens).
 * - 소유자가 닫히면 목록에서 빠져 다음 창이 소유자가 된다. 모든 창이 같은 상태를 들고 있으므로 잃는 것이 없다.
 *
 * 이 파일은 Tauri 를 모른다 — 알림은 ClientTransport 로 받고 보낸다(시험에서는 메모리 버스).
 */

export interface ClientTransport {
  /** 모든 창에 알린다(보낸 창도 받는다) */
  emit(event: string, payload: unknown): void | Promise<void>
  listen(event: string, handler: (payload: unknown) => void): Promise<() => void> | (() => void)
}

export const CLIENT_EVENTS = {
  /** 나 여기 있다(창 정보) */
  presence: 'iwae:client-presence',
  /** 지금 있는 창들은 알려 달라 */
  who: 'iwae:client-who',
  /** 창이 닫힌다 */
  bye: 'iwae:client-bye',
  /** 창이 없어졌다(Rust 가 알린다) */
  gone: 'iwae:client-gone',
  /** 소유자 → 창들: 세션의 새 상태 */
  state: 'iwae:client-state',
  /** 창 → 소유자: 내가 바꾼 상태 */
  intent: 'iwae:client-intent',
  /** 창 → 소유자: 지금 상태를 보내 달라 */
  request: 'iwae:client-request',
  /** 가리키기 신호 */
  signal: 'iwae:client-signal',
  /** 다른 창에서 명령 돌리기(MCP 의 client 지정) */
  run: 'iwae:client-run',
  runResult: 'iwae:client-run-result',
  /** 메인 창에게: 앱을 끝내 달라 */
  quit: 'iwae:client-quit',
} as const

export interface RunResult {
  readonly ok: boolean
  readonly message: string
  readonly state?: unknown
}

export interface EngineHooks {
  /** 지금 공유 상태(세션 모양). 아직 준비가 안 됐으면 null */
  capture: () => SessionState | null
  /** 다른 창이 정한 공유 상태를 이 창에 반영한다. 반영이 화면 상태에 닿은 뒤에 끝난다 */
  apply: (state: SessionState) => Promise<void>
  /** 다른 창이 보낸 가리키기 신호 */
  deliverSignal: (signal: unknown) => void
  /** 이 창에서 명령 한 줄을 돌린다 */
  runCommand: (line: string) => Promise<RunResult>
  /** (메인 창) 앱을 끝낸다 */
  quit: () => void
}

export interface LocalClientState {
  readonly session: string
  readonly screen: number
  readonly hidden: boolean
  /** 세션을 다 읽어 상태가 믿을 만한가 */
  readonly ready: boolean
}

interface EngineOptions {
  readonly self: Pick<ClientInfo, 'id' | 'letter' | 'role' | 'joinedAt'>
  /** 없으면(브라우저 · 시험) 혼자다: 늘 소유자 */
  readonly transport: ClientTransport | null
  readonly hooks: EngineHooks
  /** 다른 창이 「나 여기 있다」 하고 답할 때까지 기다리는 시간(ms) */
  readonly settleMs?: number
  readonly runTimeoutMs?: number
}

// ── 공유 상태 ────────────────────────────────────────────────────────────────

/**
 * 공유 상태를 글자 하나로: 창마다 따로인 것(보는 화면 · 사이드바 · 크게 · 떠 있는 칸 숨김, 그리고 보는 화면에서 나온 옛 필드)을 뺀다.
 * 두 상태의 키가 같으면 다른 창에 알릴 것이 없다.
 */
export function sharedSessionKey(session: SessionState): string {
  const { screens, activeScreen: _active, lastScreen: _last, sidebarCollapsed: _collapsed, sidebarPx: _px, leftFrac: _frac, activePdfTabId: _pdf, activeNoteTabId: _note, layout: _layout, paneState: _paneState, ...rest } = session
  return JSON.stringify({
    ...rest,
    screens: screens?.map((screen) => {
      const { zoomed: _zoomed, floatsHidden: _floatsHidden, ...shared } = screen
      return shared
    }),
  })
}

/**
 * 다른 창이 정한 화면들을 이 창의 상태에 합친다: 화면 목록 · 트리 · 탭 · 색 · 떠 있는 칸은 받은 것을 쓰고,
 * 이 창의 보는 화면 · 바로 앞 화면 · 「크게」 · 떠 있는 칸 숨김은 지킨다. 보던 화면이 없어졌으면 그 자리의 이웃 화면으로 간다.
 */
export function mergeRemoteScreens(local: ScreensState, remote: ScreensState): ScreensState {
  const screens = remote.screens.map((screen): Screen => {
    const own = local.screens.find((candidate) => candidate.id === screen.id)
    if (own === undefined) return screen
    const zoomed = own.zoomed !== null && leaves(screen.layout).includes(own.zoomed) ? own.zoomed : null
    const { floatsHidden: _dropped, ...rest } = screen
    return { ...rest, zoomed, ...(own.floatsHidden === true ? { floatsHidden: true } : {}) }
  })
  const ids = new Set(screens.map((screen) => screen.id))
  const oldIndex = Math.max(local.screens.findIndex((screen) => screen.id === local.activeScreen), 0)
  const activeScreen = ids.has(local.activeScreen) ? local.activeScreen : screens[Math.min(oldIndex, screens.length - 1)]!.id
  const lastScreen = local.lastScreen !== null && local.lastScreen !== activeScreen && ids.has(local.lastScreen) ? local.lastScreen : null
  return { screens, activeScreen, lastScreen }
}

// ── 엔진 ────────────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/**
 * 한 창의 동기화 담당. React 와 Tauri 를 모른다 — useSessionClients 가 감싸고 시험은 메모리 버스를 건넨다.
 * 호출 흐름: start() → 렌더마다 update(local, snapshot) → 끝날 때 stop()/leave().
 */
export class ClientEngine {
  readonly self: EngineOptions['self']
  private readonly transport: ClientTransport | null
  private readonly hooks: EngineHooks
  private readonly settleMs: number
  private readonly runTimeoutMs: number
  private local: LocalClientState = { session: '', screen: 0, hidden: false, ready: false }
  private registry: ClientRegistry = []
  private known: boolean
  private version = 0
  private readonly listeners = new Set<() => void>()
  private stops: (() => void)[] = []
  private lastKey: string | null = null
  private pendingRequest = false
  private applying = false
  private queued: { readonly state: SessionState; readonly fromIntent: boolean } | null = null
  private pumping = false
  private runSeq = 0
  private readonly pendingRuns = new Map<string, (result: RunResult) => void>()
  private stopped = false
  /** start() · stop() 마다 오른다. 개발 모드(StrictMode)처럼 시작-끝-시작이 겹쳐도 옛 시작이 건 구독이 남지 않게 한다 */
  private generation = 0

  constructor(options: EngineOptions) {
    this.self = options.self
    this.transport = options.transport
    this.hooks = options.hooks
    this.settleMs = options.settleMs ?? 250
    this.runTimeoutMs = options.runTimeoutMs ?? 8000
    // 혼자(브라우저 · 시험)면 기다릴 상대가 없다
    this.known = options.transport === null
    this.registry = [this.selfInfo()]
  }

  // ── 읽기 ──
  getRegistry(): ClientRegistry { return this.registry }
  getVersion(): number { return this.version }
  /** 다른 창이 있는지 알아볼 시간이 지났는가 */
  isOwnerKnown(): boolean { return this.known }
  isOwner(): boolean {
    return this.known && this.local.session !== '' && ownerOf(this.registry, this.local.session)?.id === this.self.id
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(): void {
    this.version += 1
    for (const listener of [...this.listeners]) listener()
  }

  private selfInfo(): ClientInfo {
    return { ...this.self, session: this.local.session, screen: this.local.screen, hidden: this.local.hidden }
  }

  private send(event: string, payload: unknown): void {
    if (this.transport === null) return
    try {
      void Promise.resolve(this.transport.emit(event, payload)).catch(() => undefined)
    } catch {
      // 알림을 못 보내도 이 창은 계속 쓴다
    }
  }

  private announce(): void {
    this.send(CLIENT_EVENTS.presence, this.selfInfo())
  }

  // ── 시작 · 끝 ──
  async start(): Promise<void> {
    const transport = this.transport
    if (transport === null) return
    this.stopped = false
    const generation = ++this.generation
    const stale = () => this.stopped || generation !== this.generation
    const on = async (event: string, handler: (payload: unknown) => void) => {
      const stop = await transport.listen(event, handler)
      if (stale()) stop()
      else this.stops.push(stop)
    }
    await Promise.all([
      on(CLIENT_EVENTS.presence, (payload) => this.onPresence(payload)),
      on(CLIENT_EVENTS.who, (payload) => { if (isRecord(payload) && payload.from !== this.self.id) this.announce() }),
      on(CLIENT_EVENTS.bye, (payload) => { if (isRecord(payload) && typeof payload.id === 'string') this.dropClient(payload.id) }),
      on(CLIENT_EVENTS.gone, (payload) => {
        const id = typeof payload === 'string' ? payload : isRecord(payload) && typeof payload.label === 'string' ? payload.label : null
        if (id !== null) this.dropClient(id)
      }),
      on(CLIENT_EVENTS.state, (payload) => this.onState(payload)),
      on(CLIENT_EVENTS.intent, (payload) => this.onIntent(payload)),
      on(CLIENT_EVENTS.request, (payload) => this.onRequest(payload)),
      on(CLIENT_EVENTS.signal, (payload) => this.onSignal(payload)),
      on(CLIENT_EVENTS.run, (payload) => this.onRun(payload)),
      on(CLIENT_EVENTS.runResult, (payload) => this.onRunResult(payload)),
      on(CLIENT_EVENTS.quit, () => { if (this.self.role === 'main') this.hooks.quit() }),
    ])
    if (stale()) return
    this.send(CLIENT_EVENTS.who, { from: this.self.id })
    this.announce()
    if (this.settleMs > 0) await new Promise<void>((resolve) => { setTimeout(resolve, this.settleMs) })
    if (stale()) return
    this.known = true
    this.notify()
    this.maybeRequest()
  }

  /** 닫히기 전에: 다른 창에 알린다 */
  leave(): void {
    this.send(CLIENT_EVENTS.bye, { id: this.self.id })
  }

  stop(): void {
    this.stopped = true
    this.generation += 1
    for (const stop of this.stops) stop()
    this.stops = []
  }

  // ── 이 창의 상태가 바뀌었다 ──
  /** 렌더마다 부른다: 붙은 세션 · 보는 화면 · 공유 상태를 알려 준다. 바뀐 것만 퍼진다 */
  update(next: LocalClientState, snapshot: SessionState | null): void {
    const sessionChanged = next.session !== this.local.session
    const changed = sessionChanged || next.screen !== this.local.screen || next.hidden !== this.local.hidden
    this.local = next
    if (changed) {
      this.registry = upsertClient(this.registry, this.selfInfo())
      this.announce()
      this.notify()
    }
    if (sessionChanged) {
      // 다른 세션에 들어갔다: 그 세션의 소유자가 있으면 그 상태를 받는다
      this.lastKey = null
      this.pendingRequest = true
    }
    if (!next.ready || snapshot === null) return
    const key = sharedSessionKey(snapshot)
    if (this.applying) {
      // 다른 창의 상태를 반영하는 중에 생긴 변화는 우리가 만든 것이 아니다: 다시 퍼뜨리지 않는다
      this.lastKey = key
    } else if (this.lastKey === null) {
      this.lastKey = key
    } else if (key !== this.lastKey) {
      this.lastKey = key
      this.publish(snapshot)
    }
    this.maybeRequest()
  }

  private publish(snapshot: SessionState): void {
    const session = this.local.session
    if (this.isOwner()) {
      this.send(CLIENT_EVENTS.state, { session, from: this.self.id, to: null, state: snapshot })
    } else if (ownerOf(this.registry, session) !== null) {
      this.send(CLIENT_EVENTS.intent, { session, from: this.self.id, state: snapshot })
    }
  }

  private maybeRequest(): void {
    if (!this.pendingRequest || !this.local.ready || !this.known) return
    const owner = ownerOf(this.registry, this.local.session)
    this.pendingRequest = false
    if (owner === null || owner.id === this.self.id) return
    this.send(CLIENT_EVENTS.request, { session: this.local.session, from: this.self.id })
  }

  // ── 받기 ──
  private onPresence(payload: unknown): void {
    if (!isRecord(payload) || typeof payload.id !== 'string' || payload.id === this.self.id) return
    if (typeof payload.session !== 'string' || typeof payload.letter !== 'string' || typeof payload.joinedAt !== 'number') return
    const info: ClientInfo = {
      id: payload.id,
      letter: payload.letter,
      role: payload.role === 'main' ? 'main' : 'extra',
      session: payload.session,
      screen: typeof payload.screen === 'number' ? payload.screen : 0,
      hidden: payload.hidden === true,
      joinedAt: payload.joinedAt,
    }
    const ownerBefore = ownerOf(this.registry, this.local.session)?.id
    this.registry = upsertClient(this.registry, info)
    // 아직 모든 창을 모를 때 스스로를 소유자로 여겼는데 앞선 창이 나타났다: 그 창의 상태를 받는다
    if (this.local.session !== '' && ownerBefore === this.self.id && ownerOf(this.registry, this.local.session)?.id !== this.self.id) this.pendingRequest = true
    this.notify()
    this.maybeRequest()
  }

  private dropClient(id: string): void {
    if (id === this.self.id) return
    const next = removeClient(this.registry, id)
    if (next === this.registry) return
    this.registry = next
    this.notify()
  }

  private onState(payload: unknown): void {
    if (!isRecord(payload) || payload.session !== this.local.session || payload.from === this.self.id || !isRecord(payload.state)) return
    if (payload.to !== null && payload.to !== undefined && payload.to !== this.self.id) return
    const owner = ownerOf(this.registry, this.local.session)
    // 소유자가 보낸 것(또는 내 요청에 대한 답)만 받는다
    if (payload.to !== this.self.id && owner?.id !== payload.from) return
    if (this.isOwner() && payload.to !== this.self.id) return
    const state = payload.state as unknown as SessionState
    // 이미 같은 상태면(내가 보낸 intent 가 돌아온 것) 할 일이 없다
    if (this.lastKey !== null && sharedSessionKey(state) === this.lastKey) return
    this.enqueue(state, false)
  }

  private onIntent(payload: unknown): void {
    if (!isRecord(payload) || payload.session !== this.local.session || payload.from === this.self.id || !isRecord(payload.state)) return
    if (!this.isOwner()) return
    this.enqueue(payload.state as unknown as SessionState, true)
  }

  private onRequest(payload: unknown): void {
    if (!isRecord(payload) || payload.session !== this.local.session || payload.from === this.self.id || typeof payload.from !== 'string') return
    if (!this.isOwner()) return
    const snapshot = this.hooks.capture()
    if (snapshot !== null) this.send(CLIENT_EVENTS.state, { session: this.local.session, from: this.self.id, to: payload.from, state: snapshot })
  }

  private onSignal(payload: unknown): void {
    if (!isRecord(payload) || payload.session !== this.local.session || payload.from === this.self.id) return
    this.hooks.deliverSignal(payload.signal)
  }

  // ── 다른 창의 상태를 반영(차례로, 가장 새것만) ──
  private enqueue(state: SessionState, fromIntent: boolean): void {
    this.queued = { state, fromIntent }
    if (!this.pumping) void this.pump()
  }

  private async pump(): Promise<void> {
    this.pumping = true
    try {
      while (this.queued !== null) {
        const { state, fromIntent } = this.queued
        this.queued = null
        this.applying = true
        this.lastKey = sharedSessionKey(state)
        try {
          await this.hooks.apply(state)
        } catch {
          // 반영하지 못한 상태는 건너뛴다(다음 알림이 다시 맞춘다)
        } finally {
          this.applying = false
        }
        if (fromIntent && this.isOwner()) {
          // 소유자: 반영한 결과를 모든 창(보낸 창 포함)에 알린다
          const snapshot = this.hooks.capture()
          if (snapshot !== null) {
            this.lastKey = sharedSessionKey(snapshot)
            this.send(CLIENT_EVENTS.state, { session: this.local.session, from: this.self.id, to: null, state: snapshot })
          }
        }
      }
    } finally {
      this.pumping = false
    }
  }

  // ── 가리키기 신호 · 명령 · 끝내기 ──
  broadcastSignal(signal: unknown): void {
    if (this.local.session === '') return
    this.send(CLIENT_EVENTS.signal, { session: this.local.session, from: this.self.id, signal })
  }

  /** ref(「B」 · 창 label)의 앱 창에서 명령 한 줄을 돌린다. 이 창이면 바로 */
  runOn(ref: string, line: string): Promise<RunResult> {
    const target = findClient(this.registry, ref)
    if (target === null) return Promise.reject(new Error(`unknown client: ${ref}`))
    if (target.id === this.self.id) return this.hooks.runCommand(line)
    const id = `${this.self.id}#${++this.runSeq}`
    return new Promise<RunResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRuns.delete(id)
        reject(new Error(`client ${target.letter} did not answer`))
      }, this.runTimeoutMs)
      this.pendingRuns.set(id, (result) => { clearTimeout(timer); resolve(result) })
      this.send(CLIENT_EVENTS.run, { to: target.id, id, from: this.self.id, line })
    })
  }

  private onRun(payload: unknown): void {
    if (!isRecord(payload) || payload.to !== this.self.id || typeof payload.line !== 'string' || typeof payload.id !== 'string') return
    const { id, from } = payload
    void this.hooks.runCommand(payload.line)
      .catch((cause: unknown): RunResult => ({ ok: false, message: cause instanceof Error ? cause.message : String(cause) }))
      .then((result) => { this.send(CLIENT_EVENTS.runResult, { to: from, id, result }) })
  }

  private onRunResult(payload: unknown): void {
    if (!isRecord(payload) || payload.to !== this.self.id || typeof payload.id !== 'string') return
    const done = this.pendingRuns.get(payload.id)
    if (done === undefined) return
    this.pendingRuns.delete(payload.id)
    done(payload.result as RunResult)
  }

  /** 앱을 끝내 달라: 메인 창이면 바로, 아니면 메인 창에게 부탁한다 */
  requestQuit(): void {
    if (this.self.role === 'main') this.hooks.quit()
    else this.send(CLIENT_EVENTS.quit, { from: this.self.id })
  }
}
