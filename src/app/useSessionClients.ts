import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { tauriClientTransport } from '../bridge/clients'
import { currentWindowLabel } from '../bridge/window'
import { MAIN_CLIENT_LETTER, type ClientRegistry } from '../core/clients'
import type { SessionState } from '../core/session'
import { isAppClient, type WindowMode } from '../core/windowMode'
import { ClientEngine, type ClientTransport, type EngineHooks, type RunResult } from './sessionSync'
import { deliverRemotePointSignal, setPointSignalRelay, type PointSignal } from './workspaceSignal'

export interface SessionClientsOptions {
  readonly windowMode: WindowMode
  /** 세션을 다 읽었는가 */
  readonly ready: boolean
  readonly session: string
  /** 보는 화면 번호(0부터) */
  readonly screen: number
  readonly hidden?: boolean
  /** 지금 공유 상태(세션 모양). 준비가 안 됐으면 null */
  readonly snapshot: SessionState | null
  readonly apply: (state: SessionState) => Promise<void>
  readonly runCommand: (line: string) => Promise<RunResult>
  readonly quit: () => void
  /** 시험: 알림 길을 바꿔 끼운다 */
  readonly transport?: ClientTransport | null
}

export interface SessionClients {
  readonly engine: ClientEngine
  readonly registry: ClientRegistry
  readonly selfId: string
  readonly selfLetter: string
  /** 이 창이 지금 세션의 소유자(세션 파일을 쓰는 창)인가 */
  readonly isOwner: boolean
  /** 같은 세션에 붙은 앱 창 수(이 창 포함) */
  readonly attached: number
}

/**
 * 앱 창 한 개의 동기화 엔진(sessionSync.ts)을 React 에 잇는다. 떼어 낸 PDF 창에서는 아무것도 하지 않는다(엔진은 만들되 알리지 않는다).
 * 엔진은 창이 사는 동안 하나다.
 */
export function useSessionClients(options: SessionClientsOptions): SessionClients {
  const { windowMode, ready, session, screen, hidden = false, snapshot } = options
  const app = isAppClient(windowMode)
  const latest = useRef(options)
  latest.current = options
  const engine = useMemo(() => {
    const hooks: EngineHooks = {
      capture: () => latest.current.snapshot,
      apply: (state) => latest.current.apply(state),
      deliverSignal: (signal) => deliverRemotePointSignal(signal as PointSignal),
      runCommand: (line) => latest.current.runCommand(line),
      quit: () => latest.current.quit(),
    }
    return new ClientEngine({
      self: {
        id: currentWindowLabel(),
        letter: windowMode.role === 'main' ? MAIN_CLIENT_LETTER : windowMode.client ?? 'B',
        role: windowMode.role === 'main' ? 'main' : 'extra',
        joinedAt: Date.now(),
      },
      transport: app ? (options.transport === undefined ? tauriClientTransport() : options.transport) : null,
      hooks,
      // 시험은 기다리지 않는다
      settleMs: options.transport === undefined ? undefined : 0,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 창이 사는 동안 하나
  }, [])
  useEffect(() => {
    if (!app) return undefined
    void engine.start()
    setPointSignalRelay((signal) => engine.broadcastSignal(signal))
    return () => {
      setPointSignalRelay(null)
      engine.stop()
    }
  }, [app, engine])
  useEffect(() => {
    if (!app) return
    engine.update({ session, screen, hidden, ready }, snapshot)
  }, [app, engine, session, screen, hidden, ready, snapshot])
  useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.getVersion(),
  )
  const registry = engine.getRegistry()
  // 떼어 낸 PDF 창은 세션에 붙지 않는다
  const isOwner = app ? engine.isOwner() : false
  return {
    engine,
    registry,
    selfId: engine.self.id,
    selfLetter: engine.self.letter,
    isOwner,
    attached: app ? registry.filter((client) => client.session === session).length : 1,
  }
}

