import { describe, expect, it } from 'vitest'
import { closeNoteBeside, pickFreeChannel, pickNotePath, placeNoteTab, rightmostPane, visibleNotePanes } from './noteBeside'
import { emptyTabs, type PaneId, type PanesState, type Tab } from './tabs'
import { DEFAULT_CHANNELS, type PaneChannels } from './workspaceChannels'

const pdf = (id: string): Tab => ({ id, title: id, kind: 'pdf' })
const note = (id: string): Tab => ({ id, title: id, kind: 'memoNote' })
const strip = (tabs: Tab[], activeId: string | null = tabs[0]?.id ?? null) => ({ tabs, activeId })
const panes = (p: Partial<PanesState>): PanesState => ({ left: emptyTabs, right: emptyTabs, third: emptyTabs, fourth: emptyTabs, ...p })
const ids = (state: { tabs: readonly Tab[] }) => state.tabs.map((tab) => tab.id)
const channels = (c: Partial<PaneChannels> = {}): PaneChannels => ({ ...DEFAULT_CHANNELS, ...c })

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
    expect(pickFreeChannel(channels({ left: 'blue', right: 'green' }), ['left', 'right'])).toBe('orange')
    expect(pickFreeChannel(channels({ left: null }), ['left'])).toBe('blue')
    expect(pickFreeChannel(channels({ left: 'blue', right: 'green', third: 'orange' }), ['left', 'right', 'third'])).toBe('blue')
  })

  it('가장 오른쪽(같으면 위) 창', () => {
    expect(rightmostPane('cols2', ['left', 'right'])).toBe('right')
    expect(rightmostPane('cols3', ['left', 'right', 'third'])).toBe('third')
    expect(rightmostPane('grid4', ['left', 'right', 'third', 'fourth'])).toBe('right')
    expect(rightmostPane('left1-right2', ['left', 'right', 'third'])).toBe('right')
    expect(rightmostPane('single', ['left'])).toBe('left')
  })
})

