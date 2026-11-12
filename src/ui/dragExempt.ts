/** 끌기를 시작하면 안 되는 자리: 단추·입력칸·목록·글(고르기 위해) */
const NO_DRAG = 'button, select, textarea, input, a, label, [data-no-drag]'

export function isDragExempt(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(NO_DRAG) !== null
}

/** 사각형이 화면(margin 안쪽)을 벗어나지 않도록 옮길 양을 줄인다 */
export function clampMoveToViewport(rect: { left: number; top: number; width: number; height: number }, dx: number, dy: number, margin = 8): { dx: number; dy: number } {
  const clamp = (value: number, a: number, b: number) => Math.max(Math.min(a, b), Math.min(value, Math.max(a, b)))
  return {
    dx: clamp(dx, margin - rect.left, window.innerWidth - margin - (rect.left + rect.width)),
    dy: clamp(dy, margin - rect.top, window.innerHeight - margin - (rect.top + rect.height)),
  }
}
