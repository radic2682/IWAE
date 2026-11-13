import { describe, expect, it } from 'vitest'
import { MAX_PANES, layoutForCount, leaves, paneCount, paneNode, splitLeaf, type LayoutNode } from '../../core/layoutTree'
import { ALL_DOCK_EDGES, type TreeWorkspace } from './tabDock'
import { emptyTabs, type PanesState, type Tab } from './tabs'
import { WORKSPACE_EDGE_BAND_PX, WORKSPACE_EDGE_REACH_PX, WORKSPACE_TOP_BAND_PX, dockTabAtRoot, rootDockBox, rootDockPlan, splitRoot, workspaceEdgeAt } from './workspaceEdge'

const tab = (id: string): Tab => ({ id, title: id, kind: 'pdf' })
const tabs = (...ids: string[]) => ({ tabs: ids.map(tab), activeId: ids[0] ?? null })
const box = { left: 300, top: 40, width: 1200, height: 900 }

describe('workspaceEdgeAt', () => {
  it('트리 바깥 띠 안이면 그 쪽, 안쪽이면 null', () => {
    expect(workspaceEdgeAt(box, 1490, 400, ALL_DOCK_EDGES)).toBe('right')
    expect(workspaceEdgeAt(box, 310, 400, ALL_DOCK_EDGES)).toBe('left')
    expect(workspaceEdgeAt(box, 800, 930, ALL_DOCK_EDGES)).toBe('bottom')
    expect(workspaceEdgeAt(box, 800, 44, ALL_DOCK_EDGES)).toBe('top')
    expect(workspaceEdgeAt(box, 800, 400, ALL_DOCK_EDGES)).toBeNull()
  })
  it('띠 두께는 24px(위쪽은 8px)', () => {
    expect(workspaceEdgeAt(box, 1500 - WORKSPACE_EDGE_BAND_PX + 1, 400, ALL_DOCK_EDGES)).toBe('right')
    expect(workspaceEdgeAt(box, 1500 - WORKSPACE_EDGE_BAND_PX - 1, 400, ALL_DOCK_EDGES)).toBeNull()
    expect(workspaceEdgeAt(box, 800, 40 + WORKSPACE_TOP_BAND_PX - 1, ALL_DOCK_EDGES)).toBe('top')
    expect(workspaceEdgeAt(box, 800, 40 + WORKSPACE_TOP_BAND_PX + 1, ALL_DOCK_EDGES)).toBeNull()
  })
  it('상자 밖 12px 까지는 그 쪽 띠, 그보다 멀면 null', () => {
    expect(workspaceEdgeAt(box, 1500 + WORKSPACE_EDGE_REACH_PX - 1, 400, ALL_DOCK_EDGES)).toBe('right')
    expect(workspaceEdgeAt(box, 1500 + WORKSPACE_EDGE_REACH_PX + 1, 400, ALL_DOCK_EDGES)).toBeNull()
  })
  it('모서리는 더 가까운 쪽, 허락 안 된 쪽은 건너뛴다', () => {
    expect(workspaceEdgeAt(box, 1495, 920, ALL_DOCK_EDGES)).toBe('right')
    expect(workspaceEdgeAt(box, 1480, 935, ALL_DOCK_EDGES)).toBe('bottom')
    expect(workspaceEdgeAt(box, 1495, 400, ['left'])).toBeNull()
    expect(workspaceEdgeAt({ ...box, width: 0 }, 300, 400, ALL_DOCK_EDGES)).toBeNull()
  })
})

