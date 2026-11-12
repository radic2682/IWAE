import { describe, expect, it } from 'vitest'
import { MAX_PANES, layoutForCount, layoutForLegacyId, leaves, paneCount, paneNode, shapeOf } from '../core/layoutTree'
import { allowedDockEdges, closePaneTree, collapseEmptyPane, dockRefusal, dockTab, dropTabAt, dockZoneAt, dockZoneBox, edgeSplit, insertionIndexAt, insertTabAt, moveTabToPaneAt, openTabBeside, type TreeWorkspace } from './tabDock'
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

describe('탭 옮기기', () => {
  it('insertTabAt 은 원하는 자리에 넣고 활성화한다', () => {
    const next = insertTabAt(state('a', 'b', 'c'), tab('x'), 1)
    expect(ids(next)).toEqual(['a', 'x', 'b', 'c'])
    expect(next.activeId).toBe('x')
    expect(ids(insertTabAt(state('a', 'b'), tab('a'), 5))).toEqual(['b', 'a'])
  })
  const panes: PanesState = { left: state('a', 'b'), right: state('c') }
  it('moveTabToPaneAt: 다른 패널의 자리로(가운데에 놓기)', () => {
    const next = moveTabToPaneAt(panes, 'a', 'right', 0)
    expect(ids(next.left)).toEqual(['b'])
    expect(ids(next.right)).toEqual(['a', 'c'])
    expect(next.right!.activeId).toBe('a')
  })
  it('moveTabToPaneAt: 같은 패널이면 순서만', () => {
    expect(ids(moveTabToPaneAt(panes, 'a', 'left', 1).left)).toEqual(['b', 'a'])
  })
})

describe('edgeSplit·dockRefusal', () => {
  it('가장자리는 나누는 방향과 새 칸의 쪽을 정한다', () => {
    expect(edgeSplit('left')).toEqual({ dir: 'h', before: true })
    expect(edgeSplit('right')).toEqual({ dir: 'h', before: false })
    expect(edgeSplit('top')).toEqual({ dir: 'v', before: true })
    expect(edgeSplit('bottom')).toEqual({ dir: 'v', before: false })
  })
  it('칸 크기를 알면 반쪽이 최소 크기보다 작아지는 가장자리를 막는다', () => {
    const layout = paneNode('a')
    const sizeOf = () => ({ width: 300, height: 500 })
    expect(dockRefusal(layout, 'a', 'right', sizeOf)).toBe('small')
    expect(dockRefusal(layout, 'a', 'bottom', sizeOf)).toBeNull()
  })
})

