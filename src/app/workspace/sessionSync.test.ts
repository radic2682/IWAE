import { afterEach, describe, expect, it, vi } from 'vitest'
import { ownerOf } from '../../core/clients'
import { paneNode } from '../../core/layoutTree'
import type { SessionState } from '../../core/session'
import { emptySession } from '../../core/session'
import { ClientEngine, CLIENT_EVENTS, mergeRemoteScreens, sharedSessionKey, type ClientTransport, type RunResult } from './sessionSync'
import type { Screen, ScreensState } from './screens'

/** 창 여러 개를 한 프로세스에서 시험하려고: 한 창이 보낸 알림이 (자기 포함) 모든 창에 비동기로 간다 */
class MemoryBus {
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>()
  readonly sent: { event: string; payload: unknown }[] = []
  transport(): ClientTransport {
    return {
      emit: (event, payload) => {
        this.sent.push({ event, payload })
        const copy = JSON.parse(JSON.stringify(payload)) as unknown
        setTimeout(() => { for (const handler of [...(this.handlers.get(event) ?? [])]) handler(copy) }, 0)
      },
      listen: (event, handler) => {
        const set = this.handlers.get(event) ?? new Set()
        set.add(handler)
        this.handlers.set(event, set)
        return () => { set.delete(handler) }
      },
    }
  }
  count(event: string): number { return this.sent.filter((item) => item.event === event).length }
}

const settle = async () => { for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setTimeout(resolve, 5)) }

function sessionOf(names: readonly string[], active: string, extra: Partial<SessionState> = {}): SessionState {
  return {
    ...emptySession,
    screens: names.map((name, index) => ({ id: `w${index + 1}`, name, layout: paneNode('p1'), paneState: { p1: { tabIds: [], activeId: null, channel: 'blue' as const } } })),
    activeScreen: active,
    lastScreen: null,
    ...extra,
  }
}

interface FakeWindow {
  readonly engine: ClientEngine
  names: string[]
  active: string
  session: string
  readonly applied: SessionState[]
  readonly signals: unknown[]
  readonly commands: string[]
  quit: ReturnType<typeof vi.fn<() => void>>
  /** React 의 렌더 뒤 효과처럼 엔진에 지금 상태를 알린다 */
  tick: () => void
}

function windowOf(bus: MemoryBus, id: string, letter: string, joinedAt: number, session = 'S', names = ['읽기']): FakeWindow {
  const win = { names, active: 'w1', session, applied: [] as SessionState[], signals: [] as unknown[], commands: [] as string[], quit: vi.fn() } as unknown as FakeWindow
  const engine = new ClientEngine({
    self: { id, letter, role: id === 'main' ? 'main' : 'extra', joinedAt },
    transport: bus.transport(),
    settleMs: 30,
    runTimeoutMs: 200,
    hooks: {
      capture: () => sessionOf(win.names, win.active),
      apply: async (state) => {
        win.applied.push(state)
        win.names = (state.screens ?? []).map((screen) => screen.name)
        // 보는 화면은 이 창 것을 지킨다
        win.tick()
      },
      deliverSignal: (signal) => { win.signals.push(signal) },
      runCommand: async (line): Promise<RunResult> => { win.commands.push(line); return { ok: true, message: `ran ${line}` } },
      quit: () => win.quit(),
    },
  })
  Object.assign(win, { engine, tick: () => engine.update({ session: win.session, screen: 0, hidden: false, ready: true }, sessionOf(win.names, win.active)) })
  return win
}

async function startAll(...windows: FakeWindow[]) {
  for (const win of windows) { await win.engine.start(); win.tick() }
  await settle()
}

afterEach(() => { vi.restoreAllMocks() })

