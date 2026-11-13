import { afterEach, describe, expect, it, vi } from 'vitest'
import { emitPointSignal, paneReceives, pendingPointSignal, POINT_SIGNAL_TTL_MS, resetPointSignals, subscribePointSignal } from './workspaceSignal'
import { MAX_PANES, layoutForCount, layoutForLegacyId, leaves, paneNode, shapeOf } from '../../core/layoutTree'
import { type PaneId, type PanesState, type Tab } from './tabs'
import { DEFAULT_CHANNELS, type PaneChannels } from './workspaceChannels'
import { memoNoteTargetFor, memoNoteTargetPaneFor, needForMemo, needForPlace, placementRevealMode, resolvePointSignal, visibleNotePathsIn, type ResolveInput } from './workspaceRouting'

const pdf = (id: string): Tab => ({ id, title: id, kind: 'pdf' })
const note = (id: string): Tab => ({ id, title: id, kind: 'memoNote' })
const pane = (tabs: Tab[], activeId: string | null = tabs[0]?.id ?? null) => ({ tabs, activeId })
const ids = (value: { tabs: readonly Tab[] }) => value.tabs.map((tab) => tab.id)

afterEach(() => resetPointSignals())

describe('가리키기 신호 버스', () => {
  it('신호는 같은 채널 창만 받는다: 보낸 창 자신·다른 채널·채널 없는 신호는 받지 않는다', () => {
    const signal = { from: 'left', channel: 'blue', target: { kind: 'memo', memoId: 'h' }, reason: 'click' } as const
    expect(paneReceives(signal, 'right', 'blue')).toBe(true)
    expect(paneReceives(signal, 'right', 'green')).toBe(false)
    expect(paneReceives(signal, 'right', null)).toBe(false)
    expect(paneReceives(signal, 'left', 'blue')).toBe(false)
    // 채널이 없는 창이 보낸 신호는 보낸 창만 처리한다 — 아무도 받지 않는다
    expect(paneReceives({ ...signal, channel: null }, 'right', 'blue')).toBe(false)
    expect(paneReceives({ ...signal, channel: null }, 'right', null)).toBe(false)
  })

  it('구독자에게 차례 번호를 붙여 알리고, 늦게 열린 화면은 TTL 안의 마지막 신호를 받는다', () => {
    const heard = vi.fn()
    const stop = subscribePointSignal(heard)
    const first = emitPointSignal({ from: 'left', channel: 'blue', target: { kind: 'memo', memoId: 'a' }, reason: 'click' })
    const second = emitPointSignal({ from: 'left', channel: 'blue', target: { kind: 'memo', memoId: 'b' }, reason: 'click' })
    expect(heard).toHaveBeenCalledTimes(2)
    expect(second.seq).toBeGreaterThan(first.seq)
    expect(pendingPointSignal(first.seq)?.target).toEqual({ kind: 'memo', memoId: 'b' })
    expect(pendingPointSignal(second.seq)).toBeNull()
    expect(pendingPointSignal(0, second.at + POINT_SIGNAL_TTL_MS + 1)).toBeNull()
    stop()
    emitPointSignal({ from: 'left', channel: 'blue', target: { kind: 'memo', memoId: 'c' }, reason: 'click' })
    expect(heard).toHaveBeenCalledTimes(2)
  })
})