describe('dockTab: 가장자리마다 칸을 나눠 새 칸에 넣는다', () => {
  const base = (): TreeWorkspace => ({ panes: { left: state('a', 'b'), right: state('c', 'd') }, channels: { left: 'green', right: 'orange' }, layout: layoutForLegacyId('cols2', ['left', 'right']) })
  const docked = (edge: 'left' | 'right' | 'top' | 'bottom', target = 'right', id = 'a') => {
    const result = dockTab(base(), id, target, edge)
    if (result === null || 'refused' in result) throw new Error('나뉘어야 한다')
    return result
  }

  it.each([
    ['right', 'h(P,h(P,P))'],
    ['left', 'h(P,h(P,P))'],
    ['bottom', 'h(P,v(P,P))'],
    ['top', 'h(P,v(P,P))'],
  ] as const)('%s: 칸이 하나 늘고 모양은 %s', (edge, shape) => {
    const result = docked(edge)
    expect(shapeOf(result.layout)).toBe(shape)
    expect(paneCount(result.layout)).toBe(3)
    expect(ids(result.panes[result.newPane])).toEqual(['a'])
    expect(ids(result.panes.left)).toEqual(['b'])
    expect(ids(result.panes.right)).toEqual(['c', 'd'])
  })

  it('새 칸의 자리: 오른쪽·아래는 대상 칸 뒤, 왼쪽·위는 대상 칸 앞', () => {
    const right = docked('right')
    expect(leaves(right.layout)).toEqual(['left', 'right', right.newPane])
    const left = docked('left')
    expect(leaves(left.layout)).toEqual(['left', left.newPane, 'right'])
    const top = docked('top', 'left', 'c')
    expect(leaves(top.layout)).toEqual([top.newPane, 'left', 'right'])
  })

  it('새 칸은 탭이 떠난 칸의 채널을 받는다(대상 칸의 채널이 아니다)', () => {
    const result = docked('left')
    expect(result.channels[result.newPane]).toBe('green')
    expect(result.channels.right).toBe('orange')
  })

  it('하나뿐인 탭을 다른 칸 가장자리에 놓으면 비어 버린 원래 칸이 닫힌다', () => {
    const input: TreeWorkspace = { ...base(), panes: { left: state('a'), right: state('c', 'd') } }
    const result = dockTab(input, 'a', 'right', 'bottom')
    if (result === null || 'refused' in result) throw new Error('나뉘어야 한다')
    expect(result.collapsed).toBe(true)
    expect(result.sourcePane).toBe('left')
    expect(result.panes.left).toBeUndefined()
    expect(leaves(result.layout)).toEqual(['right', result.newPane])
    expect(shapeOf(result.layout)).toBe('v(P,P)')
    expect(result.channels.left).toBeUndefined()
    expect(result.channels[result.newPane]).toBe('green')
  })

  it('미리보기 탭은 새 칸에서 고정된다', () => {
    const input: TreeWorkspace = { ...base(), panes: { left: { tabs: [{ ...tab('p'), preview: true }, tab('b')], activeId: 'p' }, right: state('c') } }
    const result = dockTab(input, 'p', 'right', 'bottom')
    if (result === null || 'refused' in result) throw new Error('나뉘어야 한다')
    expect(result.panes[result.newPane]!.tabs[0]!.preview).toBeUndefined()
  })

  it('하나뿐인 탭을 제 칸에서 갈라내려 하거나 없는 탭·칸이면 null', () => {
    const input: TreeWorkspace = { ...base(), panes: { left: state('a'), right: state('c', 'd') } }
    expect(dockTab(input, 'a', 'left', 'right')).toBeNull()
    expect(dockTab(input, 'zzz', 'right', 'right')).toBeNull()
    expect(dockTab(input, 'c', 'nope', 'right')).toBeNull()
  })

  it('같은 칸의 가장자리에 놓으면(탭이 둘 이상) 그 칸을 나눈다', () => {
    const result = docked('right', 'left', 'a')
    expect(leaves(result.layout)).toEqual(['left', result.newPane, 'right'])
    expect(ids(result.panes.left)).toEqual(['b'])
    expect(result.collapsed).toBe(false)
  })

  it('칸이 8개면 어느 가장자리든 { refused: max }', () => {
    const names = Array.from({ length: MAX_PANES }, (_, index) => `p${index}`)
    const full: TreeWorkspace = {
      layout: layoutForCount(MAX_PANES, names),
      panes: Object.fromEntries(names.map((name, index) => [name, state(`t${index}a`, `t${index}b`)])),
      channels: {},
    }
    for (const edge of ['left', 'right', 'top', 'bottom'] as const) expect(dockTab(full, 't0a', 'p3', edge)).toEqual({ refused: 'max' })
  })

  it('칸이 8개여도 하나뿐인 탭을 다른 칸으로 옮겨 원래 칸이 닫히면 나눌 수 있다', () => {
    const names = Array.from({ length: MAX_PANES }, (_, index) => `p${index}`)
    const full: TreeWorkspace = {
      layout: layoutForCount(MAX_PANES, names),
      panes: Object.fromEntries(names.map((name, index) => [name, state(`t${index}`)])),
      channels: {},
    }
    const result = dockTab(full, 't0', 'p3', 'bottom')
    if (result === null || 'refused' in result) throw new Error('나뉘어야 한다')
    expect(paneCount(result.layout)).toBe(MAX_PANES)
  })

  it('칸 크기를 알면 너무 작아지는 방향은 { refused: small }, 다른 방향은 나뉜다', () => {
    const sizeOf = () => ({ width: 300, height: 500 })
    expect(dockTab(base(), 'a', 'right', 'right', sizeOf)).toEqual({ refused: 'small' })
    expect(dockTab(base(), 'a', 'right', 'left', sizeOf)).toEqual({ refused: 'small' })
    const down = dockTab(base(), 'a', 'right', 'bottom', sizeOf)
    expect(down !== null && !('refused' in down)).toBe(true)
  })
})

