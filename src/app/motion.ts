/**
 * 움직임 값(JS 쪽). src/ui/motion.css 의 토큰과 같은 곡선·시간이다 — 한쪽을 고치면 다른 쪽도 고친다.
 * WAAPI(element.animate)·requestAnimationFrame 으로 움직이는 곳(탭 미끄러짐, 노트 블록 FLIP, 탭 내려앉기)이 쓴다.
 */

export const MOTION_FAST_MS = 120
export const MOTION_BASE_MS = 180
export const MOTION_SLOW_MS = 260
export const SPRING_SOFT_MS = 320
export const SPRING_SNAP_MS = 260
export const SPRING_FIRM_MS = 300

export const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
export const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)'
/** 넘침 약 5%, 부드럽게 앉는다 */
export const EASE_SPRING_SOFT = 'linear(0, 0.0387, 0.134, 0.2598, 0.3968, 0.5313, 0.6543, 0.7608, 0.8487, 0.9179, 0.9697, 1.0062, 1.03, 1.0435, 1.0493, 1.0496, 1.0462, 1.0406, 1.034, 1.0271, 1.0206, 1.0148, 1.0099, 1.0059, 1.0028, 1.0006, 0.9991, 0.9981, 0.9976, 0.9975, 0.9976, 0.9978, 0.9981, 0.9985, 1)'
/** 넘침 약 9%: 단추·작은 칩이 톡 튄다 */
export const EASE_SPRING_SNAP = 'linear(0, 0.0445, 0.1548, 0.3008, 0.4588, 0.612, 0.7489, 0.8633, 0.9528, 1.0178, 1.0607, 1.0849, 1.0943, 1.0928, 1.084, 1.071, 1.0562, 1.0414, 1.0278, 1.0162, 1.007, 1.0001, 0.9954, 0.9925, 0.9912, 0.9911, 0.9917, 0.9928, 0.9942, 0.9956, 0.997, 0.9981, 0.9991, 0.9998, 1)'
/** 넘침 약 0.6%: 큰 면이 출렁이지 않는다 */
export const EASE_SPRING_FIRM = 'linear(0, 0.0327, 0.1119, 0.2154, 0.3276, 0.4385, 0.542, 0.6344, 0.7143, 0.7816, 0.8369, 0.8813, 0.9163, 0.9432, 0.9635, 0.9784, 0.989, 0.9963, 1.001, 1.004, 1.0056, 1.0062, 1.0062, 1.0059, 1.0053, 1.0046, 1.0039, 1.0032, 1.0026, 1.0021, 1.0016, 1.0012, 1.0009, 1.0006, 1)'

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function canAnimate(): boolean {
  return typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.animate === 'function' && !reducedMotion()
}

/**
 * 감쇠 스프링의 계단 응답(0→1, 정규화 시간 t∈[0,1]). CSS 곡선과 같은 모양(soft: ζ=0.69, k=7)이라
 * requestAnimationFrame 으로 직접 움직이는 곳도 같은 느낌으로 앉는다. t≥1 이면 정확히 1.
 */
export function springSoft(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const zeta = 0.69
  const k = 7
  const wd = (k / zeta) * Math.sqrt(1 - zeta * zeta)
  return 1 - Math.exp(-k * t) * (Math.cos(wd * t) + (k / wd) * Math.sin(wd * t))
}

/** 위치가 바뀐 요소가 이전 자리에서 새 자리로 스프링으로 미끄러진다(FLIP). delta = 이전 − 새 자리(px) */
export function slideFrom(element: HTMLElement, axis: 'x' | 'y', delta: number, duration = SPRING_FIRM_MS): void {
  if (!canAnimate() || Math.abs(delta) < 0.5) return
  const from = axis === 'x' ? `translateX(${delta}px)` : `translateY(${delta}px)`
  const to = axis === 'x' ? 'translateX(0)' : 'translateY(0)'
  element.animate([{ transform: from }, { transform: to }], { duration, easing: EASE_SPRING_FIRM })
}

/**
 * 새로 생긴 것(탭 · 노트 카드)이 제자리에서 흐려지며 나타난다: 120ms 투명도뿐, 크기 · 위치는 움직이지 않고 넘침도 없다.
 * 「동작 줄이기」면 아무것도 하지 않는다.
 */
export function fadeIn(element: HTMLElement): void {
  if (!canAnimate()) return
  element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION_FAST_MS, easing: 'ease-out' })
}
