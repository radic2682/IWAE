import { describe, expect, it } from 'vitest'
import { leaves, paneNode, splitLeaf } from '../core/layoutTree'
import {
  FLOAT_DEFAULT_H, FLOAT_DEFAULT_W, FLOAT_HEAD_H, FLOAT_MIN_H, FLOAT_MIN_W, MAX_FLOATS, TRANSLATOR_FLOAT_H, TRANSLATOR_FLOAT_W,
  addFloat, closeFloat, embedPane, floatBoxIn, floatFromBox, floatPane, isFloatPane, moveFloatBox, openTranslatorFloat, patchFloat, raiseFloat, resizeFloatBox,
  selectableOrder, toggleFloating, toggleTranslatorFloat, translatorFloatFor, visibleFloats, type FloatModel,
} from './floatingPanes'
import { activeScreenOf, blankScreen, normalizeFloats, screenPaneIds, withActiveWorkspace, workspaceOf, type Screen, type ScreensState } from './screens'
import { closePaneTree, dockTab, moveTabToPaneAt } from './tabDock'
import { tabsOf, type Tab } from './tabs'

const doc = (id: string): Tab => ({ id, title: id, kind: 'pdf' })

/** [a | b | c] 세 칸, a 에 문서 d1, b 에 문서 d2, 만지는 칸은 a */
function threePanes(): FloatModel {
  const base: Screen = { ...blankScreen('읽기'), layout: paneNode('a') }
  const a = 'a'
  let layout = splitLeaf(base.layout, a, 'h', 'b')
  layout = splitLeaf(layout, 'b', 'h', 'c')
  const screen: Screen = {
    ...base,
    layout,
    panes: { [a]: { tabs: [doc('d1')], activeId: 'd1' }, b: { tabs: [doc('d2')], activeId: 'd2' }, c: { tabs: [], activeId: null } },
    channels: { [a]: 'blue', b: 'green', c: 'orange' },
  }
  return { screens: { screens: [screen], activeScreen: screen.id, lastScreen: null }, activePane: a }
}

const ok = (outcome: ReturnType<typeof floatPane>): FloatModel => {
  if ('error' in outcome) throw new Error(outcome.error)
  return outcome.model
}
const screenOf = (model: FloatModel) => activeScreenOf(model.screens)

describe('float-pane: 칸을 떼어 띄운다', () => {
  it('트리에서 빠지고 떠 있는 칸이 되며, 탭 · 색은 그대로이고 그 칸이 만지는 칸이 된다', () => {
    const before = threePanes()
    const model = ok(floatPane(before, 'b'))
    const screen = screenOf(model)
    expect(leaves(screen.layout)).toEqual([before.activePane, 'c'])
    expect(screen.floats).toHaveLength(1)
    expect(screen.floats[0]).toMatchObject({ paneId: 'b', anchor: { kind: 'screen' }, w: FLOAT_DEFAULT_W, h: FLOAT_DEFAULT_H, collapsed: false })
    expect(tabsOf(screen.panes, 'b').tabs.map((tab) => tab.id)).toEqual(['d2'])
    expect(screen.channels.b).toBe('green')
    expect(model.activePane).toBe('b')
    expect(isFloatPane(screen, 'b')).toBe(true)
  })

  it('기본은 만지는 칸을 띄운다', () => {
    const before = threePanes()
    const model = ok(floatPane(before))
    expect(screenOf(model).floats[0]!.paneId).toBe(before.activePane)
  })

  it('하나뿐인 칸은 띄울 수 없다', () => {
    const screen = blankScreen('읽기')
    const model: FloatModel = { screens: { screens: [screen], activeScreen: screen.id, lastScreen: null }, activePane: leaves(screen.layout)[0]! }
    expect(floatPane(model)).toEqual({ error: '칸이 하나뿐이라 띄울 수 없습니다' })
  })

  it('이미 떠 있는 칸 · 없는 칸 · 상한(4개)은 막는다', () => {
    const model = ok(floatPane(threePanes(), 'b'))
    expect(floatPane(model, 'b')).toEqual({ error: '이미 떠 있는 칸입니다' })
    expect(floatPane(model, 'zz')).toEqual({ error: '칸을 찾을 수 없습니다' })
    // 칸 여섯을 만들고 넷을 띄운 뒤 다섯째
    let screen = screenOf(threePanes())
    let layout = screen.layout
    const ids = ['d', 'e', 'f']
    let last = 'c'
    for (const id of ids) { layout = splitLeaf(layout, last, 'h', id); last = id }
    screen = { ...screen, layout, panes: { ...screen.panes, d: { tabs: [], activeId: null }, e: { tabs: [], activeId: null }, f: { tabs: [], activeId: null } }, channels: { ...screen.channels, d: 'blue', e: 'blue', f: 'blue' } }
    let current: FloatModel = { screens: { screens: [screen], activeScreen: screen.id, lastScreen: null }, activePane: 'b' }
    for (const id of ['b', 'c', 'd', 'e']) current = ok(floatPane(current, id))
    expect(screenOf(current).floats).toHaveLength(MAX_FLOATS)
    expect(floatPane(current, 'f')).toEqual({ error: '떠 있는 칸은 4개까지입니다' })
  })

  it('크게 보던 칸을 띄우면 크게는 풀린다', () => {
    const before = threePanes()
    const zoomed: ScreensState = { ...before.screens, screens: [{ ...screenOf(before), zoomed: 'b' }] }
    const model = ok(floatPane({ ...before, screens: zoomed }, 'b'))
    expect(screenOf(model).zoomed).toBeNull()
  })

  it('띄운 칸에 붙어 있던 떠 있는 칸은 화면에 붙는다', () => {
    const first = ok(floatPane(threePanes(), 'c'))
    const anchored = ok(addFloat(first, { anchorPane: 'b' }) as ReturnType<typeof floatPane>)
    expect(screenOf(anchored).floats.at(-1)!.anchor).toEqual({ kind: 'pane', paneId: 'b' })
    const after = ok(floatPane({ ...anchored, activePane: 'b' }, 'b'))
    expect(screenOf(after).floats.find((float) => float.paneId !== 'b' && float.paneId !== 'c')!.anchor).toEqual({ kind: 'screen' })
  })
})

