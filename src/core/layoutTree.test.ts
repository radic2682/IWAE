import { describe, expect, it } from 'vitest'
import {
  MAX_PANES,
  MIN_PANE_HEIGHT,
  MIN_PANE_WIDTH,
  applyRatios,
  clampRatioForSize,
  findNode,
  findParent,
  hasPane,
  indexOfPane,
  layoutForCount,
  layoutForLegacyId,
  layoutRects,
  leaves,
  legacyPaneCount,
  matchLegacyLayout,
  minSize,
  newPaneId,
  newSplitId,
  paneAtIndex,
  paneCount,
  paneNode,
  parseLayoutTree,
  parseRelayoutKind,
  relayout,
  removeLeaf,
  renamePane,
  replaceNode,
  setRatio,
  shapeOf,
  splitLeaf,
  splitRefusal,
  swapChildren,
  swapLeaves,
  type LayoutNode,
  type RelayoutKind,
} from './layoutTree'
import type { PdfSplitLayoutId } from './pdfSplit'

const P = paneNode
const split = (id: string, dir: 'h' | 'v', a: LayoutNode, b: LayoutNode, ratio = 0.5): LayoutNode => ({ kind: 'split', id, dir, ratio, a, b })
/** h(a, v(b, c)) */
const sample = (): LayoutNode => split('s1', 'h', P('a'), split('s2', 'v', P('b'), P('c')))

describe('잎 세기·찾기', () => {
  it('leaves 는 왼쪽 위부터 차례로, paneCount·hasPane·paneAtIndex·indexOfPane 가 같은 차례를 쓴다', () => {
    const tree = sample()
    expect(leaves(tree)).toEqual(['a', 'b', 'c'])
    expect(paneCount(tree)).toBe(3)
    expect(hasPane(tree, 'b')).toBe(true)
    expect(hasPane(tree, 'z')).toBe(false)
    expect(paneAtIndex(tree, 2)).toBe('c')
    expect(paneAtIndex(tree, 3)).toBeNull()
    expect(indexOfPane(tree, 'c')).toBe(2)
    expect(indexOfPane(tree, 'z')).toBe(-1)
    expect(leaves(P('only'))).toEqual(['only'])
  })

  it('findNode·findParent 는 칸 id 와 나누기 id 를 모두 받는다', () => {
    const tree = sample()
    expect(findNode(tree, 'b')).toEqual(P('b'))
    expect(findNode(tree, 's2')?.kind).toBe('split')
    expect(findNode(tree, 'nope')).toBeNull()
    expect(findParent(tree, 'a')).toMatchObject({ side: 'a', parent: { id: 's1' } })
    expect(findParent(tree, 'c')).toMatchObject({ side: 'b', parent: { id: 's2' } })
    expect(findParent(tree, 's2')).toMatchObject({ side: 'b', parent: { id: 's1' } })
    expect(findParent(tree, 's1')).toBeNull()
    expect(findParent(P('only'), 'only')).toBeNull()
  })
})