describe('resolvePointSignal — 신호가 필요한 탭을 보이게 하는 차례', () => {
  const noteNeed = (path: string) => needForMemo({
    memoId: 'h', fromNote: false, notesOf: () => [path], visibleNotes: [], docIdOf: () => 'doc', docTab: () => pdf('doc'), noteTab: note,
  })!
  const docNeed = (docId = 'doc') => needForMemo({
    memoId: 'h', fromNote: true, notesOf: () => [], visibleNotes: [], docIdOf: () => docId, docTab: pdf, noteTab: note,
  })!
  const base = (panes: PanesState, overrides: Partial<ResolveInput> = {}): ResolveInput => ({
    panes,
    channels: DEFAULT_CHANNELS,
    layout: layoutForLegacyId('cols2', ['left', 'right']),
    from: 'left',
    channel: 'blue',
    need: noteNeed('N'),
    preview: true,
    ...overrides,
  })
  const two = (left: Tab[], right: Tab[], leftActive?: string | null, rightActive?: string | null): PanesState => ({
    left: pane(left, leftActive), right: pane(right, rightActive),
  })

  it('채널이 없으면 아무것도 하지 않는다(보낸 창만 처리)', () => {
    const panes = two([pdf('doc')], [note('N')])
    const outcome = resolvePointSignal(base(panes, { channel: null }))
    expect(outcome.kind).toBe('none')
    expect(outcome.panes).toBe(panes)
  })

  it('0. 같은 채널 창이 이미 보이고 있으면 바꾸지 않는다', () => {
    const panes = two([pdf('doc')], [note('N')])
    const outcome = resolvePointSignal(base(panes))
    expect(outcome).toMatchObject({ kind: 'visible', pane: 'right' })
    expect(outcome.panes).toBe(panes)
  })

  it('다른 채널 창에 보이는 것은 보이는 것으로 치지 않는다(같은 채널만 받는다)', () => {
    const panes = two([pdf('doc')], [note('N')])
    const channels: PaneChannels = { ...DEFAULT_CHANNELS, right: 'green' }
    const outcome = resolvePointSignal(base(panes, { channels, allowNewPane: false }))
    expect(outcome.kind).toBe('none')
  })

  it('1. 같은 채널 창에 탭으로 있으면(안 보이는 탭) 그 탭으로 바꾼다', () => {
    const panes = two([pdf('doc')], [note('M'), note('N')], 'M')
    const outcome = resolvePointSignal(base(panes))
    expect(outcome).toMatchObject({ kind: 'activated', pane: 'right' })
    expect(outcome.panes.right!.activeId).toBe('N')
    expect(ids(outcome.panes.right!)).toEqual(['M', 'N'])
  })

  it('2. 없으면 노트를 보는 같은 채널 창에 미리보기 탭으로 연다(다음 미리보기가 그 자리를 갈아 끼운다)', () => {
    const panes = two([pdf('doc')], [note('M')])
    const first = resolvePointSignal(base(panes))
    expect(first).toMatchObject({ kind: 'preview', pane: 'right' })
    expect(ids(first.panes.right!)).toEqual(['M', 'N'])
    expect(first.panes.right!.tabs[1]!.preview).toBe(true)
    const second = resolvePointSignal(base(first.panes, { need: noteNeed('O') }))
    expect(ids(second.panes.right!)).toEqual(['M', 'O'])
    expect(second.panes.right!.activeId).toBe('O')
  })

  it('2. 문서 신호는 문서를 보는 같은 채널 창에 열고, 노트만 보는 창에는 열지 않는다', () => {
    const panes = two([note('M')], [pdf('other')])
    const outcome = resolvePointSignal(base(panes, { from: 'left', need: docNeed() }))
    expect(outcome).toMatchObject({ kind: 'preview', pane: 'right' })
    expect(ids(outcome.panes.right!)).toEqual(['other', 'doc'])
    // 보낸 창(노트)에는 문서를 넣지 않는다
    expect(ids(outcome.panes.left!)).toEqual(['M'])
  })

  it('설정을 끄면 미리보기가 아니라 보통 탭으로 연다', () => {
    const panes = two([pdf('doc')], [note('M')])
    const outcome = resolvePointSignal(base(panes, { preview: false }))
    expect(outcome.kind).toBe('preview')
    expect(outcome.panes.right!.tabs[1]!.preview).toBeUndefined()
  })

  it('3. 맞는 종류의 같은 채널 창이 없으면 보낸 창 옆에 새 창을 열고 같은 채널을 준다', () => {
    const panes: PanesState = { left: pane([note('M')]) }
    const channels: PaneChannels = { ...DEFAULT_CHANNELS, left: 'orange' }
    const outcome = resolvePointSignal(base(panes, { layout: paneNode('left'), from: 'left', channel: 'orange', channels, need: docNeed() }))
    expect(outcome.kind).toBe('beside')
    expect(shapeOf(outcome.layout)).toBe('h(P,P)')
    expect(outcome.pane).not.toBeNull()
    expect(ids(outcome.panes[outcome.pane!]!)).toEqual(['doc'])
    expect(outcome.panes[outcome.pane!]!.tabs[0]!.preview).toBe(true)
    expect(outcome.channels[outcome.pane!]).toBe('orange')
  })

  it('다른 색 창만 있어도 새 창을 연다(다른 색 창은 건드리지 않는다)', () => {
    const panes = two([note('M')], [pdf('other')])
    const channels: PaneChannels = { ...DEFAULT_CHANNELS, right: 'green' }
    const outcome = resolvePointSignal(base(panes, { channels, need: docNeed() }))
    expect(outcome.kind).toBe('beside')
    expect(leaves(outcome.layout)).toHaveLength(3)
    // 새 칸은 보낸 창 바로 옆에 끼고 다른 색 칸(right)은 그대로 색을 지킨다
    expect(leaves(outcome.layout)).toEqual(['left', outcome.pane, 'right'])
    expect(outcome.channels.right).toBe('green')
    expect(ids(outcome.panes.right!)).toEqual(['other'])
  })

  it('3. 칸이 이미 8개면 보낸 창에 미리보기 탭으로 연다', () => {
    const names = Array.from({ length: MAX_PANES }, (_, index) => `p${index}`)
    const panes: PanesState = Object.fromEntries(names.map((name) => [name, pane([note(`M-${name}`)])]))
    const layout = layoutForCount(MAX_PANES, names)
    const outcome = resolvePointSignal(base(panes, { layout, from: 'p0', need: docNeed(), channels: {} }))
    expect(outcome).toMatchObject({ kind: 'sender', pane: 'p0' })
    expect(ids(outcome.panes.p0!)).toEqual(['M-p0', 'doc'])
    expect(outcome.panes.p0!.tabs[1]!.preview).toBe(true)
    expect(outcome.layout).toBe(layout)
  })

  it('3. 칸이 너무 작아 못 나누면(크기를 알 때) 보낸 창에 미리보기 탭으로 연다', () => {
    const panes = two([note('M')], [note('M2')])
    const outcome = resolvePointSignal(base(panes, { need: docNeed(), sizeOf: () => ({ width: 300, height: 300 }) }))
    expect(outcome).toMatchObject({ kind: 'sender', pane: 'left' })
  })

  it('3. 칸이 이미 8개면 노트는 가장 오른쪽 창에 탭으로(미리보기) 열고, 그 창이 보낸 창과 같은 색이 된다', () => {
    const names = Array.from({ length: MAX_PANES }, (_, index) => `p${index}`)
    const panes: PanesState = Object.fromEntries(names.map((name) => [name, pane([pdf(name === 'p0' ? 'doc' : `d-${name}`)])]))
    const layout = layoutForCount(MAX_PANES, names)
    const channels: PaneChannels = { p7: 'green' }
    const outcome = resolvePointSignal(base(panes, { channels, layout, from: 'p0', need: noteNeed('N') }))
    expect(outcome).toMatchObject({ kind: 'rightmost', pane: 'p7' })
    expect(outcome.layout).toBe(layout)
    expect(ids(outcome.panes.p7!)).toEqual(['d-p7', 'N'])
    expect(outcome.panes.p7!.tabs[1]!.preview).toBe(true)
    expect(outcome.channels.p7).toBe('blue')
    // 미리보기를 끄면 보통 탭
    expect(resolvePointSignal(base(panes, { channels, layout, from: 'p0', need: noteNeed('N'), preview: false })).panes.p7!.tabs[1]!.preview).toBeUndefined()
  })

  it('allowNewPane 가 꺼져 있으면(노트 바가 노트를 맡는 동안의 문서 신호) 새 창을 열지 않는다', () => {
    const panes: PanesState = { left: pane([pdf('doc')]) }
    const outcome = resolvePointSignal(base(panes, { layout: paneNode('left'), allowNewPane: false }))
    expect(outcome.kind).toBe('none')
    expect(outcome.panes).toBe(panes)
  })

  it('보낸 창이 이미 그 문서를 보고 있으면 아무것도 열지 않는다', () => {
    const panes = two([pdf('doc')], [note('M')])
    const outcome = resolvePointSignal(base(panes, { from: 'left', need: docNeed() }))
    expect(outcome).toMatchObject({ kind: 'visible', pane: 'left' })
    expect(outcome.panes).toBe(panes)
  })

  it('같은 PDF 의 두 번째 보기(docId#2)도 그 문서로 센다', () => {
    const panes = two([note('M')], [pdf('doc#2')])
    expect(resolvePointSignal(base(panes, { need: docNeed() }))).toMatchObject({ kind: 'visible', pane: 'right' })
  })
})

