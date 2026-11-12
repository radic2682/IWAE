import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  currentLinkPairs,
  flushPaneLinks,
  getLinkLayerState,
  linkLines,
  neighborSide,
  pairLinkedPanes,
  registerPaneLinks,
  resetPaneLinks,
  visibleSlice,
  type LinkItem,
  type LinkPaneEntry,
  type LinkPair,
  type LinkRect,
  type PaneLinkSnapshot,
} from './workspaceLinks'

const rect = (left: number, top: number, right: number, bottom: number): LinkRect => ({ left, top, right, bottom })
const entry = (pane: LinkPaneEntry['pane'], role: LinkPaneEntry['role'], channel: LinkPaneEntry['channel'], frame: LinkRect, docId?: string): LinkPaneEntry => ({ pane, role, channel, frame, ...(docId === undefined ? {} : { docId }) })

afterEach(() => resetPaneLinks())

describe('neighborSide — 이웃한 칸', () => {
  const left = rect(0, 0, 400, 600)
  it('가로로 맞닿고(칸막이 틈 안) 세로가 겹치면 이웃이다', () => {
    expect(neighborSide(left, rect(404, 0, 800, 600))).toBe('right')
    expect(neighborSide(rect(404, 0, 800, 600), left)).toBe('left')
    // 세로가 일부만 겹쳐도(왼쪽 하나 · 오른쪽 둘) 이웃
    expect(neighborSide(left, rect(404, 300, 800, 600))).toBe('right')
  })
  it('위아래로 맞닿은 칸은 이웃이 아니다', () => {
    expect(neighborSide(left, rect(0, 604, 400, 900))).toBeNull()
  })
  it('사이에 다른 칸이 있어 떨어진 칸은 이웃이 아니다', () => {
    expect(neighborSide(left, rect(800, 0, 1200, 600))).toBeNull()
  })
  it('세로로 거의 안 겹치거나 접혀 폭이 없는 칸은 이웃이 아니다', () => {
    expect(neighborSide(left, rect(404, 590, 800, 900))).toBeNull()
    expect(neighborSide(left, rect(400, 0, 400, 600))).toBeNull()
  })
})

describe('pairLinkedPanes — 짝 맞추기', () => {
  const doc = rect(0, 0, 400, 600)
  const note = rect(404, 0, 800, 600)

  it('같은 채널의 이웃한 문서와 노트를 잇고, 노트가 어느 쪽인지 알려 준다', () => {
    expect(pairLinkedPanes([entry('left', 'document', 'blue', doc, 'a'), entry('right', 'note', 'blue', note)])).toEqual([{ doc: 'left', note: 'right', noteSide: 'right', docId: 'a' }])
    expect(pairLinkedPanes([entry('left', 'note', 'blue', doc), entry('right', 'document', 'blue', note, 'a')])).toEqual([{ doc: 'right', note: 'left', noteSide: 'left', docId: 'a' }])
  })
  it('채널이 다르거나 없으면 잇지 않는다', () => {
    expect(pairLinkedPanes([entry('left', 'document', 'blue', doc), entry('right', 'note', 'green', note)])).toEqual([])
    expect(pairLinkedPanes([entry('left', 'document', null, doc), entry('right', 'note', null, note)])).toEqual([])
  })
  it('문서와 문서, 노트와 노트는 잇지 않는다', () => {
    expect(pairLinkedPanes([entry('left', 'document', 'blue', doc), entry('right', 'document', 'blue', note)])).toEqual([])
    expect(pairLinkedPanes([entry('left', 'note', 'blue', doc), entry('right', 'note', 'blue', note)])).toEqual([])
  })
  it('위아래로 나뉜 문서와 노트는 잇지 않는다', () => {
    expect(pairLinkedPanes([entry('left', 'document', 'blue', rect(0, 0, 800, 300)), entry('right', 'note', 'blue', rect(0, 304, 800, 600))])).toEqual([])
  })
  it('좌우 셋에서 가운데에 끼어 떨어진 같은 채널 창은 잇지 않는다', () => {
    const cols3 = [entry('left', 'document', 'blue', rect(0, 0, 300, 600)), entry('right', 'document', 'green', rect(304, 0, 600, 600)), entry('third', 'note', 'blue', rect(604, 0, 900, 600))]
    expect(pairLinkedPanes(cols3)).toEqual([])
  })
  it('격자: 왼쪽 하나 · 오른쪽 둘 — 오른쪽 위·아래 노트가 모두 왼쪽 문서와 이웃이다', () => {
    const pairs = pairLinkedPanes([
      entry('left', 'document', 'blue', rect(0, 0, 400, 600), 'a'),
      entry('right', 'note', 'blue', rect(404, 0, 800, 298)),
      entry('third', 'note', 'blue', rect(404, 302, 800, 600)),
    ])
    expect(pairs.map((pair) => pair.note)).toEqual(['right', 'third'])
  })
  it('격자 2×2: 같은 줄 이웃만 잇고 위아래·대각선은 잇지 않는다', () => {
    const grid = [
      entry('left', 'document', 'blue', rect(0, 0, 400, 300), 'a'),
      entry('right', 'document', 'blue', rect(404, 0, 800, 300), 'b'),
      entry('third', 'note', 'blue', rect(0, 304, 400, 600)),
      entry('fourth', 'note', 'blue', rect(404, 304, 800, 600)),
    ]
    expect(pairLinkedPanes(grid)).toEqual([])
    // 같은 줄이면 이웃
    expect(pairLinkedPanes([entry('left', 'document', 'blue', rect(0, 0, 400, 300), 'a'), entry('right', 'note', 'blue', rect(404, 0, 800, 300))])).toHaveLength(1)
  })
})

