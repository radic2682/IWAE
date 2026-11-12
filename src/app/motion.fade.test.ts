// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MOTION_FAST_MS, fadeIn } from './motion'

describe('fadeIn', () => {
  afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(window, 'matchMedia') })

  it('새로 생긴 것은 120ms 투명도만 움직인다: 크기 · 위치(transform)는 없고 넘침(스프링)도 없다', () => {
    const animate = vi.fn()
    HTMLElement.prototype.animate = animate as unknown as HTMLElement['animate']
    fadeIn(document.createElement('div'))
    expect(animate).toHaveBeenCalledTimes(1)
    const [frames, options] = animate.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions]
    expect(frames).toEqual([{ opacity: 0 }, { opacity: 1 }])
    expect(options.duration).toBe(MOTION_FAST_MS)
    expect(String(options.easing)).not.toContain('linear(')
  })

  it('동작 줄이기이면 아무것도 움직이지 않는다', () => {
    const animate = vi.fn()
    HTMLElement.prototype.animate = animate as unknown as HTMLElement['animate']
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia
    fadeIn(document.createElement('div'))
    expect(animate).not.toHaveBeenCalled()
  })
})
