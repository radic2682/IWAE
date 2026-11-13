import { describe, expect, it } from 'vitest'
import { MAX_PANES, layoutForCount, layoutForLegacyId, leaves, paneCount, paneNode, shapeOf, type LayoutNode } from '../../core/layoutTree'
import { closeNoteBeside, pickFreeChannel, pickNotePath, placeNoteTab, rightmostPane, visibleNotePanes } from './noteBeside'
import { emptyTabs, type PanesState, type Tab, type TabsState } from './tabs'
import { DEFAULT_CHANNELS, type PaneChannels } from './workspaceChannels'

const pdf = (id: string): Tab => ({ id, title: id, kind: 'pdf' })
const note = (id: string): Tab => ({ id, title: id, kind: 'memoNote' })
const strip = (tabs: Tab[], activeId: string | null = tabs[0]?.id ?? null): TabsState => ({ tabs, activeId })
const ids = (state: { tabs: readonly Tab[] } | undefined) => state?.tabs.map((tab) => tab.id)
const channels = (c: PaneChannels = {}): PaneChannels => ({ ...c })

const single = (): LayoutNode => paneNode('L')
const cols2 = (): LayoutNode => layoutForLegacyId('cols2', ['L', 'R'])
const cols3 = (): LayoutNode => layoutForLegacyId('cols3', ['L', 'R', 'T'])
const grid4 = (): LayoutNode => layoutForLegacyId('grid4', ['L', 'R', 'T', 'F'])

describe('pickNotePath — 어느 노트를 옆에 열까', () => {
  const entries = [
    { path: '노트/일반.iwnote', title: '일반' },
    { path: '노트/S1.iwnote', title: 'S1', docId: 'docS' },
    { path: '노트/S2.iwnote', title: 'S2', docId: 'docS' },
  ]
  const owner = (docId: string) => (docId === 'docS' ? 'docS' : null)

  it('마지막으로 만진 노트가 있으면 그것(문서의 노트보다 먼저)', () => {
    expect(pickNotePath({ lastTouched: '노트/일반.iwnote', docId: 'docS', entries, docOwner: owner })).toBe('노트/일반.iwnote')
  })

  it('만진 노트가 없거나 이제 없으면 이 문서의 노트, 그것도 없으면 null(새로 만든다)', () => {
    expect(pickNotePath({ lastTouched: null, docId: 'docS', entries, docOwner: owner })).toBe('노트/S1.iwnote')
    expect(pickNotePath({ lastTouched: '노트/지움.iwnote', docId: 'docS', entries, docOwner: owner })).toBe('노트/S1.iwnote')
    expect(pickNotePath({ lastTouched: null, docId: 'docT', entries, docOwner: owner })).toBeNull()
    expect(pickNotePath({ lastTouched: null, docId: null, entries, docOwner: owner })).toBeNull()
    expect(pickNotePath({ lastTouched: null, docId: 'docS', entries: [], docOwner: owner })).toBeNull()
  })
})

describe('색·칸 고르기', () => {
  it('비어 있는 색을 고르고, 모두 썼으면 첫 색', () => {
    expect(pickFreeChannel(channels({ L: 'blue', R: 'green' }), ['L', 'R'])).toBe('orange')
    expect(pickFreeChannel(channels({ L: null }), ['L'])).toBe('blue')
    expect(pickFreeChannel(channels({ L: 'blue', R: 'green', T: 'orange' }), ['L', 'R', 'T'])).toBe('blue')
  })

  it('가장 오른쪽(같으면 위) 창', () => {
    expect(rightmostPane(cols2())).toBe('R')
    expect(rightmostPane(cols3())).toBe('T')
    expect(rightmostPane(grid4())).toBe('R')
    expect(rightmostPane(layoutForLegacyId('left1-right2', ['L', 'R', 'T']))).toBe('R')
    expect(rightmostPane(layoutForLegacyId('left2-right1', ['L', 'R', 'T']))).toBe('T')
    expect(rightmostPane(single())).toBe('L')
  })
})

