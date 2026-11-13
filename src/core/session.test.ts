import { describe, expect, it } from 'vitest'
import type { PanesState, TabsState } from '../app/workspace/tabs'
import { channelOf } from '../app/workspace/workspaceChannels'
import { layoutForLegacyId, leaves, paneNode, shapeOf } from './layoutTree'
import { PDF_SPLIT_LAYOUTS, type PdfSplitLayoutId } from './pdfSplit'
import { captureSession, dormantTabsOf, emptySession, parseSession, readLegacyLayoutId, screensFromSession, singlePaneWorkspace, withoutTranslatorFloats, withoutTranslatorTreeTabs, workspaceFromSession } from './session'

const pdfTabs: TabsState = {
  tabs: [
    { id: 'doc-a', title: 'A', kind: 'pdf' },
    { id: 'doc-b', title: 'B', kind: 'pdf' },
  ],
  activeId: 'doc-b',
}

const noteTabs: TabsState = {
  tabs: [{ id: 'Specs/Link.canvas', title: 'Link', kind: 'canvas' }],
  activeId: 'Specs/Link.canvas',
}

const valid = {
  pdfTabIds: ['doc-a', 'doc-b'],
  noteTabIds: ['Specs/Link.canvas'],
  activePdfTabId: 'doc-b',
  activeNoteTabId: 'Specs/Link.canvas',
  sidebarCollapsed: true,
  sidebarPx: 312,
  leftFrac: 0.42,
}

const windowLayout = { sidebarCollapsed: true, sidebarPx: 312, leftFrac: 0.42 }
const two = (left: TabsState, right: TabsState): { panes: PanesState; channels: Record<string, 'blue'>; layout: ReturnType<typeof layoutForLegacyId> } => ({
  panes: { a: left, b: right },
  channels: { a: 'blue', b: 'blue' },
  layout: layoutForLegacyId('cols2', ['a', 'b']),
})

describe('captureSession', () => {
  it('탭 제목을 저장하지 않고 id 와 칸 배치(트리·칸마다 탭·보던 탭·색)만 압축한다', () => {
    const workspace = two(pdfTabs, noteTabs)
    expect(captureSession(workspace, windowLayout)).toEqual({
      ...valid,
      layout: workspace.layout,
      paneState: {
        a: { tabIds: ['doc-a', 'doc-b'], activeId: 'doc-b', channel: 'blue' },
        b: { tabIds: ['Specs/Link.canvas'], activeId: 'Specs/Link.canvas', channel: 'blue' },
      },
    })
  })

  it('칸마다 문서·캔버스가 섞여 있어도 종류별 목록과 칸 배치를 함께 남긴다', () => {
    const left: TabsState = {
      tabs: [{ id: 'doc-a', title: 'A', kind: 'pdf' }, { id: 'Specs/Link.canvas', title: 'Link', kind: 'canvas' }],
      activeId: 'Specs/Link.canvas',
    }
    const right: TabsState = { tabs: [{ id: 'doc-b', title: 'B', kind: 'pdf' }], activeId: 'doc-b' }
    const session = captureSession(two(left, right), { sidebarCollapsed: false, sidebarPx: 260, leftFrac: 0.5 })
    expect(session.pdfTabIds).toEqual(['doc-a', 'doc-b'])
    expect(session.noteTabIds).toEqual(['Specs/Link.canvas'])
    expect(session.paneState?.a?.tabIds).toEqual(['doc-a', 'Specs/Link.canvas'])
    expect(session.paneState?.a?.activeId).toBe('Specs/Link.canvas')
    expect(session.paneState?.b?.tabIds).toEqual(['doc-b'])
    expect(parseSession(JSON.parse(JSON.stringify(session)))).toEqual(session)
  })

  it('칸 차례는 트리의 차례를 따른다(키 차례가 아니다). 비율도 함께 저장된다', () => {
    const workspace = { panes: { b: noteTabs, a: pdfTabs }, channels: {}, layout: layoutForLegacyId('cols2', ['a', 'b'], 0.3) }
    const session = captureSession(workspace, windowLayout)
    // a(문서) 가 먼저
    expect(session.pdfTabIds).toEqual(['doc-a', 'doc-b'])
    expect(Object.keys(session.paneState ?? {})).toEqual(['a', 'b'])
    expect(session.layout).toMatchObject({ kind: 'split', dir: 'h', ratio: 0.3 })
    // 채널을 정해 둔 적이 없는 칸은 파랑으로 적힌다
    expect(session.paneState?.a?.channel).toBe('blue')
  })

  it('저장 → 읽기를 거쳐도 트리·칸 상태가 그대로다(8칸 포함)', () => {
    const names = Array.from({ length: 8 }, (_, index) => `p${index}`)
    const layout = layoutForLegacyId('grid4', names.slice(0, 4))
    const workspace = { panes: Object.fromEntries(names.slice(0, 4).map((name, index) => [name, { tabs: [{ id: `d${index}`, title: 'x', kind: 'pdf' as const }], activeId: `d${index}` }])), channels: { p0: 'green' as const, p1: null }, layout }
    const session = captureSession(workspace, windowLayout)
    const restored = parseSession(JSON.parse(JSON.stringify(session)))
    expect(restored.layout).toEqual(layout)
    expect(restored.paneState?.p0?.channel).toBe('green')
    expect(restored.paneState?.p1?.channel).toBeNull()
    expect(restored.paneState?.p2?.channel).toBe('blue')
  })
})

