import { describe, expect, it } from 'vitest'
import { anchorGhostBelowRight, clampGhostPos } from './ghostPlace'

describe('clampGhostPos', () => {
  it('창 안이면 그대로, 가장자리를 넘으면 8px 안으로 민다', () => {
    expect(clampGhostPos(100, 100, 50, 30, 800, 600)).toEqual({ x: 100, y: 100 })
    expect(clampGhostPos(790, 590, 50, 30, 800, 600)).toEqual({ x: 742, y: 562 })
    expect(clampGhostPos(-20, -5, 50, 30, 800, 600)).toEqual({ x: 8, y: 8 })
  })
  it('껍질 안쪽 투명 여백만큼 음수 여백을 주면 보이는 부분이 8px 안에 든다', () => {
    // 껍질 폭 100 = 보이는 60 + 좌우 20: 오른쪽 끝에서 보이는 부분이 8px 떨어지려면 껍질은 창 밖으로 12px 나간다
    expect(clampGhostPos(900, 10, 100, 40, 800, 600, -12, 4).x).toBe(712)
    expect(clampGhostPos(-90, 10, 100, 40, 800, 600, -12, 4).x).toBe(-12)
  })
})

describe('anchorGhostBelowRight', () => {
  it('포인터 오른쪽 아래(+14, +16)에 둔다', () => {
    expect(anchorGhostBelowRight(100, 100, 280, 60, 1000, 800)).toEqual({ x: 114, y: 116 })
  })
  it('오른쪽이 넘치면 포인터 왼쪽으로, 아래가 넘치면 위로 뒤집는다', () => {
    const right = anchorGhostBelowRight(900, 100, 280, 60, 1000, 800)
    expect(right.x + 280).toBeLessThanOrEqual(900 - 14)
    const below = anchorGhostBelowRight(100, 780, 280, 60, 1000, 800)
    expect(below.y + 60).toBeLessThanOrEqual(780 - 16)
    const both = anchorGhostBelowRight(990, 790, 280, 60, 1000, 800)
    expect(both.x + 280).toBeLessThanOrEqual(990)
    expect(both.y + 60).toBeLessThanOrEqual(790)
  })
  it('어느 쪽이든 포인터 끝은 ghost 에 가려지지 않는다', () => {
    for (const [px, py] of [[5, 5], [500, 400], [995, 5], [5, 795], [995, 795]] as const) {
      const { x, y } = anchorGhostBelowRight(px, py, 280, 70, 1000, 800)
      const covered = px >= x && px <= x + 280 && py >= y && py <= y + 70
      expect(covered).toBe(false)
      expect(x).toBeGreaterThanOrEqual(8)
      expect(y).toBeGreaterThanOrEqual(8)
      expect(x + 280).toBeLessThanOrEqual(992)
      expect(y + 70).toBeLessThanOrEqual(792)
    }
  })
})