describe('rootDockPlan', () => {
  const two = layoutForCount(2, ['a', 'b'])
  it('크기를 모르면 1/3', () => {
    const plan = rootDockPlan(two, 'right', null)
    expect(plan).toEqual({ share: 1 / 3 })
  })
  it('몫은 트리 폭의 1/3 이고, 칸 최소 폭 240 보다 작아지면 240 으로', () => {
    expect(rootDockPlan(paneNode('a'), 'right', { width: 1200, height: 900 })).toEqual({ share: 400 / 1200 })
    const narrow = rootDockPlan(paneNode('a'), 'left', { width: 600, height: 900 })
    expect(narrow).toEqual({ share: 240 / 600 })
  })
  it('남는 트리가 최소 크기를 못 지키면 small', () => {
    // 칸 둘 = 최소 폭 480, 새 줄 240 이 더해지면 720 이 필요
    expect(rootDockPlan(two, 'right', { width: 700, height: 900 })).toEqual({ refused: 'small' })
    expect(rootDockPlan(two, 'right', { width: 720, height: 900 })).toEqual({ share: 240 / 720 })
  })
  it('세로는 높이 160 을 지킨다', () => {
    expect(rootDockPlan(paneNode('a'), 'bottom', { width: 900, height: 300 })).toEqual({ refused: 'small' })
    expect(rootDockPlan(paneNode('a'), 'top', { width: 900, height: 480 })).toEqual({ share: 1 / 3 })
  })
  it('칸이 상한이면 max, 비어 닫힐 칸이 있으면 닫힌 뒤로 센다', () => {
    const ids = Array.from({ length: MAX_PANES }, (_, index) => `p${index}`)
    const full = layoutForCount(MAX_PANES, ids)
    expect(rootDockPlan(full, 'right', null)).toEqual({ refused: 'max' })
    expect(rootDockPlan(full, 'right', null, 'p3')).toEqual({ share: 1 / 3 })
  })
})

describe('rootDockPlan: 기존 칸이 줄어든 뒤에도 최소 크기를 지킨다', () => {
  // [650 | 321 | 322/322] 폭 1311: 가운데 칸 321 이 가장 빠듯하다
  const layout = splitLeaf(splitLeaf(splitLeaf(paneNode('a'), 'a', 'h', 'b'), 'b', 'h', 'c'), 'c', 'v', 'd')
  const widths: Record<string, number> = { a: 650, b: 321, c: 322, d: 322 }
  const sizeOf = (pane: string) => ({ width: widths[pane]!, height: 600 })
  it('1/3 몫이면 칸이 240 아래로 내려가므로 새 줄을 가장 빠듯한 칸이 허락하는 만큼으로 줄인다', () => {
    const plan = rootDockPlan(layout, 'right', { width: 1311, height: 600 }, null, sizeOf)
    if ('refused' in plan) throw new Error('expected a plan')
    const taken = plan.share * 1311
    expect(taken).toBeGreaterThanOrEqual(240)
    expect(taken).toBeLessThan(1311 / 3)
    const factor = (1311 - taken) / 1311
    for (const width of Object.values(widths)) expect(width * factor).toBeGreaterThanOrEqual(240 - 1e-6)
    expect(321 * factor).toBeCloseTo(240, 3)
  })
  it('새 줄을 최소 240 으로 줘도 어느 칸이 깨지면 미리보기를 내지 않는다', () => {
    expect(rootDockPlan(layout, 'right', { width: 1311, height: 600 }, null, (pane) => ({ width: pane === 'b' ? 270 : widths[pane]!, height: 600 }))).toEqual({ refused: 'small' })
  })
  it('세로도 같은 규칙(칸 높이 160)', () => {
    const plan = rootDockPlan(layout, 'bottom', { width: 1311, height: 600 }, null, () => ({ width: 400, height: 200 }))
    expect(plan).toEqual({ refused: 'small' })
  })
})

describe('rootDockBox', () => {
  it('트리 상자 바깥 쪽에 키 전체 · 폭 전체의 띠', () => {
    expect(rootDockBox(box, 'right', 0.25)).toEqual({ left: 1200, top: 40, width: 300, height: 900 })
    expect(rootDockBox(box, 'left', 0.25)).toEqual({ left: 300, top: 40, width: 300, height: 900 })
    expect(rootDockBox(box, 'top', 0.5)).toEqual({ left: 300, top: 40, width: 1200, height: 450 })
    expect(rootDockBox(box, 'bottom', 0.5)).toEqual({ left: 300, top: 490, width: 1200, height: 450 })
  })
})