describe('embed-pane: 트리로 되돌린다', () => {
  it('만지는 칸이 떠 있는 칸이면 그 칸을, 붙은 칸이 없으면 만지던 트리 칸의 오른쪽에 나누어 넣는다', () => {
    const floated = ok(floatPane(threePanes(), 'b'))
    const model = ok(embedPane(floated))
    const screen = screenOf(model)
    expect(screen.floats).toHaveLength(0)
    expect(leaves(screen.layout)).toContain('b')
    expect(model.activePane).toBe('b')
    expect(tabsOf(screen.panes, 'b').tabs.map((tab) => tab.id)).toEqual(['d2'])
    expect(screen.channels.b).toBe('green')
  })

  it('붙은 칸이 있으면 그 칸의 오른쪽에 넣는다', () => {
    const base = threePanes()
    const created = addFloat(base, { anchorPane: 'c', tab: doc('d9') })
    if ('error' in created) throw new Error(created.error)
    const model = ok(embedPane(created.model))
    const order = leaves(screenOf(model).layout)
    expect(order.indexOf(created.paneId)).toBe(order.indexOf('c') + 1)
  })

  it('만지는 칸이 트리 칸이면 가장 위의 떠 있는 칸을 넣는다', () => {
    let model = ok(floatPane(threePanes(), 'b'))
    model = ok(floatPane(model, 'c'))
    const back = ok(embedPane({ ...model, activePane: leaves(screenOf(model).layout)[0]! }))
    expect(screenOf(back).floats.map((float) => float.paneId)).toEqual(['b'])
    expect(leaves(screenOf(back).layout)).toContain('c')
  })

  it('떠 있는 칸이 없으면 알리고, 칸이 상한이면 막는다', () => {
    expect(embedPane(threePanes())).toEqual({ error: '떠 있는 칸이 없습니다' })
    const floated = ok(floatPane(threePanes(), 'b'))
    const screen = screenOf(floated)
    let layout = screen.layout
    let last = 'c'
    const extra = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6']
    for (const id of extra) { layout = splitLeaf(layout, last, 'h', id); last = id }
    const crowded: FloatModel = { ...floated, screens: { ...floated.screens, screens: [{ ...screen, layout }] } }
    expect(embedPane(crowded)).toEqual({ error: '칸은 8개까지입니다' })
  })

  it('칸이 너무 작으면 막는다(sizeOf)', () => {
    const floated = ok(floatPane(threePanes(), 'b'))
    expect(embedPane(floated, () => ({ width: 300, height: 400 }))).toEqual({ error: '칸이 너무 작습니다' })
  })
})

