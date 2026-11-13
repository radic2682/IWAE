import { describe, expect, it } from 'vitest'
import { layoutForLegacyId, leaves, paneNode } from '../core/layoutTree'
import { activeScreenOf, allScreenPaneIds, type Screen, type ScreensState } from './screens'
import { attachTabToPane, tearTabToScreen } from './tabTearOff'
import type { Tab } from './tabs'

const note = (id: string): Tab => ({ id, title: id, kind: 'memoNote' })
const md = (id: string): Tab => ({ id, title: id, kind: 'markdown', preview: true })
const tabs = (...list: Tab[]) => ({ tabs: list, activeId: list[0]?.id ?? null })

const screen = (id: string, over: Partial<Screen>): Screen => ({ id, name: id, layout: paneNode('x'), panes: {}, channels: {}, zoomed: null, floats: [], ...over })

/** 화면 w1: 두 칸(a 노트 둘 · b Markdown), 화면 w2: 한 칸 */
function base(): ScreensState {
  return {
    screens: [
      screen('w1', { layout: layoutForLegacyId('cols2', ['a', 'b']), panes: { a: tabs(note('n1'), note('n2')), b: tabs(md('m1')) }, channels: { a: 'green', b: 'blue' } }),
      screen('w2', { layout: paneNode('c'), panes: { c: tabs(note('n3')) }, channels: { c: 'orange' } }),
    ],
    activeScreen: 'w1',
    lastScreen: null,
  }
}

describe('tearTabToScreen — 탭을 새 화면으로 떼어 내기', () => {
  it('탭이 새 화면(맨 뒤, 칸 하나)에 담기고 원래 칸에서는 빠지며, 보는 화면은 그대로다', () => {
    const state = base()
    const torn = tearTabToScreen(state, 'n1', '화면 3')!
    expect(torn.screens.screens.map((s) => s.id)).toEqual(['w1', 'w2', torn.screenId])
    const created = torn.screens.screens[2]!
    expect(created.name).toBe('화면 3')
    expect(leaves(created.layout)).toEqual([torn.pane])
    expect(created.panes[torn.pane]!.tabs.map((t) => t.id)).toEqual(['n1'])
    expect(created.panes[torn.pane]!.activeId).toBe('n1')
    expect(created.channels[torn.pane]).toBe('green')
    expect(activeScreenOf(torn.screens).id).toBe('w1')
    expect(torn.screens.activeScreen).toBe('w1')
    expect(torn.screens.screens[0]!.panes.a!.tabs.map((t) => t.id)).toEqual(['n2'])
    // 새 칸 id 는 모든 화면의 칸과 겹치지 않는다
    const ids = allScreenPaneIds(torn.screens)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('Markdown 탭의 미리보기 표시는 떼어 낼 때 풀린다', () => {
    const torn = tearTabToScreen(base(), 'm1', 'md')!
    expect(torn.screens.screens[2]!.panes[torn.pane]!.tabs[0]).toEqual({ id: 'm1', title: 'm1', kind: 'markdown' })
  })

  it('칸의 마지막 탭을 떼어도 칸은 닫히지 않고 빈 칸으로 남는다(하나뿐인 칸이어도)', () => {
    const torn = tearTabToScreen(base(), 'm1', 'md')!
    const first = torn.screens.screens[0]!
    expect(leaves(first.layout)).toEqual(['a', 'b'])
    expect(first.panes.b!.tabs).toEqual([])
    const lone = tearTabToScreen(torn.screens, 'n3', 'again')!
    expect(lone.screens.screens[1]!.panes.c!.tabs).toEqual([])
    expect(leaves(lone.screens.screens[1]!.layout)).toEqual(['c'])
  })

  it('다른 화면에 있는 탭도 떼어 내고, 미리 정한 화면 id 를 쓴다', () => {
    const torn = tearTabToScreen(base(), 'n3', 'x', 'w9')!
    expect(torn.screenId).toBe('w9')
    expect(torn.screens.screens[2]!.id).toBe('w9')
  })

  it('없는 탭이거나 화면 id 가 이미 있으면 null', () => {
    expect(tearTabToScreen(base(), 'nope', 'x')).toBeNull()
    expect(tearTabToScreen(base(), 'n1', 'x', 'w2')).toBeNull()
  })
})

describe('attachTabToPane — 떼어 낸 탭을 다른 창의 탭 줄에 붙이기', () => {
  it('떼어 낸 화면의 탭이 대상 칸의 그 자리로 가고, 비어 버린 떼어 낸 화면은 닫힌다', () => {
    const torn = tearTabToScreen(base(), 'n3', 'x', 'w9')!
    const next = attachTabToPane(torn.screens, 'n3', 'a', 1)!
    expect(next.screens.map((s) => s.id)).toEqual(['w1', 'w2'])
    expect(next.screens.find((s) => s.id === 'w1')!.panes.a!.tabs.map((t) => t.id)).toEqual(['n1', 'n3', 'n2'])
    expect(next.screens.find((s) => s.id === 'w1')!.panes.a!.activeId).toBe('n3')
    // 떼어 낼 때 만든 화면 w9 는 닫히고, 원래 화면 w2 에는 빈 칸이 남는다
    expect(next.screens.some((s) => s.id === 'w9')).toBe(false)
  })

  it('여러 칸이 있는 화면에서 탭을 빼도 그 화면은 닫히지 않는다', () => {
    const torn = tearTabToScreen(base(), 'n2', 'x', 'w9')!
    const next = attachTabToPane(torn.screens, 'n2', 'c', 0)!
    expect(next.screens.map((s) => s.id)).toEqual(['w1', 'w2'])
    expect(next.screens[1]!.panes.c!.tabs.map((t) => t.id)).toEqual(['n2', 'n3'])
    expect(next.screens[0]!.panes.a!.tabs.map((t) => t.id)).toEqual(['n1'])
  })

  it('같은 화면 안에서는 자리를 옮긴다', () => {
    const next = attachTabToPane(base(), 'n1', 'b', 0)!
    expect(next.screens[0]!.panes.b!.tabs.map((t) => t.id)).toEqual(['n1', 'm1'])
    expect(next.screens[0]!.panes.a!.tabs.map((t) => t.id)).toEqual(['n2'])
  })

  it('없는 탭 · 없는 칸은 null', () => {
    expect(attachTabToPane(base(), 'nope', 'a', 0)).toBeNull()
    expect(attachTabToPane(base(), 'n1', 'zzz', 0)).toBeNull()
  })
})
