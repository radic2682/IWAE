import { describe, it, expect } from 'vitest'
import {
  SIDEBAR_MIN,
  SIDEBAR_MAX,
  PANE_MIN_FRAC,
  clampSidebar,
  clampLeftFrac,
  fracFromPointer,
  workspaceColumns,
} from './splitLayout'

describe('clampSidebar', () => {
  it('범위 안의 값은 그대로 둔다', () => {
    expect(clampSidebar(240)).toBe(240)
  })
  it('최소보다 작으면 최소로 올린다', () => {
    expect(clampSidebar(50)).toBe(SIDEBAR_MIN)
  })
  it('최대보다 크면 최대로 내린다', () => {
    expect(clampSidebar(9999)).toBe(SIDEBAR_MAX)
  })
  it('음수와 NaN 도 최소로 떨어진다 — 드래그 중 좌표가 튀어도 레이아웃이 안 무너진다', () => {
    expect(clampSidebar(-10)).toBe(SIDEBAR_MIN)
    expect(clampSidebar(Number.NaN)).toBe(SIDEBAR_MIN)
  })
})

describe('clampLeftFrac', () => {
  it('범위 안의 값은 그대로 둔다', () => {
    expect(clampLeftFrac(0.5)).toBe(0.5)
  })
  it('한쪽 패널이 20% 밑으로 못 내려간다', () => {
    expect(clampLeftFrac(0.05)).toBe(PANE_MIN_FRAC)
    expect(clampLeftFrac(0.99)).toBeCloseTo(1 - PANE_MIN_FRAC, 10)
  })
  it('NaN 은 절반으로 되돌린다', () => {
    expect(clampLeftFrac(Number.NaN)).toBe(0.5)
  })
})

describe('fracFromPointer', () => {
  it('영역 한가운데를 가리키면 0.5 다', () => {
    expect(fracFromPointer(600, 400, 400)).toBe(0.5)
  })
  it('영역 왼쪽 끝을 가리켜도 최소 비율을 지킨다', () => {
    expect(fracFromPointer(400, 400, 400)).toBe(PANE_MIN_FRAC)
  })
  it('폭이 0 이면 절반을 돌려준다 — 최초 렌더에서 폭이 아직 0 일 수 있다', () => {
    expect(fracFromPointer(100, 0, 0)).toBe(0.5)
  })
})

describe('workspaceColumns', () => {
  it('사이드바를 접으면 두 pane 경계를 전체 폭 기준으로 맞춘다', () => {
    expect(workspaceColumns(true, 280, 0.5, 1600)).toEqual({
      sidebar: 0,
      leftStart: 0,
      divider: 800,
      rightStart: 801,
    })
  })

  it('열린 사이드바와 구분선 뒤의 남은 폭을 pane 비율로 나눈다', () => {
    expect(workspaceColumns(false, 280, 0.5, 1600)).toEqual({
      sidebar: 280,
      leftStart: 281,
      divider: 941,
      rightStart: 942,
    })
  })
})
