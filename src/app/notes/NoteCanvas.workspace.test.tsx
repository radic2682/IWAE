// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { createDevelopmentCanvasDocument } from '../../fixtures/developmentCanvasDocument'
import type { CanvasDocumentV2, PdfExcerptCanvasBlock } from '../../core/canvasDocument'
import { NoteCanvas } from './NoteCanvas'
import { PaneIdContext, WorkspaceContext, NO_WORKSPACE_LINK, type WorkspaceLink } from '../workspace/workspaceContext'
import { DEFAULT_CHANNELS, type PaneChannels } from '../workspace/workspaceChannels'
import { emitPointSignal, resetPointSignals, subscribePointSignal, type DeliveredSignal } from '../workspace/workspaceSignal'
import { currentLinkPairs, getLinkLayerState, registerPaneLinks, resetPaneLinks, flushPaneLinks } from '../workspace/workspaceLinks'
import type { PointableHighlight } from './canvasWorkspace'

const flowHooks = vi.hoisted(() => ({
  setViewport: vi.fn(),
  props: null as Record<string, unknown> | null,
}))

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    ReactFlow: (props: Record<string, unknown>) => {
      flowHooks.props = props
      return createElement(actual.ReactFlow, props)
    },
    useUpdateNodeInternals: () => vi.fn(),
    useReactFlow: () => ({
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      zoomTo: vi.fn(),
      fitView: vi.fn(),
      getViewport: () => ({ x: 10, y: 20, zoom: 2 }),
      setViewport: flowHooks.setViewport,
    }),
  }
})

const original = Element.prototype.getBoundingClientRect
const box = (left: number, top: number, right: number, bottom: number): DOMRect => ({ x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top, toJSON: () => ({}) })

beforeEach(() => {
  flowHooks.props = null
  flowHooks.setViewport.mockReset()
  resetPointSignals()
  resetPaneLinks()
  // 캔버스 틀은 오른쪽 칸(404~800 × 0~600)
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this instanceof HTMLElement && this.classList.contains('note-flow')) return box(404, 0, 800, 600)
    return original.call(this)
  }
})

afterEach(() => {
  cleanup()
  Element.prototype.getBoundingClientRect = original
})

function pdfNodes(document: CanvasDocumentV2) {
  return document.nodes.filter((node) => node.data.block.kind === 'pdfExcerpt')
}

function Harness({ channels = DEFAULT_CHANNELS, children }: { channels?: PaneChannels; children: ReactNode }) {
  const link: WorkspaceLink = { ...NO_WORKSPACE_LINK, channels }
  return (
    <WorkspaceContext.Provider value={link}>
      <PaneIdContext.Provider value="right">{children}</PaneIdContext.Provider>
    </WorkspaceContext.Provider>
  )
}

function renderCanvas(options: { highlights?: readonly PointableHighlight[]; channels?: PaneChannels; document?: CanvasDocumentV2 } = {}) {
  const document = options.document ?? createDevelopmentCanvasDocument()
  const view = render(
    <Harness channels={options.channels}>
      <NoteCanvas noteId="샘플/n.canvas" title="샘플" initialDocument={document} highlights={options.highlights} />
    </Harness>,
  )
  return { document, view }
}

const clickEvent = (init: Partial<MouseEvent> = {}) => ({ shiftKey: false, ctrlKey: false, metaKey: false, ...init })
const onNodeClick = () => flowHooks.props!.onNodeClick as (event: unknown, node: unknown) => void
const nodeOf = (id: string) => (flowHooks.props!.nodes as { id: string }[]).find((node) => node.id === id)!

