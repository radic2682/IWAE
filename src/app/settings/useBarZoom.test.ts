// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { attachBarZoomWheel, stepBarZoomPref } from './useBarZoom'
import { getAppPrefs, setAppPref } from '../appPrefs'

function wheel(element: HTMLElement, init: WheelEventInit) {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  element.dispatchEvent(event)
  return event
}

describe('바 위의 Ctrl+휠 확대', () => {
  afterEach(() => {
    setAppPref('leftBarZoom', 1)
    setAppPref('rightBarZoom', 1)
  })

  it('Ctrl+휠은 그 바의 배율만 바꾸고 웹뷰 확대는 막는다', () => {
    const left = document.createElement('div')
    const right = document.createElement('div')
    const stopLeft = attachBarZoomWheel(left, 'left')
    const stopRight = attachBarZoomWheel(right, 'right')
    expect(wheel(left, { ctrlKey: true, deltaY: -100 }).defaultPrevented).toBe(true)
    expect(getAppPrefs().leftBarZoom).toBe(1.1)
    expect(getAppPrefs().rightBarZoom).toBe(1)
    wheel(right, { ctrlKey: true, deltaY: 100 })
    wheel(right, { ctrlKey: true, deltaY: 100 })
    expect(getAppPrefs().rightBarZoom).toBe(0.8)
    expect(getAppPrefs().leftBarZoom).toBe(1.1)
    stopLeft()
    stopRight()
  })

  it('Ctrl 없는 휠은 그대로 둔다(스크롤)', () => {
    const left = document.createElement('div')
    const stop = attachBarZoomWheel(left, 'left')
    expect(wheel(left, { deltaY: -100 }).defaultPrevented).toBe(false)
    expect(getAppPrefs().leftBarZoom).toBe(1)
    stop()
  })

  it('끝에 닿으면 더 바뀌지 않고, 떼면 더 듣지 않는다', () => {
    for (let index = 0; index < 8; index++) stepBarZoomPref('right', 1)
    expect(getAppPrefs().rightBarZoom).toBe(1.5)
    const bar = document.createElement('div')
    const stop = attachBarZoomWheel(bar, 'right')
    stop()
    wheel(bar, { ctrlKey: true, deltaY: 100 })
    expect(getAppPrefs().rightBarZoom).toBe(1.5)
  })
})
