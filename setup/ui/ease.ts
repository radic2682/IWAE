// Shown percent chases the real one: never backwards, and slow near the end
// so a stalled final step does not look finished.
const SLOW_FROM = 95
const SLOW_RATE = 4 // percent per second
const EASE_RATE = 6

export function stepProgress(shown: number, target: number, dtSeconds: number): number {
  if (target <= shown) return shown
  let step = (target - shown) * (1 - Math.exp(-EASE_RATE * dtSeconds))
  if (shown >= SLOW_FROM) step = Math.min(step, SLOW_RATE * dtSeconds)
  return Math.min(target, shown + step)
}
