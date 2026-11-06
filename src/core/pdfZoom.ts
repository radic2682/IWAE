/**
 * PDF 배율(%) 범위와 단계. 큰 확대는 보이는 부분만 타일로 기기 해상도 그대로 그리므로
 * (PageImage) 800% 까지 글자가 뭉개지지 않는다.
 */
export const ZOOM_MIN = 25
export const ZOOM_MAX = 800

/** 확대·축소 단추와 Ctrl+휠이 밟는 단계. 큰 배율일수록 간격이 넓다 */
const STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500, 600, 800] as const

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.min(Math.max(Math.round(value), ZOOM_MIN), ZOOM_MAX)
}

/** 지금 배율에서 한 단계 위(1) 또는 아래(-1) */
export function stepZoom(value: number, direction: 1 | -1): number {
  if (direction > 0) return STEPS.find((step) => step > value + 0.5) ?? ZOOM_MAX
  for (let index = STEPS.length - 1; index >= 0; index--) {
    const step = STEPS[index]
    if (step !== undefined && step < value - 0.5) return step
  }
  return ZOOM_MIN
}