describe('toggle-floating: 모두 숨기고 보이기', () => {
  it('없으면 알리고, 숨기면 floatsHidden 이 되어 visibleFloats 가 비며, 한 번 더 하면 보인다', () => {
    expect(toggleFloating(threePanes())).toEqual({ error: '떠 있는 칸이 없습니다' })
    const floated = ok(floatPane(threePanes(), 'b'))
    const hidden = ok(toggleFloating(floated))
    expect(screenOf(hidden).floatsHidden).toBe(true)
    expect(visibleFloats(screenOf(hidden))).toEqual([])
    expect(screenOf(hidden).floats).toHaveLength(1)
    // 숨기면 만지던 떠 있는 칸 대신 트리의 칸을 만진다
    expect(leaves(screenOf(hidden).layout)).toContain(hidden.activePane)
    const shown = ok(toggleFloating(hidden))
    expect(screenOf(shown).floatsHidden).toBe(false)
    expect(visibleFloats(screenOf(shown))).toHaveLength(1)
  })

  it('select-pane 이 도는 칸에는 보이는 떠 있는 칸만 든다', () => {
    const floated = ok(floatPane(threePanes(), 'b'))
    expect(selectableOrder(screenOf(floated))).toEqual([...leaves(screenOf(floated).layout), 'b'])
    const hidden = ok(toggleFloating(floated))
    expect(selectableOrder(screenOf(hidden))).toEqual(leaves(screenOf(hidden).layout))
  })

  it('새 떠 있는 칸은 숨김을 푼다', () => {
    const hidden = ok(toggleFloating(ok(floatPane(threePanes(), 'b'))))
    const created = addFloat(hidden)
    if ('error' in created) throw new Error(created.error)
    expect(screenOf(created.model).floatsHidden).toBe(false)
  })
})

describe('display-popup · 번역기', () => {
  it('번역기 탭을 담은 떠 있는 칸을 새로 만들고 만지는 칸으로 삼는다', () => {
    const model = ok(openTranslatorFloat(threePanes()))
    const screen = screenOf(model)
    const float = screen.floats[0]!
    expect(float).toMatchObject({ anchor: { kind: 'screen' }, w: TRANSLATOR_FLOAT_W, h: TRANSLATOR_FLOAT_H })
    expect(tabsOf(screen.panes, float.paneId).tabs).toEqual([{ id: `translator:${float.paneId}`, title: '번역기', kind: 'translator' }])
    expect(model.activePane).toBe(float.paneId)
    expect(leaves(screen.layout)).toHaveLength(3)
  })

  it('같은 곳에 붙은 번역기가 이미 있으면 새로 만들지 않고 보여 준다(숨김 · 접힘도 푼다)', () => {
    const first = ok(openTranslatorFloat(threePanes(), 'b'))
    const paneId = screenOf(first).floats[0]!.paneId
    const collapsed = patchFloat(first.screens, paneId, { collapsed: true })
    const hidden = ok(toggleFloating({ screens: collapsed, activePane: 'b' }))
    const again = ok(openTranslatorFloat(hidden, 'b'))
    expect(screenOf(again).floats).toHaveLength(1)
    expect(screenOf(again).floatsHidden).toBe(false)
    expect(screenOf(again).floats[0]!.collapsed).toBe(false)
    expect(again.activePane).toBe(paneId)
  })

  it('번역기 단추: 이 칸의 번역기가 있으면 닫고 없으면 연다. 다른 칸의 번역기는 건드리지 않는다', () => {
    const opened = ok(toggleTranslatorFloat(threePanes(), 'a'))
    expect(translatorFloatFor(screenOf(opened), 'a')).toBeDefined()
    expect(translatorFloatFor(screenOf(opened), 'b')).toBeUndefined()
    const other = ok(toggleTranslatorFloat(opened, 'b'))
    expect(screenOf(other).floats).toHaveLength(2)
    const closed = ok(toggleTranslatorFloat(other, 'a'))
    expect(translatorFloatFor(screenOf(closed), 'a')).toBeUndefined()
    expect(translatorFloatFor(screenOf(closed), 'b')).toBeDefined()
  })

  it('상한(4개)이면 알린다', () => {
    // 같은 칸의 번역기는 재사용되므로 화면에 붙은 빈 칸으로 채운다
    let crowded = threePanes()
    for (let index = 0; index < MAX_FLOATS; index += 1) {
      const added = addFloat(crowded)
      if ('error' in added) throw new Error(added.error)
      crowded = added.model
    }
    expect(openTranslatorFloat(crowded)).toEqual({ error: '떠 있는 칸은 4개까지입니다' })
  })
})

