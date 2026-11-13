import { describe, expect, it } from 'vitest'
import { MAX_PANES, layoutForCount, layoutForLegacyId, leaves, paneCount, paneNode, shapeOf } from '../../core/layoutTree'
import { PDF_SPLIT_LAYOUTS } from '../../core/pdfSplit'
import { applyLegacyLayout, moveTabToNewPane, paneByIndex, selectLayout, setPaneCountTree, splitPane, swapSplitSides } from './paneLayoutOps'
import type { TreeWorkspace } from './tabDock'
import type { Tab } from './tabs'

const tab = (id: string): Tab => ({ id, title: id, kind: 'pdf' })
const state = (...ids: string[]) => ({ tabs: ids.map(tab), activeId: ids[0] ?? null })
const ids = (value: { tabs: readonly Tab[] } | undefined) => value?.tabs.map((item) => item.id)

const cols2 = (): TreeWorkspace => ({
  panes: { a: state('a1', 'a2'), b: state('b1') },
  channels: { a: 'green', b: 'orange' },
  layout: layoutForLegacyId('cols2', ['a', 'b']),
})

describe('applyLegacyLayout — 「창 나누기」 목록의 예전 배치', () => {
  const shapes: Record<string, string> = {
    single: 'P', cols2: 'h(P,P)', rows2: 'v(P,P)', cols3: 'h(P,h(P,P))', 'top2-bottom1': 'v(h(P,P),P)',
    'top1-bottom2': 'v(P,h(P,P))', 'left1-right2': 'h(P,v(P,P))', 'left2-right1': 'h(v(P,P),P)', grid4: 'v(h(P,P),h(P,P))',
  }

  it.each(PDF_SPLIT_LAYOUTS.map((layout) => layout.id))('%s: 같은 모양의 트리가 되고 칸 차례대로 지금 칸을 이어 쓰며 탭을 잃지 않는다', (id) => {
    const result = applyLegacyLayout(cols2(), id)
    expect(shapeOf(result.layout)).toBe(shapes[id])
    const order = leaves(result.layout)
    expect(Object.keys(result.panes).sort()).toEqual([...order].sort())
    expect(order.slice(0, Math.min(2, order.length))[0]).toBe('a')
    const all = order.flatMap((pane) => ids(result.panes[pane]) ?? []).sort()
    expect(all).toEqual(['a1', 'a2', 'b1'])
  })

  it('칸을 늘리면 빈 칸이 더해지고 마지막 칸의 채널을 받는다', () => {
    const result = applyLegacyLayout(cols2(), 'grid4')
    const order = leaves(result.layout)
    expect(order.slice(0, 2)).toEqual(['a', 'b'])
    expect(ids(result.panes[order[2]!])).toEqual([])
    expect(result.channels[order[2]!]).toBe('orange')
    expect(result.channels[order[3]!]).toBe('orange')
  })

  it('칸을 줄이면 남는 칸의 탭이 마지막 칸 뒤에 합쳐지고 채널은 지워진다', () => {
    const result = applyLegacyLayout(cols2(), 'single')
    expect(shapeOf(result.layout)).toBe('P')
    expect(ids(result.panes.a)).toEqual(['a1', 'a2', 'b1'])
    expect(result.panes.b).toBeUndefined()
    expect(result.channels).toEqual({ a: 'green' })
    expect(result.kept).toEqual(['a'])
  })
})

describe('splitPane (split-window)', () => {
  it('새 빈 칸은 지금 칸의 색을 받고 방향대로 놓인다', () => {
    const right = splitPane(cols2(), 'a', 'h')
    if ('refused' in right) throw new Error('나뉘어야 한다')
    expect(leaves(right.layout)).toEqual(['a', right.newPane, 'b'])
    expect(right.channels[right.newPane]).toBe('green')
    expect(ids(right.panes[right.newPane])).toEqual([])
    const above = splitPane(cols2(), 'b', 'v', undefined, true)
    if ('refused' in above) throw new Error('나뉘어야 한다')
    expect(shapeOf(above.layout)).toBe('h(P,v(P,P))')
    expect(leaves(above.layout)).toEqual(['a', above.newPane, 'b'])
  })

  it('칸이 8개이거나 너무 작으면 { refused }', () => {
    const names = Array.from({ length: MAX_PANES }, (_, index) => `p${index}`)
    const full: TreeWorkspace = { panes: Object.fromEntries(names.map((name) => [name, state(name)])), channels: {}, layout: layoutForCount(MAX_PANES, names) }
    expect(splitPane(full, 'p0', 'h')).toEqual({ refused: 'max' })
    expect(splitPane(cols2(), 'a', 'h', () => ({ width: 400, height: 900 }))).toEqual({ refused: 'small' })
    expect(splitPane(cols2(), 'a', 'v', () => ({ width: 400, height: 900 }))).toMatchObject({ newPane: expect.any(String) })
  })
})