describe('앱 창 목록', () => {
  it('창들이 서로 알아보고, 소유자는 메인 창이다', async () => {
    const bus = new MemoryBus()
    const main = windowOf(bus, 'main', 'A', 1)
    const second = windowOf(bus, 'window-2', 'B', 2)
    await startAll(main, second)
    for (const win of [main, second]) {
      expect(win.engine.getRegistry().map((client) => client.letter)).toEqual(['A', 'B'])
      expect(ownerOf(win.engine.getRegistry(), 'S')?.id).toBe('main')
    }
    expect(main.engine.isOwner()).toBe(true)
    expect(second.engine.isOwner()).toBe(false)
  })

  it('창이 닫히면(bye) 목록에서 빠지고, Rust 의 gone 알림도 같다', async () => {
    const bus = new MemoryBus()
    const main = windowOf(bus, 'main', 'A', 1)
    const second = windowOf(bus, 'window-2', 'B', 2)
    const third = windowOf(bus, 'window-3', 'C', 3)
    await startAll(main, second, third)
    second.engine.leave()
    await bus.transport().emit(CLIENT_EVENTS.gone, 'window-3')
    await settle()
    expect(main.engine.getRegistry().map((client) => client.id)).toEqual(['main'])
  })

  it('다른 세션에 붙은 창은 따로 소유자를 가진다', async () => {
    const bus = new MemoryBus()
    const main = windowOf(bus, 'main', 'A', 1, 'S')
    const other = windowOf(bus, 'window-2', 'B', 2, 'T')
    await startAll(main, other)
    expect(main.engine.isOwner()).toBe(true)
    expect(other.engine.isOwner()).toBe(true)
  })

  it('혼자(알림 길 없음)면 바로 소유자다', () => {
    const solo = new ClientEngine({ self: { id: 'main', letter: 'A', role: 'main', joinedAt: 1 }, transport: null, hooks: { capture: () => null, apply: async () => undefined, deliverSignal: () => undefined, runCommand: async () => ({ ok: true, message: '' }), quit: () => undefined } })
    solo.update({ session: 'S', screen: 0, hidden: false, ready: true }, null)
    expect(solo.isOwner()).toBe(true)
  })
})

describe('상태 동기화', () => {
  it('소유자가 아닌 창이 바꾼 상태는 소유자가 반영하고 모든 창에 퍼진다', async () => {
    const bus = new MemoryBus()
    const main = windowOf(bus, 'main', 'A', 1)
    const second = windowOf(bus, 'window-2', 'B', 2)
    const third = windowOf(bus, 'window-3', 'C', 3)
    await startAll(main, second, third)
    const intents = () => bus.count(CLIENT_EVENTS.intent)
    second.names = ['읽기', '비교']
    second.tick()
    await settle()
    expect(intents()).toBe(1)
    expect(main.names).toEqual(['읽기', '비교'])
    expect(third.names).toEqual(['읽기', '비교'])
    // 보낸 창에는 같은 상태가 돌아오지만 다시 반영하지 않는다
    expect(second.applied).toHaveLength(0)
    // 반영한 쪽이 다시 퍼뜨리지 않는다(끝없이 오가지 않는다)
    const before = bus.sent.length
    await settle()
    expect(bus.sent.length).toBe(before)
  })

  it('소유자가 바꾼 상태는 다른 창에 퍼진다', async () => {
    const bus = new MemoryBus()
    const main = windowOf(bus, 'main', 'A', 1)
    const second = windowOf(bus, 'window-2', 'B', 2)
    await startAll(main, second)
    main.names = ['읽기', '정리']
    main.tick()
    await settle()
    expect(second.names).toEqual(['읽기', '정리'])
    expect(bus.count(CLIENT_EVENTS.intent)).toBe(0)
  })

  it('창마다 따로인 것(보는 화면)은 알리지 않는다', async () => {
    const bus = new MemoryBus()
    const main = windowOf(bus, 'main', 'A', 1, 'S', ['읽기', '비교'])
    const second = windowOf(bus, 'window-2', 'B', 2, 'S', ['읽기', '비교'])
    await startAll(main, second)
    const before = bus.sent.filter((item) => item.event === CLIENT_EVENTS.state || item.event === CLIENT_EVENTS.intent).length
    second.active = 'w2'
    second.tick()
    await settle()
    expect(bus.sent.filter((item) => item.event === CLIENT_EVENTS.state || item.event === CLIENT_EVENTS.intent).length).toBe(before)
    expect(main.active).toBe('w1')
    expect(second.active).toBe('w2')
  })

  it('나중에 붙은 창은 소유자에게 지금 상태를 받는다', async () => {
    const bus = new MemoryBus()
    const main = windowOf(bus, 'main', 'A', 1, 'S', ['읽기', '비교', '정리'])
    await startAll(main)
    const late = windowOf(bus, 'window-2', 'B', 2, 'S', ['읽기'])
    await startAll(late)
    expect(late.names).toEqual(['읽기', '비교', '정리'])
  })

  it('다른 세션으로 옮겨 가면 그 세션의 소유자에게 상태를 받는다', async () => {
    const bus = new MemoryBus()
    const main = windowOf(bus, 'main', 'A', 1, 'S', ['읽기'])
    const other = windowOf(bus, 'window-2', 'B', 2, 'T', ['정리'])
    await startAll(main, other)
    other.session = 'S'
    other.tick()
    await settle()
    expect(other.names).toEqual(['읽기'])
    expect(other.engine.isOwner()).toBe(false)
    // 떠난 세션 T 에는 아무도 없다
    expect(ownerOf(main.engine.getRegistry(), 'T')).toBeNull()
  })

  it('다른 세션의 창끼리는 서로의 상태를 받지 않는다', async () => {
    const bus = new MemoryBus()
    const main = windowOf(bus, 'main', 'A', 1, 'S')
    const other = windowOf(bus, 'window-2', 'B', 2, 'T')
    await startAll(main, other)
    main.names = ['읽기', '새 화면']
    main.tick()
    await settle()
    expect(other.names).toEqual(['읽기'])
  })
})