describe('꺼 둔 캔버스 탭은 저장할 때 그대로 지나간다(통과)', () => {
  const canvasId = 'Specs/Link.canvas'
  const saved = () => captureSession({ screens: [{ id: 'w1', name: '읽기', ...two(pdfTabs, noteTabs), zoomed: null, floats: [] }], activeScreen: 'w1', lastScreen: null }, windowLayout)

  it('되살리지 않은 캔버스 탭 id 를 같은 칸 뒤에 다시 적고 노트 탭 목록에도 남긴다', () => {
    const dormant = dormantTabsOf(screensFromSession(saved(), null, '읽기'), new Set([canvasId]))
    expect(dormant).toEqual({ b: [canvasId] })
    // 캔버스를 끈 실행: 칸 b 는 빈 칸으로 보인다
    const shown = { screens: [{ id: 'w1', name: '읽기', ...two(pdfTabs, { tabs: [], activeId: null }), zoomed: null, floats: [] }], activeScreen: 'w1', lastScreen: null }
    const without = captureSession(shown, windowLayout)
    expect(without.noteTabIds).toEqual([])
    const kept = captureSession(shown, windowLayout, dormant)
    expect(kept.noteTabIds).toEqual([canvasId])
    expect(kept.screens![0]!.paneState.b!.tabIds).toEqual([canvasId])
    expect(kept.paneState!.b!.tabIds).toEqual([canvasId])
    // 다시 읽으면 캔버스를 켠 앱이 그대로 되살릴 수 있다
    expect(parseSession(JSON.parse(JSON.stringify(kept))).screens![0]!.paneState.b!.tabIds).toEqual([canvasId])
  })

  it('칸이 닫히면 같이 사라지고, 칸에 다른 탭이 새로 생겨도 캔버스 id 는 그 뒤에 남는다', () => {
    const dormant = dormantTabsOf(screensFromSession(saved(), null, '읽기'), new Set([canvasId]))
    const closed = captureSession({ screens: [{ id: 'w1', name: '읽기', layout: paneNode('a'), panes: { a: pdfTabs } as PanesState, channels: { a: 'blue' as const }, zoomed: null, floats: [] }], activeScreen: 'w1', lastScreen: null }, windowLayout, dormant)
    expect(closed.noteTabIds).toEqual([])
    const added = captureSession({ screens: [{ id: 'w1', name: '읽기', ...two(pdfTabs, { tabs: [{ id: 'doc-c', title: 'C', kind: 'pdf' }], activeId: 'doc-c' }), zoomed: null, floats: [] }], activeScreen: 'w1', lastScreen: null }, windowLayout, dormant)
    expect(added.screens![0]!.paneState.b!.tabIds).toEqual(['doc-c', canvasId])
  })

  it('통과할 탭이 없으면 저장 모양은 그대로다', () => {
    expect(dormantTabsOf(screensFromSession(saved(), null, '읽기'), new Set())).toEqual({})
    expect(captureSession(two(pdfTabs, noteTabs), windowLayout, {})).toEqual(captureSession(two(pdfTabs, noteTabs), windowLayout))
  })

  it('v0.1.19 형식 세션(screens · paneState 없이 left/right 의 panes, 캔버스가 노트 탭 id)도 옮겨 읽은 칸 id 로 통과한다', () => {
    // 그때는 캔버스가 노트 탭(noteTabIds)이었고 칸 이름 right 에 있었다
    const old = parseSession({
      pdfTabIds: ['doc-a'], noteTabIds: [canvasId], activePdfTabId: 'doc-a', activeNoteTabId: canvasId,
      sidebarCollapsed: false, sidebarPx: 260, leftFrac: 0.5,
      panes: { left: ['doc-a'], right: [canvasId], activeLeft: 'doc-a', activeRight: canvasId },
      paneChannels: { left: 'green', right: 'blue', third: 'blue', fourth: 'blue' },
    })
    expect(old.screens).toBeUndefined()
    expect(old.paneState).toBeUndefined()
    const snapshot = screensFromSession(old, 'cols2', '읽기')
    const [leftPane, rightPane] = leaves(snapshot.screens[0]!.layout)
    const dormant = dormantTabsOf(snapshot, new Set([canvasId]))
    expect(dormant).toEqual({ [rightPane!]: [canvasId] })
    // 캔버스를 끈 실행에서 저장해도 그 탭이 같은 칸 뒤에 남고, 노트 탭 목록에도 남는다
    const shown = {
      screens: [{ id: snapshot.screens[0]!.id, name: '읽기', layout: snapshot.screens[0]!.layout, panes: { [leftPane!]: { tabs: [{ id: 'doc-a', title: 'A', kind: 'pdf' as const }], activeId: 'doc-a' }, [rightPane!]: { tabs: [], activeId: null } } as PanesState, channels: { [leftPane!]: 'green' as const, [rightPane!]: 'blue' as const }, zoomed: null, floats: [] }],
      activeScreen: snapshot.screens[0]!.id, lastScreen: null,
    }
    const kept = captureSession(shown, windowLayout, dormant)
    expect(kept.noteTabIds).toEqual([canvasId])
    expect(kept.screens![0]!.paneState[rightPane!]!.tabIds).toEqual([canvasId])
    // 통과가 없으면(예전 코드: 세션 파일의 screens · paneState 만 봤다) 탭이 사라진다
    expect(captureSession(shown, windowLayout).noteTabIds).toEqual([])
  })
})