describe('placeNoteTab — 옆에 노트 열기', () => {
  const input = (state: PanesState, overrides: Partial<Parameters<typeof placeNoteTab>[0]> = {}) => ({
    panes: state,
    channels: DEFAULT_CHANNELS,
    visible: ['left'] as readonly PaneId[],
    layoutId: 'single' as const,
    anchor: 'left' as PaneId,
    tab: note('N'),
    ...overrides,
  })

  it('창이 하나면 문서 창 오른쪽에 새 창을 열어 노트를 놓고, 문서 창의 색을 준다(노트 바 자리가 「읽기」 배치가 된다)', () => {
    const result = placeNoteTab(input(panes({ left: strip([pdf('D')]) })))
    expect(result.kind).toBe('beside')
    expect(result.layout).toBe('cols2')
    expect(result.pane).toBe('right')
    expect(ids(result.panes.left)).toEqual(['D'])
    expect(ids(result.panes.right)).toEqual(['N'])
    expect(result.panes.right.activeId).toBe('N')
    expect(result.channels.right).toBe(result.channels.left)
    expect(result.channels.right).toBe('blue')
  })

  it('문서 창에 색이 없으면 비어 있는 색을 골라 두 창에 준다', () => {
    const result = placeNoteTab(input(panes({ left: strip([pdf('D')]) }), { channels: channels({ left: null }) }))
    expect(result.kind).toBe('beside')
    expect(result.channels.left).not.toBeNull()
    expect(result.channels.right).toBe(result.channels.left)
  })

  it('미리보기 설정이면 새 창의 노트 탭이 미리보기 탭이다', () => {
    const result = placeNoteTab(input(panes({ left: strip([pdf('D')]) }), { preview: true }))
    expect(result.panes.right.tabs[0]).toMatchObject({ id: 'N', preview: true })
  })

  it('이미 같은 노트가 어느 창에 보이면 아무것도 바꾸지 않는다', () => {
    const state = panes({ left: strip([pdf('D')]), right: strip([note('N')]) })
    const result = placeNoteTab(input(state, { visible: ['left', 'right'], layoutId: 'cols2' }))
    expect(result.kind).toBe('visible')
    expect(result.panes).toBe(state)
    expect(result.pane).toBe('right')
  })

  it('그 노트가 탭으로만 있으면 그 탭으로 바꾸고(닫힌 것은 없다) 다른 탭은 그대로다', () => {
    const state = panes({ left: strip([pdf('D')]), right: strip([note('X'), note('N')], 'X') })
    const result = placeNoteTab(input(state, { visible: ['left', 'right'], layoutId: 'cols2' }))
    expect(result.kind).toBe('activated')
    expect(result.panes.right.activeId).toBe('N')
    expect(ids(result.panes.right)).toEqual(['X', 'N'])
  })

  it('같은 색 이웃 창이 다른 노트를 보이고 있으면 그 창에 탭으로 더한다(새 창을 열지 않는다)', () => {
    const state = panes({ left: strip([pdf('D')]), right: strip([note('X')]) })
    const result = placeNoteTab(input(state, { visible: ['left', 'right'], layoutId: 'cols2' }))
    expect(result.kind).toBe('tab')
    expect(result.layout).toBe('cols2')
    expect(ids(result.panes.right)).toEqual(['X', 'N'])
    expect(result.panes.right.activeId).toBe('N')
  })

  it('다른 색의 노트 창은 이웃이 아니다 — 새 창을 연다', () => {
    const state = panes({ left: strip([pdf('D')]), right: strip([pdf('E')]), third: strip([note('X')]) })
    const result = placeNoteTab(input(state, { visible: ['left', 'right', 'third'], layoutId: 'cols3', channels: channels({ third: 'green' }) }))
    expect(result.kind).not.toBe('tab')
  })

  it('노트 창에서 부르면(anchor 가 노트를 보인다) 그 창에 탭으로 더한다', () => {
    const state = panes({ left: strip([pdf('D')]), right: strip([note('X')]) })
    const result = placeNoteTab(input(state, { visible: ['left', 'right'], layoutId: 'cols2', anchor: 'right' }))
    expect(result.kind).toBe('tab')
    expect(ids(result.panes.right)).toEqual(['X', 'N'])
  })

  it('칸이 가득(넷)이면 가장 오른쪽 창에 탭으로 넣고, 그 창이 문서 창과 같은 색이 된다 — 탭은 하나도 닫히지 않는다', () => {
    const state = panes({ left: strip([pdf('A')]), right: strip([pdf('B')]), third: strip([pdf('C')]), fourth: strip([pdf('D')]) })
    const result = placeNoteTab(input(state, { visible: ['left', 'right', 'third', 'fourth'], layoutId: 'grid4', channels: channels({ right: 'green' }) }))
    expect(result.kind).toBe('rightmost')
    expect(result.layout).toBe('grid4')
    expect(result.pane).toBe('right')
    expect(ids(result.panes.right)).toEqual(['B', 'N'])
    expect(result.channels.right).toBe('blue')
    expect(ids(result.panes.left)).toEqual(['A'])
    expect(ids(result.panes.third)).toEqual(['C'])
    expect(ids(result.panes.fourth)).toEqual(['D'])
  })

  it('3칸(좌우 셋)처럼 오른쪽에 더 못 나누는 배치도 가득이면 가장 오른쪽 창의 탭으로', () => {
    const state = panes({ left: strip([pdf('A')]), right: strip([pdf('B')]), third: strip([pdf('C')]) })
    const result = placeNoteTab(input(state, { visible: ['left', 'right', 'third'], layoutId: 'cols3' }))
    // 오른쪽·아래·왼쪽·위 어디로도 못 나누면(그런 배치가 없다) 가장 오른쪽(셋째)에 탭으로 들어간다
    expect(result.kind).toBe('rightmost')
    expect(result.layout).toBe('cols3')
    expect(ids(result.panes.third)).toEqual(['C', 'N'])
    expect(ids(result.panes.left)).toEqual(['A'])
    expect(ids(result.panes.right)).toEqual(['B'])
  })

  it('좌우 둘에서 노트를 놓으면 문서 창 바로 오른쪽(가운데)에 새 창이 끼고 옛 오른쪽 창은 한 칸 밀린다', () => {
    const state = panes({ left: strip([pdf('A')]), right: strip([pdf('B')]) })
    const result = placeNoteTab(input(state, { visible: ['left', 'right'], layoutId: 'cols2' }))
    expect(result.kind).toBe('beside')
    expect(result.layout).toBe('cols3')
    expect(ids(result.panes.left)).toEqual(['A'])
    expect(ids(result.panes.right)).toEqual(['N'])
    expect(ids(result.panes.third)).toEqual(['B'])
  })
})