describe('소유권 이전', () => {
  it('소유자가 닫히면 다음 창이 소유자가 되고, 그 창의 변화가 다른 창에 퍼진다', async () => {
    const bus = new MemoryBus()
    const main = windowOf(bus, 'main', 'A', 1)
    const second = windowOf(bus, 'window-2', 'B', 2)
    const third = windowOf(bus, 'window-3', 'C', 3)
    await startAll(main, second, third)
    main.engine.leave()
    main.engine.stop()
    await settle()
    expect(second.engine.isOwner()).toBe(true)
    expect(third.engine.isOwner()).toBe(false)
    second.names = ['읽기', '이어서']
    second.tick()
    await settle()
    expect(third.names).toEqual(['읽기', '이어서'])
  })

  it('소유자가 세션을 바꾸면 남은 창이 소유자가 된다', async () => {
    const bus = new MemoryBus()
    const main = windowOf(bus, 'main', 'A', 1, 'S')
    const second = windowOf(bus, 'window-2', 'B', 2, 'S')
    await startAll(main, second)
    main.session = 'T'
    main.tick()
    await settle()
    expect(second.engine.isOwner()).toBe(true)
    expect(main.engine.isOwner()).toBe(true)
  })
})

describe('가리키기 신호 · 명령 · 끝내기', () => {
  it('신호는 같은 세션의 다른 창에만 간다', async () => {
    const bus = new MemoryBus()
    const main = windowOf(bus, 'main', 'A', 1, 'S')
    const second = windowOf(bus, 'window-2', 'B', 2, 'S')
    const other = windowOf(bus, 'window-3', 'C', 3, 'T')
    await startAll(main, second, other)
    main.engine.broadcastSignal({ from: 'p1', channel: 'blue', target: { kind: 'memo', memoId: 'm1' }, reason: 'click' })
    await settle()
    expect(second.signals).toHaveLength(1)
    expect(main.signals).toHaveLength(0)
    expect(other.signals).toHaveLength(0)
  })

  it('runOn: 다른 앱 창에서 명령을 돌리고 결과를 받는다. 이 창이면 바로 돌린다', async () => {
    const bus = new MemoryBus()
    const main = windowOf(bus, 'main', 'A', 1)
    const second = windowOf(bus, 'window-2', 'B', 2)
    await startAll(main, second)
    await expect(main.engine.runOn('B', 'next-window')).resolves.toEqual({ ok: true, message: 'ran next-window' })
    expect(second.commands).toEqual(['next-window'])
    await expect(main.engine.runOn('a', 'x')).resolves.toMatchObject({ ok: true })
    expect(main.commands).toEqual(['x'])
    await expect(main.engine.runOn('Z', 'x')).rejects.toThrow(/unknown client/u)
  })

  it('runOn: 답이 없으면 시간이 지나 실패한다', async () => {
    const bus = new MemoryBus()
    const main = windowOf(bus, 'main', 'A', 1)
    const second = windowOf(bus, 'window-2', 'B', 2)
    await startAll(main, second)
    second.engine.stop()
    await expect(main.engine.runOn('B', 'x')).rejects.toThrow(/did not answer/u)
  })

  it('requestQuit: 메인 창이면 바로 끝내고, 아니면 메인 창에 부탁한다', async () => {
    const bus = new MemoryBus()
    const main = windowOf(bus, 'main', 'A', 1)
    const second = windowOf(bus, 'window-2', 'B', 2)
    await startAll(main, second)
    second.engine.requestQuit()
    await settle()
    expect(main.quit).toHaveBeenCalledTimes(1)
    main.engine.requestQuit()
    expect(main.quit).toHaveBeenCalledTimes(2)
    expect(second.quit).not.toHaveBeenCalled()
  })
})