describe('메모 노트 탭 세션', () => {
  it('탭으로 연 메모 노트는 memoNoteTabIds 와 칸 배치로 남고, 문서·캔버스 목록에는 섞이지 않는다', () => {
    const left: TabsState = { tabs: [{ id: 'doc-a', title: 'A', kind: 'pdf' }], activeId: 'doc-a' }
    const right: TabsState = {
      tabs: [{ id: '노트/전원.iwnote', title: '전원', kind: 'memoNote' }, { id: 'Specs/Link.canvas', title: 'Link', kind: 'canvas' }],
      activeId: '노트/전원.iwnote',
    }
    const session = captureSession(two(left, right), { sidebarCollapsed: false, sidebarPx: 260, leftFrac: 0.5 })
    expect(session.pdfTabIds).toEqual(['doc-a'])
    expect(session.noteTabIds).toEqual(['Specs/Link.canvas'])
    expect(session.memoNoteTabIds).toEqual(['노트/전원.iwnote'])
    expect(session.paneState?.b?.tabIds).toEqual(['노트/전원.iwnote', 'Specs/Link.canvas'])
    expect(parseSession(JSON.parse(JSON.stringify(session)))).toEqual(session)
  })

  it('메모 노트 탭이 없으면 필드를 쓰지 않고, 예전 세션(필드 없음)도 그대로 읽는다', () => {
    expect(captureSession(two(pdfTabs, noteTabs), windowLayout)).not.toHaveProperty('memoNoteTabIds')
    expect(parseSession(valid)).not.toHaveProperty('memoNoteTabIds')
  })
})

describe('parseSession', () => {
  it('정상 입력을 그대로 복원한다', () => {
    expect(parseSession(valid)).toEqual(valid)
  })

  it.each([
    ['빈 객체', {}],
    ['null', null],
    ['필드 일부 누락', { ...valid, activeNoteTabId: undefined }],
    ['문자열이어야 할 배열 항목', { ...valid, pdfTabIds: ['doc-a', 4] }],
    ['잘못된 접힘 값', { ...valid, sidebarCollapsed: 'yes' }],
    ['유한하지 않은 폭', { ...valid, sidebarPx: Number.NaN }],
    ['범위를 벗어난 패널 비율', { ...valid, leftFrac: 2 }],
  ])('%s이면 빈 세션으로 안전하게 떨어진다', (_name, raw) => {
    expect(parseSession(raw)).toEqual(emptySession)
  })

  it('틀린 트리나 칸 상태는 버리고(예전 방식으로 읽는다) 나머지 세션은 살린다', () => {
    const broken = parseSession({ ...valid, layout: { kind: 'split', id: 's', dir: 'x', ratio: 0.5 }, paneState: {} })
    expect(broken.layout).toBeUndefined()
    expect(broken.paneState).toBeUndefined()
    expect(broken.pdfTabIds).toEqual(['doc-a', 'doc-b'])
    const badState = parseSession({ ...valid, layout: paneNode('a'), paneState: { a: { tabIds: 'nope' } } })
    expect(badState.layout).toBeUndefined()
  })

  it('트리의 칸이 칸 상태에 없으면 빈 칸(파랑)으로 채운다', () => {
    const restored = parseSession({ ...valid, layout: layoutForLegacyId('cols2', ['a', 'b']), paneState: { a: { tabIds: ['doc-a'], activeId: 'doc-a', channel: 'green' } } })
    expect(restored.paneState?.b).toEqual({ tabIds: [], activeId: null, channel: 'blue' })
    expect(restored.paneState?.a?.channel).toBe('green')
  })
})

