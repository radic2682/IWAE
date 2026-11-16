import { describe, expect, it, vi } from 'vitest'
import { dividerPointerFraction, dividerStyle, startDividerDrag } from './splitDivider'

describe('dividerStyle', () => {
  it('세로 구분선은 왼쪽 자리와 위·길이를 %로 준다', () => {
    expect(dividerStyle({ axis: 'col', boundary: 1, start: 0, end: 2 }, [0.4, 0.6], [0.5, 0.5])).toEqual({ left: '40%', top: '0%', height: '100%' })
  })

  it('가로 구분선은 위쪽 자리와 왼쪽·너비를 %로 주고, 칸 일부만 가를 수 있다', () => {
    expect(dividerStyle({ axis: 'row', boundary: 1, start: 1, end: 2 }, [0.25, 0.75], [0.3, 0.7])).toEqual({ top: '30%', left: '25%', width: '75%' })
  })
})

describe('dividerPointerFraction', () => {
  const box = { left: 100, top: 50, width: 200, height: 400 }
  it('축에 맞는 쪽으로 묶음 안 자리를 잰다', () => {
    expect(dividerPointerFraction('col', { clientX: 150, clientY: 0 }, box)).toBe(0.25)
    expect(dividerPointerFraction('row', { clientX: 0, clientY: 250 }, box)).toBe(0.5)
  })
  it('크기를 알 수 없으면 null 이다', () => {
    expect(dividerPointerFraction('col', { clientX: 1, clientY: 1 }, { ...box, width: 0 })).toBeNull()
  })
})

describe('startDividerDrag', () => {
  function fakeHandle() {
    const target = new EventTarget() as EventTarget & { setPointerCapture: (id: number) => void }
    target.setPointerCapture = vi.fn()
    return target
  }
  const box = { left: 0, top: 0, width: 100, height: 100 }
  const move = (x: number, y: number) => Object.assign(new Event('pointermove'), { clientX: x, clientY: y })

  it('왼쪽 버튼이 아니면 시작하지 않는다', () => {
    const handle = fakeHandle()
    const preventDefault = vi.fn()
    startDividerDrag({ button: 2, pointerId: 1, currentTarget: handle as unknown as Element, preventDefault }, 'col', () => box, vi.fn())
    expect(preventDefault).not.toHaveBeenCalled()
    expect(handle.setPointerCapture).not.toHaveBeenCalled()
  })

  it('끄는 동안 새 자리를 주고, 놓으면 멈춘다', () => {
    const handle = fakeHandle()
    const apply = vi.fn()
    startDividerDrag({ button: 0, pointerId: 7, currentTarget: handle as unknown as Element, preventDefault: vi.fn() }, 'col', () => box, apply)
    expect(handle.setPointerCapture).toHaveBeenCalledWith(7)
    handle.dispatchEvent(move(30, 90))
    expect(apply).toHaveBeenLastCalledWith(0.3)
    handle.dispatchEvent(new Event('pointerup'))
    handle.dispatchEvent(move(60, 0))
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('붙들기가 풀리거나 취소되어도 멈추고, 묶음 크기를 모르면 건너뛴다', () => {
    const lost = fakeHandle()
    const applyLost = vi.fn()
    startDividerDrag({ button: 0, pointerId: 1, currentTarget: lost as unknown as Element, preventDefault: vi.fn() }, 'row', () => box, applyLost)
    lost.dispatchEvent(new Event('lostpointercapture'))
    lost.dispatchEvent(move(0, 50))
    expect(applyLost).not.toHaveBeenCalled()

    const blind = fakeHandle()
    const applyBlind = vi.fn()
    startDividerDrag({ button: 0, pointerId: 1, currentTarget: blind as unknown as Element, preventDefault: vi.fn() }, 'row', () => undefined, applyBlind)
    blind.dispatchEvent(move(0, 50))
    expect(applyBlind).not.toHaveBeenCalled()
    blind.dispatchEvent(new Event('pointercancel'))
  })
})
