// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { GRIP_DRAGGING_CLASS, trackGripDrag } from './gripDrag'

let stop: (() => void) | null = null
afterEach(() => { stop?.(); stop = null })

const handlers = () => ({ onStart: vi.fn(), onMove: vi.fn(), onDrop: vi.fn(), onCancel: vi.fn() })

describe('손잡이 끌기 뼈대', () => {
  it('문턱(6px)을 넘기 전에는 아무것도 부르지 않고, 눌렀다 떼도 놓기로 치지 않는다', () => {
    const h = handlers()
    stop = trackGripDrag({ x: 10, y: 10 }, h)
    fireEvent.pointerMove(window, { clientX: 13, clientY: 12 })
    expect(h.onStart).not.toHaveBeenCalled()
    expect(document.body.classList.contains(GRIP_DRAGGING_CLASS)).toBe(false)
    fireEvent.pointerUp(window, { clientX: 13, clientY: 12 })
    expect(h.onDrop).not.toHaveBeenCalled()
    expect(h.onMove).not.toHaveBeenCalled()
  })

  it('문턱을 넘기면 한 번 시작하고 움직임마다 따라가며, 놓으면 onDrop 하고 body 이름을 지운다', () => {
    const h = handlers()
    stop = trackGripDrag({ x: 0, y: 0 }, h)
    fireEvent.pointerMove(window, { clientX: 20, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: 40, clientY: 5 })
    expect(h.onStart).toHaveBeenCalledTimes(1)
    expect(h.onMove).toHaveBeenCalledTimes(2)
    expect(document.body.classList.contains(GRIP_DRAGGING_CLASS)).toBe(true)
    fireEvent.pointerUp(window, { clientX: 40, clientY: 5 })
    expect(h.onDrop).toHaveBeenCalledTimes(1)
    expect(h.onCancel).not.toHaveBeenCalled()
    expect(document.body.classList.contains(GRIP_DRAGGING_CLASS)).toBe(false)
    // 끝난 뒤의 움직임은 듣지 않는다
    fireEvent.pointerMove(window, { clientX: 99, clientY: 99 })
    expect(h.onMove).toHaveBeenCalledTimes(2)
  })

  it('끄는 중 Esc 나 pointercancel 은 취소다(놓기는 부르지 않는다)', () => {
    const escape = handlers()
    stop = trackGripDrag({ x: 0, y: 0 }, escape)
    fireEvent.pointerMove(window, { clientX: 30, clientY: 0 })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(escape.onCancel).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(window, { clientX: 30, clientY: 0 })
    expect(escape.onDrop).not.toHaveBeenCalled()
    expect(document.body.classList.contains(GRIP_DRAGGING_CLASS)).toBe(false)
    const cancelled = handlers()
    stop = trackGripDrag({ x: 0, y: 0 }, cancelled)
    fireEvent.pointerMove(window, { clientX: 30, clientY: 0 })
    fireEvent.pointerCancel(window)
    expect(cancelled.onCancel).toHaveBeenCalledTimes(1)
  })

  it('반환한 정리 함수는 듣기만 걷고 취소를 부르지 않는다', () => {
    const h = handlers()
    stop = trackGripDrag({ x: 0, y: 0 }, h)
    fireEvent.pointerMove(window, { clientX: 30, clientY: 0 })
    stop()
    expect(h.onCancel).not.toHaveBeenCalled()
    expect(document.body.classList.contains(GRIP_DRAGGING_CLASS)).toBe(false)
    fireEvent.pointerMove(window, { clientX: 60, clientY: 0 })
    expect(h.onMove).toHaveBeenCalledTimes(1)
  })
})