describe('linkLines — 선 모양', () => {
  const mark = (id: string, rectLeft: number, rectRight: number, y: number): LinkItem => ({ id, color: 'yellow', rect: rect(rectLeft, y, rectRight, y + 14), y })
  const card = (id: string, left: number, right: number, top: number): LinkItem => ({ id, rect: rect(left, top, right, top + 80), y: top + 18 })
  const doc = (items: LinkItem[], frame = rect(0, 0, 400, 600), activeIds: string[] = []): PaneLinkSnapshot => ({ frame, body: frame, items, activeIds })
  const note = (items: LinkItem[], frame = rect(404, 0, 800, 600), activeIds: string[] = []): PaneLinkSnapshot => ({ frame, body: frame, items, activeIds })

  it('노트가 오른쪽이면 형광펜의 오른쪽 끝에서 문서 창 오른쪽 가장자리까지 가서 카드 왼쪽 가장자리로 든다', () => {
    const pair: LinkPair = { doc: 'left', note: 'right', noteSide: 'right', docId: 'a' }
    const [line] = linkLines(pair, doc([mark('h', 100, 220, 120)]), note([card('h', 420, 780, 200)]))
    expect(line).toMatchObject({ id: 'h', side: 'right', startX: 220, y: 120, edgeX: 400, cardX: 420, cardY: 218, active: false })
  })
  it('노트가 왼쪽이면 형광펜의 왼쪽 끝에서 왼쪽으로 가서 카드 오른쪽 가장자리로 든다', () => {
    const pair: LinkPair = { doc: 'right', note: 'left', noteSide: 'left', docId: 'a' }
    const [line] = linkLines(pair, doc([mark('h', 500, 620, 120)], rect(404, 0, 800, 600)), note([card('h', 20, 380, 200)], rect(0, 0, 400, 600)))
    expect(line).toMatchObject({ side: 'left', startX: 500, edgeX: 404, cardX: 380, cardY: 218 })
  })
  it('보이는 형광펜과 보이는 카드가 둘 다 있는 것만, 각 몸통 안에 걸친 것만 그린다', () => {
    const pair: LinkPair = { doc: 'left', note: 'right', noteSide: 'right', docId: 'a' }
    const lines = linkLines(pair,
      doc([mark('both', 100, 200, 100), mark('noCard', 100, 200, 150), mark('outside', 100, 200, 700), mark('cardBelow', 100, 200, 160)]),
      note([card('both', 420, 780, 90), card('outside', 420, 780, 90), card('cardBelow', 420, 780, 590)]))
    expect(lines.map((line) => line.id)).toEqual(['both'])
  })
  it('가리키는 선(문서 쪽이든 노트 쪽이든)은 활성이고 맨 뒤에 놓여 위에 그려진다', () => {
    const pair: LinkPair = { doc: 'left', note: 'right', noteSide: 'right', docId: 'a' }
    const lines = linkLines(pair,
      doc([mark('x', 100, 200, 100), mark('y', 100, 200, 140), mark('z', 100, 200, 180)]),
      note([card('x', 420, 780, 90), card('y', 420, 780, 130), card('z', 420, 780, 170)], rect(404, 0, 800, 600), ['x']))
    expect(lines.map((line) => [line.id, line.active])).toEqual([['y', false], ['z', false], ['x', true]])
  })
})