describe('placeNoteTab — 옆에 노트 열기', () => {
  const input = (state: PanesState, overrides: Partial<Parameters<typeof placeNoteTab>[0]> = {}) => ({
    panes: state,
    channels: DEFAULT_CHANNELS,
    layout: single(),
    anchor: 'L',
    tab: note('N'),
    ...overrides,
  })

  it('창이 하나면 문서 창 오른쪽에 새 창을 열어 노트를 놓고, 문서 창의 색을 준다(노트 바 자리가 「읽기」 배치가 된다)', () => {
    const result = placeNoteTab(input({ L: strip([pdf('D')]) }))
    expect(result.kind).toBe('beside')
    expect(shapeOf(result.layout)).toBe('h(P,P)')
    expect(leaves(result.layout)).toEqual(['L', result.pane])
    expect(ids(result.panes.L)).toEqual(['D'])
    expect(ids(result.panes[result.pane])).toEqual(['N'])
    expect(result.panes[result.pane]!.activeId).toBe('N')
    expect(result.channels[result.pane]).toBe(result.channels.L ?? 'blue')
    expect(result.channels[result.pane]).toBe('blue')
  })

  it('inCurrentPane: 창이 하나면 분할 없이 그 창에 탭으로 넣고 활성으로 만든다', () => {
    const result = placeNoteTab(input({ L: strip([pdf('D')]) }, { inCurrentPane: true }))
    expect(result.kind).toBe('tab')
    expect(leaves(result.layout)).toEqual(['L'])
    expect(ids(result.panes.L)).toEqual(['D', 'N'])
    expect(result.panes.L!.activeId).toBe('N')
    expect(result.pane).toBe('L')
  })

  it('inCurrentPane: 이미 탭이면 그 탭으로 바꾸기만 하고, 창이 둘이면 예전 규칙(옆에 새 창)이다', () => {
    const had = placeNoteTab(input({ L: strip([pdf('D'), note('N')], 'D') }, { inCurrentPane: true }))
    expect(had.kind).toBe('activated')
    const two = placeNoteTab(input({ L: strip([pdf('D')]), R: strip([pdf('E')]) }, { layout: layoutForCount(2, ['L', 'R']), inCurrentPane: true }))
    expect(two.kind).toBe('beside')
  })

  it('문서 창에 색이 없으면 비어 있는 색을 골라 두 창에 준다', () => {
    const result = placeNoteTab(input({ L: strip([pdf('D')]) }, { channels: channels({ L: null }) }))
    expect(result.kind).toBe('beside')
    expect(result.channels.L).not.toBeNull()
    expect(result.channels[result.pane]).toBe(result.channels.L)
  })

  it('미리보기 설정이면 새 창의 노트 탭이 미리보기 탭이다', () => {
    const result = placeNoteTab(input({ L: strip([pdf('D')]) }, { preview: true }))
    expect(result.panes[result.pane]!.tabs[0]).toMatchObject({ id: 'N', preview: true })
  })

  it('이미 같은 노트가 어느 창에 보이면 아무것도 바꾸지 않는다', () => {
    const state: PanesState = { L: strip([pdf('D')]), R: strip([note('N')]) }
    const result = placeNoteTab(input(state, { layout: cols2() }))
    expect(result.kind).toBe('visible')
    expect(result.panes).toBe(state)
    expect(result.pane).toBe('R')
  })

  it('그 노트가 탭으로만 있으면 그 탭으로 바꾸고(닫힌 것은 없다) 다른 탭은 그대로다', () => {
    const state: PanesState = { L: strip([pdf('D')]), R: strip([note('X'), note('N')], 'X') }
    const result = placeNoteTab(input(state, { layout: cols2() }))
    expect(result.kind).toBe('activated')
    expect(result.panes.R!.activeId).toBe('N')
    expect(ids(result.panes.R)).toEqual(['X', 'N'])
  })

  it('같은 색 이웃 창이 다른 노트를 보이고 있으면 그 창에 탭으로 더한다(새 창을 열지 않는다)', () => {
    const state: PanesState = { L: strip([pdf('D')]), R: strip([note('X')]) }
    const result = placeNoteTab(input(state, { layout: cols2() }))
    expect(result.kind).toBe('tab')
    expect(paneCount(result.layout)).toBe(2)
    expect(ids(result.panes.R)).toEqual(['X', 'N'])
    expect(result.panes.R!.activeId).toBe('N')
  })

  it('다른 색의 노트 창은 이웃이 아니다 — 새 창을 연다', () => {
    const state: PanesState = { L: strip([pdf('D')]), R: strip([pdf('E')]), T: strip([note('X')]) }
    const result = placeNoteTab(input(state, { layout: cols3(), channels: channels({ T: 'green' }) }))
    expect(result.kind).not.toBe('tab')
  })

  it('노트 창에서 부르면(anchor 가 노트를 보인다) 그 창에 탭으로 더한다', () => {
    const state: PanesState = { L: strip([pdf('D')]), R: strip([note('X')]) }
    const result = placeNoteTab(input(state, { layout: cols2(), anchor: 'R' }))
    expect(result.kind).toBe('tab')
    expect(ids(result.panes.R)).toEqual(['X', 'N'])
  })

  it('칸이 가득(8개)이면 가장 오른쪽 창에 탭으로 넣고, 그 창이 문서 창과 같은 색이 된다 — 탭은 하나도 닫히지 않는다', () => {
    const names = Array.from({ length: MAX_PANES }, (_, index) => `p${index}`)
    const layout = layoutForCount(MAX_PANES, names)
    const state: PanesState = Object.fromEntries(names.map((name) => [name, strip([pdf(`d-${name}`)])]))
    const rightmost = rightmostPane(layout)
    const result = placeNoteTab(input(state, { layout, anchor: 'p0', channels: channels({ [rightmost]: 'green' }) }))
    expect(result.kind).toBe('rightmost')
    expect(result.layout).toBe(layout)
    expect(result.pane).toBe(rightmost)
    expect(ids(result.panes[rightmost])).toEqual([`d-${rightmost}`, 'N'])
    expect(result.channels[rightmost]).toBe('blue')
    for (const name of names.filter((item) => item !== rightmost)) expect(ids(result.panes[name])).toEqual([`d-${name}`])
  })

  it('칸이 너무 작아 나눌 수 없어도(어느 방향으로도 반쪽이 최소 크기 미만) 가장 오른쪽 창의 탭으로 들어간다', () => {
    const state: PanesState = { L: strip([pdf('A')]), R: strip([pdf('B')]) }
    const result = placeNoteTab(input(state, { layout: cols2(), sizeOf: () => ({ width: 300, height: 300 }) }))
    expect(result.kind).toBe('rightmost')
    expect(result.layout).toEqual(cols2())
    expect(ids(result.panes.R)).toEqual(['B', 'N'])
  })

  it('오른쪽이 좁아 못 나누면 아래로 나눈다', () => {
    const state: PanesState = { L: strip([pdf('D')]) }
    const result = placeNoteTab(input(state, { sizeOf: () => ({ width: 300, height: 800 }) }))
    expect(result.kind).toBe('beside')
    expect(shapeOf(result.layout)).toBe('v(P,P)')
  })

  it('좌우 둘에서 노트를 놓으면 문서 창 바로 오른쪽(가운데)에 새 창이 끼고 옛 오른쪽 창은 한 칸 밀린다', () => {
    const state: PanesState = { L: strip([pdf('A')]), R: strip([pdf('B')]) }
    const result = placeNoteTab(input(state, { layout: cols2() }))
    expect(result.kind).toBe('beside')
    expect(leaves(result.layout)).toEqual(['L', result.pane, 'R'])
    expect(ids(result.panes.L)).toEqual(['A'])
    expect(ids(result.panes[result.pane])).toEqual(['N'])
    expect(ids(result.panes.R)).toEqual(['B'])
  })
})