describe('NoteCanvas — 블록을 누르면 가리키기 신호를 보낸다', () => {
  it('출처만 있는 블록은 place 신호(문서·쪽 1부터·글자 범위)를 같은 색 창에 보낸다', () => {
    const { document } = renderCanvas()
    const [excerpt] = pdfNodes(document)
    const block = excerpt!.data.block as PdfExcerptCanvasBlock
    const signals: DeliveredSignal[] = []
    subscribePointSignal((signal) => signals.push(signal))
    act(() => onNodeClick()(clickEvent(), nodeOf(excerpt!.id)))
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      from: 'right',
      channel: 'blue',
      reason: 'click',
      target: { kind: 'place', docId: block.source.anchor.docId, page: block.source.anchor.page + 1, range: block.source.anchor.charRange },
    })
  })

  it('메모(형광펜)에 이어진 블록은 memo 신호를 보낸다', () => {
    const document = createDevelopmentCanvasDocument()
    const block = pdfNodes(document)[0]!.data.block as PdfExcerptCanvasBlock
    const { anchor } = block.source
    const highlight: PointableHighlight = { id: 'memo-1', anchor: { docId: anchor.docId, page: anchor.page, charRange: anchor.charRange } }
    renderCanvas({ highlights: [highlight] })
    const signals: DeliveredSignal[] = []
    subscribePointSignal((signal) => signals.push(signal))
    act(() => onNodeClick()(clickEvent(), nodeOf(pdfNodes(document)[0]!.id)))
    expect(signals[0]).toMatchObject({ from: 'right', channel: 'blue', target: { kind: 'memo', memoId: 'memo-1' } })
  })

  it('출처가 없는 블록, 색이 없는 창, Ctrl·Shift 를 누른 선택은 신호를 보내지 않는다', () => {
    const { document } = renderCanvas()
    const plain = document.nodes.find((node) => node.data.block.kind === 'title')!
    const excerpt = pdfNodes(document)[0]!
    const signals: DeliveredSignal[] = []
    subscribePointSignal((signal) => signals.push(signal))
    act(() => onNodeClick()(clickEvent(), nodeOf(plain.id)))
    act(() => onNodeClick()(clickEvent({ ctrlKey: true }), nodeOf(excerpt.id)))
    act(() => onNodeClick()(clickEvent({ shiftKey: true }), nodeOf(excerpt.id)))
    expect(signals).toEqual([])
    cleanup()
    renderCanvas({ channels: { ...DEFAULT_CHANNELS, right: null } })
    act(() => onNodeClick()(clickEvent(), nodeOf(excerpt.id)))
    expect(signals).toEqual([])
  })
})

