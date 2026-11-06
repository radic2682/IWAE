import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFrameScheduler } from './frameScheduler'

describe('createFrameScheduler', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('coalesces repeated schedules into one animation-frame callback', () => {
    let pending: FrameRequestCallback | undefined
    const request = vi.fn((callback: FrameRequestCallback) => {
      pending = callback
      return 17
    })
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const callback = vi.fn()
    const scheduler = createFrameScheduler(callback)

    scheduler.schedule()
    scheduler.schedule()
    scheduler.schedule()

    expect(request).toHaveBeenCalledTimes(1)
    pending?.(12)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('allows a new callback to be scheduled after the current frame runs', () => {
    const pending: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      pending.push(callback)
      return pending.length
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const callback = vi.fn()
    const scheduler = createFrameScheduler(callback)

    scheduler.schedule()
    pending.shift()?.(1)
    scheduler.schedule()
    pending.shift()?.(2)

    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('cancels pending delivery', () => {
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 23))
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const callback = vi.fn()
    const scheduler = createFrameScheduler(callback)

    scheduler.schedule()
    scheduler.cancel()

    expect(cancel).toHaveBeenCalledWith(23)
    expect(callback).not.toHaveBeenCalled()
  })
})