describe('closeNoteBeside — 옆에 노트 닫기', () => {
  const base = (state: PanesState, layout: LayoutNode = cols2()) => ({ panes: state, channels: DEFAULT_CHANNELS, layout, anchor: 'L' })

  it('같은 색 창이 노트만 보이고 있으면 그 칸을 닫는다(노트 탭만 사라지고 문서 창은 그대로)', () => {
    const state: PanesState = { L: strip([pdf('D')]), R: strip([note('N')]) }
    const result = closeNoteBeside(base(state))!
    expect(result.collapsed).toBe(true)
    expect(result.layout).toEqual(single())
    expect(result.closed).toEqual(['N'])
    expect(ids(result.panes.L)).toEqual(['D'])
    expect(result.panes.R).toBeUndefined()
  })

  it('노트를 왼쪽에 둔 배치에서 닫으면 문서 창이 남은 칸을 차지한다', () => {
    const state: PanesState = { L: strip([note('N')]), R: strip([pdf('D')]) }
    const result = closeNoteBeside({ ...base(state), anchor: 'R' })!
    expect(result.collapsed).toBe(true)
    expect(result.layout).toEqual(paneNode('R'))
    expect(ids(result.panes.R)).toEqual(['D'])
    expect(result.panes.L).toBeUndefined()
  })

  it('노트 창에 다른 탭(문서)도 있으면 창은 두고 메모 노트 탭만 거둔다', () => {
    const state: PanesState = { L: strip([pdf('D')]), R: strip([pdf('E'), note('N'), note('M')], 'N') }
    const result = closeNoteBeside(base(state))!
    expect(result.collapsed).toBe(false)
    expect(paneCount(result.layout)).toBe(2)
    expect(ids(result.panes.R)).toEqual(['E'])
    expect(result.panes.R!.activeId).toBe('E')
    expect(result.closed).toEqual(['N', 'M'])
  })

  it('노트 창의 노트 탭이 여럿이어도 한 번에 모두 거둔다', () => {
    const state: PanesState = { L: strip([pdf('D')]), R: strip([note('N'), note('M')]) }
    const result = closeNoteBeside(base(state))!
    expect(result.collapsed).toBe(true)
    expect([...result.closed].sort()).toEqual(['M', 'N'])
  })

  it('같은 색 창에 노트가 안 보이면 null(그러면 열기가 된다)', () => {
    expect(closeNoteBeside(base({ L: strip([pdf('D')]), R: strip([pdf('E')]) }))).toBeNull()
    // 다른 색의 노트 창은 보이는 노트가 아니다
    const other = { ...base({ L: strip([pdf('D')]), R: strip([note('N')]) }), channels: channels({ R: 'green' }) }
    expect(closeNoteBeside(other)).toBeNull()
    // 색이 없는 문서 창은 어느 노트와도 잇지 않는다
    const none = { ...base({ L: strip([pdf('D')]), R: strip([note('N')]) }), channels: channels({ L: null }) }
    expect(closeNoteBeside(none)).toBeNull()
  })

  it('보이는 노트 창을 찾는다: 노트를 보이는 같은 색 창만(문서 창 자신은 아니다)', () => {
    const state: PanesState = { L: strip([pdf('D')]), R: strip([note('N')]), T: strip([pdf('E')]) }
    expect(visibleNotePanes(state, DEFAULT_CHANNELS, ['L', 'R', 'T'], 'L')).toEqual(['R'])
  })

  it('4칸 배치에서 노트 칸을 닫으면 3칸 배치가 되고 나머지 창의 탭·색은 그대로다', () => {
    const state: PanesState = { L: strip([pdf('A')]), R: strip([note('N')]), T: strip([pdf('C')]), F: strip([pdf('D')]) }
    const result = closeNoteBeside(base(state, grid4()))!
    expect(result.collapsed).toBe(true)
    expect(leaves(result.layout)).toEqual(['L', 'T', 'F'])
    expect(shapeOf(result.layout)).toBe('v(P,h(P,P))')
    expect(ids(result.panes.L)).toEqual(['A'])
    expect(ids(result.panes.T)).toEqual(['C'])
    expect(ids(result.panes.F)).toEqual(['D'])
    expect(result.panes.R).toBeUndefined()
  })

  it('열고 닫고 다시 열어도 같은 배치로 돌아온다(여닫기 왕복)', () => {
    const start: PanesState = { L: strip([pdf('D')]) }
    const opened = placeNoteTab({ panes: start, channels: DEFAULT_CHANNELS, layout: single(), anchor: 'L', tab: note('N') })
    const closed = closeNoteBeside({ panes: opened.panes, channels: opened.channels, layout: opened.layout, anchor: 'L' })!
    expect(closed.layout).toEqual(single())
    expect(ids(closed.panes.L)).toEqual(['D'])
    const again = placeNoteTab({ panes: closed.panes, channels: closed.channels, layout: closed.layout, anchor: 'L', tab: note('N') })
    expect(shapeOf(again.layout)).toBe('h(P,P)')
    expect(ids(again.panes[again.pane])).toEqual(['N'])
  })

  it('빈 칸 상태(emptyTabs)가 섞여 있어도 닫을 수 있다', () => {
    const state: PanesState = { L: strip([pdf('D')]), R: strip([note('N')]), T: emptyTabs }
    const result = closeNoteBeside(base(state, cols3()))!
    expect(leaves(result.layout)).toEqual(['L', 'T'])
  })
})