describe('moveTabToNewPane — 「새 오른쪽 칸으로 이동」', () => {
  it('탭을 새 칸에 옮긴다(하나뿐인 탭도: 원래 칸은 빈 채 남는다). 미리보기는 고정된다', () => {
    const input: TreeWorkspace = { ...cols2(), panes: { a: { tabs: [{ ...tab('p'), preview: true }], activeId: 'p' }, b: state('b1') } }
    const result = moveTabToNewPane(input, 'p', 'a', 'right')
    if (result === null || 'refused' in result) throw new Error('옮겨져야 한다')
    expect(leaves(result.layout)).toEqual(['a', result.newPane, 'b'])
    expect(ids(result.panes.a)).toEqual([])
    expect(result.panes[result.newPane]!.tabs[0]).toEqual({ id: 'p', title: 'p', kind: 'pdf' })
    expect(result.channels[result.newPane]).toBe('green')
  })

  it('없는 탭이면 null, 못 나누면 { refused }', () => {
    expect(moveTabToNewPane(cols2(), 'zzz', 'a', 'right')).toBeNull()
    expect(moveTabToNewPane(cols2(), 'a1', 'a', 'right', () => ({ width: 300, height: 900 }))).toEqual({ refused: 'small' })
  })
})

describe('setPaneCountTree — 칸 수만 정하기(MCP·Ctrl+\\)', () => {
  it('늘리면 마지막 칸을 좌우로 나눈다. 좌우 한 줄이면 같은 폭으로 다시 짠다', () => {
    const one: TreeWorkspace = { panes: { a: state('a1') }, channels: { a: 'green' }, layout: paneNode('a') }
    const three = setPaneCountTree(one, 3)
    expect(paneCount(three.layout)).toBe(3)
    expect(shapeOf(three.layout)).toBe('h(P,h(P,P))')
    expect(three.refused).toBeNull()
    expect(leaves(three.layout)[0]).toBe('a')
    for (const pane of leaves(three.layout)) expect(three.channels[pane]).toBe('green')
  })

  it('줄이면 뒤 칸부터 닫고 탭은 남는 마지막 칸 뒤에 합친다', () => {
    const three = setPaneCountTree(setPaneCountTree({ panes: { a: state('a1') }, channels: {}, layout: paneNode('a') }, 3), 3)
    const [a, b, c] = leaves(three.layout) as [string, string, string]
    const filled: TreeWorkspace = { ...three, panes: { [a]: state('x'), [b]: state('y'), [c]: state('z') } }
    const two = setPaneCountTree(filled, 2)
    expect(leaves(two.layout)).toEqual([a, b])
    expect(ids(two.panes[b])).toEqual(['y', 'z'])
    const one = setPaneCountTree(two, 1)
    expect(ids(one.panes[a])).toEqual(['x', 'y', 'z'])
  })

  it('상한(8)을 넘기지 않고, 못 늘리면 refused 가 붙는다', () => {
    const one: TreeWorkspace = { panes: { a: state('a1') }, channels: {}, layout: paneNode('a') }
    expect(paneCount(setPaneCountTree(one, 20).layout)).toBe(MAX_PANES)
    const tiny = setPaneCountTree(one, 4, () => ({ width: 300, height: 900 }))
    expect(paneCount(tiny.layout)).toBe(1)
    expect(tiny.refused).toBe('small')
  })

  it('같은 수면 그대로', () => {
    const input = cols2()
    const result = setPaneCountTree(input, 2)
    expect(result.layout).toBe(input.layout)
  })
})

describe('selectLayout·swapSplitSides·paneByIndex', () => {
  it('select-layout 은 칸 차례를 지키며 트리를 다시 짠다', () => {
    const grid: TreeWorkspace = { panes: {}, channels: {}, layout: layoutForLegacyId('grid4', ['a', 'b', 'c', 'd']) }
    const tiled = selectLayout(grid, 'main-vertical')
    expect(leaves(tiled.layout)).toEqual(['a', 'b', 'c', 'd'])
    expect(shapeOf(tiled.layout)).toBe('h(P,v(P,v(P,P)))')
    const single: TreeWorkspace = { panes: {}, channels: {}, layout: paneNode('a') }
    expect(selectLayout(single, 'tiled')).toBe(single)
  })

  it('swapSplitSides 는 나누기의 양쪽을 맞바꾸고 칸의 탭·색은 칸을 따라간다', () => {
    const input = cols2()
    const split = input.layout.kind === 'split' ? input.layout.id : ''
    const swapped = swapSplitSides(input, split)
    expect(leaves(swapped.layout)).toEqual(['b', 'a'])
    expect(swapped.panes).toBe(input.panes)
    expect(swapped.channels).toBe(input.channels)
    expect(swapSplitSides(input, 'nope')).toBe(input)
  })

  it('paneByIndex 는 칸 번호로 칸을 찾는다', () => {
    const { layout } = cols2()
    expect(paneByIndex(layout, 0)).toBe('a')
    expect(paneByIndex(layout, 1)).toBe('b')
    expect(paneByIndex(layout, 2)).toBeNull()
  })
})