describe('예전 세션 → 칸 나누기 트리', () => {
  /** 예전 세션: 칸 이름별 탭(left/right/third/fourth)과 칸 이름별 색 */
  const legacy = {
    ...valid,
    leftFrac: 0.35,
    panes: {
      left: ['doc-a'], right: ['doc-b'], activeLeft: 'doc-a', activeRight: 'doc-b',
      third: ['Specs/Link.canvas'], activeThird: 'Specs/Link.canvas',
      fourth: ['n4'], activeFourth: 'n4',
    },
    paneChannels: { left: 'green', right: null, third: 'orange', fourth: 'blue' },
  }
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

  it.each(PDF_SPLIT_LAYOUTS.map((layout) => layout.id))('옛 배치 %s 를 같은 모양의 트리로 옮기고 칸 이름별 탭·색을 칸 차례대로 이어 준다', (id) => {
    const session = parseSession(legacy)
    expect(session.panes?.left).toEqual(['doc-a'])
    const { layout, paneState } = workspaceFromSession(session, id)
    const order = leaves(layout)
    expect(shapeOf(layout)).toBe(shapes[id])
    expect(Object.keys(paneState).sort()).toEqual([...order].sort())
    // 칸 차례 0, 1, 2, 3 = 옛 left, right, third, fourth
    const wanted = [
      { tabIds: ['doc-a'], activeId: 'doc-a', channel: 'green' },
      { tabIds: ['doc-b'], activeId: 'doc-b', channel: null },
      { tabIds: ['Specs/Link.canvas'], activeId: 'Specs/Link.canvas', channel: 'orange' },
      { tabIds: ['n4'], activeId: 'n4', channel: 'blue' },
    ]
    const shown = order.length
    order.forEach((pane, index) => {
      // 마지막으로 보이는 칸은 보이지 않던 칸(예: 한 칸 배치인데 right 에 탭이 남음)의 탭을 뒤에 합친다
      if (index < shown - 1) expect(paneState[pane]).toEqual(wanted[index])
    })
    const last = paneState[order[shown - 1]!]!
    expect(last.tabIds).toEqual([...new Set(wanted.slice(shown - 1).flatMap((item) => item.tabIds))])
    expect(last.activeId).toBe(wanted[shown - 1]!.activeId)
    expect(last.channel).toBe(wanted[shown - 1]!.channel)
    // 탭은 하나도 잃지 않는다
    expect(order.flatMap((pane) => paneState[pane]!.tabIds).sort()).toEqual(['Specs/Link.canvas', 'doc-a', 'doc-b', 'n4'])
  })

  it('좌우 둘은 옛 leftFrac 을 왼쪽 몫으로 쓴다', () => {
    const { layout } = workspaceFromSession(parseSession(legacy), 'cols2')
    expect(layout).toMatchObject({ kind: 'split', dir: 'h', ratio: 0.35 })
  })

  it('배치 id 가 없으면(처음 쓰던 사람) 한 칸이고, 보이지 않던 오른쪽 칸의 탭도 그 칸에 모인다', () => {
    const { layout, paneState } = workspaceFromSession(parseSession({ ...legacy, paneChannels: undefined }), null)
    expect(shapeOf(layout)).toBe('P')
    const only = paneState[leaves(layout)[0]!]!
    expect(only.tabIds).toEqual(['doc-a', 'doc-b', 'Specs/Link.canvas', 'n4'])
    expect(only.activeId).toBe('doc-a')
    expect(only.channel).toBe('blue')
  })

  it('칸 정보(panes)나 채널이 아예 없는 예전 세션은 빈 칸들로, 채널은 모두 파랑으로 읽는다(탭은 문서 → 첫 칸, 노트 → 둘째 칸으로 App 이 나눈다)', () => {
    const { layout, paneState } = workspaceFromSession(parseSession(valid), 'cols2')
    expect(shapeOf(layout)).toBe('h(P,P)')
    for (const pane of leaves(layout)) expect(paneState[pane]).toEqual({ tabIds: [], activeId: null, channel: 'blue' })
  })

  it('새 세션(layout·paneState 가 있음)은 그대로 쓰고 예전 필드를 보지 않는다', () => {
    const layout = layoutForLegacyId('rows2', ['x', 'y'])
    const paneState = { x: { tabIds: ['doc-a'], activeId: 'doc-a', channel: 'green' as const }, y: { tabIds: [], activeId: null, channel: null } }
    const result = workspaceFromSession(parseSession({ ...legacy, layout, paneState }), 'grid4')
    expect(result.layout).toEqual(layout)
    expect(result.paneState).toEqual(paneState)
  })

  it('예전 채널의 저장된 null(연동 없음)은 파랑으로 바뀌지 않는다', () => {
    const session = parseSession(legacy)
    expect(session.paneChannels).toEqual({ left: 'green', right: null, third: 'orange', fourth: 'blue' })
    const parsed = workspaceFromSession(session, 'cols2')
    expect(channelOf({ [leaves(parsed.layout)[1]!]: parsed.paneState[leaves(parsed.layout)[1]!]!.channel }, leaves(parsed.layout)[1]!)).toBeNull()
  })

  it('한 칸 작업 공간(떼어 낸 창·새 창)은 빈 칸 하나', () => {
    const { layout, paneState } = singlePaneWorkspace()
    expect(shapeOf(layout)).toBe('P')
    expect(paneState[leaves(layout)[0]!]).toEqual({ tabIds: [], activeId: null, channel: 'blue' })
  })
})