describe('바꾸기·빼기·나누기', () => {
  it('replaceNode 는 그 마디만 바꾸고, 없는 id 면 같은 객체를 돌려준다', () => {
    const tree = sample()
    const next = replaceNode(tree, 'b', P('x'))
    expect(leaves(next)).toEqual(['a', 'x', 'c'])
    expect(replaceNode(tree, 'nope', P('x'))).toBe(tree)
    expect(replaceNode(tree, 's2', P('y'))).toEqual(split('s1', 'h', P('a'), P('y')))
  })

  it('removeLeaf 는 형제가 부모 자리를 차지하게 한다', () => {
    const tree = sample()
    expect(removeLeaf(tree, 'a')).toEqual(split('s2', 'v', P('b'), P('c')))
    expect(removeLeaf(tree, 'b')).toEqual(split('s1', 'h', P('a'), P('c')))
    expect(removeLeaf(tree, 'c')).toEqual(split('s1', 'h', P('a'), P('b')))
  })

  it('removeLeaf: 하나뿐인 칸·없는 칸은 null', () => {
    expect(removeLeaf(P('only'), 'only')).toBeNull()
    expect(removeLeaf(sample(), 'zzz')).toBeNull()
  })

  it('splitLeaf: 새 칸이 뒤(오른쪽·아래)에 놓이고, before 면 앞에 놓인다', () => {
    const after = splitLeaf(P('a'), 'a', 'h', 'n', { splitId: 'sx' })
    expect(after).toEqual(split('sx', 'h', P('a'), P('n')))
    const before = splitLeaf(P('a'), 'a', 'v', 'n', { before: true, splitId: 'sx', ratio: 0.3 })
    expect(before).toEqual(split('sx', 'v', P('n'), P('a'), 0.3))
    expect(leaves(splitLeaf(sample(), 'b', 'h', 'n'))).toEqual(['a', 'b', 'n', 'c'])
  })

  it('splitLeaf: 없는 칸이면 같은 객체, 나누기 id 는 겹치지 않는다', () => {
    const tree = sample()
    expect(splitLeaf(tree, 'nope', 'h', 'n')).toBe(tree)
    const twice = splitLeaf(splitLeaf(tree, 'a', 'h', 'n1'), 'n1', 'v', 'n2')
    const ids: string[] = []
    const walk = (node: LayoutNode) => { if (node.kind === 'split') { ids.push(node.id); walk(node.a); walk(node.b) } }
    walk(twice)
    expect(new Set(ids).size).toBe(ids.length)
    expect(newSplitId(tree)).not.toBe('s1')
  })

  it('newPaneId 는 쓴 id 를 건너뛰고 닫힌 칸의 id 를 다시 내지 않는다', () => {
    const first = newPaneId()
    const second = newPaneId([first])
    expect(second).not.toBe(first)
    expect(newPaneId([first, second])).not.toBe(first)
  })

  it('setRatio 는 그 나누기만 바꾸고 0.05–0.95 로 가둔다', () => {
    const tree = sample()
    const next = setRatio(tree, 's2', 0.7)
    expect(findNode(next, 's2')).toMatchObject({ ratio: 0.7 })
    expect(findNode(next, 's1')).toMatchObject({ ratio: 0.5 })
    expect(findNode(setRatio(tree, 's1', 5), 's1')).toMatchObject({ ratio: 0.95 })
    expect(findNode(setRatio(tree, 's1', -1), 's1')).toMatchObject({ ratio: 0.05 })
    expect(setRatio(tree, 's1', 0.5)).toBe(tree)
    expect(setRatio(tree, 'nope', 0.2)).toEqual(tree)
  })

  it('applyRatios 는 여러 나누기를 한 번에 바꾼다', () => {
    const next = applyRatios(sample(), { s1: 0.25, s2: 0.75 })
    expect(findNode(next, 's1')).toMatchObject({ ratio: 0.25 })
    expect(findNode(next, 's2')).toMatchObject({ ratio: 0.75 })
    const tree = sample()
    expect(applyRatios(tree, {})).toBe(tree)
  })

  it('swapLeaves 는 두 칸의 자리를 맞바꾼다', () => {
    const tree = sample()
    expect(leaves(swapLeaves(tree, 'a', 'c'))).toEqual(['c', 'b', 'a'])
    expect(swapLeaves(tree, 'a', 'a')).toBe(tree)
    expect(swapLeaves(tree, 'a', 'zzz')).toBe(tree)
  })

  it('swapChildren 은 나누기 하나의 양쪽을 맞바꾸고 비율을 뒤집는다', () => {
    const tree = split('s1', 'h', P('a'), P('b'), 0.3)
    expect(swapChildren(tree, 's1')).toEqual(split('s1', 'h', P('b'), P('a'), 0.7))
    expect(leaves(swapChildren(sample(), 's2'))).toEqual(['a', 'c', 'b'])
    expect(swapChildren(P('a'), 's1')).toEqual(P('a'))
  })

  it('renamePane 은 칸 id 를 바꾼다', () => {
    expect(leaves(renamePane(sample(), 'b', 'q'))).toEqual(['a', 'q', 'c'])
    const tree = sample()
    expect(renamePane(tree, 'nope', 'q')).toBe(tree)
  })
})