describe('visibleSlice — 보이는 것만 읽는다', () => {
  it('항목이 1,000 개여도 읽는 것은 보이는 몇 개와 앞뒤 하나씩이다', () => {
    const reads = vi.fn()
    const rectAt = (index: number) => { reads(index); return { top: index * 100 - 50000, bottom: index * 100 - 50000 + 90 } }
    // 몸통 0~300: 500 번째 카드부터 보인다
    const slice = visibleSlice(1000, rectAt, 0, 300, 500)
    expect(slice.indexes).toEqual([500, 501, 502, 503])
    expect(new Set(reads.mock.calls.map(([index]) => index as number)).size).toBeLessThanOrEqual(8)
    expect(slice.first).toBe(500)
  })
  it('스크롤해서 힌트가 멀어져도 첫 보이는 자리를 찾아간다(위·아래 어느 쪽이든)', () => {
    const at = (offset: number) => (index: number) => ({ top: index * 100 - offset, bottom: index * 100 - offset + 90 })
    expect(visibleSlice(1000, at(0), 0, 300, 700).indexes).toEqual([0, 1, 2, 3])
    expect(visibleSlice(1000, at(90000), 0, 300, 3).indexes).toEqual([900, 901, 902, 903])
  })
  it('그리지 않는 항목(접힘, null)은 건너뛰고, 아무것도 없으면 빈 목록이다', () => {
    const hidden = (index: number) => (index % 2 === 0 ? null : { top: index * 100, bottom: index * 100 + 90 })
    expect(visibleSlice(10, hidden, 0, 250).indexes).toEqual([1])
    expect(visibleSlice(0, hidden, 0, 250).indexes).toEqual([])
    expect(visibleSlice(3, () => null, 0, 250).indexes).toEqual([])
  })
})

describe('등록 — 탭이 바뀌거나 닫히면 거둔다', () => {
  const snapshot = (frame: LinkRect, items: LinkItem[] = [], activeIds: string[] = []): PaneLinkSnapshot => ({ frame, body: frame, items, activeIds })
  const docFrame = rect(0, 0, 400, 600)
  const noteFrame = rect(404, 0, 800, 600)
  const markItem: LinkItem = { id: 'h', color: 'green', rect: rect(100, 100, 200, 114), y: 100 }
  const cardItem: LinkItem = { id: 'h', rect: rect(420, 90, 780, 170), y: 108 }

  it('문서와 노트가 같은 채널로 이웃하면 짝이 맺히고 선이 나온다', () => {
    registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'a' }, () => snapshot(docFrame, [markItem]))
    registerPaneLinks({ pane: 'right', role: 'note', channel: 'blue' }, () => snapshot(noteFrame, [cardItem]))
    expect(currentLinkPairs()).toEqual([{ doc: 'left', note: 'right', noteSide: 'right', docId: 'a' }])
    expect(getLinkLayerState().lines.map((line) => line.id)).toEqual(['h'])
  })
  it('노트 탭을 닫으면(거두면) 짝과 선이 사라진다', () => {
    registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'a' }, () => snapshot(docFrame, [markItem]))
    const stop = registerPaneLinks({ pane: 'right', role: 'note', channel: 'blue' }, () => snapshot(noteFrame, [cardItem]))
    stop()
    expect(currentLinkPairs()).toEqual([])
    expect(getLinkLayerState().lines).toEqual([])
  })
  it('같은 창의 탭이 바뀌어 새 등록이 먼저 와도 옛 등록의 거둠이 새 것을 지우지 않는다', () => {
    registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'a' }, () => snapshot(docFrame, [markItem]))
    const stopOld = registerPaneLinks({ pane: 'right', role: 'note', channel: 'blue' }, () => snapshot(noteFrame, [cardItem]))
    registerPaneLinks({ pane: 'right', role: 'note', channel: 'blue' }, () => snapshot(noteFrame, [cardItem]))
    stopOld()
    expect(currentLinkPairs()).toHaveLength(1)
  })
  it('창의 보이는 탭이 문서에서 노트로 바뀌면(문서 등록이 거두어지면) 짝이 풀린다', () => {
    const stopDoc = registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'a' }, () => snapshot(docFrame, [markItem]))
    registerPaneLinks({ pane: 'right', role: 'note', channel: 'blue' }, () => snapshot(noteFrame, [cardItem]))
    stopDoc()
    registerPaneLinks({ pane: 'left', role: 'note', channel: 'blue' }, () => snapshot(docFrame, [cardItem]))
    // 이제 노트와 노트다
    expect(currentLinkPairs()).toEqual([])
  })
  it('채널이 없거나 짝이 될 창이 없으면 재지도 않는다', () => {
    const docMeasure = vi.fn(() => snapshot(docFrame, [markItem]))
    registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'a' }, docMeasure)
    flushPaneLinks()
    expect(docMeasure).not.toHaveBeenCalled()
    const noteMeasure = vi.fn(() => snapshot(noteFrame, [cardItem]))
    registerPaneLinks({ pane: 'right', role: 'note', channel: null }, noteMeasure)
    flushPaneLinks()
    expect(noteMeasure).not.toHaveBeenCalled()
    expect(docMeasure).not.toHaveBeenCalled()
  })
  it('결과가 같으면 층을 다시 깨우지 않는다', () => {
    registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'a' }, () => snapshot(docFrame, [markItem]))
    registerPaneLinks({ pane: 'right', role: 'note', channel: 'blue' }, () => snapshot(noteFrame, [cardItem]))
    const before = getLinkLayerState()
    flushPaneLinks()
    flushPaneLinks()
    expect(getLinkLayerState()).toBe(before)
  })
})
