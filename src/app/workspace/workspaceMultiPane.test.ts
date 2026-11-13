import { describe, expect, it } from 'vitest'
import { layoutForCount, layoutForLegacyId, layoutRects, splitLeaf, type LayoutNode } from '../../core/layoutTree'
import { byRecency, mostRecent, PANE_MRU_LIMIT, touchMru } from './paneRecency'
import { resolveChannelLink } from './channelLink'
import { placeNoteTab, closeNoteBeside } from './noteBeside'
import type { PanesState, Tab } from './tabs'
import { DEFAULT_CHANNELS, type PaneChannels } from './workspaceChannels'
import { neighborSide, pairLinkedPanes, type LinkPaneEntry, type LinkRect } from './workspaceLinks'
import { memoNoteTargetFor, needForMemo, resolvePointSignal, visibleNotePathsIn, type ResolveInput } from './workspaceRouting'

/** 같은 색 칸이 셋 이상일 때의 규칙(색 점 끌어 잇기 · MRU · 이웃에게만 선). 칸 모양은 배치 트리에서 만든 실제 사각형을 쓴다 */

const pdf = (id: string): Tab => ({ id, title: id, kind: 'pdf' })
const note = (id: string): Tab => ({ id, title: id, kind: 'memoNote' })
const pane = (tabs: Tab[], activeId: string | null = tabs[0]?.id ?? null) => ({ tabs, activeId })
const ids = (value: { tabs: readonly Tab[] }) => value.tabs.map((tab) => tab.id)

