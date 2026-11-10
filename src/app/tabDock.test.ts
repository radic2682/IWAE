import { describe, expect, it } from 'vitest'
import { PDF_SPLIT_LAYOUTS } from '../core/pdfSplit'
import { collapseEmptyPane, dockSplit, dockTab, dockZoneAt, dockZoneBox, dockableEdges, insertionIndexAt, insertTabAt, moveTabToPaneAt } from './tabDock'
import { emptyTabs, type PanesState, type Tab } from './tabs'

const box = { left: 100, top: 50, width: 400, height: 300 }
const tab = (id: string): Tab => ({ id, title: id, kind: 'pdf' })
const state = (...ids: string[]) => ({ tabs: ids.map(tab), activeId: ids[0] ?? null })
const ids = (value: { tabs: readonly Tab[] } | undefined) => value?.tabs.map((item) => item.id)

describe('dockZoneAt', () => {
  it('중앙은 center, 띠 안쪽은 가장 가까운 가장자리', () => {
    expect(dockZoneAt(box, 300, 200)).toBe('center')
    expect(dockZoneAt(box, 110, 200)).toBe('left')
    expect(dockZoneAt(box, 490, 200)).toBe('right')
    expect(dockZoneAt(box, 300, 55)).toBe('top')
    expect(dockZoneAt(box, 300, 345)).toBe('bottom')
  })
  it('모서리는 더 가까운 가장자리가 이긴다', () => {
    expect(dockZoneAt(box, 105, 60)).toBe('left')
    expect(dockZoneAt(box, 130, 52)).toBe('top')
  })
  it('창 밖은 null, 허락 안 된 가장자리는 center', () => {
    expect(dockZoneAt(box, 50, 200)).toBeNull()
    expect(dockZoneAt(box, 110, 200, ['right'])).toBe('center')
    expect(dockZoneAt({ ...box, width: 0 }, 100, 100)).toBeNull()
  })
})

describe('dockZoneBox', () => {
  it('가장자리는 절반, center 는 전체', () => {
    expect(dockZoneBox(box, 'left')).toEqual({ left: 100, top: 50, width: 200, height: 300 })
    expect(dockZoneBox(box, 'right')).toEqual({ left: 300, top: 50, width: 200, height: 300 })
    expect(dockZoneBox(box, 'top')).toEqual({ left: 100, top: 50, width: 400, height: 150 })
    expect(dockZoneBox(box, 'bottom')).toEqual({ left: 100, top: 200, width: 400, height: 150 })
    expect(dockZoneBox(box, 'center')).toBe(box)
  })
})

describe('insertionIndexAt', () => {
  const rects = [{ left: 0, width: 100 }, { left: 100, width: 100 }, { left: 200, width: 100 }]
  it('이웃 가운데를 넘으면 그 뒤', () => {
    expect(insertionIndexAt(rects, -20)).toBe(0)
    expect(insertionIndexAt(rects, 40)).toBe(0)
    expect(insertionIndexAt(rects, 60)).toBe(1)
    expect(insertionIndexAt(rects, 160)).toBe(2)
    expect(insertionIndexAt(rects, 999)).toBe(3)
  })
  it('빈 줄이면 0', () => expect(insertionIndexAt([], 10)).toBe(0))
})

