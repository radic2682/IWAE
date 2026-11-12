import { describe, expect, it } from 'vitest'
import { applyLayoutPreset, availableLayoutPresets, LAYOUT_PRESETS } from './layoutPresets'
import { layoutForLegacyId, leaves, shapeOf } from '../core/layoutTree'
import { allPaneTabs, emptyTabs, type PanesState, type Tab } from './tabs'
import { DEFAULT_CHANNELS } from './workspaceChannels'
import { CANVAS_ENABLED } from '../core/features'

const pdf = (id: string): Tab => ({ id, title: id, kind: 'pdf' })
const md = (id: string): Tab => ({ id, title: id, kind: 'markdown' })
const note = (id: string): Tab => ({ id, title: id, kind: 'memoNote' })
const canvas = (id: string): Tab => ({ id, title: id, kind: 'canvas' })
const strip = (tabs: Tab[], activeId: string | null = tabs[0]?.id ?? null) => ({ tabs, activeId })
const panes = (p: PanesState): PanesState => p
/** 지금 배치: 칸 넷(left → right → third → fourth). 프리셋은 이 칸 id 를 차례로 이어 쓴다 */
const current = layoutForLegacyId('grid4', ['left', 'right', 'third', 'fourth'])
const ids = (state: { tabs: readonly Tab[] } | undefined) => state?.tabs.map((tab) => tab.id)
const sorted = (state: PanesState) => allPaneTabs(state).map((tab) => tab.id).sort()

describe('배치 목록', () => {
  it('읽기·노트 왼쪽·비교·정리 네 가지이고, 캔버스가 꺼져 있으면 「정리」를 감춘다', () => {
    expect(LAYOUT_PRESETS.map((preset) => preset.id)).toEqual(['read', 'noteLeft', 'compare', 'organize'])
    expect(availableLayoutPresets(true).map((preset) => preset.id)).toEqual(['read', 'noteLeft', 'compare', 'organize'])
    expect(availableLayoutPresets(false).map((preset) => preset.id)).toEqual(['read', 'noteLeft', 'compare'])
    expect(LAYOUT_PRESETS.map((preset) => preset.label)).toEqual(['읽기', '노트 왼쪽', '비교', '정리'])
  })

  it('캔버스가 켜져 있으면 앱이 쓰는 목록에 「정리」가 보인다', () => {
    expect(CANVAS_ENABLED).toBe(true)
    expect(availableLayoutPresets(CANVAS_ENABLED).map((preset) => preset.id)).toContain('organize')
  })
})