describe('readLegacyLayoutId — 예전에 localStorage 에 따로 적던 배치', () => {
  const storage = (values: Record<string, string>) => ({ getItem: (key: string) => values[key] ?? null })

  it('배치 id 를 읽고, 모르는 값은 무시한다', () => {
    expect(readLegacyLayoutId(storage({ 'iwae:pane-layout:v1': 'grid4' }))).toBe('grid4')
    expect(readLegacyLayoutId(storage({ 'iwae:pane-layout:v1': 'weird' }))).toBeNull()
    expect(readLegacyLayoutId(storage({}))).toBeNull()
    expect(readLegacyLayoutId(null)).toBeNull()
  })

  it('예전 단 수(2·3)와 한 칸 끄기 표시도 좌우 배치로 읽는다', () => {
    expect(readLegacyLayoutId(storage({ 'iwae:pane-count:v1': '2' }))).toBe('cols2')
    expect(readLegacyLayoutId(storage({ 'iwae:pane-count:v1': '3' }))).toBe('cols3')
    expect(readLegacyLayoutId(storage({ 'iwae:single-pane:v2': '0' }))).toBe('cols2')
  })

  it('저장소를 못 읽으면 null', () => {
    expect(readLegacyLayoutId({ getItem: () => { throw new Error('blocked') } })).toBeNull()
  })
})

describe('화면(screens) 저장과 읽기', () => {
  const screensState = () => ({
    screens: [
      { id: 'w1', name: '읽기', layout: layoutForLegacyId('cols2', ['a', 'b']), panes: { a: pdfTabs, b: noteTabs } as PanesState, channels: { a: 'blue', b: 'green' } as Record<string, 'blue' | 'green'>, zoomed: 'a' as string | null, floats: [] },
      { id: 'w2', name: '비교', layout: paneNode('c'), panes: { c: { tabs: [{ id: 'doc-a', title: 'A', kind: 'pdf' as const }], activeId: 'doc-a' } } as PanesState, channels: { c: 'orange' } as Record<string, 'orange'>, zoomed: null, floats: [] },
    ],
    activeScreen: 'w2',
    lastScreen: 'w1',
  })

  it('이름 · 순서 · 화면마다 트리와 칸 상태 · 보던 화면 · 마지막 화면을 저장하고 그대로 읽는다', () => {
    const session = parseSession(JSON.parse(JSON.stringify(captureSession(screensState(), windowLayout))))
    expect(session.screens?.map((screen) => [screen.id, screen.name])).toEqual([['w1', '읽기'], ['w2', '비교']])
    expect(session.screens?.[0]?.paneState.b).toEqual({ tabIds: ['Specs/Link.canvas'], activeId: 'Specs/Link.canvas', channel: 'green' })
    expect(session.screens?.[0]?.zoomed).toBe('a')
    expect(session.screens?.[1]?.zoomed).toBeUndefined()
    expect(session).toMatchObject({ activeScreen: 'w2', lastScreen: 'w1' })
    // 탭 id 목록은 모든 화면의 탭을 한 번씩(같은 문서가 두 화면에 있어도 한 번)
    expect(session.pdfTabIds).toEqual(['doc-a', 'doc-b'])
    // 옛 앱도 읽도록 보던 화면의 layout 을 같이 쓴다
    expect(leaves(session.layout!)).toEqual(['c'])
  })

  it('화면이 적힌 세션은 screensFromSession 이 그대로 돌려준다', () => {
    const session = parseSession(JSON.parse(JSON.stringify(captureSession(screensState(), windowLayout))))
    const result = screensFromSession(session, null, '읽기')
    expect(result.screens).toHaveLength(2)
    expect(result.activeScreen).toBe('w2')
    expect(result.lastScreen).toBe('w1')
  })

  it('단계 1 의 세션(layout 하나)은 「읽기」 화면 하나로 옮긴다', () => {
    const stepOne = captureSession(two(pdfTabs, noteTabs), windowLayout)
    expect(stepOne).not.toHaveProperty('screens')
    const result = screensFromSession(parseSession(JSON.parse(JSON.stringify(stepOne))), null, '읽기')
    expect(result.screens).toHaveLength(1)
    expect(result.screens[0]!.name).toBe('읽기')
    expect(shapeOf(result.screens[0]!.layout)).toBe('h(P,P)')
    expect(result.screens[0]!.paneState.a!.tabIds).toEqual(['doc-a', 'doc-b'])
    expect(result.lastScreen).toBeNull()
  })

  it('단계 1 이전의 세션(칸 이름 left/right)도 같은 길로 「읽기」 화면 하나가 된다', () => {
    const legacy = { ...valid, panes: { left: ['doc-a', 'doc-b'], right: ['Specs/Link.canvas'], activeLeft: 'doc-b', activeRight: 'Specs/Link.canvas' } }
    const result = screensFromSession(parseSession(legacy), 'cols2', '읽기')
    expect(result.screens).toHaveLength(1)
    expect(result.screens[0]!.name).toBe('읽기')
    expect(Object.values(result.screens[0]!.paneState).map((pane) => pane.tabIds)).toEqual([['doc-a', 'doc-b'], ['Specs/Link.canvas']])
  })

  it('칸 id 가 두 화면에 겹치면 뒤 화면의 칸에 새 id 를 주고, 크게 보던 칸도 따라간다', () => {
    const raw = JSON.parse(JSON.stringify(captureSession(screensState(), windowLayout)))
    raw.screens[1].layout = JSON.parse(JSON.stringify(layoutForLegacyId('cols2', ['a', 'z'])))
    raw.screens[1].paneState = { a: raw.screens[0].paneState.a, z: raw.screens[0].paneState.b }
    raw.screens[1].zoomed = 'a'
    const parsed = parseSession(raw)
    const first = leaves(parsed.screens![0]!.layout)
    const second = leaves(parsed.screens![1]!.layout)
    expect(second.filter((pane) => first.includes(pane))).toEqual([])
    expect(parsed.screens![1]!.zoomed).toBe(second[0])
    expect(Object.keys(parsed.screens![1]!.paneState).sort()).toEqual([...second].sort())
  })

  it('모양이 틀린 화면은 건너뛰고, 하나도 못 읽으면 옛 모양으로 본다', () => {
    const raw = JSON.parse(JSON.stringify(captureSession(screensState(), windowLayout)))
    raw.screens[0].layout = { kind: 'nope' }
    expect(parseSession(raw).screens?.map((screen) => screen.id)).toEqual(['w2'])
    raw.screens = [{ id: 'x' }]
    expect(parseSession(raw)).not.toHaveProperty('screens')
  })
})