describe('relayout (select-layout)', () => {
  const five = () => leaves(layoutForCount(5, ['a', 'b', 'c', 'd', 'e']))
  const messy = (): LayoutNode => split('x1', 'v', split('x2', 'h', P('a'), P('b')), split('x3', 'v', P('c'), split('x4', 'h', P('d'), P('e'))))

  it('모든 종류가 칸 차례를 지킨다', () => {
    expect(five()).toEqual(['a', 'b', 'c', 'd', 'e'])
    const kinds: RelayoutKind[] = ['even-horizontal', 'even-vertical', 'main-vertical', 'main-horizontal', 'tiled']
    for (const kind of kinds) {
      expect(leaves(relayout(messy(), kind))).toEqual(leaves(messy()))
      expect(paneCount(relayout(messy(), kind))).toBe(5)
    }
  })

  it('even-horizontal: 좌우로 같은 폭', () => {
    const tree = relayout(layoutForCount(3, ['a', 'b', 'c']), 'even-horizontal')
    expect(shapeOf(tree)).toBe('h(P,h(P,P))')
    const { panes } = layoutRects(tree)
    for (const id of ['a', 'b', 'c']) {
      expect(panes.get(id)!.w).toBeCloseTo(1 / 3)
      expect(panes.get(id)!.h).toBeCloseTo(1)
    }
  })

  it('even-vertical: 위아래로 같은 높이', () => {
    const tree = relayout(layoutForCount(4, ['a', 'b', 'c', 'd']), 'even-vertical')
    expect(shapeOf(tree)).toBe('v(P,v(P,v(P,P)))')
    for (const rect of layoutRects(tree).panes.values()) {
      expect(rect.h).toBeCloseTo(1 / 4)
      expect(rect.w).toBeCloseTo(1)
    }
  })

  it('main-vertical: 첫 칸이 왼쪽에 크게, 나머지는 오른쪽에 위아래로', () => {
    const tree = relayout(layoutForCount(4, ['a', 'b', 'c', 'd']), 'main-vertical')
    expect(shapeOf(tree)).toBe('h(P,v(P,v(P,P)))')
    const { panes } = layoutRects(tree)
    expect(panes.get('a')).toMatchObject({ x: 0, w: 0.6, h: 1 })
    expect(panes.get('b')!.x).toBeCloseTo(0.6)
    expect(panes.get('b')!.h).toBeCloseTo(1 / 3)
  })

  it('main-horizontal: 첫 칸이 위에 크게, 나머지는 아래에 좌우로', () => {
    const tree = relayout(layoutForCount(3, ['a', 'b', 'c']), 'main-horizontal')
    expect(shapeOf(tree)).toBe('v(P,h(P,P))')
    const { panes } = layoutRects(tree)
    expect(panes.get('a')).toMatchObject({ y: 0, h: 0.6, w: 1 })
    expect(panes.get('b')!.y).toBeCloseTo(0.6)
    expect(panes.get('b')!.w).toBeCloseTo(0.5)
  })

  it('tiled: 열 = 올림(√n), 줄은 위에서 채운다', () => {
    const rows = (n: number) => {
      const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].slice(0, n)
      const { panes } = layoutRects(relayout(messyOf(ids), 'tiled'))
      const byRow = new Map<number, string[]>()
      for (const id of ids) {
        const key = Math.round(panes.get(id)!.y * 1000)
        byRow.set(key, [...(byRow.get(key) ?? []), id])
      }
      return [...byRow.entries()].sort((x, y) => x[0] - y[0]).map(([, row]) => row)
    }
    expect(rows(4)).toEqual([['a', 'b'], ['c', 'd']])
    expect(rows(3)).toEqual([['a', 'b'], ['c']])
    expect(rows(5)).toEqual([['a', 'b', 'c'], ['d', 'e']])
    expect(rows(8)).toEqual([['a', 'b', 'c'], ['d', 'e', 'f'], ['g', 'h']])
  })

  it('tiled 의 마지막 줄이 짧으면 그 칸이 줄 전체를 나눠 쓴다', () => {
    const { panes } = layoutRects(relayout(messyOf(['a', 'b', 'c']), 'tiled'))
    expect(panes.get('c')).toMatchObject({ x: 0, w: 1 })
  })

  it('칸이 하나면 그대로, 나누기 id 는 s1, s2 … 로 새로 붙는다', () => {
    const one = P('only')
    expect(relayout(one, 'tiled')).toBe(one)
    const tree = relayout(messyOf(['a', 'b', 'c']), 'even-horizontal')
    expect(tree).toMatchObject({ id: 's1' })
  })

  it('parseRelayoutKind 는 알려진 이름만 받는다', () => {
    expect(parseRelayoutKind('tiled')).toBe('tiled')
    expect(parseRelayoutKind('main-vertical')).toBe('main-vertical')
    expect(parseRelayoutKind('diagonal')).toBeNull()
    expect(parseRelayoutKind(3)).toBeNull()
  })
})

/** 칸 id 들을 아무렇게나 엮은 트리(모양은 relayout 이 어차피 버린다) */
function messyOf(ids: readonly string[]): LayoutNode {
  return ids.slice(1).reduce<LayoutNode>((tree, id, index) => split(`m${index}`, index % 2 === 0 ? 'v' : 'h', tree, P(id)), P(ids[0]!))
}