describe('dockSplit', () => {
  it('한 화면을 좌우·위아래로', () => {
    expect(dockSplit('single', 0, 'right')).toEqual({ layout: 'cols2', slots: [0, 'new'] })
    expect(dockSplit('single', 0, 'left')).toEqual({ layout: 'cols2', slots: ['new', 0] })
    expect(dockSplit('single', 0, 'bottom')).toEqual({ layout: 'rows2', slots: [0, 'new'] })
    expect(dockSplit('single', 0, 'top')).toEqual({ layout: 'rows2', slots: ['new', 0] })
  })
  it('좌우 둘에서 오른쪽 칸을 아래로 가르면 왼쪽 하나 · 오른쪽 둘', () => {
    expect(dockSplit('cols2', 1, 'bottom')).toEqual({ layout: 'left1-right2', slots: [0, 1, 'new'] })
    expect(dockSplit('cols2', 1, 'top')).toEqual({ layout: 'left1-right2', slots: [0, 'new', 1] })
    expect(dockSplit('cols2', 0, 'bottom')).toEqual({ layout: 'left2-right1', slots: [0, 'new', 1] })
  })
  it('좌우 둘에서 가로로 더 가르면 좌우 셋', () => {
    expect(dockSplit('cols2', 0, 'right')).toEqual({ layout: 'cols3', slots: [0, 'new', 1] })
    expect(dockSplit('cols2', 1, 'right')).toEqual({ layout: 'cols3', slots: [0, 1, 'new'] })
  })
  it('위아래 둘에서 가로로 가르면 위 둘·아래 하나 또는 위 하나·아래 둘', () => {
    expect(dockSplit('rows2', 0, 'right')).toEqual({ layout: 'top2-bottom1', slots: [0, 'new', 1] })
    expect(dockSplit('rows2', 1, 'left')).toEqual({ layout: 'top1-bottom2', slots: [0, 'new', 1] })
  })
  it('셋을 넷(2×2)으로', () => {
    expect(dockSplit('top2-bottom1', 2, 'right')).toEqual({ layout: 'grid4', slots: [0, 1, 2, 'new'] })
    expect(dockSplit('top2-bottom1', 2, 'left')).toEqual({ layout: 'grid4', slots: [0, 1, 'new', 2] })
    expect(dockSplit('left1-right2', 0, 'right')).toBeNull()
    expect(dockSplit('left1-right2', 1, 'bottom')).toBeNull()
  })
  it('넷에서는 더 나눌 수 없다', () => {
    for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
      for (let cell = 0; cell < 4; cell += 1) expect(dockSplit('grid4', cell, edge)).toBeNull()
    }
  })
  it('없는 모양(좌우 셋의 가운데를 위아래로)은 null', () => {
    expect(dockSplit('cols3', 1, 'bottom')).toBeNull()
  })
  it('잘못된 칸 번호는 null', () => {
    expect(dockSplit('single', 3, 'left')).toBeNull()
  })
  it('나온 배치는 늘 새 칸을 하나 더 가지고, 옛 칸은 한 번씩만 쓴다', () => {
    for (const layout of PDF_SPLIT_LAYOUTS) {
      for (let cell = 0; cell < layout.cells.length; cell += 1) {
        for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
          const result = dockSplit(layout.id, cell, edge)
          if (result === null) continue
          expect(result.slots).toHaveLength(layout.cells.length + 1)
          expect(result.slots.filter((slot) => slot === 'new')).toHaveLength(1)
          const olds = result.slots.filter((slot): slot is number => slot !== 'new').sort()
          expect(olds).toEqual(layout.cells.map((_, index) => index))
        }
      }
    }
  })
  it('dockableEdges 는 나눌 수 있는 쪽만', () => {
    expect(dockableEdges('single', 0)).toEqual(['left', 'right', 'top', 'bottom'])
    expect(dockableEdges('grid4', 0)).toEqual([])
  })
})