describe('닫기와 붙은 칸 따라가기', () => {
  it('닫으면 번역기 탭은 버리고 다른 탭은 돌아갈 칸에 합친다', () => {
    const floated = ok(floatPane(threePanes(), 'b'))
    const closed = ok(closeFloat(floated, 'b'))
    const screen = screenOf(closed)
    expect(screen.floats).toHaveLength(0)
    expect(screen.panes.b).toBeUndefined()
    expect(screen.channels.b).toBeUndefined()
    // 문서 d2 는 만지던 칸(a)으로 합쳐진다
    expect(tabsOf(screen.panes, floated.activePane === 'b' ? leaves(screen.layout)[0]! : floated.activePane).tabs.map((tab) => tab.id)).toContain('d2')
  })

  it('번역기 떠 있는 칸을 닫으면 아무 탭도 트리로 새지 않는다', () => {
    const opened = ok(openTranslatorFloat(threePanes(), 'a'))
    const closed = ok(closeFloat(opened, screenOf(opened).floats[0]!.paneId))
    const screen = screenOf(closed)
    expect(Object.values(screen.panes).flatMap((state) => state.tabs).some((tab) => tab.kind === 'translator')).toBe(false)
    expect(closed.activePane).toBe('a')
  })

  it('붙은 칸이 닫히면 화면에 붙고, 있던 자리를 화면 비율로 옮겨 적는다', () => {
    const opened = ok(openTranslatorFloat(threePanes(), 'c'))
    const float = screenOf(opened).floats[0]!
    expect(float.anchor).toEqual({ kind: 'pane', paneId: 'c' })
    const screen = screenOf(opened)
    const closed = closePaneTree(workspaceOf(screen), 'c')!
    const next = withActiveWorkspace(opened.screens, { panes: closed.panes, channels: closed.channels, layout: closed.layout })
    const moved = activeScreenOf(next).floats[0]!
    expect(moved.anchor).toEqual({ kind: 'screen' })
    // 칸 c 는 맨 오른쪽 사분의 일(x 0.75, 너비 0.25)이었다: 칸 안 55% → 화면 비율
    expect(moved.x).toBeCloseTo(0.75 + 0.25 * 0.55, 5)
    expect(moved.w).toBe(TRANSLATOR_FLOAT_W)
    // 떠 있는 칸의 탭 · 색은 칸 닫기가 지우지 않는다
    expect(activeScreenOf(next).panes[float.paneId]).toBeDefined()
    expect(activeScreenOf(next).channels[float.paneId]).toBeDefined()
  })

  it('칸이 닫혀도 다른 칸에 붙은 떠 있는 칸은 그대로다', () => {
    const opened = ok(openTranslatorFloat(threePanes(), 'a'))
    const screen = screenOf(opened)
    const closed = closePaneTree(workspaceOf(screen), 'c')!
    const next = withActiveWorkspace(opened.screens, { panes: closed.panes, channels: closed.channels, layout: closed.layout })
    expect(activeScreenOf(next).floats[0]!.anchor).toEqual({ kind: 'pane', paneId: 'a' })
  })

  it('normalizeFloats 는 바뀐 것이 없으면 같은 객체를 돌려준다', () => {
    const screen = screenOf(threePanes())
    expect(normalizeFloats(screen)).toBe(screen)
    expect(screenPaneIds(screen)).toEqual(leaves(screen.layout))
  })

  it('raiseFloat 은 맨 위로 올리고, patchFloat 은 없는 칸이면 같은 객체', () => {
    let model = ok(floatPane(threePanes(), 'b'))
    model = ok(floatPane(model, 'c'))
    const raised = raiseFloat(model.screens, 'b')
    expect(activeScreenOf(raised).floats.map((float) => float.paneId)).toEqual(['c', 'b'])
    expect(raiseFloat(raised, 'b')).toBe(raised)
    expect(patchFloat(model.screens, 'zz', { x: 0.5 })).toBe(model.screens)
  })
})

describe('탭 끌어 놓기와 떠 있는 칸', () => {
  it('탭을 떠 있는 칸 가운데로 끌어 놓으면 그 칸 줄에 들어간다(떠 있는 칸은 트리에 끼지 않는다)', () => {
    const model = ok(floatPane(threePanes(), 'b'))
    const screen = screenOf(model)
    const moved = moveTabToPaneAt(screen.panes, 'd1', 'b', 1)
    expect(tabsOf(moved, 'b').tabs.map((tab) => tab.id)).toEqual(['d2', 'd1'])
    expect(tabsOf(moved, 'b').activeId).toBe('d1')
    expect(tabsOf(moved, 'a').tabs).toEqual([])
  })

  it('떠 있는 칸의 탭을 트리 칸 가장자리로 끌면 거기서 갈라져 새 칸이 되고, 떠 있는 칸의 색은 새 칸이 받는다', () => {
    const model = ok(floatPane(threePanes(), 'b'))
    const screen = screenOf(model)
    const result = dockTab(workspaceOf(screen), 'd2', 'c', 'right')
    expect(result).not.toBeNull()
    if (result === null || 'refused' in result) throw new Error('나누지 못했다')
    expect(leaves(result.layout)).toEqual(['a', 'c', result.newPane])
    expect(tabsOf(result.panes, result.newPane).tabs.map((tab) => tab.id)).toEqual(['d2'])
    expect(result.channels[result.newPane]).toBe('green')
    // 떠 있는 칸의 칸 상태는 남는다(비면 앱이 그 칸을 닫는다)
    expect(tabsOf(result.panes, 'b').tabs).toEqual([])
    expect(result.sourcePane).toBe('b')
    expect(result.collapsed).toBe(false)
  })
})