describe('splitRoot', () => {
  const root = splitLeaf(paneNode('a'), 'a', 'v', 'b')
  it('오른쪽: 기존 트리가 앞(a), 새 칸이 뒤(b), 비율은 1 - share', () => {
    const next = splitRoot(root, 'n', 'right', 0.3)
    expect(next.kind).toBe('split')
    if (next.kind !== 'split') return
    expect(next.dir).toBe('h')
    expect(next.a).toBe(root)
    expect(next.b).toEqual(paneNode('n'))
    expect(next.ratio).toBeCloseTo(0.7)
    expect(leaves(next)).toEqual(['a', 'b', 'n'])
  })
  it('왼쪽 · 위: 새 칸이 앞이고 비율은 share', () => {
    const left = splitRoot(root, 'n', 'left', 0.3)
    expect(left.kind === 'split' && left.a).toEqual(paneNode('n'))
    expect(left.kind === 'split' && left.ratio).toBeCloseTo(0.3)
    const top = splitRoot(root, 'n', 'top', 0.3)
    expect(top.kind === 'split' && top.dir).toBe('v')
    expect(leaves(top)).toEqual(['n', 'a', 'b'])
  })
  it('나누기 id 는 겹치지 않는다', () => {
    const next = splitRoot(root, 'n', 'right', 0.3)
    const ids: string[] = []
    const walk = (node: LayoutNode) => { if (node.kind === 'split') { ids.push(node.id); walk(node.a); walk(node.b) } }
    walk(next)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('dockTabAtRoot', () => {
  const layout = layoutForCount(3, ['a', 'b', 'c'])
  const panes: PanesState = { a: tabs('x', 'y'), b: tabs('z'), c: emptyTabs }
  const input: TreeWorkspace = { panes, layout, channels: { a: 'orange' } }
  const size = { width: 1200, height: 900 }

  it('여러 탭 중 하나를 오른쪽 바깥으로: 새 칸이 생기고 원래 칸은 남는다', () => {
    const outcome = dockTabAtRoot(input, 'x', 'right', size)
    expect(outcome !== null && !('refused' in outcome)).toBe(true)
    if (outcome === null || 'refused' in outcome) return
    expect(outcome.collapsed).toBe(false)
    expect(paneCount(outcome.layout)).toBe(4)
    expect(leaves(outcome.layout).at(-1)).toBe(outcome.newPane)
    expect(outcome.panes[outcome.newPane]?.tabs.map((item) => item.id)).toEqual(['x'])
    expect(outcome.panes.a?.tabs.map((item) => item.id)).toEqual(['y'])
    expect(outcome.channels[outcome.newPane]).toBe('orange')
  })
  it('하나뿐인 탭을 끌면 비는 칸은 닫히고 새 칸이 맨 바깥에 놓인다', () => {
    const outcome = dockTabAtRoot(input, 'z', 'left', size)
    if (outcome === null || 'refused' in outcome) throw new Error('expected an outcome')
    expect(outcome.collapsed).toBe(true)
    expect(leaves(outcome.layout)).toEqual([outcome.newPane, 'a', 'c'])
    expect(outcome.panes.b).toBeUndefined()
  })
  it('칸이 하나뿐인 화면의 하나뿐인 탭은 할 일이 없다(null)', () => {
    expect(dockTabAtRoot({ panes: { a: tabs('x') }, layout: paneNode('a'), channels: {} }, 'x', 'right', size)).toBeNull()
  })
  it('칸이 상한이면 refused max, 닫히는 칸이 있으면 된다', () => {
    const ids = Array.from({ length: MAX_PANES }, (_, index) => `q${index}`)
    const full = layoutForCount(MAX_PANES, ids)
    const fullPanes: PanesState = Object.fromEntries(ids.map((id, index) => [id, tabs(`t${index}`, `u${index}`)]))
    expect(dockTabAtRoot({ panes: fullPanes, layout: full, channels: {} }, 't0', 'right', null)).toEqual({ refused: 'max' })
    const single: PanesState = { ...fullPanes, q0: tabs('t0') }
    const outcome = dockTabAtRoot({ panes: single, layout: full, channels: {} }, 't0', 'right', null)
    expect(outcome !== null && !('refused' in outcome)).toBe(true)
  })
  it('너무 좁으면 refused small, 없는 탭은 null', () => {
    expect(dockTabAtRoot(input, 'x', 'right', { width: 700, height: 900 })).toEqual({ refused: 'small' })
    expect(dockTabAtRoot(input, 'nope', 'right', size)).toBeNull()
  })
  it('미리보기 표시는 떼고 옮긴다', () => {
    const preview: PanesState = { a: { tabs: [{ ...tab('p'), preview: true }, tab('q')], activeId: 'p' }, b: tabs('z') }
    const outcome = dockTabAtRoot({ panes: preview, layout: layoutForCount(2, ['a', 'b']), channels: {} }, 'p', 'bottom', null)
    if (outcome === null || 'refused' in outcome) throw new Error('expected an outcome')
    expect(outcome.panes[outcome.newPane]?.tabs[0]?.preview).toBeUndefined()
  })
})