describe('closeNoteBeside — 옆에 노트 닫기', () => {
  const base = (state: PanesState, layoutId: 'cols2' | 'grid4' | 'cols3' = 'cols2', visible: readonly PaneId[] = ['left', 'right']) => ({ panes: state, channels: DEFAULT_CHANNELS, visible, layoutId, anchor: 'left' as PaneId })

  it('같은 색 창이 노트만 보이고 있으면 그 칸을 닫는다(노트 탭만 사라지고 문서 창은 그대로)', () => {
    const state = panes({ left: strip([pdf('D')]), right: strip([note('N')]) })
    const result = closeNoteBeside(base(state))!
    expect(result.collapsed).toBe(true)
    expect(result.layout).toBe('single')
    expect(result.closed).toEqual(['N'])
    expect(ids(result.panes.left)).toEqual(['D'])
    expect(result.remap('left')).toBe('left')
  })

  it('노트를 왼쪽에 둔 배치에서 닫으면 문서 창이 남은 칸으로 옮겨 간다', () => {
    const state = panes({ left: strip([note('N')]), right: strip([pdf('D')]) })
    const result = closeNoteBeside({ ...base(state), anchor: 'right' })!
    expect(result.collapsed).toBe(true)
    expect(ids(result.panes.left)).toEqual(['D'])
    expect(result.remap('right')).toBe('left')
  })

  it('노트 창에 다른 탭(문서)도 있으면 창은 두고 메모 노트 탭만 거둔다', () => {
    const state = panes({ left: strip([pdf('D')]), right: strip([pdf('E'), note('N'), note('M')], 'N') })
    const result = closeNoteBeside(base(state))!
    expect(result.collapsed).toBe(false)
    expect(result.layout).toBe('cols2')
    expect(ids(result.panes.right)).toEqual(['E'])
    expect(result.panes.right.activeId).toBe('E')
    expect(result.closed).toEqual(['N', 'M'])
  })

  it('노트 창의 노트 탭이 여럿이어도 한 번에 모두 거둔다', () => {
    const state = panes({ left: strip([pdf('D')]), right: strip([note('N'), note('M')]) })
    const result = closeNoteBeside(base(state))!
    expect(result.collapsed).toBe(true)
    expect([...result.closed].sort()).toEqual(['M', 'N'])
  })

  it('같은 색 창에 노트가 안 보이면 null(그러면 열기가 된다)', () => {
    expect(closeNoteBeside(base(panes({ left: strip([pdf('D')]), right: strip([pdf('E')]) })))).toBeNull()
    // 다른 색의 노트 창은 보이는 노트가 아니다
    const other = { ...base(panes({ left: strip([pdf('D')]), right: strip([note('N')]) })), channels: channels({ right: 'green' }) }
    expect(closeNoteBeside(other)).toBeNull()
    // 색이 없는 문서 창은 어느 노트와도 잇지 않는다
    const none = { ...base(panes({ left: strip([pdf('D')]), right: strip([note('N')]) })), channels: channels({ left: null }) }
    expect(closeNoteBeside(none)).toBeNull()
  })

  it('보이는 노트 창을 찾는다: 노트를 보이는 같은 색 창만(문서 창 자신은 아니다)', () => {
    const state = panes({ left: strip([pdf('D')]), right: strip([note('N')]), third: strip([pdf('E')]) })
    expect(visibleNotePanes(state, DEFAULT_CHANNELS, ['left', 'right', 'third'], 'left')).toEqual(['right'])
  })

  it('4칸 배치에서 노트 칸을 닫으면 3칸 배치가 되고 나머지 창의 탭·색은 그대로다', () => {
    const state = panes({ left: strip([pdf('A')]), right: strip([note('N')]), third: strip([pdf('C')]), fourth: strip([pdf('D')]) })
    const result = closeNoteBeside(base(state, 'grid4', ['left', 'right', 'third', 'fourth']))!
    expect(result.collapsed).toBe(true)
    expect(ids(result.panes.left)).toEqual(['A'])
    expect(ids(result.panes.right)).toEqual(['C'])
    expect(ids(result.panes.third)).toEqual(['D'])
    expect(result.panes.fourth).toEqual(emptyTabs)
  })

  it('열고 닫고 다시 열어도 같은 배치로 돌아온다(여닫기 왕복)', () => {
    const start = panes({ left: strip([pdf('D')]) })
    const opened = placeNoteTab({ panes: start, channels: DEFAULT_CHANNELS, visible: ['left'], layoutId: 'single', anchor: 'left', tab: note('N') })
    const closed = closeNoteBeside({ panes: opened.panes, channels: opened.channels, visible: ['left', 'right'], layoutId: opened.layout, anchor: 'left' })!
    expect(closed.layout).toBe('single')
    expect(ids(closed.panes.left)).toEqual(['D'])
    const again = placeNoteTab({ panes: closed.panes, channels: closed.channels, visible: ['left'], layoutId: closed.layout, anchor: 'left', tab: note('N') })
    expect(again.layout).toBe('cols2')
    expect(ids(again.panes.right)).toEqual(['N'])
  })
})

