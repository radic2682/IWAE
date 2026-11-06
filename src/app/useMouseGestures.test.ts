// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { GESTURES, strokeOf, useMouseGestures } from './useMouseGestures'

const pointer = (type: string, init: { button?: number; buttons?: number; clientX: number; clientY: number }) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
  window.dispatchEvent(Object.assign(event, { pointerId: 1 }))
  return event
}

describe('마우스 제스처', () => {
  it('한 방향으로 충분히 가야 한 획', () => {
    expect(strokeOf(10, 5)).toBeNull()
    expect(strokeOf(0, 40)).toBe('D')
    expect(strokeOf(-40, 10)).toBe('L')
    expect(GESTURES.DR?.run).toBe('closeTab')
    expect(GESTURES.RD?.run).toBe('reopenTab')
  })

  it('ㄴ(아래→오른쪽)은 탭을 닫고, 뒤따르는 우클릭 메뉴는 막는다. 그리지 않은 우클릭은 그대로', () => {
    const actions = { bottom: vi.fn(), top: vi.fn(), closeTab: vi.fn(), reopenTab: vi.fn(), back: vi.fn(), forward: vi.fn() }
    renderHook(() => useMouseGestures(actions))
    pointer('pointerdown', { button: 2, buttons: 2, clientX: 100, clientY: 100 })
    pointer('pointermove', { buttons: 2, clientX: 100, clientY: 160 })
    pointer('pointermove', { buttons: 2, clientX: 170, clientY: 160 })
    pointer('pointerup', { button: 2, clientX: 170, clientY: 160 })
    expect(actions.closeTab).toHaveBeenCalledOnce()
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    window.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(true)

    pointer('pointerdown', { button: 2, buttons: 2, clientX: 100, clientY: 100 })
    pointer('pointerup', { button: 2, clientX: 102, clientY: 101 })
    const plain = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    window.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)
  })
})