describe('paneRecency — 칸을 만진 차례', () => {
  it('touchMru: 만진 칸이 맨 앞으로, 이미 맨 앞이면 같은 배열', () => {
    const first = touchMru([], 'a')
    expect(first).toEqual(['a'])
    expect(touchMru(first, 'a')).toBe(first)
    expect(touchMru(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(touchMru(['a', 'b'], 'z')).toEqual(['z', 'a', 'b'])
  })

  it('touchMru: 상한을 넘으면 가장 오래된 칸부터 버린다', () => {
    let mru: readonly string[] = []
    for (let n = 0; n < PANE_MRU_LIMIT + 5; n += 1) mru = touchMru(mru, `p${n}`)
    expect(mru).toHaveLength(PANE_MRU_LIMIT)
    expect(mru[0]).toBe(`p${PANE_MRU_LIMIT + 4}`)
    expect(mru).not.toContain('p0')
  })

  it('byRecency: 최근 칸이 먼저, 기록 없는 칸은 원래 차례로 뒤에', () => {
    expect(byRecency(['a', 'b', 'c', 'd'], ['c', 'a'])).toEqual(['c', 'a', 'b', 'd'])
    expect(byRecency(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
    expect(byRecency(['x', 'y'], ['q'])).toEqual(['x', 'y'])
  })

  it('mostRecent: 후보 가운데 가장 최근 칸, 후보가 없으면 undefined', () => {
    expect(mostRecent(['a', 'b', 'c'], ['b', 'c', 'a'])).toBe('b')
    expect(mostRecent([], ['a'])).toBeUndefined()
  })
})

describe('resolveChannelLink — 색 점을 끌어 다른 칸에 놓기', () => {
  const visible = ['a', 'b', 'c', 'd']

  it('끈 칸에 채널이 있으면 놓은 칸이 그 채널을 받는다(끈 칸은 그대로)', () => {
    const channels: PaneChannels = { a: 'green', b: 'blue', c: null }
    const link = resolveChannelLink(channels, visible, 'a', 'b')!
    expect(link.channel).toBe('green')
    expect(link.channels).toEqual({ a: 'green', b: 'green', c: null })
    expect(link.panes).toEqual(['a', 'b'])
  })

  it('끈 칸이 채널 없음이어도 놓은 칸의 채널은 그대로 따라가지 않는다 — 끈 칸이 정한다', () => {
    // 끈 칸(null)은 규칙대로 새 색을 받고, 놓은 칸도 그 색이 된다
    const channels: PaneChannels = { a: null, b: 'green', c: 'blue', d: 'orange' }
    const link = resolveChannelLink(channels, visible, 'a', 'b')!
    // 두 칸을 뺀 다른 칸(c 파랑 · d 주황)이 쓰지 않는 첫 색은 초록
    expect(link.channel).toBe('green')
    expect(link.channels).toMatchObject({ a: 'green', b: 'green', c: 'blue', d: 'orange' })
  })

  it('끈 칸이 채널 없음: 다른 칸이 쓰지 않는 첫 색(파랑 → 초록 → 주황 차례)을 둘 다에 준다', () => {
    const channels: PaneChannels = { a: null, b: null, c: 'blue', d: 'green' }
    const link = resolveChannelLink(channels, visible, 'a', 'b')!
    expect(link.channel).toBe('orange')
    expect(link.channels).toMatchObject({ a: 'orange', b: 'orange', c: 'blue', d: 'green' })
  })

  it('끈 칸이 채널 없음이고 다른 칸이 아무도 안 쓰면 파랑', () => {
    const link = resolveChannelLink({ a: null, b: null }, ['a', 'b'], 'a', 'b')!
    expect(link.channel).toBe('blue')
    expect(link.channels).toEqual({ a: 'blue', b: 'blue' })
  })

  it('끈 칸이 채널 없음이고 세 색을 모두 다른 칸이 쓰고 있으면 파랑', () => {
    const channels: PaneChannels = { a: null, b: null, c: 'blue', d: 'green', e: 'orange' }
    const link = resolveChannelLink(channels, ['a', 'b', 'c', 'd', 'e'], 'a', 'b')!
    expect(link.channel).toBe('blue')
    expect(link.channels).toMatchObject({ a: 'blue', b: 'blue' })
  })

  it('놓는 칸이 쓰던 색은 「쓰이는 색」으로 세지 않는다(놓으면 덮이므로)', () => {
    // b 가 파랑이어도 b 는 곧 덮이는 칸이다: a(없음)를 b 에 놓으면 다른 칸 c 의 색(초록)만 피한다 → 파랑
    const link = resolveChannelLink({ a: null, b: 'blue', c: 'green' }, ['a', 'b', 'c'], 'a', 'b')!
    expect(link.channel).toBe('blue')
  })

  it('자기 자신에게 놓으면 아무 일도 없다', () => {
    expect(resolveChannelLink({ a: 'blue' }, visible, 'a', 'a')).toBeNull()
  })

  it('채널 기본값(적힌 적 없음)은 파랑으로 본다', () => {
    const link = resolveChannelLink(DEFAULT_CHANNELS, ['a', 'b'], 'a', 'b')!
    expect(link.channel).toBe('blue')
  })
})

describe('같은 색 칸이 셋 이상 — 바꿀 칸은 최근에 만진 하나', () => {
  const noteNeed = (path: string) => needForMemo({
    memoId: 'h', fromNote: false, notesOf: () => [path], visibleNotes: [], docIdOf: () => 'doc', docTab: () => pdf('doc'), noteTab: note,
  })!
  const base = (panes: PanesState, overrides: Partial<ResolveInput> = {}): ResolveInput => ({
    panes,
    channels: DEFAULT_CHANNELS,
    layout: layoutForCount(4, ['d', 'n1', 'n2', 'n3']),
    from: 'd',
    channel: 'blue',
    need: noteNeed('N'),
    preview: true,
    allowNewPane: false,
    ...overrides,
  })

  it('노트 칸 셋 중 미리보기 탭은 가장 최근에 만진 칸에만 열린다', () => {
    const panes: PanesState = { d: pane([pdf('doc')]), n1: pane([note('A')]), n2: pane([note('B')]), n3: pane([note('C')]) }
    const outcome = resolvePointSignal(base(panes, { mru: ['n2', 'n3', 'n1', 'd'] }))
    expect(outcome).toMatchObject({ kind: 'preview', pane: 'n2' })
    expect(ids(outcome.panes.n2!)).toEqual(['B', 'N'])
    // 나머지 둘은 그대로(같은 객체) — 두 칸을 한꺼번에 바꾸지 않는다
    expect(outcome.panes.n1).toBe(panes.n1)
    expect(outcome.panes.n3).toBe(panes.n3)
  })

  it('MRU 가 미리보기 탭이 이미 있는 칸보다 앞선다', () => {
    const withPreview: Tab = { ...note('P'), preview: true }
    const panes: PanesState = { d: pane([pdf('doc')]), n1: pane([note('A'), withPreview]), n2: pane([note('B')]), n3: pane([note('C')]) }
    expect(resolvePointSignal(base(panes, { mru: ['n3', 'n1'] }))).toMatchObject({ kind: 'preview', pane: 'n3' })
  })

  it('만진 기록이 없으면 미리보기 탭이 이미 있는 칸이 먼저(탭을 늘리지 않는다)', () => {
    const withPreview: Tab = { ...note('P'), preview: true }
    const panes: PanesState = { d: pane([pdf('doc')]), n1: pane([note('A')]), n2: pane([note('B'), withPreview]), n3: pane([note('C')]) }
    expect(resolvePointSignal(base(panes))).toMatchObject({ kind: 'preview', pane: 'n2' })
  })

  it('세 칸이 그 노트를 탭으로 갖고 있으면 최근에 만진 칸에서만 활성화한다', () => {
    const panes: PanesState = {
      d: pane([pdf('doc')]),
      n1: pane([note('A'), note('N')], 'A'),
      n2: pane([note('B'), note('N')], 'B'),
      n3: pane([note('C'), note('N')], 'C'),
    }
    const outcome = resolvePointSignal(base(panes, { mru: ['n3', 'n1', 'n2'] }))
    expect(outcome).toMatchObject({ kind: 'activated', pane: 'n3' })
    expect(outcome.panes.n3!.activeId).toBe('N')
    expect(outcome.panes.n1).toBe(panes.n1)
    expect(outcome.panes.n2).toBe(panes.n2)
  })

  it('이미 보이는 칸이 여럿이면 아무것도 바꾸지 않는다(모두 스스로 반응한다)', () => {
    const panes: PanesState = { d: pane([pdf('doc')]), n1: pane([note('N')]), n2: pane([note('N')]), n3: pane([note('N')]) }
    const outcome = resolvePointSignal(base(panes, { mru: ['n3'] }))
    expect(outcome.kind).toBe('visible')
    expect(outcome.panes).toBe(panes)
    expect(outcome.pane).toBe('n3')
  })

  it('다른 색 칸은 MRU 가 앞서도 고르지 않는다', () => {
    const panes: PanesState = { d: pane([pdf('doc')]), n1: pane([note('A')]), n2: pane([note('B')]), n3: pane([note('C')]) }
    const channels: PaneChannels = { d: 'blue', n1: 'blue', n2: 'green', n3: 'blue' }
    const outcome = resolvePointSignal(base(panes, { channels, mru: ['n2', 'n3', 'n1'] }))
    expect(outcome).toMatchObject({ kind: 'preview', pane: 'n3' })
  })

  it('문서 신호도 같은 규칙: 문서 칸 넷 중 최근에 만진 한 칸에만 미리보기', () => {
    const docNeed = needForMemo({ memoId: 'h', fromNote: true, notesOf: () => [], visibleNotes: [], docIdOf: () => 'doc2', docTab: pdf, noteTab: note })!
    const panes: PanesState = { n: pane([note('N')]), d1: pane([pdf('a')]), d2: pane([pdf('b')]), d3: pane([pdf('c')]) }
    const outcome = resolvePointSignal(base(panes, { from: 'n', layout: layoutForCount(4, ['n', 'd1', 'd2', 'd3']), need: docNeed, mru: ['d2', 'd1', 'd3', 'n'] }))
    expect(outcome).toMatchObject({ kind: 'preview', pane: 'd2' })
    expect(outcome.panes.d1).toBe(panes.d1)
    expect(outcome.panes.d3).toBe(panes.d3)
  })
})

describe('새 메모가 갈 노트 — 같은 색 노트 칸 중 최근에 만진 칸의 노트', () => {
  const panes: PanesState = {
    d: pane([pdf('doc')]),
    n1: pane([note('A')]),
    n2: pane([note('B')]),
    n3: pane([note('C')]),
  }
  const visible = ['d', 'n1', 'n2', 'n3']

  it('mru 가 없으면 화면 차례 첫째, 있으면 가장 최근에 만진 노트 칸', () => {
    expect(memoNoteTargetFor(panes, DEFAULT_CHANNELS, visible, 'd')).toBe('A')
    expect(memoNoteTargetFor(panes, DEFAULT_CHANNELS, visible, 'd', ['n3', 'n1'])).toBe('C')
    expect(memoNoteTargetFor(panes, DEFAULT_CHANNELS, visible, 'd', ['n2'])).toBe('B')
  })

  it('보이는 노트 목록도 최근 칸 순서', () => {
    expect(visibleNotePathsIn(panes, DEFAULT_CHANNELS, visible, 'blue', ['n3', 'n2'])).toEqual(['C', 'B', 'A'])
    expect(visibleNotePathsIn(panes, DEFAULT_CHANNELS, visible, 'blue')).toEqual(['A', 'B', 'C'])
  })

  it('다른 색 노트 칸이나 문서 칸은 후보가 아니다', () => {
    const channels: PaneChannels = { d: 'blue', n1: 'green', n2: 'blue', n3: 'orange' }
    expect(memoNoteTargetFor(panes, channels, visible, 'd', ['n1', 'n3', 'n2'])).toBe('B')
  })

  it('같은 색 노트 칸이 없으면 null(옆에 노트를 연다)', () => {
    const channels: PaneChannels = { d: 'blue', n1: 'green', n2: 'green', n3: 'green' }
    expect(memoNoteTargetFor(panes, channels, visible, 'd', ['n1'])).toBeNull()
  })

  it('채널이 없는 문서 칸은 어느 노트와도 잇지 않는다', () => {
    expect(memoNoteTargetFor(panes, { ...DEFAULT_CHANNELS, d: null }, visible, 'd', ['n1'])).toBeNull()
  })

  it('보이는 탭이 노트가 아닌 칸(안 보이는 노트 탭)은 후보가 아니다', () => {
    const hidden: PanesState = { ...panes, n3: pane([pdf('x'), note('C')], 'x') }
    expect(memoNoteTargetFor(hidden, DEFAULT_CHANNELS, visible, 'd', ['n3', 'n2'])).toBe('B')
  })
})

describe('placeNoteTab · closeNoteBeside — 같은 색 노트 칸이 여럿일 때', () => {
  const layout = layoutForCount(4, ['d', 'n1', 'n2', 'n3'])
  const panes: PanesState = { d: pane([pdf('doc')]), n1: pane([note('A')]), n2: pane([note('B')]), n3: pane([note('C')]) }

  it('새 노트는 가장 최근에 만진 노트 칸 하나에만 탭으로 들어간다', () => {
    const outcome = placeNoteTab({ panes, channels: DEFAULT_CHANNELS, layout, anchor: 'd', tab: note('N'), mru: ['n3', 'n2', 'n1'] })
    expect(outcome).toMatchObject({ kind: 'tab', pane: 'n3' })
    expect(ids(outcome.panes.n3!)).toEqual(['C', 'N'])
    expect(outcome.panes.n1).toBe(panes.n1)
    expect(outcome.panes.n2).toBe(panes.n2)
  })

  it('이미 여러 칸에 탭으로 있으면 최근에 만진 칸에서 활성화한다', () => {
    const held: PanesState = { ...panes, n1: pane([note('A'), note('N')], 'A'), n2: pane([note('B'), note('N')], 'B') }
    const outcome = placeNoteTab({ panes: held, channels: DEFAULT_CHANNELS, layout, anchor: 'd', tab: note('N'), mru: ['n2', 'n1'] })
    expect(outcome).toMatchObject({ kind: 'activated', pane: 'n2' })
    expect(outcome.panes.n1).toBe(held.n1)
  })

  it('「옆에 노트 닫기」는 가장 최근에 만진 노트 칸의 노트만 거둔다', () => {
    const outcome = closeNoteBeside({ panes, channels: DEFAULT_CHANNELS, layout, anchor: 'd', mru: ['n2', 'n3'] })!
    expect(outcome.closed).toEqual(['B'])
    expect(outcome.pane).toBe('n2')
  })
})

describe('이웃한 칸 — 배치 트리의 실제 사각형으로(1000×600 화면에 놓는다)', () => {
  const W = 1000
  const H = 600
  /** 배치 트리의 칸마다 화면 사각형(칸 사이 틈 없음 — 맞닿는다) */
  const frames = (layout: LayoutNode): Record<string, LinkRect> => {
    const out: Record<string, LinkRect> = {}
    for (const [id, r] of layoutRects(layout).panes) out[id] = { left: r.x * W, top: r.y * H, right: (r.x + r.w) * W, bottom: (r.y + r.h) * H }
    return out
  }
  /** 가운데 칸은 문서, 나머지는 노트이고 모두 같은 색: 이웃인 (문서, 노트) 쌍 */
  const pairsOf = (layout: LayoutNode, docs: readonly string[]): string[] => {
    const rects = frames(layout)
    const entries: LinkPaneEntry[] = Object.entries(rects).map(([id, frame]) => ({ pane: id, role: docs.includes(id) ? 'document' : 'note', channel: 'blue', frame, docId: docs.includes(id) ? id : undefined }))
    return pairLinkedPanes(entries).map((pair) => `${pair.doc}>${pair.note}:${pair.noteSide}`).sort()
  }

  it('가로 셋(노트 | 문서 | 노트): 문서가 양쪽 노트와 이어진다', () => {
    expect(pairsOf(layoutForCount(3, ['l', 'm', 'r']), ['m'])).toEqual(['m>l:left', 'm>r:right'])
  })

  it('가로 셋(문서 | 노트 | 노트): 떨어진 노트에도 선이 간다', () => {
    expect(pairsOf(layoutForCount(3, ['a', 'b', 'c']), ['a'])).toEqual(['a>b:right', 'a>c:right'])
  })

  it('가로 다섯: 문서가 둘째면 모든 노트와 이어진다(떨어진 노트도)', () => {
    expect(pairsOf(layoutForCount(5, ['a', 'b', 'c', 'd', 'e']), ['b'])).toEqual(['b>a:left', 'b>c:right', 'b>d:right', 'b>e:right'])
  })

  it('세로 나눔(위 | 아래): 위아래도 이어진다(세로로 나간다)', () => {
    const layout = splitLeaf(layoutForLegacyId('single', ['top']), 'top', 'v', 'bottom')
    expect(pairsOf(layout, ['top'])).toEqual(['top>bottom:down'])
  })

  it('2×2 격자: 같은 줄 · 같은 열 · 대각선 모두 이어진다', () => {
    const layout = layoutForCount(4, ['a', 'b', 'c', 'd'])
    const rects = frames(layout)
    expect(neighborSide(rects.a!, rects.b!)).toBe('right')
    expect(neighborSide(rects.a!, rects.c!)).toBeNull()
    expect(neighborSide(rects.a!, rects.d!)).toBeNull()
    expect(neighborSide(rects.c!, rects.d!)).toBe('right')
    expect(pairsOf(layout, ['a'])).toEqual(['a>b:right', 'a>c:down', 'a>d:right'])
  })

  it('왼쪽 하나 · 오른쪽 위아래 둘: 문서 하나가 오른쪽 노트 둘과 모두 이어진다', () => {
    const layout = splitLeaf(splitLeaf(layoutForLegacyId('single', ['doc']), 'doc', 'h', 'rt'), 'rt', 'v', 'rb')
    expect(pairsOf(layout, ['doc'])).toEqual(['doc>rb:right', 'doc>rt:right'])
  })

  it('중첩: 왼쪽 열 위아래 둘 · 오른쪽 하나 — 오른쪽 문서는 왼쪽 두 노트와 이웃이다', () => {
    const layout = splitLeaf(splitLeaf(layoutForLegacyId('single', ['lt']), 'lt', 'v', 'lb'), 'lt', 'h', 'doc', {})
    // lt 를 가로로 나눈 결과: (lt | doc) 위, lb 아래 — 위쪽 줄만 이웃이고 아래 칸은 문서와 세로 범위가 달라 이웃이 아니다
    const rects = frames(layout)
    expect(neighborSide(rects.doc!, rects.lt!)).toBe('left')
    expect(neighborSide(rects.doc!, rects.lb!)).toBeNull()
  })

  it('중첩: 노트 하나 사이에 둔 문서 둘 — 각자 옆 노트와만', () => {
    // d1 | n | d2 를 한 줄에 놓고 같은 색이면 n 은 양쪽 문서와 이어진다
    expect(pairsOf(layoutForCount(3, ['d1', 'n', 'd2']), ['d1', 'd2'])).toEqual(['d1>n:right', 'd2>n:left'])
  })

  it('같은 색 문서 넷 · 노트 하나(일렬): 먼 문서도 이어진다', () => {
    // 한 줄: d1 | d2 | n | d3 | x — 모두 n 과 이어진다
    expect(pairsOf(layoutForCount(5, ['d1', 'd2', 'n', 'd3', 'x']), ['d1', 'd2', 'd3', 'x'])).toEqual(['d1>n:right', 'd2>n:right', 'd3>n:left', 'x>n:left'])
  })
})
