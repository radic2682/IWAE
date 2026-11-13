/**
 * 왼쪽 바·노트 창(예전의 오른쪽 노트 바)의 따로 확대. Ctrl+마우스 휠을 그 바 위에서 굴리면 그 바 안쪽만 커지고 작아진다
 * (문서의 확대와 화면 전체 확대와는 별개). 80% ~ 150%, 10% 씩.
 */
export const BAR_ZOOM_MIN = 0.8
export const BAR_ZOOM_MAX = 1.5
export const BAR_ZOOM_STEP = 0.1
export const BAR_ZOOM_DEFAULT = 1
/**
 * 왼쪽 바의 「100%」가 실제로 그리는 배율. 사용자가 90% 크기를 기본으로 두고 그것을 100% 로 보이게 하자고 했다(2026-11-13).
 * 저장 · 표시 값(leftBarZoom)은 그대로 80~150% 이고, 그릴 때만 이 값을 곱한다
 */
export const LEFT_BAR_BASE = 0.9

/** 예전(기준 1) 에 저장된 왼쪽 바 배율을 새 기준(0.9 = 100%) 으로 옮긴다: 같은 크기로 보이게 나눈다 */
export function migrateLeftBarZoom(oldZoom: unknown): number {
  return typeof oldZoom === 'number' && Number.isFinite(oldZoom) ? clampBarZoom(oldZoom / LEFT_BAR_BASE) : BAR_ZOOM_DEFAULT
}

/** 80%~150% 안으로, 소수 둘째 자리까지. 숫자가 아니면 100% */
export function clampBarZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return BAR_ZOOM_DEFAULT
  return Math.round(Math.min(BAR_ZOOM_MAX, Math.max(BAR_ZOOM_MIN, value)) * 100) / 100
}

/** direction 1 = 키우기, -1 = 줄이기. 10% 눈금에 맞춘 뒤 한 칸 */
export function stepBarZoom(current: number, direction: 1 | -1): number {
  const snapped = Math.round(clampBarZoom(current) * 10) / 10
  return clampBarZoom(snapped + direction * BAR_ZOOM_STEP)
}

/**
 * 휠 굴림을 쌓아 칸 수로 바꾼다: 마우스 휠 한 칸(deltaY 100)은 한 단계, 트랙패드의 잔 움직임은 쌓였다가 넘치면 한 단계.
 * 위로 굴리면(deltaY < 0) 키운다. rest 는 다음 굴림에 이어 쌓는다.
 */
export function wheelZoomSteps(accumulated: number, deltaY: number, threshold = 100): { readonly steps: number; readonly rest: number } {
  const total = accumulated + deltaY
  const count = Math.trunc(Math.abs(total) / threshold)
  if (count === 0) return { steps: 0, rest: total }
  const sign = total < 0 ? 1 : -1
  return { steps: sign * count, rest: total - (total < 0 ? -1 : 1) * count * threshold }
}
