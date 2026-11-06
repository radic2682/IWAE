// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useNavigationHistory } from './useNavigationHistory'
import type { NavLocation } from '../core/navigationHistory'

function setup(initial: NavLocation | null, exists: (loc: NavLocation) => boolean = () => true) {
  let current = initial
  const navigate = vi.fn((loc: NavLocation) => { current = loc })
  const hook = renderHook(() => useNavigationHistory({
    current: () => current,
    navigate,
    exists,
  }))
  return { hook, navigate, at: () => current }
}

describe('useNavigationHistory', () => {
  it('jumps, goes back, and goes forward', () => {
    const { hook, navigate, at } = setup({ docId: 'a', page: 2 })
    act(() => hook.result.current.jump({ docId: 'a', page: 30 }))
    expect(at()).toEqual({ docId: 'a', page: 30 })
    expect(hook.result.current.canBack).toBe(true)
    expect(hook.result.current.canForward).toBe(false)

    act(() => hook.result.current.back())
    expect(at()).toEqual({ docId: 'a', page: 2 })
    expect(hook.result.current.canForward).toBe(true)

    act(() => hook.result.current.forward())
    expect(at()).toEqual({ docId: 'a', page: 30 })
    expect(navigate).toHaveBeenCalledTimes(3)
  })

  it('a jump with nothing open just navigates', () => {
    const { hook, at } = setup(null)
    act(() => hook.result.current.jump({ docId: 'b', page: 4 }))
    expect(at()).toEqual({ docId: 'b', page: 4 })
    expect(hook.result.current.canBack).toBe(false)
  })

  it('back skips documents that no longer exist', () => {
    const { hook, at } = setup({ docId: 'gone', page: 1 }, (loc) => loc.docId !== 'gone')
    act(() => hook.result.current.jump({ docId: 'a', page: 9 }))
    act(() => hook.result.current.back())
    expect(at()).toEqual({ docId: 'a', page: 9 })
    expect(hook.result.current.canBack).toBe(false)
  })
})