describe('떠 있는 칸 저장과 읽기', () => {
  const windowLayout = { sidebarCollapsed: false, sidebarPx: 280, leftFrac: 0.5 }
  const floating = () => ({
    screens: [{
      id: 'w1',
      name: '읽기',
      layout: layoutForLegacyId('cols2', ['a', 'b']),
      panes: {
        a: { tabs: [{ id: 'doc-a', title: 'A', kind: 'pdf' as const }], activeId: 'doc-a' },
        b: { tabs: [], activeId: null },
        f1: { tabs: [{ id: 'note/m.iwnote', title: 'M', kind: 'memoNote' as const }], activeId: 'note/m.iwnote' },
        f2: { tabs: [{ id: 'doc-b', title: 'B', kind: 'pdf' as const }], activeId: 'doc-b' },
      } as PanesState,
      channels: { a: 'blue', b: 'green', f1: 'orange', f2: null } as Record<string, 'blue' | 'green' | 'orange' | null>,
      zoomed: null,
      floats: [
        { paneId: 'f1', anchor: { kind: 'pane' as const, paneId: 'a' }, x: 0.55, y: 0.05, w: 340, h: 380, collapsed: false },
        { paneId: 'f2', anchor: { kind: 'screen' as const }, x: 0.2, y: 0.3, w: 400, h: 260, collapsed: true },
      ],
      floatsHidden: true,
    }],
    activeScreen: 'w1',
    lastScreen: null,
  })
  const roundTrip = (state: ReturnType<typeof floating>) => parseSession(JSON.parse(JSON.stringify(captureSession(state, windowLayout))))

  it('떠 있는 칸의 자리 · 크기 · 접힘 · 붙은 곳과 그 칸의 탭 · 색을 저장하고 그대로 읽는다', () => {
    const session = roundTrip(floating())
    const screen = session.screens![0]!
    expect(screen.floats).toEqual(floating().screens[0]!.floats)
    expect(screen.floatsHidden).toBe(true)
    expect(screen.paneState.f1).toEqual({ tabIds: ['note/m.iwnote'], activeId: 'note/m.iwnote', channel: 'orange' })
    expect(screen.paneState.f2).toEqual({ tabIds: ['doc-b'], activeId: 'doc-b', channel: null })
    // 트리 칸은 그대로다
    expect(leaves(screen.layout)).toEqual(['a', 'b'])
  })

  it('떠 있는 칸의 문서 탭도 탭 id 목록에 든다', () => {
    const session = roundTrip(floating())
    expect(session.pdfTabIds).toEqual(['doc-a', 'doc-b'])
  })

  it('떠 있는 칸이 없으면 floats 를 적지 않는다(예전 세션과 같은 모양)', () => {
    const state = floating()
    const plain = { ...state, screens: [{ ...state.screens[0]!, floats: [], floatsHidden: undefined }] }
    const raw = JSON.parse(JSON.stringify(captureSession(plain as never, windowLayout))) as { screens: Record<string, unknown>[] }
    expect('floats' in raw.screens[0]!).toBe(false)
    expect('floatsHidden' in raw.screens[0]!).toBe(false)
  })

  it('읽을 때 나쁜 값을 바로잡는다: 자리 0–1, 최소 크기, 없는 붙은 칸은 화면, 겹치거나 비어 있는 칸 id 는 건너뜀', () => {
    const raw = JSON.parse(JSON.stringify(captureSession(floating(), windowLayout))) as { screens: { floats: unknown[] }[] }
    raw.screens[0]!.floats = [
      { paneId: 'f1', anchor: { kind: 'pane', paneId: 'nope' }, x: 9, y: -3, w: 5, h: 'x', collapsed: 'yes' },
      { paneId: 'f1', anchor: { kind: 'screen' }, x: 0, y: 0, w: 300, h: 300, collapsed: false },
      { paneId: '', anchor: { kind: 'screen' } },
      { paneId: 'a', anchor: { kind: 'screen' } },
      'zzz',
    ]
    const screen = parseSession(raw).screens![0]!
    expect(screen.floats).toHaveLength(1)
    expect(screen.floats![0]).toEqual({ paneId: 'f1', anchor: { kind: 'screen' }, x: 1, y: 0, w: 120, h: 300, collapsed: false })
  })

  it('다른 화면과 칸 id 가 겹치면 뒤의 것에 새 id 를 주고 붙은 칸도 따라간다', () => {
    const state = floating()
    const second = { ...state.screens[0]!, id: 'w2', name: '비교' }
    const session = roundTrip({ ...state, screens: [state.screens[0]!, second] })
    const [first, again] = session.screens!
    const firstIds = [...leaves(first!.layout), ...first!.floats!.map((float) => float.paneId)]
    const againIds = [...leaves(again!.layout), ...again!.floats!.map((float) => float.paneId)]
    expect(againIds.filter((id) => firstIds.includes(id))).toEqual([])
    const renamedAnchor = again!.floats![0]!.anchor
    expect(renamedAnchor.kind === 'pane' && leaves(again!.layout).includes(renamedAnchor.paneId)).toBe(true)
    for (const id of againIds) expect(again!.paneState[id]).toBeDefined()
  })

  it('화면이 적힌 세션을 되살릴 때 떠 있는 칸 id 도 새 칸 id 가 비켜 간다', () => {
    const session = roundTrip({ ...floating(), screens: [{ ...floating().screens[0]!, layout: paneNode('p41'), panes: { p41: { tabs: [], activeId: null }, p77: { tabs: [], activeId: null } } as PanesState, channels: { p41: 'blue', p77: 'blue' }, floats: [{ paneId: 'p77', anchor: { kind: 'screen' as const }, x: 0, y: 0, w: 300, h: 300, collapsed: false }] }] })
    const restored = screensFromSession(session, null, '읽기')
    expect(restored.screens[0]!.floats?.[0]?.paneId).toBe('p77')
    expect(singlePaneWorkspace().layout.kind).toBe('pane')
    const fresh = leaves(singlePaneWorkspace().layout)[0]!
    expect(Number(fresh.slice(1))).toBeGreaterThan(77)
  })
})

