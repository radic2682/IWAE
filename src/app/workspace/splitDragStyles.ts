import type { CSSProperties } from 'react'
import { layoutRects, type LayoutNode, type SplitRect, type UnitRect } from '../../core/layoutTree'

type Size = { readonly width: number; readonly height: number }

/**
 * 칸 사각형(0–1 비율)을 칸 영역(px)의 정수 픽셀 자리로 맞춘다. 비율 % 를 그대로 쓰면 카드가 267.98px 처럼 소수 픽셀에 걸려
 * 테두리 · 모서리가 거칠어 보인다. 왼쪽 · 오른쪽(위 · 아래) 가장자리를 각각 반올림하므로 이웃한 두 칸은 같은 경계를 나눠 쓴다(틈 · 겹침 없음).
 * 영역 크기를 모르면(0) null — 그때는 비율(%)로 둔다.
 */
export function snapRect(unit: UnitRect, size: Size): { readonly left: number; readonly top: number; readonly width: number; readonly height: number } | null {
  if (size.width <= 0 || size.height <= 0) return null
  const left = Math.round(unit.x * size.width)
  const top = Math.round(unit.y * size.height)
  return { left, top, width: Math.round((unit.x + unit.w) * size.width) - left, height: Math.round((unit.y + unit.h) * size.height) - top }
}

/** 칸 하나의 자리 스타일. 크기를 모르면(0) 비율(%)로 둔다 */
export function paneCellStyle(rect: UnitRect | null, size: Size): CSSProperties {
  if (rect === null) return { left: 0, top: 0, width: 0, height: 0 }
  return snapRect(rect, size) ?? { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }
}

/** 경계선 하나의 자리 스타일(칸 영역 안의 정수 px) */
export function dividerStyle(split: Pick<SplitRect, 'dir' | 'x' | 'y' | 'w' | 'h' | 'ratio'>, size: Size): CSSProperties {
  const horizontal = split.dir === 'h'
  const edge = snapRect({ x: split.x, y: split.y, w: split.w, h: split.h }, size)
  if (horizontal) {
    return edge === null
      ? { left: `${(split.x + split.w * split.ratio) * 100}%`, top: `${split.y * 100}%`, height: `${split.h * 100}%` }
      : { left: Math.round((split.x + split.w * split.ratio) * size.width), top: edge.top, height: edge.height }
  }
  return edge === null
    ? { top: `${(split.y + split.h * split.ratio) * 100}%`, left: `${split.x * 100}%`, width: `${split.w * 100}%` }
    : { top: Math.round((split.y + split.h * split.ratio) * size.height), left: edge.left, width: edge.width }
}

/** 끄는 동안 React 를 거치지 않고 DOM 에 바로 쓸 수 있는가: 떠 있는 칸(칸 사각형에 붙는다)이 있으면 React 로 그린다 */
export function canPaintDragDirectly(floatCount: number, zoomed: boolean): boolean {
  return floatCount === 0 && !zoomed
}

/** 끄는 동안의 트리 모양대로 칸 · 경계선의 자리를 칸 영역 DOM 에 바로 쓴다(React 를 거치지 않는다) */
export function paintSplitDrag(area: HTMLElement, root: LayoutNode): void {
  const size = { width: area.clientWidth, height: area.clientHeight }
  const { panes, splits } = layoutRects(root)
  for (const [id, rect] of panes) {
    const cell = area.querySelector<HTMLElement>(`[data-pane-cell="${id}"]`)
    if (cell !== null) writeStyle(cell, paneCellStyle(rect, size))
  }
  for (const split of splits) {
    const divider = area.querySelector<HTMLElement>(`[data-split-id="${split.id}"]`)
    if (divider !== null) writeStyle(divider, dividerStyle(split, size))
  }
}

/** style 객체를 요소에 바로 쓴다(숫자는 px) */
export function writeStyle(element: HTMLElement, style: CSSProperties): void {
  for (const [key, value] of Object.entries(style)) {
    element.style.setProperty(key, typeof value === 'number' ? `${value}px` : String(value))
  }
}
