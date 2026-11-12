import { describe, expect, it } from 'vitest'
import { leaves, paneNode, splitLeaf, type LayoutNode } from '../core/layoutTree'
import {
  activeScreenOf, addScreen, allScreenPaneIds, blankScreen, breakPane, closeScreen, lastScreenOf, renameScreen, reorderScreen,
  setZoomed, statusScreens, stepScreen, switchScreen, switchScreenAt, withActiveWorkspace, workspaceOf, type Screen, type ScreensState,
} from './screens'
import type { TabsState } from './tabs'

const tabs = (...ids: string[]): TabsState => ({ tabs: ids.map((id) => ({ id, title: id, kind: 'pdf' as const })), activeId: ids[0] ?? null })

function screenOf(id: string, name: string, panes: Record<string, TabsState>): Screen {
  const ids = Object.keys(panes)
  let layout: LayoutNode = paneNode(ids[0]!)
  for (const pane of ids.slice(1)) layout = splitLeaf(layout, ids[0]!, 'h', pane)
  return { id, name, layout, panes, channels: Object.fromEntries(ids.map((pane) => [pane, 'blue' as const])), zoomed: null }
}

const three = (): ScreensState => ({
  screens: [screenOf('w1', '읽기', { a: tabs('d1') }), screenOf('w2', '비교', { b: tabs('d2'), c: tabs('d3') }), screenOf('w3', '정리', { e: tabs() })],
  activeScreen: 'w1',
  lastScreen: null,
})

describe('화면 묶음', () => {
  it('보는 화면의 탭·색·배치만 바꾸고 다른 화면은 건드리지 않는다', () => {
    const state = three()
    const next = withActiveWorkspace(state, { ...workspaceOf(state.screens[0]!), panes: { a: tabs('d1', 'd9') } })
    expect(next.screens[0]!.panes.a!.tabs).toHaveLength(2)
    expect(next.screens[1]).toBe(state.screens[1])
    expect(next.screens[2]).toBe(state.screens[2])
    // 바꾼 것이 없으면 같은 상태
    expect(withActiveWorkspace(state, workspaceOf(state.screens[0]!))).toBe(state)
  })

  it('모든 화면의 칸 id 를 모아 준다(새 칸 id 가 겹치지 않게)', () => {
    expect(allScreenPaneIds(three()).sort()).toEqual(['a', 'b', 'c', 'e'])
  })

  it('화면 옮기기: 앞 화면이 lastScreen 이 되고, 번호·다음·이전·마지막으로도 간다', () => {
    let state = switchScreen(three(), 'w3')
    expect(state).toMatchObject({ activeScreen: 'w3', lastScreen: 'w1' })
    state = lastScreenOf(state)
    expect(state).toMatchObject({ activeScreen: 'w1', lastScreen: 'w3' })
    expect(switchScreenAt(state, 1).activeScreen).toBe('w2')
    expect(stepScreen(three(), -1).activeScreen).toBe('w3')
    expect(stepScreen(three(), 1).activeScreen).toBe('w2')
    expect(switchScreen(state, 'nope')).toBe(state)
  })

  it('새 화면은 맨 뒤에 붙고 그 화면으로 간다', () => {
    const state = addScreen(three(), blankScreen('화면 3'))
    expect(state.screens.map((screen) => screen.name)).toEqual(['읽기', '비교', '정리', '화면 3'])
    expect(state).toMatchObject({ activeScreen: state.screens[3]!.id, lastScreen: 'w1' })
    expect(addScreen(three(), blankScreen('x'), false).activeScreen).toBe('w1')
  })

  it('이름 바꾸기: 빈 이름은 무시, 앞뒤 공백은 뗀다', () => {
    const state = three()
    expect(renameScreen(state, 'w2', ' 대조 ').screens[1]!.name).toBe('대조')
    expect(renameScreen(state, 'w2', '  ')).toBe(state)
  })

  it('순서 바꾸기: 끌어 놓은 자리로 옮기고 보는 화면은 그대로다', () => {
    const state = reorderScreen(three(), 'w1', 2)
    expect(state.screens.map((screen) => screen.id)).toEqual(['w2', 'w3', 'w1'])
    expect(state.activeScreen).toBe('w1')
    expect(reorderScreen(three(), 'w3', 0).screens.map((screen) => screen.id)).toEqual(['w3', 'w1', 'w2'])
    expect(reorderScreen(three(), 'w2', 1).screens.map((screen) => screen.id)).toEqual(['w1', 'w2', 'w3'])
  })

  it('화면 닫기: 보던 화면을 닫으면 바로 앞 화면으로, 하나뿐이면 못 닫는다', () => {
    const state = switchScreen(switchScreen(three(), 'w3'), 'w2')
    expect(closeScreen(state, 'w2')).toMatchObject({ activeScreen: 'w3' })
    expect(closeScreen(three(), 'w3')).toMatchObject({ activeScreen: 'w1' })
    expect(closeScreen({ screens: [state.screens[0]!], activeScreen: 'w1', lastScreen: null }, 'w1')).toBeNull()
  })

  it('크게: 그 화면의 칸만 정할 수 있고, 그 칸이 없어지면 풀린다', () => {
    let state = switchScreen(three(), 'w2')
    expect(setZoomed(state, 'a')).toBe(state)
    state = setZoomed(state, 'b')
    expect(activeScreenOf(state).zoomed).toBe('b')
    const closed = withActiveWorkspace(state, { ...workspaceOf(activeScreenOf(state)), layout: paneNode('c') })
    expect(activeScreenOf(closed).zoomed).toBeNull()
  })

  it('새 화면으로 떼기: 그 칸의 탭이 새 화면으로 가고 원래 화면은 줄어든다. 칸이 하나뿐이면 못 한다', () => {
    const state = switchScreen(three(), 'w2')
    const next = breakPane(state, 'c', '화면 3')!
    expect(next.screens).toHaveLength(4)
    expect(leaves(next.screens[1]!.layout)).toEqual(['b'])
    expect(Object.keys(next.screens[1]!.panes)).toEqual(['b'])
    const created = next.screens[3]!
    expect(created.panes.c!.tabs.map((tab) => tab.id)).toEqual(['d3'])
    expect(next).toMatchObject({ activeScreen: created.id, lastScreen: 'w2' })
    expect(breakPane(three(), 'a', 'x')).toBeNull()
  })

  it('상태 줄 글: 보는 화면은 *, 바로 앞 화면은 -', () => {
    expect(statusScreens(switchScreen(three(), 'w2'))).toBe('0:읽기- 1:비교* 2:정리')
  })
})
