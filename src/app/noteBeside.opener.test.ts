import { describe, expect, it } from 'vitest'
import { createNoteBesideOpener } from './noteBeside'
import { emptyTabs, type PaneId, type PanesState, type Tab } from './tabs'
import { DEFAULT_CHANNELS, type PaneChannels } from './workspaceChannels'

const pdf = (id: string): Tab => ({ id, title: id, kind: 'pdf' })
const note = (id: string): Tab => ({ id, title: id, kind: 'memoNote' })
const strip = (tabs: Tab[], activeId: string | null = tabs[0]?.id ?? null) => ({ tabs, activeId })
const panes = (p: Partial<PanesState>): PanesState => ({ left: emptyTabs, right: emptyTabs, third: emptyTabs, fourth: emptyTabs, ...p })
const ids = (state: { tabs: readonly Tab[] }) => state.tabs.map((tab) => tab.id)

type LayoutId = 'single' | 'cols2' | 'cols3' | 'grid4'

/** 앱을 흉내 낸 가짜 작업 공간: 상태를 들고 있고 apply 로 바뀐다 */
function fakeApp(
  start: { panes: PanesState; layoutId?: LayoutId; channels?: PaneChannels },
  options: { lastTouched?: string | null; entries?: { path: string; title: string; docId?: string }[]; createdPath?: string | null; available?: boolean } = {},
) {
  const state = {
    panes: start.panes,
    channels: start.channels ?? DEFAULT_CHANNELS,
    layoutId: start.layoutId ?? ('single' as LayoutId),
    lastTouched: options.lastTouched ?? null,
    created: [] as string[],
    touched: [] as string[],
    fresh: [] as PaneId[],
  }
  const count = () => ({ single: 1, cols2: 2, cols3: 3, grid4: 4 })[state.layoutId]
  const visible = (): PaneId[] => (['left', 'right', 'third', 'fourth'] as const).slice(0, count())
  const entries = options.entries ?? []
  const made = (): string | null => (options.createdPath === undefined ? '노트/새.iwnote' : options.createdPath)
  const host = {
    snapshot: () => ({ panes: state.panes, channels: state.channels, visible: visible(), layoutId: state.layoutId }),
    apply: (next: { panes: PanesState; channels: PaneChannels; layout: string }, fresh?: PaneId) => {
      state.panes = next.panes
      state.channels = next.channels
      state.layoutId = next.layout as LayoutId
      if (fresh !== undefined) state.fresh.push(fresh)
    },
    lastTouched: () => state.lastTouched,
    entries: () => entries,
    docOwner: (docId: string) => (docId === 'docS' ? 'docS' : null),
    createForDoc: async (docId: string) => { state.created.push(`doc:${docId}`); await Promise.resolve(); return made() },
    createGeneral: async () => { state.created.push('general'); await Promise.resolve(); return made() },
    touch: (path: string) => { state.lastTouched = path; state.touched.push(path) },
    available: () => options.available ?? true,
    docIdOf: (tab: Tab | null) => (tab !== null && (tab.kind === 'pdf' || tab.kind === 'markdown') ? tab.id : null),
  }
  return { state, opener: createNoteBesideOpener(host) }
}

