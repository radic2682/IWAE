import { describe, expect, it } from 'vitest'
import { applyLayoutPreset, availableLayoutPresets, LAYOUT_PRESETS } from './layoutPresets'
import { allPaneTabs, emptyTabs, type PanesState, type Tab } from './tabs'
import { DEFAULT_CHANNELS } from './workspaceChannels'

const pdf = (id: string): Tab => ({ id, title: id, kind: 'pdf' })
const md = (id: string): Tab => ({ id, title: id, kind: 'markdown' })
const note = (id: string): Tab => ({ id, title: id, kind: 'memoNote' })
const canvas = (id: string): Tab => ({ id, title: id, kind: 'canvas' })
const strip = (tabs: Tab[], activeId: string | null = tabs[0]?.id ?? null) => ({ tabs, activeId })
const panes = (p: Partial<PanesState>): PanesState => ({ left: emptyTabs, right: emptyTabs, third: emptyTabs, fourth: emptyTabs, ...p })
const ids = (state: { tabs: readonly Tab[] }) => state.tabs.map((tab) => tab.id)
const sorted = (state: PanesState) => allPaneTabs(state).map((tab) => tab.id).sort()

describe('배치 목록', () => {
  it('읽기·노트 왼쪽·비교·정리 네 가지이고, 캔버스가 꺼져 있으면 「정리」를 감춘다', () => {
    expect(LAYOUT_PRESETS.map((preset) => preset.id)).toEqual(['read', 'noteLeft', 'compare', 'organize'])
    expect(availableLayoutPresets(true).map((preset) => preset.id)).toEqual(['read', 'noteLeft', 'compare', 'organize'])
    expect(availableLayoutPresets(false).map((preset) => preset.id)).toEqual(['read', 'noteLeft', 'compare'])
    expect(LAYOUT_PRESETS.map((preset) => preset.label)).toEqual(['읽기', '노트 왼쪽', '비교', '정리'])
  })
})

describe('applyLayoutPreset — 열린 탭을 그 모양으로 다시 놓는다', () => {
  const input = (state: PanesState, id: Parameters<typeof applyLayoutPreset>[0]['id'], more: Partial<Parameters<typeof applyLayoutPreset>[0]> = {}) => ({
    id,
    panes: state,
    channels: DEFAULT_CHANNELS,
    anchor: 'left' as const,
    lastTouched: null,
    fallbackNote: null,
    ...more,
  })

  it('읽기: 문서 | 노트, 같은 색. 보던 문서와 마지막으로 만진 노트가 보인다', () => {
    const state = panes({ left: strip([pdf('A'), pdf('B')], 'B'), right: strip([note('N1'), note('N2')], 'N1') })
    const result = applyLayoutPreset(input(state, 'read', { lastTouched: 'N2' }))
    expect(result.layout).toBe('cols2')
    expect(ids(result.panes.left)).toEqual(['A', 'B'])
    expect(result.panes.left.activeId).toBe('B')
    expect(ids(result.panes.right)).toEqual(['N1', 'N2'])
    expect(result.panes.right.activeId).toBe('N2')
    expect(result.channels.left).toBe(result.channels.right)
    expect(result.channels.left).not.toBeNull()
  })

  it('읽기: 흩어진 탭을 모은다(문서는 왼쪽, 노트는 오른쪽). 하나도 닫지 않는다', () => {
    const state = panes({ left: strip([pdf('A'), note('N1')], 'A'), right: strip([md('M'), note('N2')], 'N2'), third: strip([pdf('C')]) })
    const result = applyLayoutPreset(input(state, 'read'))
    expect(ids(result.panes.left)).toEqual(['A', 'M', 'C'])
    expect(ids(result.panes.right)).toEqual(['N1', 'N2'])
    expect(sorted(result.panes)).toEqual(sorted(state))
    expect(result.panes.third).toEqual(emptyTabs)
  })

  it('읽기: 노트 탭이 없으면 준 노트(마지막으로 만진·문서의·새 노트)를 노트 칸에 놓는다', () => {
    const state = panes({ left: strip([pdf('A')]) })
    const result = applyLayoutPreset(input(state, 'read', { fallbackNote: note('N') }))
    expect(ids(result.panes.right)).toEqual(['N'])
    expect(result.panes.right.activeId).toBe('N')
    // 준 노트도 없으면 노트 칸은 비어 있다(탭을 만들어 내지 않는다)
    expect(applyLayoutPreset(input(state, 'read')).panes.right).toEqual(emptyTabs)
  })

  it('노트 왼쪽: 노트 | 문서', () => {
    const state = panes({ left: strip([pdf('A')]), right: strip([note('N')]) })
    const result = applyLayoutPreset(input(state, 'noteLeft'))
    expect(result.layout).toBe('cols2')
    expect(ids(result.panes.left)).toEqual(['N'])
    expect(ids(result.panes.right)).toEqual(['A'])
    expect(result.channels.left).toBe(result.channels.right)
    expect(result.focus).toBe('right')
  })

  it('비교: 문서 둘(위·아래) | 노트 둘(위·아래), 두 쌍은 서로 다른 색', () => {
    const state = panes({ left: strip([pdf('A'), pdf('B')], 'A'), right: strip([note('N1'), note('N2')], 'N1') })
    const result = applyLayoutPreset(input(state, 'compare', { lastTouched: 'N1' }))
    expect(result.layout).toBe('grid4')
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
    expect(result.layout).toBe('cols2')
    expect(ids(result.panes.left)).toEqual(['N', 'A'])
    expect(result.panes.left.activeId).toBe('N')
    expect(ids(result.panes.right)).toEqual(['C'])
    expect(sorted(result.panes)).toEqual(sorted(state))
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
