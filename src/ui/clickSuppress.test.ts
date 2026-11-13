// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { armClickSuppress } from './clickSuppress'

const click = () => {
  const seen = vi.fn()
  document.body.addEventListener('click', seen)
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  document.body.removeEventListener('click', seen)
  return seen.mock.calls.length
}
const fire = (type: string) => window.dispatchEvent(new Event(type))

afterEach(() => { vi.useRealTimers() })

describe('armClickSuppress', () => {
  it('swallows clicks until a tick after pointerup', () => {
    vi.useFakeTimers()
    armClickSuppress()
    expect(click()).toBe(0)
    fire('pointerup')
    expect(click()).toBe(0)
    vi.advanceTimersByTime(1)
    expect(click()).toBe(1)
  })
  it('a new pointerdown releases at once (Esc or release outside the window must not eat the next real click)', () => {
    armClickSuppress()
    expect(click()).toBe(0)
    fire('pointerdown')
    expect(click()).toBe(1)
  })
  it('released:true lets go one tick later without waiting for pointerup, and reports it once', () => {
    vi.useFakeTimers()
    const onRelease = vi.fn()
    const release = armClickSuppress({ released: true, onRelease })
    expect(click()).toBe(0)
    vi.advanceTimersByTime(1)
    expect(click()).toBe(1)
    release()
    expect(onRelease).toHaveBeenCalledTimes(1)
  })
  it('swallow:false only tracks the armed window', () => {
    const onRelease = vi.fn()
    armClickSuppress({ swallow: false, onRelease })
    expect(click()).toBe(1)
    expect(onRelease).not.toHaveBeenCalled()
    fire('pointerdown')
    expect(onRelease).toHaveBeenCalledTimes(1)
  })
})