describe('NoteCanvas — 같은 색 창의 신호를 받아 블록을 가운데로 가져온다', () => {
  const anchorOf = (document: CanvasDocumentV2) => (pdfNodes(document)[0]!.data.block as PdfExcerptCanvasBlock).source.anchor

  it('메모 신호: 그 메모에 이어진 블록을 고르고 틀 가운데로 가져와 잠깐 표시한다(확대는 그대로)', () => {
    const document = createDevelopmentCanvasDocument()
    const anchor = anchorOf(document)
    const target = pdfNodes(document)[0]!
    const { view } = renderCanvas({ highlights: [{ id: 'memo-1', anchor: { docId: anchor.docId, page: anchor.page, charRange: anchor.charRange } }] })
    act(() => { emitPointSignal({ from: 'left', channel: 'blue', target: { kind: 'memo', memoId: 'memo-1' }, reason: 'click', origin: 'document' }) })
    expect(flowHooks.setViewport).toHaveBeenCalledTimes(1)
    const next = flowHooks.setViewport.mock.calls[0]![0] as { x: number; y: number; zoom: number }
    const block = target.data.block
    expect(next.zoom).toBe(2)
    // 틀은 396 × 600: 블록 한가운데가 틀 한가운데(198, 300)에 온다
    expect(next.x).toBeCloseTo(198 - (target.position.x + block.width / 2) * 2, 5)
    expect(next.y).toBeCloseTo(300 - (target.position.y + block.height / 2) * 2, 5)
    expect(view.container.querySelector('.react-flow__node.canvas-node-pointed')?.getAttribute('data-id')).toBe(target.id)
    expect(nodeOf(target.id)).toBeDefined()
  })

  it('이어진 메모가 없으면 문서·쪽·범위가 맞는 place 신호가 같은 일을 한다', () => {
    const document = createDevelopmentCanvasDocument()
    const anchor = anchorOf(document)
    renderCanvas()
    act(() => { emitPointSignal({ from: 'left', channel: 'blue', target: { kind: 'place', docId: anchor.docId, page: anchor.page + 1, range: anchor.charRange }, reason: 'ai' }) })
    expect(flowHooks.setViewport).toHaveBeenCalledTimes(1)
  })

  it('이어진 블록이 없는 신호, 다른 색의 신호, 자기 창이 보낸 신호는 아무 일도 하지 않는다', () => {
    const document = createDevelopmentCanvasDocument()
    const anchor = anchorOf(document)
    const { view } = renderCanvas({ highlights: [{ id: 'memo-1', anchor: { docId: anchor.docId, page: anchor.page, charRange: anchor.charRange } }] })
    act(() => { emitPointSignal({ from: 'left', channel: 'blue', target: { kind: 'memo', memoId: 'unknown' }, reason: 'click' }) })
    act(() => { emitPointSignal({ from: 'left', channel: 'blue', target: { kind: 'place', docId: 'other-doc', page: 1 }, reason: 'click' }) })
    act(() => { emitPointSignal({ from: 'left', channel: 'green', target: { kind: 'memo', memoId: 'memo-1' }, reason: 'click' }) })
    act(() => { emitPointSignal({ from: 'right', channel: 'blue', target: { kind: 'memo', memoId: 'memo-1' }, reason: 'click' }) })
    expect(flowHooks.setViewport).not.toHaveBeenCalled()
    expect(view.container.querySelector('.canvas-node-pointed')).toBeNull()
  })
})

describe('NoteCanvas — 연결선 층에 보이는 블록을 내놓는다', () => {
  it('이웃한 같은 색 문서 창과 짝이 맺히고, 문서의 출처 자리에서 블록 가장자리로 선이 나온다', () => {
    const fixture = createDevelopmentCanvasDocument()
    const first = pdfNodes(fixture)[0]!
    // 발췌 블록을 화면에 확실히 보이는 자리(캔버스 20, 20 → 화면 454, 60)로 옮겨 둔다
    const document: CanvasDocumentV2 = { ...fixture, nodes: fixture.nodes.map((node) => (node.id === first.id ? { ...node, position: { x: 20, y: 20 } } : node)) }
    const target = pdfNodes(document)[0]!
    renderCanvas({ document })
    const docSnapshot = (frame: DOMRect) => ({
      frame,
      body: frame,
      items: [{ id: `src:${target.id}`, rect: { left: 60, top: 200, right: 300, bottom: 230 }, y: 205 }],
      activeIds: [] as string[],
    })
    registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'doc' }, () => docSnapshot(box(0, 0, 400, 600)))
    flushPaneLinks()
    expect(currentLinkPairs()).toEqual([{ doc: 'left', note: 'right', noteRole: 'canvas', noteSide: 'right', docId: 'doc', distance: 4 }])
    // viewport(10, 20, ×2): 블록 왼쪽 가장자리는 404 + 10 + 20 × 2 = 454. 선은 문서 창 가장자리(400)를 지나 거기로 든다
    const line = getLinkLayerState().lines.find((candidate) => candidate.id === `src:${target.id}`)
    expect(line).toMatchObject({ side: 'right', startX: 300, y: 205, edgeX: 400, cardX: 454 })
  })

  it('색이 없는 창은 등록은 하지만 짝이 없어 선이 없다', () => {
    renderCanvas({ channels: { ...DEFAULT_CHANNELS, right: null } })
    registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'doc' }, () => ({ frame: box(0, 0, 400, 600), body: box(0, 0, 400, 600), items: [], activeIds: [] }))
    expect(currentLinkPairs()).toEqual([])
  })
})
