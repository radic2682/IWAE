import { describe, expect, it } from 'vitest'
import { clampScroll, isNotchedWheel, smoothStep, wheelPixels } from './smoothScroll'

describe('smoothScroll', () => {
  it('마우스 휠 칸만 부드럽게 하고 터치패드의 잘게 오는 값은 그대로 둔다', () => {
    expect(isNotchedWheel({ deltaX: 0, deltaY: 100, deltaMode: 0 })).toBe(true)
    expect(isNotchedWheel({ deltaX: 0, deltaY: -125, deltaMode: 0 })).toBe(true)
    expect(isNotchedWheel({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toBe(true)
    expect(isNotchedWheel({ deltaX: 0, deltaY: 4.5, deltaMode: 0 })).toBe(false)
    expect(isNotchedWheel({ deltaX: 12, deltaY: 60, deltaMode: 0 })).toBe(false)
  })

  it('줄·쪽 단위 휠을 px 로 바꾼다', () => {
    expect(wheelPixels({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800)).toBe(120)
    expect(wheelPixels({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 800)).toBe(800)
    expect(wheelPixels({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 800)).toBe(100)
  })

  it('목표로 갈수록 느려지며 다가가고, 가까우면 닿는다', () => {
    const first = smoothStep(0, 100, 16)
    const second = smoothStep(first, 100, 16)
    expect(first).toBeGreaterThan(20)
    expect(second - first).toBeLessThan(first)
    let pos = 0
    for (let frame = 0; frame < 30 && pos !== 100; frame += 1) pos = smoothStep(pos, 100, 16)
    expect(pos).toBe(100)
    expect(clampScroll(-5, 300)).toBe(0)
    expect(clampScroll(400, 300)).toBe(300)
  })
})
