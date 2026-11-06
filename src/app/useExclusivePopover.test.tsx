// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useExclusivePopover } from './useExclusivePopover'

describe('useExclusivePopover', () => {
  it('한 번에 하나만 열고 바깥 클릭과 Escape로 닫는다', () => {
    const { result } = renderHook(() => useExclusivePopover())

    act(() => result.current.open('text-color'))
    expect(result.current.openId).toBe('text-color')
    act(() => result.current.open('block-background'))
    expect(result.current.openId).toBe('block-background')

    fireEventOn(document.body, 'mousedown')
    expect(result.current.openId).toBeNull()

    act(() => result.current.open('text-color'))
    fireEventOn(document, 'keydown', { key: 'Escape' })
    expect(result.current.openId).toBeNull()
  })

  it('현재 팝오버 내부 클릭은 닫지 않는다', () => {
    const owner = document.createElement('button')
    owner.dataset.exclusivePopover = 'text-color'
    document.body.append(owner)
    const { result } = renderHook(() => useExclusivePopover())
    act(() => result.current.open('text-color'))

    fireEventOn(owner, 'mousedown')

    expect(result.current.openId).toBe('text-color')
    owner.remove()
  })
})

function fireEventOn(target: EventTarget, type: string, init: EventInit & { key?: string } = {}): void {
  const event = type === 'keydown'
    ? new KeyboardEvent(type, { ...init, bubbles: true })
    : new MouseEvent(type, { ...init, bubbles: true })
  act(() => target.dispatchEvent(event))
}
