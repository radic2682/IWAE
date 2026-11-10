import type { CSSProperties } from 'react'

/** <input type=range> 의 채워진 부분(--range-fill, %). 입력의 style 로 넘기면 값이 바뀔 때 React 가 함께 갱신한다 */
export function rangeFillStyle(value: number, min: number, max: number): CSSProperties {
  const pct = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0
  return { ['--range-fill' as string]: `${Math.round(pct * 10) / 10}%` }
}
