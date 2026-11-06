import { describe, expect, it } from 'vitest'
import { PDF_SPLIT_LAYOUTS, closeSplitCell, evenFractions, fractionOffset, moveSplitBoundary, pdfSplitLayout, splitDividers } from './pdfSplit'

describe('pdfSplit', () => {
  it('배치마다 칸이 격자를 빈틈없이 한 번씩 덮는다', () => {
    for (const layout of PDF_SPLIT_LAYOUTS) {
      const covered = new Map<string, number>()
      for (const cell of layout.cells) {
        for (let col = cell.col; col < cell.col + cell.colSpan; col += 1) {
          for (let row = cell.row; row < cell.row + cell.rowSpan; row += 1) {
            covered.set(`${col}:${row}`, (covered.get(`${col}:${row}`) ?? 0) + 1)
          }
        }
      }
      expect(covered.size, layout.id).toBe(layout.cols * layout.rows)
      expect([...covered.values()].every((count) => count === 1), layout.id).toBe(true)
    }
  })

  it('칸 하나가 가로지르는 줄에서는 구분선이 끊긴다', () => {
    expect(splitDividers(pdfSplitLayout('single'))).toEqual([])
    expect(splitDividers(pdfSplitLayout('top2-bottom1'))).toEqual([
      { axis: 'col', boundary: 1, start: 0, end: 1 },
      { axis: 'row', boundary: 1, start: 0, end: 2 },
    ])
    expect(splitDividers(pdfSplitLayout('left1-right2'))).toEqual([
      { axis: 'col', boundary: 1, start: 0, end: 2 },
      { axis: 'row', boundary: 1, start: 1, end: 2 },
    ])
    expect(splitDividers(pdfSplitLayout('cols3')).map((divider) => divider.boundary)).toEqual([1, 2])
  })

  it('경계를 옮기면 이웃한 두 칸만 바뀌고 너무 좁아지지 않는다', () => {
    const three = evenFractions(3)
    const moved = moveSplitBoundary(three, 2, 0.5)
    expect(moved[0]).toBeCloseTo(1 / 3)
    expect(moved[1]).toBeCloseTo(0.5 - 1 / 3)
    expect(moved[2]).toBeCloseTo(0.5)
    const squeezed = moveSplitBoundary([0.5, 0.5], 1, 0.01)
    expect(squeezed[0]).toBeCloseTo(0.15)
    expect(fractionOffset([0.2, 0.3, 0.5], 2)).toBeCloseTo(0.5)
  })
})

describe('칸 닫기', () => {
  it('남은 칸 수와 모양에 맞는 배치로', () => {
    expect(closeSplitCell('cols2', 0)).toEqual({ layout: 'single', keep: [1] })
    expect(closeSplitCell('cols3', 1)).toEqual({ layout: 'cols2', keep: [0, 2] })
    expect(closeSplitCell('top2-bottom1', 2)).toEqual({ layout: 'cols2', keep: [0, 1] })
    expect(closeSplitCell('top2-bottom1', 0)).toEqual({ layout: 'rows2', keep: [1, 2] })
    expect(closeSplitCell('grid4', 1)).toEqual({ layout: 'top1-bottom2', keep: [0, 2, 3] })
    expect(closeSplitCell('grid4', 3)).toEqual({ layout: 'top2-bottom1', keep: [0, 1, 2] })
    expect(closeSplitCell('single', 0)).toEqual({ layout: 'single', keep: [0] })
  })
})