describe('탭 옮기기', () => {
  it('insertTabAt 은 원하는 자리에 넣고 활성화한다', () => {
    const next = insertTabAt(state('a', 'b', 'c'), tab('x'), 1)
    expect(ids(next)).toEqual(['a', 'x', 'b', 'c'])
    expect(next.activeId).toBe('x')
    expect(ids(insertTabAt(state('a', 'b'), tab('a'), 5))).toEqual(['b', 'a'])
  })
  const panes: PanesState = { left: state('a', 'b'), right: state('c'), third: emptyTabs, fourth: emptyTabs }
  it('moveTabToPaneAt: 다른 패널의 자리로', () => {
    const next = moveTabToPaneAt(panes, 'a', 'right', 0)
    expect(ids(next.left)).toEqual(['b'])
    expect(ids(next.right)).toEqual(['a', 'c'])
    expect(next.right.activeId).toBe('a')
  })
  it('moveTabToPaneAt: 같은 패널이면 순서만', () => {
    expect(ids(moveTabToPaneAt(panes, 'a', 'left', 1).left)).toEqual(['b', 'a'])
  })
  it('dockTab: 오른쪽 패널을 아래로 갈라 새 패널에', () => {
    const result = dockTab({ ...panes, right: state('c', 'd') }, 'cols2', 'a', 'right', 'bottom')
    expect(result?.layout).toBe('left1-right2')
    expect(result?.newPane).toBe('third')
    expect(ids(result?.panes.left)).toEqual(['b'])
    expect(ids(result?.panes.right)).toEqual(['c', 'd'])
    expect(ids(result?.panes.third)).toEqual(['a'])
  })
  it('dockTab: 새 칸이 앞에 오면 패널 이름이 밀린다', () => {
    const result = dockTab(panes, 'cols2', 'a', 'left', 'left')
    expect(result?.layout).toBe('cols3')
    expect(result?.newPane).toBe('left')
    expect(ids(result?.panes.left)).toEqual(['a'])
    expect(ids(result?.panes.right)).toEqual(['b'])
    expect(ids(result?.panes.third)).toEqual(['c'])
  })
  it('dockTab: 하나뿐인 탭을 제 패널에서 갈라내기·넷 일 때는 null', () => {
    expect(dockTab({ ...panes, left: state('a') }, 'cols2', 'a', 'left', 'right')).toBeNull()
    const four: PanesState = { left: state('a', 'e'), right: state('b'), third: state('c'), fourth: state('d') }
    expect(dockTab(four, 'grid4', 'a', 'right', 'left')).toBeNull()
  })
})

describe('collapseEmptyPane', () => {
  const panes: PanesState = { left: emptyTabs, right: state('b'), third: state('c'), fourth: emptyTabs }
  it('비어 버린 패널을 닫고 남은 패널이 그 자리를 채운다', () => {
    const result = collapseEmptyPane(panes, 'cols3', 'left')
    expect(result?.layout).toBe('cols2')
    expect(ids(result?.panes.left)).toEqual(['b'])
    expect(ids(result?.panes.right)).toEqual(['c'])
    expect(result?.remap('right')).toBe('left')
    expect(result?.remap('third')).toBe('right')
  })
  it('탭이 남아 있거나 칸이 하나뿐이면 null', () => {
    expect(collapseEmptyPane(panes, 'cols3', 'right')).toBeNull()
    expect(collapseEmptyPane({ ...panes, left: emptyTabs }, 'single', 'left')).toBeNull()
  })
  it('dockTab 은 탭이 떠난 패널의 새 이름을 알려 준다', () => {
    const base: PanesState = { left: state('a'), right: state('b', 'c'), third: emptyTabs, fourth: emptyTabs }
    const docked = dockTab(base, 'cols2', 'a', 'right', 'left')
    expect(docked?.layout).toBe('cols3')
    expect(docked?.sourcePane).toBe('left')
    const collapsed = collapseEmptyPane(docked!.panes, docked!.layout, docked!.sourcePane)
    expect(collapsed?.layout).toBe('cols2')
    expect(ids(collapsed?.panes.left)).toEqual(['a'])
    expect(ids(collapsed?.panes.right)).toEqual(['b', 'c'])
    const after = dockTab(base, 'cols2', 'a', 'right', 'bottom')
    expect(after?.layout).toBe('left1-right2')
    expect(after?.sourcePane).toBe('left')
    const closed = collapseEmptyPane(after!.panes, after!.layout, after!.sourcePane)
    expect(closed?.layout).toBe('rows2')
    expect(ids(closed?.panes.left)).toEqual(['b', 'c'])
    expect(ids(closed?.panes.right)).toEqual(['a'])
    expect(closed?.remap(after!.newPane)).toBe('right')
  })
})