describe('자리 · 크기 가두기', () => {
  const anchor = { width: 800, height: 600 }
  const float = { x: 0.1, y: 0.1, w: 300, h: 200, collapsed: false }

  it('저장된 상자를 붙은 곳 안에 가둔다: 비율 자리를 px 로, 넘치면 안쪽으로', () => {
    expect(floatBoxIn(float, anchor)).toEqual({ x: 80, y: 60, w: 300, h: 200 })
    expect(floatBoxIn({ ...float, x: 0.95, y: 0.95 }, anchor)).toEqual({ x: 500, y: 400, w: 300, h: 200 })
    expect(floatBoxIn({ ...float, x: -1, y: -1 }, anchor)).toMatchObject({ x: 0, y: 0 })
  })

  it('붙은 곳보다 큰 상자는 붙은 곳 크기로, 작은 곳에서는 최소 크기도 줄어든다', () => {
    expect(floatBoxIn({ ...float, w: 2000, h: 2000 }, anchor)).toEqual({ x: 0, y: 0, w: 800, h: 600 })
    expect(floatBoxIn({ ...float, w: 10, h: 10 }, anchor)).toMatchObject({ w: FLOAT_MIN_W, h: FLOAT_MIN_H })
    expect(floatBoxIn({ ...float, w: 10, h: 10 }, { width: 200, height: 100 })).toMatchObject({ x: 0, y: 0, w: 200, h: 100 })
  })

  it('접힌 칸은 머리만 남기고, 펼쳤을 때의 높이는 저장에 그대로 둔다', () => {
    expect(floatBoxIn({ ...float, collapsed: true }, anchor).h).toBe(FLOAT_HEAD_H)
    const stored = { paneId: 'x', anchor: { kind: 'screen' as const }, ...float, collapsed: true }
    const saved = floatFromBox(stored, { x: 10, y: 20, w: 320, h: FLOAT_HEAD_H }, anchor)
    expect(saved.h).toBe(200)
    expect(saved).toMatchObject({ x: 10 / 800, y: 20 / 600, w: 320, collapsed: true })
  })

  it('끌어 옮기기는 붙은 곳 밖으로 나가지 않는다', () => {
    const box = floatBoxIn(float, anchor)
    expect(moveFloatBox(box, 50, 30, anchor)).toMatchObject({ x: 130, y: 90 })
    expect(moveFloatBox(box, -500, -500, anchor)).toMatchObject({ x: 0, y: 0 })
    expect(moveFloatBox(box, 9999, 9999, anchor)).toMatchObject({ x: 500, y: 400, w: 300, h: 200 })
  })

  it('크기 바꾸기는 최소 크기 이상, 붙은 곳의 오른쪽·아래 가장자리까지', () => {
    const box = floatBoxIn(float, anchor)
    expect(resizeFloatBox(box, 100, 50, anchor)).toMatchObject({ x: 80, y: 60, w: 400, h: 250 })
    expect(resizeFloatBox(box, -999, -999, anchor)).toMatchObject({ w: FLOAT_MIN_W, h: FLOAT_MIN_H })
    expect(resizeFloatBox(box, 9999, 9999, anchor)).toMatchObject({ w: 720, h: 540 })
  })

  it('저장 비율은 붙은 곳 크기가 바뀌어도 같은 자리를 가리킨다', () => {
    const stored = { paneId: 'x', anchor: { kind: 'screen' as const }, ...float }
    const saved = floatFromBox(stored, { x: 400, y: 300, w: 300, h: 200 }, anchor)
    expect(saved).toMatchObject({ x: 0.5, y: 0.5 })
    expect(floatBoxIn(saved, { width: 1000, height: 800 })).toMatchObject({ x: 500, y: 400 })
  })
})
