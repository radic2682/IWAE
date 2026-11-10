/**
 * 막대 옆 흐린 새 핀을 한 번 누른 것만으로는 꽂지 않는다.
 * 핀은 마우스를 막대에 올리면 그 높이를 따라다니는데, 막대 옆의 빈 자리를 누르려던 손이
 * 핀 위를 누르게 되는 일이 잦아서 책갈피가 뜻 없이 생겼다. 짧은 사이에 두 번 눌러야 꽂는다.
 */
export const PIN_DOUBLE_PRESS_MS = 500

export interface PinPressTracker {
  /** 누른 때(ms)를 알린다. 앞선 누름에서 {@link PIN_DOUBLE_PRESS_MS} 안이면 true(꽂는다), 아니면 false */
  readonly press: (now: number) => boolean
  readonly reset: () => void
}

export function createPinPressTracker(): PinPressTracker {
  let last: number | null = null
  return {
    press: (now) => {
      const second = last !== null && now - last <= PIN_DOUBLE_PRESS_MS
      last = second ? null : now
      return second
    },
    reset: () => { last = null },
  }
}
