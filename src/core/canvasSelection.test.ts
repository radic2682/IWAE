import { describe, expect, it } from 'vitest'
import { intersectingNodeIds, rightDragCrossedThreshold, screenPointToCanvas } from './canvasSelection'

describe('canvas selection geometry', () => {
  it('선택 사각형과 일부만 닿은 블록도 선택한다', () => {
    expect(intersectingNodeIds(
      { x: 0, y: 0, width: 100, height: 100 },
      [{ id: 'partial', x: 90, y: 90, width: 40, height: 40, selectable: true }],
    )).toEqual(['partial'])
  })

  it('그리기 오버레이처럼 선택 불가능한 항목은 무시한다', () => {
    expect(intersectingNodeIds(
      { x: 0, y: 0, width: 100, height: 100 },
      [{ id: 'overlay', x: 0, y: 0, width: 100, height: 100, selectable: false }],
    )).toEqual([])
  })

  it('음수 pan과 확대 상태에서도 보이는 화면 좌표를 캔버스 좌표로 바꾼다', () => {
    expect(screenPointToCanvas(
      { x: 500, y: 300 },
      { x: -1000, y: -600, zoom: 2 },
    )).toEqual({ x: 750, y: 450 })
  })

  it('우클릭 이동 거리가 5px을 넘어야 pan으로 판정한다', () => {
    expect(rightDragCrossedThreshold({ x: 10, y: 10 }, { x: 13, y: 14 })).toBe(false)
    expect(rightDragCrossedThreshold({ x: 10, y: 10 }, { x: 16, y: 10 })).toBe(true)
  })
})