describe('신호가 보여 줄 것 고르기', () => {
  it('문서 화면에서 보낸 메모는 그 메모를 담은 노트 — 같은 채널에 이미 보이는 노트를 먼저', () => {
    const need = needForMemo({ memoId: 'h', fromNote: false, notesOf: () => ['A', 'B'], visibleNotes: ['B'], docIdOf: () => 'd', docTab: pdf, noteTab: note })
    expect(need?.kind).toBe('note')
    expect(need?.tab.id).toBe('B')
    expect(needForMemo({ memoId: 'h', fromNote: false, notesOf: () => ['A', 'B'], visibleNotes: [], docIdOf: () => 'd', docTab: pdf, noteTab: note })?.tab.id).toBe('A')
    // 어느 노트에도 없으면 보일 것이 없다
    expect(needForMemo({ memoId: 'h', fromNote: false, notesOf: () => [], visibleNotes: [], docIdOf: () => 'd', docTab: pdf, noteTab: note })).toBeNull()
  })

  it('노트 화면에서 보낸 메모는 그 메모의 문서. 문서를 모르면 null', () => {
    expect(needForMemo({ memoId: 'h', fromNote: true, notesOf: () => [], visibleNotes: [], docIdOf: () => 'd', docTab: pdf, noteTab: note })?.tab).toEqual(pdf('d'))
    expect(needForMemo({ memoId: 'h', fromNote: true, notesOf: () => [], visibleNotes: [], docIdOf: () => null, docTab: pdf, noteTab: note })).toBeNull()
    expect(needForMemo({ memoId: 'h', fromNote: true, notesOf: () => [], visibleNotes: [], docIdOf: () => 'd', docTab: () => null, noteTab: note })).toBeNull()
  })

  it('티켓의 다른 자리처럼 노트가 정해진 신호는 보낸 쪽과 상관없이 그 노트를 보인다', () => {
    const need = needForMemo({ memoId: 'h', notePath: 'Z', fromNote: true, notesOf: () => ['A'], visibleNotes: ['A'], docIdOf: () => 'd', docTab: pdf, noteTab: note })
    expect(need?.kind).toBe('note')
    expect(need?.tab.id).toBe('Z')
    expect(need?.matches(note('Z'))).toBe(true)
    expect(need?.matches(note('A'))).toBe(false)
  })

  it('위치 신호는 그 문서', () => {
    expect(needForPlace('d', pdf)?.tab.id).toBe('d')
    expect(needForPlace('d', () => null)).toBeNull()
  })
})