describe('placeNoteTab — 캔버스 탭', () => {
  const canvas = (id: string): Tab => ({ id, title: id, kind: 'canvas' })
  const base = { channels: DEFAULT_CHANNELS, visible: ['left'] as readonly PaneId[], layoutId: 'single' as const, anchor: 'left' as PaneId }

  it('문서 창 옆에 새 창을 열어 캔버스 탭을 놓고 같은 색을 준다', () => {
    const result = placeNoteTab({ ...base, panes: panes({ left: strip([pdf('A')]) }), tab: canvas('C') })
    expect(result.kind).toBe('beside')
    expect(result.layout).toBe('cols2')
    expect(ids(result.panes[result.pane])).toEqual(['C'])
    expect(result.panes[result.pane].tabs[0]?.kind).toBe('canvas')
    expect(result.channels.right).toBe(result.channels.left)
  })

  it('같은 색 창에 캔버스가 보이면 거기에 탭으로 더한다(메모 노트 창은 캔버스를 받지 않는다)', () => {
    const state = panes({ left: strip([pdf('A')]), right: strip([note('N')]), third: strip([canvas('C1')]) })
    const result = placeNoteTab({ ...base, panes: state, visible: ['left', 'right', 'third'], layoutId: 'cols3', tab: canvas('C2') })
    expect(result.kind).toBe('tab')
    expect(result.pane).toBe('third')
    expect(ids(result.panes.third)).toEqual(['C1', 'C2'])
    expect(ids(result.panes.right)).toEqual(['N'])
  })

  it('이미 탭으로 있으면 그 탭으로 바꾼다', () => {
    const state = panes({ left: strip([pdf('A')]), right: strip([canvas('C1'), canvas('C2')], 'C1') })
    const result = placeNoteTab({ ...base, panes: state, visible: ['left', 'right'], layoutId: 'cols2', tab: canvas('C2') })
    expect(result.kind).toBe('activated')
    expect(result.panes.right.activeId).toBe('C2')
  })
})
