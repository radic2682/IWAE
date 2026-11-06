import { afterEach, describe, expect, it, vi } from 'vitest'
import { scheduleNodeInternalsUpdate, visibleCanvasPorts } from './canvasPorts'

afterEach(() => vi.unstubAllGlobals())

describe('visibleCanvasPorts', () => {
  it('맞닿은 내부 면만 숨긴다', () => {
    expect(visibleCanvasPorts({ id: 'a' }, new Set(['right']), true)).toEqual(['top', 'bottom', 'left'])
  })

  it('선택되지 않아도 저장된 연결선 계산을 위해 포트 DOM을 유지한다', () => {
    expect(visibleCanvasPorts({ id: 'a' }, new Set(), false)).toEqual(['top', 'right', 'bottom', 'left'])
  })
})

describe('scheduleNodeInternalsUpdate', () => {
  it('같은 프레임의 노드 갱신을 중복 없이 한 번으로 묶는다', () => {
    let frame: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frame = callback
      return 1
    })
    const update = vi.fn()

    scheduleNodeInternalsUpdate(['a', 'b'], update)
    scheduleNodeInternalsUpdate(['b', 'c'], update)

    expect(update).not.toHaveBeenCalled()
    frame?.(0)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith(['a', 'b', 'c'])
  })
})