describe('applyLayoutPreset — 열린 탭을 그 모양으로 다시 놓는다', () => {
  const input = (state: PanesState, id: Parameters<typeof applyLayoutPreset>[0]['id'], more: Partial<Parameters<typeof applyLayoutPreset>[0]> = {}) => ({
    id,
    panes: state,
    channels: DEFAULT_CHANNELS,
    layout: current,
    anchor: 'left' as const,
    lastTouched: null,
    fallbackNote: null,
    ...more,
  })

  it('읽기: 문서 | 노트, 같은 색. 보던 문서와 마지막으로 만진 노트가 보인다', () => {
    const state = panes({ left: strip([pdf('A'), pdf('B')], 'B'), right: strip([note('N1'), note('N2')], 'N1') })
    const result = applyLayoutPreset(input(state, 'read', { lastTouched: 'N2' }))
    expect(shapeOf(result.layout)).toBe('h(P,P)')
    expect(ids(result.panes.left)).toEqual(['A', 'B'])
    expect(result.panes.left!.activeId).toBe('B')
    expect(ids(result.panes.right)).toEqual(['N1', 'N2'])
    expect(result.panes.right!.activeId).toBe('N2')
    expect(result.channels.left).toBe(result.channels.right)
    expect(result.channels.left).not.toBeNull()
  })

  it('읽기: 흩어진 탭을 모은다(문서는 왼쪽, 노트는 오른쪽). 하나도 닫지 않는다', () => {
    const state = panes({ left: strip([pdf('A'), note('N1')], 'A'), right: strip([md('M'), note('N2')], 'N2'), third: strip([pdf('C')]) })
    const result = applyLayoutPreset(input(state, 'read'))
    expect(ids(result.panes.left)).toEqual(['A', 'M', 'C'])
    expect(ids(result.panes.right)).toEqual(['N1', 'N2'])
    expect(sorted(result.panes)).toEqual(sorted(state))
    expect(result.panes.third).toBeUndefined()
    expect(result.panes.fourth).toBeUndefined()
    expect(leaves(result.layout)).toEqual(['left', 'right'])
  })

  it('읽기: 노트 탭이 없으면 준 노트(마지막으로 만진·문서의·새 노트)를 노트 칸에 놓는다', () => {
    const state = panes({ left: strip([pdf('A')]) })
    const result = applyLayoutPreset(input(state, 'read', { fallbackNote: note('N') }))
    expect(ids(result.panes.right)).toEqual(['N'])
    expect(result.panes.right!.activeId).toBe('N')
    // 준 노트도 없으면 노트 칸은 비어 있다(탭을 만들어 내지 않는다)
    expect(applyLayoutPreset(input(state, 'read')).panes.right).toEqual(emptyTabs)
  })

  it('노트 왼쪽: 노트 | 문서', () => {
    const state = panes({ left: strip([pdf('A')]), right: strip([note('N')]) })
    const result = applyLayoutPreset(input(state, 'noteLeft'))
    expect(shapeOf(result.layout)).toBe('h(P,P)')
    expect(ids(result.panes.left)).toEqual(['N'])
    expect(ids(result.panes.right)).toEqual(['A'])
    expect(result.channels.left).toBe(result.channels.right)
    expect(result.focus).toBe('right')
  })

  it('비교: 문서 둘(위·아래) | 노트 둘(위·아래), 두 쌍은 서로 다른 색', () => {
    const state = panes({ left: strip([pdf('A'), pdf('B')], 'A'), right: strip([note('N1'), note('N2')], 'N1') })
    const result = applyLayoutPreset(input(state, 'compare', { lastTouched: 'N1' }))
    expect(shapeOf(result.layout)).toBe('v(h(P,P),h(P,P))')
    // 칸 차례: 왼쪽 위, 오른쪽 위, 왼쪽 아래, 오른쪽 아래
    expect(ids(result.panes.left)).toEqual(['A'])
    expect(ids(result.panes.right)).toEqual(['N1'])
    expect(ids(result.panes.third)).toEqual(['B'])
    expect(ids(result.panes.fourth)).toEqual(['N2'])
    expect(result.channels.left).toBe(result.channels.right)
    expect(result.channels.third).toBe(result.channels.fourth)
    expect(result.channels.left).not.toBe(result.channels.third)
  })

  it('비교: 보던 문서가 첫 칸. 남는 탭은 닫지 않고 아래 칸 탭 줄에 둔다', () => {
    const state = panes({ left: strip([pdf('A'), pdf('B'), pdf('C')], 'C'), right: strip([note('N1'), note('N2'), note('N3')], 'N2') })
    const result = applyLayoutPreset(input(state, 'compare', { lastTouched: 'N2' }))
    expect(ids(result.panes.left)).toEqual(['C'])
    expect(ids(result.panes.third)).toEqual(['A', 'B'])
    expect(ids(result.panes.right)).toEqual(['N2'])
    expect(ids(result.panes.fourth)).toEqual(['N1', 'N3'])
    expect(sorted(result.panes)).toEqual(sorted(state))
  })

  it('비교: 문서가 하나뿐이면 아래 문서 칸은 비어 있다(탭을 만들지 않는다)', () => {
    const state = panes({ left: strip([pdf('A')]), right: strip([note('N')]) })
    const result = applyLayoutPreset(input(state, 'compare'))
    expect(result.panes.third).toEqual(emptyTabs)
    expect(result.panes.fourth).toEqual(emptyTabs)
  })

  it('정리: 노트 | 캔버스. 문서 탭은 닫지 않고 노트 칸 뒤에 둔다', () => {
    const state = panes({ left: strip([pdf('A')]), right: strip([note('N'), canvas('C')], 'N') })
    const result = applyLayoutPreset(input(state, 'organize'))
    expect(shapeOf(result.layout)).toBe('h(P,P)')
    expect(ids(result.panes.left)).toEqual(['N', 'A'])
    expect(result.panes.left!.activeId).toBe('N')
    expect(ids(result.panes.right)).toEqual(['C'])
    expect(sorted(result.panes)).toEqual(sorted(state))
  })

  it('정리: 캔버스가 여럿이면 마지막으로 만진 캔버스가 보인다', () => {
    const state = panes({ left: strip([note('N')]), right: strip([canvas('C1'), canvas('C2')], 'C1') })
    const result = applyLayoutPreset(input(state, 'organize', { lastCanvas: 'C2' }))
    expect(ids(result.panes.right)).toEqual(['C1', 'C2'])
    expect(result.panes.right!.activeId).toBe('C2')
    expect(result.channels.left).toBe(result.channels.right)
  })

  it('정리: 열린 캔버스 탭이 없으면 준 캔버스(마지막으로 만진·첫 캔버스·새 캔버스)를 캔버스 칸에 놓는다', () => {
    const state = panes({ left: strip([pdf('A'), note('N')], 'N') })
    const result = applyLayoutPreset(input(state, 'organize', { fallbackCanvas: canvas('NEW') }))
    expect(ids(result.panes.left)).toEqual(['N', 'A'])
    expect(ids(result.panes.right)).toEqual(['NEW'])
    expect(result.panes.right!.activeId).toBe('NEW')
    // 준 캔버스가 없으면 캔버스 칸은 비어 있다(다른 프리셋은 캔버스를 만들지 않는다)
    expect(applyLayoutPreset(input(state, 'organize')).panes.right).toEqual(emptyTabs)
    expect(applyLayoutPreset(input(state, 'read', { fallbackCanvas: canvas('NEW') })).panes.right!.tabs.map((tab) => tab.id)).not.toContain('NEW')
  })

  it('정리: 노트가 없으면 보던 문서가 왼쪽 칸에 보인다', () => {
    const state = panes({ left: strip([pdf('A'), pdf('B')], 'B'), right: strip([canvas('C')]) })
    const result = applyLayoutPreset(input(state, 'organize'))
    expect(ids(result.panes.left)).toEqual(['A', 'B'])
    expect(result.panes.left!.activeId).toBe('B')
  })

  it('어느 프리셋이든 탭 수는 그대로다(같은 탭이 모두 남는다)', () => {
    const state = panes({ left: strip([pdf('A'), md('M')]), right: strip([note('N1'), canvas('C')]), third: strip([note('N2'), pdf('B')]) })
    for (const id of ['read', 'noteLeft', 'compare', 'organize'] as const) {
      expect(sorted(applyLayoutPreset(input(state, id, { lastTouched: 'N2' })).panes), id).toEqual(sorted(state))
    }
  })

  it('문서 창의 색을 그대로 쓴다(없으면 비어 있는 색)', () => {
    const state = panes({ left: strip([pdf('A')]), right: strip([note('N')]) })
    expect(applyLayoutPreset(input(state, 'read', { channels: { ...DEFAULT_CHANNELS, left: 'orange' } })).channels).toMatchObject({ left: 'orange', right: 'orange' })
    const none = applyLayoutPreset(input(state, 'read', { channels: { ...DEFAULT_CHANNELS, left: null } }))
    expect(none.channels.left).not.toBeNull()
    expect(none.channels.left).toBe(none.channels.right)
  })
})