describe('상한과 최소 크기', () => {
  it('칸이 8개면 어디서든 나눌 수 없다(max)', () => {
    const ids = Array.from({ length: MAX_PANES }, (_, index) => `p${index}`)
    const full = layoutForCount(MAX_PANES, ids)
    expect(paneCount(full)).toBe(MAX_PANES)
    expect(splitRefusal(full, 'p0', 'h')).toBe('max')
    expect(splitRefusal(full, 'p3', 'v', { width: 5000, height: 5000 })).toBe('max')
    expect(splitRefusal(layoutForCount(MAX_PANES - 1, ids.slice(0, MAX_PANES - 1)), 'p0', 'h')).toBeNull()
  })

  it('나누면 반쪽이 240×160 보다 작아지면 막는다(small)', () => {
    const tree = P('a')
    expect(splitRefusal(tree, 'a', 'h', { width: 2 * MIN_PANE_WIDTH - 1, height: 800 })).toBe('small')
    expect(splitRefusal(tree, 'a', 'h', { width: 2 * MIN_PANE_WIDTH, height: 800 })).toBeNull()
    expect(splitRefusal(tree, 'a', 'v', { width: 800, height: 2 * MIN_PANE_HEIGHT - 1 })).toBe('small')
    expect(splitRefusal(tree, 'a', 'v', { width: 800, height: 2 * MIN_PANE_HEIGHT })).toBeNull()
  })

  it('크기를 모르면(0·null) 크기는 따지지 않고, 없는 칸은 막지 않는다', () => {
    expect(splitRefusal(P('a'), 'a', 'h', null)).toBeNull()
    expect(splitRefusal(P('a'), 'a', 'h', { width: 0, height: 0 })).toBeNull()
    expect(splitRefusal(P('a'), 'zzz', 'h')).toBeNull()
  })

  it('minSize 는 나누기 방향대로 쌓는다', () => {
    expect(minSize(P('a'))).toEqual({ width: MIN_PANE_WIDTH, height: MIN_PANE_HEIGHT })
    expect(minSize(split('s', 'h', P('a'), P('b')))).toEqual({ width: 2 * MIN_PANE_WIDTH, height: MIN_PANE_HEIGHT })
    expect(minSize(split('s', 'v', P('a'), P('b')))).toEqual({ width: MIN_PANE_WIDTH, height: 2 * MIN_PANE_HEIGHT })
    expect(minSize(layoutForLegacyId('grid4', ['a', 'b', 'c', 'd']))).toEqual({ width: 2 * MIN_PANE_WIDTH, height: 2 * MIN_PANE_HEIGHT })
  })

  it('clampRatioForSize: 두 쪽이 최소 크기를 지키는 범위로 가둔다', () => {
    const node = split('s', 'h', P('a'), P('b')) as Extract<LayoutNode, { kind: 'split' }>
    // 폭 1000: a 는 240/1000 ~ b 는 240/1000 남기고
    expect(clampRatioForSize(node, 0.01, 1000)).toBeCloseTo(0.24)
    expect(clampRatioForSize(node, 0.99, 1000)).toBeCloseTo(0.76)
    expect(clampRatioForSize(node, 0.4, 1000)).toBe(0.4)
    // 자리가 모자라면 가운데 근처로만
    expect(clampRatioForSize(node, 0.01, 300)).toBeCloseTo(0.2)
    expect(clampRatioForSize(node, 0.4, 0)).toBe(0.4)
  })
})

describe('그리기용 사각형', () => {
  it('칸과 나누기의 사각형이 비율대로 나온다', () => {
    const tree = split('s1', 'h', P('a'), split('s2', 'v', P('b'), P('c'), 0.25), 0.4)
    const { panes, splits } = layoutRects(tree)
    expect(panes.get('a')).toEqual({ x: 0, y: 0, w: 0.4, h: 1 })
    expect(panes.get('b')!.x).toBeCloseTo(0.4)
    expect(panes.get('b')!.h).toBeCloseTo(0.25)
    expect(panes.get('c')!.y).toBeCloseTo(0.25)
    expect(panes.get('c')!.w).toBeCloseTo(0.6)
    expect(splits.map((item) => item.id)).toEqual(['s1', 's2'])
    expect(splits[1]).toMatchObject({ dir: 'v', ratio: 0.25 })
  })
})