describe('openTabBeside', () => {
  const panes: PanesState = { left: state('a'), right: state('b') }
  const layout = layoutForLegacyId('cols2', ['left', 'right'])

  it('보낸 칸의 오른쪽에 새 칸을 만들고 보낸 칸의 채널을 준다', () => {
    const result = openTabBeside(panes, layout, 'left', tab('x'), { left: 'orange', right: 'blue' })
    if (result === null) throw new Error('나뉘어야 한다')
    expect(leaves(result.layout)).toEqual(['left', result.newPane, 'right'])
    expect(ids(result.panes[result.newPane])).toEqual(['x'])
    expect(result.channels[result.newPane]).toBe('orange')
  })

  it('오른쪽이 너무 좁으면 아래로, 그것도 안 되면 왼쪽·위를 차례로 본다', () => {
    const narrowTall = () => ({ width: 300, height: 800 })
    const down = openTabBeside(panes, layout, 'left', tab('x'), {}, narrowTall)
    expect(down && shapeOf(down.layout)).toBe('h(v(P,P),P)')
    const tiny = () => ({ width: 300, height: 300 })
    expect(openTabBeside(panes, layout, 'left', tab('x'), {}, tiny)).toBeNull()
  })

  it('칸이 8개면 null', () => {
    const names = Array.from({ length: MAX_PANES }, (_, index) => `p${index}`)
    const full = Object.fromEntries(names.map((name) => [name, state(name)]))
    expect(openTabBeside(full, layoutForCount(MAX_PANES, names), 'p0', tab('x'), {})).toBeNull()
  })

  it('없는 칸이면 null', () => {
    expect(openTabBeside(panes, layout, 'zzz', tab('x'), {})).toBeNull()
  })
})

describe('collapseEmptyPane', () => {
  const input = (): TreeWorkspace => ({ panes: { a: emptyTabs, b: state('b'), c: state('c') }, channels: { a: 'green', b: 'orange', c: null }, layout: layoutForLegacyId('cols3', ['a', 'b', 'c']) })

  it('비어 버린 패널의 칸을 빼고 남은 칸이 그 자리를 채운다(형제가 부모 자리를 차지한다)', () => {
    const result = collapseEmptyPane(input(), 'a')
    expect(result && leaves(result.layout)).toEqual(['b', 'c'])
    expect(result && shapeOf(result.layout)).toBe('h(P,P)')
    expect(result?.panes.a).toBeUndefined()
    expect(result?.channels).toEqual({ b: 'orange', c: null })
  })

  it('가운데 칸을 빼면 그 형제가 부모 자리를 차지한다', () => {
    const middle: TreeWorkspace = { ...input(), panes: { a: state('a'), b: emptyTabs, c: state('c') } }
    const result = collapseEmptyPane(middle, 'b')
    expect(result && leaves(result.layout)).toEqual(['a', 'c'])
  })

  it('탭이 남아 있거나 칸이 하나뿐이거나 없는 칸이면 null', () => {
    expect(collapseEmptyPane(input(), 'b')).toBeNull()
    expect(collapseEmptyPane({ panes: { a: emptyTabs }, channels: {}, layout: paneNode('a') }, 'a')).toBeNull()
    expect(collapseEmptyPane(input(), 'zzz')).toBeNull()
  })
})

describe('closePaneTree (kill-pane)', () => {
  const input = (): TreeWorkspace => ({ panes: { a: state('a'), b: state('b'), c: state('c') }, channels: { a: 'blue', b: 'green', c: 'orange' }, layout: layoutForLegacyId('cols3', ['a', 'b', 'c']) })

  it('칸을 닫고 그 탭을 다음 칸 뒤에 합친다. 닫은 칸의 채널은 사라진다', () => {
    const result = closePaneTree(input(), 'b')
    expect(result?.landed).toBe('c')
    expect(result && leaves(result.layout)).toEqual(['a', 'c'])
    expect(ids(result?.panes.c)).toEqual(['c', 'b'])
    expect(result?.channels).toEqual({ a: 'blue', c: 'orange' })
  })

  it('맨 뒤 칸을 닫으면 앞 칸으로 합친다', () => {
    const result = closePaneTree(input(), 'c')
    expect(result?.landed).toBe('b')
    expect(ids(result?.panes.b)).toEqual(['b', 'c'])
  })

  it('하나뿐인 칸이거나 없는 칸이면 null', () => {
    expect(closePaneTree({ panes: { a: state('a') }, channels: {}, layout: paneNode('a') }, 'a')).toBeNull()
    expect(closePaneTree(input(), 'zzz')).toBeNull()
  })
})