describe('번역기 탭을 담았던 떠 있는 칸(2026-11-12 세션)은 번역기 창으로 옮긴다', () => {
  const windowLayout = { sidebarCollapsed: false, sidebarPx: 280, leftFrac: 0.5 }
  /** 예전 앱이 저장한 모양: 칸 id f1 이 번역기 탭 하나를 담은 떠 있는 칸 */
  const legacyRaw = () => {
    const state = {
      screens: [{
        id: 'w1',
        name: '읽기',
        layout: layoutForLegacyId('cols2', ['a', 'b']),
        panes: {
          a: { tabs: [{ id: 'doc-a', title: 'A', kind: 'pdf' as const }], activeId: 'doc-a' },
          b: { tabs: [], activeId: null },
          f1: { tabs: [{ id: 'doc-b', title: 'B', kind: 'pdf' as const }], activeId: 'doc-b' },
        } as PanesState,
        channels: { a: 'blue', b: 'green', f1: 'orange' } as Record<string, 'blue' | 'green' | 'orange' | null>,
        zoomed: null,
        floats: [{ paneId: 'f1', anchor: { kind: 'pane' as const, paneId: 'a' }, x: 0.55, y: 0.05, w: 340, h: 300, collapsed: false }],
      }],
      activeScreen: 'w1',
      lastScreen: null,
    }
    const raw = JSON.parse(JSON.stringify(captureSession(state, windowLayout)))
    raw.screens[0].paneState.f1 = { tabIds: ['translator:f1'], activeId: 'translator:f1', channel: 'orange' }
    return raw
  }

  it('번역기 탭만 있던 떠 있는 칸은 칸 · 상태째 없애고, 그 자리 · 크기를 legacyTranslator 로 남긴다', () => {
    const session = parseSession(legacyRaw())
    const screen = session.screens![0]!
    expect(screen.floats).toBeUndefined()
    expect(screen.paneState.f1).toBeUndefined()
    expect(leaves(screen.layout)).toEqual(['a', 'b'])
    expect(session.legacyTranslator).toEqual({ x: 0.55, y: 0.05, w: 340, h: 300 })
  })

  it('다른 탭도 담은 떠 있는 칸은 번역기 탭만 버린다(탭 · 보던 탭 · 칸은 남는다)', () => {
    const raw = legacyRaw()
    raw.screens[0].paneState.f1 = { tabIds: ['translator:f1', 'doc-b'], activeId: 'translator:f1', channel: 'orange' }
    const session = parseSession(raw)
    const screen = session.screens![0]!
    expect(screen.floats).toHaveLength(1)
    expect(screen.paneState.f1).toEqual({ tabIds: ['doc-b'], activeId: null, channel: 'orange' })
    // 비워 있던 칸이 아니라 번역기 칸만 옮기므로 legacyTranslator 는 없다
    expect(session.legacyTranslator).toBeUndefined()
  })

  it('나누기 트리 칸에 저장된 번역기 탭도 버린다: 번역기 탭만 있던 칸은 트리에서 접고, 창 자리를 legacyTranslator 로 남긴다', () => {
    const raw = legacyRaw()
    raw.screens[0].paneState.b = { tabIds: ['translator:b'], activeId: 'translator:b', channel: 'green' }
    const session = parseSession(raw)
    const screen = session.screens![0]!
    expect(leaves(screen.layout)).toEqual(['a'])
    expect(screen.paneState.b).toBeUndefined()
    expect(JSON.stringify(session.screens)).not.toContain('translator:')
    expect(session.legacyTranslator).toBeDefined()
  })

  it('다른 탭도 있는 트리 칸은 번역기 탭만 버리고 칸은 남는다 · 하나뿐인 칸은 빈 칸으로 남는다', () => {
    const raw = legacyRaw()
    raw.screens[0].paneState.a = { tabIds: ['translator:a', 'doc-a'], activeId: 'translator:a', channel: 'blue' }
    const session = parseSession(raw)
    expect(session.screens![0]!.paneState.a).toEqual({ tabIds: ['doc-a'], activeId: null, channel: 'blue' })
    expect(leaves(session.screens![0]!.layout)).toEqual(['a', 'b'])
    const lone = withoutTranslatorTreeTabs(paneNode('x'), { x: { tabIds: ['translator'], activeId: 'translator', channel: 'blue' } })
    expect(leaves(lone.layout)).toEqual(['x'])
    expect(lone.state.x!.tabIds).toEqual([])
  })

  it('접어 두었거나 모두 숨긴 번역기 칸은 창을 열지 않도록 표시를 남긴다', () => {
    const collapsed = legacyRaw()
    collapsed.screens[0].floats[0].collapsed = true
    expect(parseSession(collapsed).legacyTranslator).toMatchObject({ collapsed: true })
    const hidden = legacyRaw()
    hidden.screens[0].floatsHidden = true
    expect(parseSession(hidden).legacyTranslator).toMatchObject({ hidden: true })
  })

  it('번역기 칸이 없으면 legacyTranslator 도 없고, 새로 저장하는 세션에는 번역기가 적히지 않는다', () => {
    const saved = JSON.parse(JSON.stringify(captureSession(floatsFree(), windowLayout)))
    expect(JSON.stringify(saved)).not.toContain('translator')
    expect(parseSession(saved).legacyTranslator).toBeUndefined()
  })

  it('withoutTranslatorFloats 는 순수하다: 입력을 바꾸지 않고, 처음 만난 번역기 칸의 자리 · 크기만 알려 준다', () => {
    const floats = [
      { paneId: 't1', anchor: { kind: 'screen' as const }, x: 0.1, y: 0.2, w: 340, h: 300, collapsed: false },
      { paneId: 't2', anchor: { kind: 'screen' as const }, x: 0.9, y: 0.9, w: 400, h: 400, collapsed: false },
      { paneId: 'f', anchor: { kind: 'screen' as const }, x: 0, y: 0, w: 300, h: 300, collapsed: false },
    ]
    const state = {
      t1: { tabIds: ['translator'], activeId: 'translator', channel: 'blue' as const },
      t2: { tabIds: ['translator:t2'], activeId: null, channel: 'blue' as const },
      f: { tabIds: ['doc'], activeId: 'doc', channel: 'blue' as const },
    }
    const found: { translator?: { x: number; y: number; w: number; h: number } } = {}
    const result = withoutTranslatorFloats(floats, state, found)
    expect(result.floats.map((float) => float.paneId)).toEqual(['f'])
    expect(Object.keys(result.state)).toEqual(['f'])
    expect(found.translator).toEqual({ x: 0.1, y: 0.2, w: 340, h: 300 })
    expect(Object.keys(state)).toEqual(['t1', 't2', 'f'])
    expect(floats).toHaveLength(3)
  })
})

function floatsFree() {
  return {
    screens: [{ id: 'w1', name: '읽기', layout: paneNode('a'), panes: { a: { tabs: [], activeId: null } } as PanesState, channels: { a: 'blue' as const }, zoomed: null, floats: [] }],
    activeScreen: 'w1',
    lastScreen: null,
  }
}
