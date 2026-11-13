// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  currentLinkPairs,
  getLinkLayerState,
  isCanvasLinkedToDoc,
  pairLinkedPanes,
  registerPaneLinks,
  resetPaneLinks,
  useLinkedDocIds,
  type LinkItem,
  type LinkPaneEntry,
  type LinkRect,
  type PaneLinkSnapshot,
} from './workspaceLinks'

const rect = (left: number, top: number, right: number, bottom: number): LinkRect => ({ left, top, right, bottom })
const entry = (pane: LinkPaneEntry['pane'], role: LinkPaneEntry['role'], channel: LinkPaneEntry['channel'], frame: LinkRect, docId?: string): LinkPaneEntry => ({ pane, role, channel, frame, ...(docId === undefined ? {} : { docId }) })
const snapshot = (frame: LinkRect, items: LinkItem[] = [], activeIds: string[] = []): PaneLinkSnapshot => ({ frame, body: frame, items, activeIds })

afterEach(() => resetPaneLinks())

describe('캔버스 창과 짝 맞추기 — 노트 창과 같은 규칙', () => {
  const docFrame = rect(0, 0, 400, 600)
  const canvasFrame = rect(404, 0, 800, 600)
  const block = (id: string, top: number): LinkItem => ({ id, rect: rect(430, top, 700, top + 100), y: top + 50 })
  const mark = (id: string, top: number): LinkItem => ({ id, color: 'yellow', rect: rect(100, top, 200, top + 14), y: top })

  it('같은 채널의 이웃한 문서와 캔버스를 잇고, 캔버스 쪽임을 알려 준다', () => {
    expect(pairLinkedPanes([entry('left', 'document', 'blue', docFrame, 'a'), entry('right', 'canvas', 'blue', canvasFrame)])).toEqual([{ doc: 'left', note: 'right', noteRole: 'canvas', noteSide: 'right', docId: 'a', distance: 4 }])
    expect(pairLinkedPanes([entry('left', 'canvas', 'blue', docFrame), entry('right', 'document', 'blue', canvasFrame, 'a')])).toEqual([{ doc: 'right', note: 'left', noteRole: 'canvas', noteSide: 'left', docId: 'a', distance: 4 }])
  })

  it('채널이 다르거나 캔버스끼리면 잇지 않는다', () => {
    expect(pairLinkedPanes([entry('left', 'document', 'blue', docFrame), entry('right', 'canvas', 'green', canvasFrame)])).toEqual([])
    expect(pairLinkedPanes([entry('left', 'canvas', 'blue', docFrame), entry('right', 'canvas', 'blue', canvasFrame)])).toEqual([])
  })

  it('메모 노트와 캔버스가 모두 문서와 이웃하면 둘 다와 짝이 맺힌다(같은 형광펜 선도 따로 그린다)', () => {
    registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'a' }, () => snapshot(docFrame, [mark('h', 100)]))
    registerPaneLinks({ pane: 'right', role: 'note', channel: 'blue' }, () => snapshot(rect(404, 0, 800, 298), [{ id: 'h', rect: rect(420, 20, 780, 100), y: 38 }]))
    registerPaneLinks({ pane: 'third', role: 'canvas', channel: 'blue' }, () => snapshot(rect(404, 302, 800, 600), [block('h', 330)]))
    expect(currentLinkPairs().map((pair) => `${pair.note}:${pair.noteRole}`)).toEqual(['right:note', 'third:canvas'])
    const keys = getLinkLayerState().lines.map((line) => line.key)
    expect(keys).toHaveLength(2)
    expect(new Set(keys).size).toBe(2)
  })

  it('문서의 형광펜에서 캔버스 블록의 가까운 가장자리로 간다(캔버스가 오른쪽이면 블록 왼쪽 가장자리)', () => {
    registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'a' }, () => snapshot(docFrame, [mark('h', 100)]))
    registerPaneLinks({ pane: 'right', role: 'canvas', channel: 'blue' }, () => snapshot(canvasFrame, [block('h', 200)]))
    expect(getLinkLayerState().lines).toHaveLength(1)
    expect(getLinkLayerState().lines[0]).toMatchObject({ id: 'h', side: 'right', startX: 200, y: 100, edgeX: 400, cardX: 430, cardY: 250 })
  })

  it('캔버스가 왼쪽이면 형광펜 왼쪽 끝에서 블록의 오른쪽 가장자리로 간다', () => {
    registerPaneLinks({ pane: 'left', role: 'canvas', channel: 'blue' }, () => snapshot(docFrame, [{ id: 'h', rect: rect(30, 200, 300, 300), y: 250 }]))
    registerPaneLinks({ pane: 'right', role: 'document', channel: 'blue', docId: 'a' }, () => snapshot(canvasFrame, [{ id: 'h', color: 'yellow', rect: rect(500, 100, 600, 114), y: 100 }]))
    expect(getLinkLayerState().lines[0]).toMatchObject({ id: 'h', side: 'left', startX: 500, edgeX: 404, cardX: 300, cardY: 250 })
  })

  it('이어진 메모가 없는 블록은 문서가 내놓는 출처 자리(src:블록)와 잇는다', () => {
    registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'a' }, () => snapshot(docFrame, [{ id: 'src:block-1', rect: rect(60, 300, 300, 330), y: 305 }]))
    registerPaneLinks({ pane: 'right', role: 'canvas', channel: 'blue' }, () => snapshot(canvasFrame, [block('src:block-1', 280)]))
    expect(getLinkLayerState().lines.map((line) => line.id)).toEqual(['src:block-1'])
  })

  it('화면 밖으로 나간 블록(몸통 밖)은 선을 그리지 않는다', () => {
    registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'a' }, () => snapshot(docFrame, [mark('h', 100)]))
    registerPaneLinks({ pane: 'right', role: 'canvas', channel: 'blue' }, () => snapshot(canvasFrame, [block('h', 900)]))
    expect(getLinkLayerState().lines).toEqual([])
  })

  it('옛 출처 추적선은 층이 같은 문서·캔버스에 선을 그릴 때만 물러난다(캔버스 창의 이름으로 묻는다)', () => {
    expect(isCanvasLinkedToDoc('right', 'a')).toBe(false)
    registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'a' }, () => snapshot(docFrame, []))
    registerPaneLinks({ pane: 'right', role: 'canvas', channel: 'blue' }, () => snapshot(canvasFrame, []))
    expect(isCanvasLinkedToDoc('right', 'a')).toBe(true)
    expect(isCanvasLinkedToDoc('right', 'other')).toBe(false)
    expect(isCanvasLinkedToDoc(null, 'a')).toBe(false)
  })

  it('캔버스 창은 메모 노트 카드의 「원문이 옆에 보이는가」를 만들지 않는다', () => {
    registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'a' }, () => snapshot(docFrame, []))
    registerPaneLinks({ pane: 'right', role: 'canvas', channel: 'blue' }, () => snapshot(canvasFrame, []))
    const seen: (readonly string[])[] = []
    const Probe = () => { seen.push(useLinkedDocIds('right')); return null }
    render(<Probe />)
    expect(seen.at(-1)).toEqual([])
  })
})