describe('allowedDockEdges: 미리보기는 놓으면 꼭 되는 자리만', () => {
  const two = layoutForLegacyId('cols2', ['left', 'right'])
  it('크기를 모르면 칸 상한만 본다', () => {
    expect(allowedDockEdges(two, 'right', null)).toEqual(['left', 'right', 'top', 'bottom'])
  })
  it('너비 절반이 240 미만이면 좌우는 뺀다(470px 칸: 235)', () => {
    expect(allowedDockEdges(two, 'left', null, () => ({ width: 470, height: 958 }))).toEqual(['top', 'bottom'])
    expect(allowedDockEdges(two, 'left', null, () => ({ width: 480, height: 958 }))).toEqual(['left', 'right', 'top', 'bottom'])
  })
  it('높이 절반이 160 미만이면 위아래는 뺀다', () => {
    expect(allowedDockEdges(two, 'left', null, () => ({ width: 900, height: 300 }))).toEqual(['left', 'right'])
  })
  it('칸이 상한이면 아무 쪽도 없다(가운데만)', () => {
    const full = layoutForCount(MAX_PANES, Array.from({ length: MAX_PANES }, (_, index) => `p${index}`))
    expect(allowedDockEdges(full, 'p0', null)).toEqual([])
  })
  it('상한이어도 이 끌기로 닫힐 칸이 있으면 닫힌 뒤로 센다', () => {
    const names = Array.from({ length: MAX_PANES }, (_, index) => `p${index}`)
    const full = layoutForCount(MAX_PANES, names)
    expect(allowedDockEdges(full, 'p0', 'p1')).toEqual(['left', 'right', 'top', 'bottom'])
  })
})

describe('dropTabAt: 왼쪽 바에서 끌어 온 탭을 연다', () => {
  const base = (): TreeWorkspace => ({ panes: { left: state('a', 'b'), right: state('c'), empty: emptyTabs }, channels: {}, layout: layoutForLegacyId('cols3', ['left', 'right', 'empty']) })
  const landed = (result: ReturnType<typeof dropTabAt>) => {
    if (result === null || 'refused' in result) throw new Error('열려야 한다')
    return result
  }
  const fresh: Tab = { id: 'n', title: 'n', kind: 'markdown', preview: true }

  it('가운데: 그 칸 맨 뒤에 보통 탭(미리보기 아님)으로 열리고 활성이 된다', () => {
    const result = landed(dropTabAt(base(), fresh, { kind: 'body', pane: 'left', zone: 'center' }))
    expect(ids(result.panes.left)).toEqual(['a', 'b', 'n'])
    expect(result.panes.left!.activeId).toBe('n')
    expect(result.panes.left!.tabs.at(-1)!.preview).toBeUndefined()
    expect(result.landed).toBe('left')
    expect(result.created).toBeNull()
  })
  it('빈 칸 가운데: 그 칸에 열린다', () => {
    const result = landed(dropTabAt(base(), fresh, { kind: 'body', pane: 'empty', zone: 'center' }))
    expect(ids(result.panes.empty)).toEqual(['n'])
  })
  it('탭 줄: 놓은 자리(index)에 끼운다', () => {
    const result = landed(dropTabAt(base(), fresh, { kind: 'strip', pane: 'left', index: 1 }))
    expect(ids(result.panes.left)).toEqual(['a', 'n', 'b'])
  })
  it('가장자리: 그쪽을 갈라 새 칸에 연다(칸이 하나 는다)', () => {
    const result = landed(dropTabAt(base(), fresh, { kind: 'body', pane: 'right', zone: 'bottom' }))
    expect(paneCount(result.layout)).toBe(4)
    expect(result.created).not.toBeNull()
    expect(ids(result.panes[result.created!])).toEqual(['n'])
    expect(result.landed).toBe(result.created)
    expect(ids(result.panes.right)).toEqual(['c'])
  })
  it('가장자리가 못 나뉘면 { refused }', () => {
    const names = Array.from({ length: MAX_PANES }, (_, index) => `p${index}`)
    const panes: PanesState = Object.fromEntries(names.map((name) => [name, state(`t-${name}`)]))
    const input: TreeWorkspace = { panes, channels: {}, layout: layoutForCount(MAX_PANES, names) }
    expect(dropTabAt(input, fresh, { kind: 'body', pane: 'p0', zone: 'left' })).toEqual({ refused: 'max' })
  })
  it('이미 다른 칸에 열린 탭이면 그 탭을 옮긴다(복제하지 않는다), 비면 그 칸은 닫힌다', () => {
    const result = landed(dropTabAt(base(), tab('c'), { kind: 'body', pane: 'left', zone: 'center' }))
    expect(ids(result.panes.left)).toEqual(['a', 'b', 'c'])
    expect(result.panes.right).toBeUndefined()
    expect(paneCount(result.layout)).toBe(2)
  })
  it('같은 칸에 이미 열린 탭은 활성만 바뀐다', () => {
    const result = landed(dropTabAt(base(), tab('a'), { kind: 'body', pane: 'left', zone: 'center' }))
    expect(ids(result.panes.left)).toEqual(['b', 'a'])
    expect(result.panes.left!.activeId).toBe('a')
  })
  it('없는 칸이면 null', () => {
    expect(dropTabAt(base(), fresh, { kind: 'body', pane: 'nope', zone: 'center' })).toBeNull()
  })
})