describe('예전 배치(10가지)와의 대응', () => {
  const ids: readonly PdfSplitLayoutId[] = ['single', 'cols2', 'rows2', 'cols3', 'top2-bottom1', 'top1-bottom2', 'left1-right2', 'left2-right1', 'grid4']
  const shapes: Record<PdfSplitLayoutId, string> = {
    single: 'P',
    cols2: 'h(P,P)',
    rows2: 'v(P,P)',
    cols3: 'h(P,h(P,P))',
    'top2-bottom1': 'v(h(P,P),P)',
    'top1-bottom2': 'v(P,h(P,P))',
    'left1-right2': 'h(P,v(P,P))',
    'left2-right1': 'h(v(P,P),P)',
    grid4: 'v(h(P,P),h(P,P))',
  }

  it.each(ids)('%s 는 같은 모양의 트리가 되고, 칸 차례는 예전 칸 차례를 따른다', (id) => {
    const names = ['A', 'B', 'C', 'D']
    const tree = layoutForLegacyId(id, names)
    expect(shapeOf(tree)).toBe(shapes[id])
    expect(paneCount(tree)).toBe(legacyPaneCount(id))
    expect(leaves(tree)).toEqual(names.slice(0, legacyPaneCount(id)))
    expect(matchLegacyLayout(tree)).toBe(id)
  })

  it('예전 배치의 칸 사각형이 격자 모양과 같다(left2-right1: 왼쪽 위·아래, 오른쪽 한 칸)', () => {
    const { panes } = layoutRects(layoutForLegacyId('left2-right1', ['a', 'b', 'c']))
    expect(panes.get('a')).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 })
    expect(panes.get('b')).toEqual({ x: 0, y: 0.5, w: 0.5, h: 0.5 })
    expect(panes.get('c')).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 })
  })

  it('cols2 는 leftFrac 을 왼쪽 몫으로 쓴다', () => {
    expect(layoutForLegacyId('cols2', ['a', 'b'], 0.35)).toMatchObject({ dir: 'h', ratio: 0.35 })
  })

  it('직접 나눈 모양은 어느 예전 배치와도 맞지 않는다(null)', () => {
    expect(matchLegacyLayout(sample())).toBe('left1-right2')
    expect(matchLegacyLayout(splitLeaf(layoutForLegacyId('cols2', ['a', 'b']), 'a', 'h', 'n'))).toBeNull()
    expect(matchLegacyLayout(layoutForCount(5, ['a', 'b', 'c', 'd', 'e']))).toBeNull()
  })

  it('layoutForCount: 1·2·3·4 는 예전 setPaneCount 와 같은 모양, 5 이상은 좌우 한 줄', () => {
    expect(shapeOf(layoutForCount(1, ['a']))).toBe('P')
    expect(shapeOf(layoutForCount(2, ['a', 'b']))).toBe('h(P,P)')
    expect(shapeOf(layoutForCount(3, ['a', 'b', 'c']))).toBe('h(P,h(P,P))')
    expect(shapeOf(layoutForCount(4, ['a', 'b', 'c', 'd']))).toBe('v(h(P,P),h(P,P))')
    expect(shapeOf(layoutForCount(5, ['a', 'b', 'c', 'd', 'e']))).toBe('h(P,h(P,h(P,h(P,P))))')
  })
})

describe('저장·읽기', () => {
  it('트리는 JSON 을 거쳐 그대로 돌아온다', () => {
    const tree = sample()
    expect(parseLayoutTree(JSON.parse(JSON.stringify(tree)))).toEqual(tree)
  })

  it('모양이 틀린 값·겹치는 칸·너무 많은 칸은 null', () => {
    expect(parseLayoutTree(null)).toBeNull()
    expect(parseLayoutTree({ kind: 'pane' })).toBeNull()
    expect(parseLayoutTree({ kind: 'pane', paneId: '' })).toBeNull()
    expect(parseLayoutTree({ kind: 'split', id: 's', dir: 'x', ratio: 0.5, a: P('a'), b: P('b') })).toBeNull()
    expect(parseLayoutTree({ kind: 'split', id: 's', dir: 'h', ratio: 'wide', a: P('a'), b: P('b') })).toBeNull()
    expect(parseLayoutTree(split('s', 'h', P('a'), P('a')))).toBeNull()
    expect(parseLayoutTree(split('s', 'h', P('a'), split('s', 'v', P('b'), P('c'))))).toBeNull()
    const nine = Array.from({ length: 9 }, (_, index) => `p${index}`)
    expect(parseLayoutTree(relayout(messyOf(nine), 'even-horizontal'))).toBeNull()
  })

  it('비율은 읽을 때 0.05–0.95 안으로 가둔다', () => {
    expect(parseLayoutTree(split('s', 'h', P('a'), P('b'), 7))).toMatchObject({ ratio: 0.95 })
  })
})