describe('createNoteBesideOpener — 옆에 노트 열기·닫기의 흐름', () => {
  it('마지막으로 만진 노트를 옆(오른쪽 새 창)에 열고, 같은 색을 주고, 새 창이 자라듯 나타나게 한다', async () => {
    const { state, opener } = fakeApp({ panes: panes({ left: strip([pdf('docS')]) }) }, { lastTouched: '노트/일반.iwnote', entries: [{ path: '노트/일반.iwnote', title: '일반' }, { path: '노트/S1.iwnote', title: 'S1', docId: 'docS' }] })
    expect(await opener.open('left')).toBe('노트/일반.iwnote')
    expect(state.layoutId).toBe('cols2')
    expect(ids(state.panes.right)).toEqual(['노트/일반.iwnote'])
    expect(state.channels.right).toBe(state.channels.left)
    expect(state.fresh).toEqual(['right'])
    expect(state.created).toEqual([])
    expect(state.touched).toEqual(['노트/일반.iwnote'])
  })

  it('만진 노트가 없으면 이 문서의 노트를 연다', async () => {
    const { state, opener } = fakeApp({ panes: panes({ left: strip([pdf('docS')]) }) }, { entries: [{ path: '노트/S1.iwnote', title: 'S1', docId: 'docS' }] })
    expect(await opener.open('left')).toBe('노트/S1.iwnote')
    expect(ids(state.panes.right)).toEqual(['노트/S1.iwnote'])
    expect(state.created).toEqual([])
  })

  it('둘 다 없으면 이 문서의 새 노트를 만들어 연다(문서가 없는 창이면 일반 새 노트)', async () => {
    const { state, opener } = fakeApp({ panes: panes({ left: strip([pdf('docS')]) }) })
    expect(await opener.open('left')).toBe('노트/새.iwnote')
    expect(state.created).toEqual(['doc:docS'])
    expect(ids(state.panes.right)).toEqual(['노트/새.iwnote'])
    const general = fakeApp({ panes: panes({ left: strip([note('X')]) }) })
    await general.opener.open('left')
    expect(general.state.created).toEqual(['general'])
  })

  it('정해 준 노트(notePath)는 그대로 연다(마지막으로 만진 노트보다 먼저)', async () => {
    const { state, opener } = fakeApp({ panes: panes({ left: strip([pdf('docS')]) }) }, { lastTouched: '노트/A.iwnote' })
    expect(await opener.open('left', '노트/B.iwnote')).toBe('노트/B.iwnote')
    expect(ids(state.panes.right)).toEqual(['노트/B.iwnote'])
  })

  it('미리보기 설정으로 열면 새 노트 탭이 미리보기 탭이다', async () => {
    const { state, opener } = fakeApp({ panes: panes({ left: strip([pdf('docS')]) }) })
    await opener.open('left', '노트/B.iwnote', true)
    expect(state.panes.right.tabs[0]).toMatchObject({ id: '노트/B.iwnote', preview: true })
  })

  it('새 노트를 만드는 동안 같은 요청이 또 오면(메모를 이어 고르는 중) 노트는 하나만 만든다', async () => {
    const { state, opener } = fakeApp({ panes: panes({ left: strip([pdf('docS')]) }) })
    const [a, b] = await Promise.all([opener.open('left'), opener.open('left')])
    expect(a).toBe('노트/새.iwnote')
    expect(b).toBe('노트/새.iwnote')
    expect(state.created).toEqual(['doc:docS'])
    // 두 번째는 이미 보이는 창에 그대로 둔다(창이 또 생기지 않는다)
    expect(state.layoutId).toBe('cols2')
    expect(ids(state.panes.right)).toEqual(['노트/새.iwnote'])
  })

  it('노트를 못 만들면(null) 아무것도 바꾸지 않는다. Vault 가 없어도 같다', async () => {
    const failed = fakeApp({ panes: panes({ left: strip([pdf('docS')]) }) }, { createdPath: null })
    expect(await failed.opener.open('left')).toBeNull()
    expect(failed.state.layoutId).toBe('single')
    const closed = fakeApp({ panes: panes({ left: strip([pdf('docS')]) }) }, { available: false })
    expect(await closed.opener.open('left')).toBeNull()
    expect(closed.state.created).toEqual([])
  })

  it('이미 같은 색 창에 보이는 노트가 있으면 새 창을 열지 않고 그 창의 탭으로 더한다', async () => {
    const { state, opener } = fakeApp({ panes: panes({ left: strip([pdf('docS')]), right: strip([note('노트/X.iwnote')]) }), layoutId: 'cols2' }, { lastTouched: '노트/Y.iwnote', entries: [{ path: '노트/Y.iwnote', title: 'Y' }] })
    await opener.open('left')
    expect(state.layoutId).toBe('cols2')
    expect(ids(state.panes.right)).toEqual(['노트/X.iwnote', '노트/Y.iwnote'])
  })

  it('칸이 가득(넷)이어도 노트는 열린다: 가장 오른쪽 창의 탭으로(새 창은 없다)', async () => {
    const full = panes({ left: strip([pdf('docS')]), right: strip([pdf('B')]), third: strip([pdf('C')]), fourth: strip([pdf('D')]) })
    const { state, opener } = fakeApp({ panes: full, layoutId: 'grid4' }, { lastTouched: '노트/N.iwnote', entries: [{ path: '노트/N.iwnote', title: 'N' }] })
    expect(await opener.open('left')).toBe('노트/N.iwnote')
    expect(state.layoutId).toBe('grid4')
    expect(ids(state.panes.right)).toEqual(['B', '노트/N.iwnote'])
    expect(state.channels.right).toBe(state.channels.left)
    expect(state.fresh).toEqual([])
  })

  it('여닫기: 열려 있지 않으면 열고(opening), 같은 색 창에 노트가 보이면 그 창을 닫는다(closed). 다시 누르면 같은 노트가 다시 열린다', async () => {
    const { state, opener } = fakeApp({ panes: panes({ left: strip([pdf('docS')]) }) }, { lastTouched: '노트/N.iwnote', entries: [{ path: '노트/N.iwnote', title: 'N' }] })
    const first = opener.toggle('left')
    expect(first.kind).toBe('opening')
    if (first.kind === 'opening') await first.opened
    expect(state.layoutId).toBe('cols2')
    expect(ids(state.panes.right)).toEqual(['노트/N.iwnote'])
    const second = opener.toggle('left')
    expect(second.kind).toBe('closed')
    expect(state.layoutId).toBe('single')
    expect(ids(state.panes.left)).toEqual(['docS'])
    const third = opener.toggle('left')
    expect(third.kind).toBe('opening')
    if (third.kind === 'opening') expect(await third.opened).toBe('노트/N.iwnote')
    expect(ids(state.panes.right)).toEqual(['노트/N.iwnote'])
  })

  it('다른 색의 노트 창이 보여도 그건 닫지 않는다 — 열기가 된다', async () => {
    const { state, opener } = fakeApp(
      { panes: panes({ left: strip([pdf('docS')]), right: strip([note('노트/X.iwnote')]) }), layoutId: 'cols2', channels: { ...DEFAULT_CHANNELS, right: 'green' } },
      { lastTouched: '노트/N.iwnote', entries: [{ path: '노트/N.iwnote', title: 'N' }] },
    )
    const result = opener.toggle('left')
    expect(result.kind).toBe('opening')
    if (result.kind === 'opening') await result.opened
    // 다른 색의 노트 창은 그대로 두고(한 칸 밀려 셋째가 되고 색도 따라간다), 문서 창 옆에 새 노트 창을 연다
    expect(state.layoutId).toBe('cols3')
    expect(ids(state.panes.right)).toEqual(['노트/N.iwnote'])
    expect(ids(state.panes.third)).toEqual(['노트/X.iwnote'])
    expect(state.channels.third).toBe('green')
    expect(state.channels.right).toBe('blue')
  })

  it('place: 이미 있는 노트 탭을 문서 옆에 두고 마지막으로 만진 노트로 삼는다(열기 메뉴·사이드바·MCP)', () => {
    const { state, opener } = fakeApp({ panes: panes({ left: strip([pdf('docS')]) }) })
    const outcome = opener.place('left', '노트/Z.iwnote')
    expect(outcome.kind).toBe('beside')
    expect(state.touched).toEqual(['노트/Z.iwnote'])
    expect(ids(state.panes.right)).toEqual(['노트/Z.iwnote'])
  })
})
