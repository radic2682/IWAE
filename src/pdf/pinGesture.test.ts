import { describe, expect, it } from 'vitest'
import { PIN_DOUBLE_PRESS_MS, createPinPressTracker } from './pinGesture'

describe('pinGesture', () => {
  it('짧은 사이에 두 번째로 눌러야 꽂고, 꽂은 뒤에는 다시 두 번이 필요하다', () => {
    const tracker = createPinPressTracker()
    expect(tracker.press(1000)).toBe(false)
    expect(tracker.press(1000 + PIN_DOUBLE_PRESS_MS)).toBe(true)
    expect(tracker.press(1100 + PIN_DOUBLE_PRESS_MS)).toBe(false)
  })

  it('너무 늦은 두 번째 누름은 새 첫 번째로 센다', () => {
    const tracker = createPinPressTracker()
    expect(tracker.press(0)).toBe(false)
    expect(tracker.press(PIN_DOUBLE_PRESS_MS + 1)).toBe(false)
    expect(tracker.press(PIN_DOUBLE_PRESS_MS + 100)).toBe(true)
  })

  it('reset 하면 처음부터 센다', () => {
    const tracker = createPinPressTracker()
    tracker.press(0)
    tracker.reset()
    expect(tracker.press(10)).toBe(false)
  })
})
