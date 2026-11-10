import { describe, expect, it } from 'vitest'
import { BAR_ZOOM_MAX, BAR_ZOOM_MIN, clampBarZoom, stepBarZoom, wheelZoomSteps } from './barZoom'

describe('barZoom', () => {
  it('80%~150% 안으로 맞추고, 숫자가 아니면 100%', () => {
    expect(clampBarZoom(0.3)).toBe(BAR_ZOOM_MIN)
    expect(clampBarZoom(9)).toBe(BAR_ZOOM_MAX)
    expect(clampBarZoom(1.234)).toBe(1.23)
    expect(clampBarZoom(Number.NaN)).toBe(1)
    expect(clampBarZoom('1.2')).toBe(1)
    expect(clampBarZoom(undefined)).toBe(1)
  })

  it('10% 씩 키우고 줄이며 끝에서 멈춘다', () => {
    expect(stepBarZoom(1, 1)).toBe(1.1)
    expect(stepBarZoom(1, -1)).toBe(0.9)
    expect(stepBarZoom(1.4, 1)).toBe(1.5)
    expect(stepBarZoom(1.5, 1)).toBe(1.5)
    expect(stepBarZoom(0.8, -1)).toBe(0.8)
    // 10% 눈금이 아닌 값은 눈금에 맞춘 뒤 한 칸(부동소수점 오차가 쌓이지 않는다)
    expect(stepBarZoom(1.04, 1)).toBe(1.1)
    let value = 1
    for (let index = 0; index < 5; index++) value = stepBarZoom(value, 1)
    expect(value).toBe(1.5)
    for (let index = 0; index < 7; index++) value = stepBarZoom(value, -1)
    expect(value).toBe(0.8)
  })

  it('휠 한 칸(100)은 한 단계, 위로 굴리면 키운다. 잔 움직임은 쌓였다가 넘치면 한 단계', () => {
    expect(wheelZoomSteps(0, -100)).toEqual({ steps: 1, rest: 0 })
    expect(wheelZoomSteps(0, 100)).toEqual({ steps: -1, rest: 0 })
    expect(wheelZoomSteps(0, -30)).toEqual({ steps: 0, rest: -30 })
    expect(wheelZoomSteps(-30, -80)).toEqual({ steps: 1, rest: -10 })
    expect(wheelZoomSteps(0, -250)).toEqual({ steps: 2, rest: -50 })
  })
})