describe('placeNoteTab — 캔버스 탭', () => {
  const canvas = (id: string): Tab => ({ id, title: id, kind: 'canvas' })
  const base = { channels: DEFAULT_CHANNELS, layout: single(), anchor: 'L' }

  it('문서 창 옆에 새 창을 열어 캔버스 탭을 놓고 같은 색을 준다', () => {
    const result = placeNoteTab({ ...base, panes: { L: strip([pdf('A')]) }, tab: canvas('C') })
    expect(result.kind).toBe('beside')
    expect(shapeOf(result.layout)).toBe('h(P,P)')
    expect(ids(result.panes[result.pane])).toEqual(['C'])
    expect(result.panes[result.pane]!.tabs[0]?.kind).toBe('canvas')
    expect(result.channels[result.pane]).toBe('blue')
  })

  it('같은 색 창에 캔버스가 보이면 거기에 탭으로 더한다(메모 노트 창은 캔버스를 받지 않는다)', () => {
    const state: PanesState = { L: strip([pdf('A')]), R: strip([note('N')]), T: strip([canvas('C1')]) }
    const result = placeNoteTab({ ...base, panes: state, layout: cols3(), tab: canvas('C2') })
    expect(result.kind).toBe('tab')
    expect(result.pane).toBe('T')
    expect(ids(result.panes.T)).toEqual(['C1', 'C2'])
    expect(ids(result.panes.R)).toEqual(['N'])
  })

  it('이미 탭으로 있으면 그 탭으로 바꾼다', () => {
    const state: PanesState = { L: strip([pdf('A')]), R: strip([canvas('C1'), canvas('C2')], 'C1') }
    const result = placeNoteTab({ ...base, panes: state, layout: cols2(), tab: canvas('C2') })
    expect(result.kind).toBe('activated')
    expect(result.panes.R!.activeId).toBe('C2')
  })
})

describe('placeNoteTab — 이미 보이는 칸이 먼저', () => {
  it('가장 최근에 만진 칸이 그 노트를 배경 탭으로만 가졌어도, 그 노트를 보이는 다른 칸이 있으면 그 칸을 쓴다', () => {
    const panes: PanesState = {
      L: strip([pdf('d'), note('n')], 'd'), // 원래 칸: 노트가 배경 탭
      R: strip([note('n')], 'n'), // 받는 칸: 노트가 보인다
    }
    const out = placeNoteTab({ panes, channels: channels(), layout: cols2(), anchor: 'L', tab: note('n'), mru: ['L', 'R'] })
    expect(out.kind).toBe('visible')
    expect(out.pane).toBe('R')
    expect(out.panes.L?.activeId).toBe('d')
  })
})