describe('공유 상태 키와 합치기', () => {
  it('키는 창마다 따로인 값(보는 화면 · 사이드바 · 크게)을 보지 않는다', () => {
    const base = sessionOf(['읽기', '비교'], 'w1')
    const local = {
      ...sessionOf(['읽기', '비교'], 'w2'),
      sidebarPx: 400,
      lastScreen: 'w1',
      screens: sessionOf(['읽기', '비교'], 'w2').screens!.map((screen) => ({ ...screen, zoomed: 'p1', floatsHidden: true })),
    }
    expect(sharedSessionKey(local)).toBe(sharedSessionKey(base))
    expect(sharedSessionKey(sessionOf(['읽기', '다른'], 'w1'))).not.toBe(sharedSessionKey(base))
  })

  const screen = (id: string, name: string, extra: Partial<Screen> = {}): Screen => ({ id, name, layout: paneNode('p1'), panes: {}, channels: {}, zoomed: null, floats: [], ...extra })

  it('받은 화면 목록을 쓰되 보는 화면 · 크게 · 떠 있는 칸 숨김은 이 창 것을 지킨다', () => {
    const local: ScreensState = { screens: [screen('w1', '읽기'), screen('w2', '비교', { zoomed: 'p1', floatsHidden: true })], activeScreen: 'w2', lastScreen: 'w1' }
    const remote: ScreensState = { screens: [screen('w1', '읽기 2'), screen('w2', '비교 2'), screen('w3', '정리')], activeScreen: 'w1', lastScreen: null }
    const merged = mergeRemoteScreens(local, remote)
    expect(merged.screens.map((item) => item.name)).toEqual(['읽기 2', '비교 2', '정리'])
    expect(merged.activeScreen).toBe('w2')
    expect(merged.lastScreen).toBe('w1')
    expect(merged.screens[1]).toMatchObject({ zoomed: 'p1', floatsHidden: true })
  })

  it('보던 화면이 없어지면 그 자리의 이웃 화면으로 간다', () => {
    const local: ScreensState = { screens: [screen('w1', 'a'), screen('w2', 'b'), screen('w3', 'c')], activeScreen: 'w3', lastScreen: 'w2' }
    const remote: ScreensState = { screens: [screen('w1', 'a'), screen('w2', 'b')], activeScreen: 'w1', lastScreen: null }
    const merged = mergeRemoteScreens(local, remote)
    expect(merged.activeScreen).toBe('w2')
    expect(merged.lastScreen).toBeNull()
  })
})

describe('시작 · 끝 반복(개발 모드)', () => {
  it('start-stop-start 가 겹쳐도 구독이 하나만 남는다(상태를 두 번 반영하지 않는다)', async () => {
    const bus = new MemoryBus()
    const main = windowOf(bus, 'main', 'A', 1)
    const second = windowOf(bus, 'window-2', 'B', 2)
    await startAll(main)
    // 첫 시작이 끝나기 전에 stop 하고 다시 시작한다
    const first = second.engine.start()
    second.engine.stop()
    await first
    await startAll(second)
    main.names = ['읽기', '새 화면']
    main.tick()
    await settle()
    expect(second.applied).toHaveLength(1)
    expect(second.names).toEqual(['읽기', '새 화면'])
  })
})