describe('티켓의 다른 자리로 가기(placementRevealMode)', () => {
  it('같은 색 창에 메모 노트가 보이면 신호로, 아니면 예전처럼 이 화면에서', () => {
    expect(placementRevealMode({ path: 'Z', openPath: 'A', pane: 'left', channel: 'blue', channelNotes: ['M'] })).toBe('signal')
    expect(placementRevealMode({ path: 'Z', openPath: 'A', pane: 'left', channel: 'blue', channelNotes: [] })).toBe('local')
  })
  it('채널이 없거나 창 밖이거나 이 화면이 이미 그 노트면 늘 이 화면에서', () => {
    expect(placementRevealMode({ path: 'Z', openPath: 'A', pane: 'left', channel: null, channelNotes: ['M'] })).toBe('local')
    expect(placementRevealMode({ path: 'Z', openPath: 'A', pane: null, channel: 'blue', channelNotes: ['M'] })).toBe('local')
    expect(placementRevealMode({ path: 'A', openPath: 'A', pane: 'left', channel: 'blue', channelNotes: ['A'] })).toBe('local')
  })
})

describe('같은 채널에 보이는 노트', () => {
  const panes: PanesState = { left: pane([pdf('doc')]), right: pane([note('N'), note('M')], 'M'), third: pane([note('P')]) }
  const channels: PaneChannels = { left: 'blue', right: 'blue', third: 'green' }
  const visible: PaneId[] = ['left', 'right', 'third']

  it('새 메모가 갈 노트가 보이는 칸: memoNoteTargetFor 와 같은 칸을 돌려준다', () => {
    expect(memoNoteTargetPaneFor(panes, channels, visible, 'left')).toBe('right')
    expect(memoNoteTargetPaneFor(panes, { ...channels, left: 'green' }, visible, 'left')).toBe('third')
    expect(memoNoteTargetPaneFor(panes, { ...channels, left: null }, visible, 'left')).toBeNull()
  })

  it('보이는(활성 탭인) 같은 채널의 메모 노트만 센다', () => {
    expect(visibleNotePathsIn(panes, channels, visible, 'blue')).toEqual(['M'])
    expect(visibleNotePathsIn(panes, channels, visible, 'green')).toEqual(['P'])
    expect(visibleNotePathsIn(panes, channels, visible, null)).toEqual([])
  })

  it('새 메모가 갈 노트: 같은 채널 창에 보이는 메모 노트 탭. 채널이 없거나 다른 색뿐이면 null', () => {
    expect(memoNoteTargetFor(panes, channels, visible, 'left')).toBe('M')
    expect(memoNoteTargetFor(panes, { ...channels, left: 'green' }, visible, 'left')).toBe('P')
    expect(memoNoteTargetFor(panes, { ...channels, left: null }, visible, 'left')).toBeNull()
    expect(memoNoteTargetFor(panes, { ...channels, right: 'orange', third: 'orange' }, visible, 'left')).toBeNull()
    // 안 보이는 창(칸 밖)의 노트는 세지 않는다
    expect(memoNoteTargetFor(panes, channels, ['left'], 'left')).toBeNull()
  })
})