describe('applyLayoutPreset — 칸 id 와 배치', () => {
  const pdf2 = (id: string): Tab => ({ id, title: id, kind: 'pdf' })
  const mk = (state: PanesState, layout: Parameters<typeof applyLayoutPreset>[0]['layout']) => applyLayoutPreset({ id: 'read', panes: state, channels: DEFAULT_CHANNELS, layout, anchor: null, lastTouched: null, fallbackNote: null })

  it('지금 있는 칸 id 를 차례로 이어 쓰고, 칸이 모자라면 새 id 를 만든다', () => {
    const one = layoutForLegacyId('single', ['only'])
    const result = mk({ only: { tabs: [pdf2('A')], activeId: 'A' } }, one)
    expect(leaves(result.layout)).toHaveLength(2)
    expect(leaves(result.layout)[0]).toBe('only')
    expect(leaves(result.layout)[1]).not.toBe('only')
    // 새 칸도 panes 에 있다
    expect(Object.keys(result.panes).sort()).toEqual([...leaves(result.layout)].sort())
  })

  it('칸이 남으면(넷 → 둘) 남는 칸은 사라지고 그 탭은 모두 두 칸 안에 있다', () => {
    const state: PanesState = { left: { tabs: [pdf2('A')], activeId: 'A' }, right: { tabs: [pdf2('B')], activeId: 'B' }, third: { tabs: [pdf2('C')], activeId: 'C' }, fourth: { tabs: [pdf2('D')], activeId: 'D' } }
    const result = mk(state, current)
    expect(Object.keys(result.panes)).toHaveLength(2)
    expect(allPaneTabs(result.panes).map((tab) => tab.id).sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('focus·fresh 는 새 배치의 칸이다', () => {
    const result = applyLayoutPreset({ id: 'noteLeft', panes: { left: { tabs: [pdf2('A')], activeId: 'A' }, right: { tabs: [{ id: 'N', title: 'N', kind: 'memoNote' }], activeId: 'N' } }, channels: DEFAULT_CHANNELS, layout: current, anchor: 'left', lastTouched: null, fallbackNote: null })
    const order = leaves(result.layout)
    expect(result.focus).toBe(order[1])
    expect(result.fresh).toBe(order[0])
  })
})
