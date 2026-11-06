/**
 * 마우스 휠 부드럽게 굴리기의 계산. 브라우저(웨일·크롬)처럼 휠 한 칸이 툭 끊겨 넘어가지 않고
 * 짧게 미끄러지듯 따라간다. 터치패드는 이미 매끄러워서 건드리지 않는다.
 */

/** 휠 한 칸이 끝까지 가는 데 드는 시간의 눈금(ms). 클수록 더 길게 미끄러진다 */
export const SMOOTH_TAU_MS = 55

/** 줄 단위 휠의 한 줄(px) */
const LINE_PX = 40

export interface WheelLike {
  readonly deltaX: number
  readonly deltaY: number
  readonly deltaMode: number
}

/**
 * 마우스 휠(칸으로 넘어가는 것)인가. 터치패드는 작은 값이 잘게 여러 번 오고,
 * 마우스 휠은 한 칸에 크게(보통 100px) 한 번 온다.
 */
export function isNotchedWheel(event: WheelLike): boolean {
  if (event.deltaMode === 1 || event.deltaMode === 2) return true
  return event.deltaX === 0 && Math.abs(event.deltaY) >= 50
}

/** 휠 값을 px 로 */
export function wheelPixels(event: WheelLike, pageHeight: number): number {
  if (event.deltaMode === 1) return event.deltaY * LINE_PX
  if (event.deltaMode === 2) return event.deltaY * pageHeight
  return event.deltaY
}

/** 한 프레임(dt ms) 뒤의 자리. 목표에 가까워질수록 느려지고(ease-out), 반 px 안이면 닿은 것으로 본다 */
export function smoothStep(current: number, target: number, dtMs: number): number {
  const gap = target - current
  if (Math.abs(gap) < 0.5) return target
  return current + gap * (1 - Math.exp(-Math.max(dtMs, 0) / SMOOTH_TAU_MS))
}

export function clampScroll(value: number, max: number): number {
  return Math.min(Math.max(value, 0), Math.max(max, 0))
}
