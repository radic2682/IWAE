import { describe, expect, it } from 'vitest'
import type { PanesState, TabsState } from '../app/tabs'
import { channelOf } from '../app/workspaceChannels'
import { layoutForLegacyId, leaves, paneNode, shapeOf } from './layoutTree'
import { PDF_SPLIT_LAYOUTS, type PdfSplitLayoutId } from './pdfSplit'
import { captureSession, emptySession, parseSession, readLegacyLayoutId, singlePaneWorkspace, workspaceFromSession } from './session'

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
