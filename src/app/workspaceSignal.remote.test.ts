import { afterEach, describe, expect, it, vi } from 'vitest'
import { deliverRemotePointSignal, emitPointSignal, paneReceives, REMOTE_PANE_ID, resetPointSignals, setPointSignalRelay, subscribePointSignal, type DeliveredSignal, type PointSignal } from './workspaceSignal'

afterEach(() => { resetPointSignals() })

const click: PointSignal = { from: 'p1', channel: 'blue', target: { kind: 'memo', memoId: 'm1' }, reason: 'click', origin: 'document' }

describe('앱 창을 넘는 가리키기 신호', () => {
  it('채널이 있는 신호는 이 창에서 처리한 뒤 다른 앱 창으로도 보낸다', () => {
    const relay = vi.fn()
    setPointSignalRelay(relay)
    const seen: DeliveredSignal[] = []
    subscribePointSignal((signal) => seen.push(signal))
    emitPointSignal(click)
    expect(seen).toHaveLength(1)
    expect(relay).toHaveBeenCalledWith(click)
  })

  it('채널이 없는 신호는 이 창만 처리한다', () => {
    const relay = vi.fn()
    setPointSignalRelay(relay)
    emitPointSignal({ ...click, channel: null })
    expect(relay).not.toHaveBeenCalled()
  })

  it('다른 앱 창에서 온 신호는 이 창의 같은 채널 칸이 받고, 다시 보내지 않으며, 보낸 칸은 이 창에 없다', () => {
    const relay = vi.fn()
    setPointSignalRelay(relay)
    const seen: DeliveredSignal[] = []
    subscribePointSignal((signal) => seen.push(signal))
    const delivered = deliverRemotePointSignal(click)
    expect(relay).not.toHaveBeenCalled()
    expect(seen).toHaveLength(1)
    expect(delivered.remote).toBe(true)
    expect(delivered.from).toBe(REMOTE_PANE_ID)
    // 이 창에 p1 이라는 칸이 있어도 보낸 칸이 아니다: 같은 채널이면 받는다
    expect(paneReceives(delivered, 'p1', 'blue')).toBe(true)
    expect(paneReceives(delivered, 'p2', 'green')).toBe(false)
  })
})
