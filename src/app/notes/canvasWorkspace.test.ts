import { describe, expect, it } from 'vitest'
import type { Anchor } from '../../core/anchor'
import type { CanvasBlockData } from '../../core/canvasDocument'
import { createDefaultTextBlockStyle } from '../../core/canvasDocument'
import {
  blockScreenRect,
  blockSource,
  blocksForTarget,
  highlightsAtSource,
  linkIdsOfBlock,
  pickCanvasPane,
  pointTargetForBlock,
  rangesOverlap,
  viewportCenteredOn,
  visibleBlockLinkItems,
  visibleCanvasPanes,
  type CanvasNodeLike,
  type PointableHighlight,
} from './canvasWorkspace'
import { emptyTabs, type PanesState, type Tab } from '../workspace/tabs'
import { DEFAULT_CHANNELS } from '../workspace/workspaceChannels'

const style = createDefaultTextBlockStyle('paragraph')
const anchor = (docId: string, page: number, range: [number, number]): Anchor => ({
  docId, page, coordSpace: 'pdfium-page', rects: [{ x: 0, y: 0, w: 10, h: 10 }], charRange: range, quote: 'q', prefix: '', suffix: '',
})
const pdfBlock = (docId: string, page: number, range: [number, number], size = { width: 200, height: 100 }): CanvasBlockData => ({
  kind: 'pdfExcerpt', ...size, style,
  excerpt: {} as never,
  source: { relation: 'excerpt', anchor: anchor(docId, page, range) },
}) as CanvasBlockData
const selectionOf = (path: string, start: number, end: number) => ({ path, title: 't', quote: 'q', prefix: '', suffix: '', startOffset: start, endOffset: end, format: 'paragraph' as const })
const mdBlock = (path: string, start: number, end: number): CanvasBlockData => ({
  kind: 'markdownExcerpt', width: 200, height: 100, style,
  selection: selectionOf(path, start, end),
  source: { relation: 'markdown-excerpt', selection: selectionOf(path, start, end) },
}) as CanvasBlockData
const textBlock: CanvasBlockData = { kind: 'paragraph', width: 200, height: 40, style, text: 'hi' }
const node = (id: string, block: CanvasBlockData, x = 0, y = 0): CanvasNodeLike => ({ id, position: { x, y }, data: { block } })
const memo = (id: string, docId: string, page: number, range: [number, number]): PointableHighlight => ({ id, anchor: { docId, page, charRange: range } })

describe('blockSource·pointTargetForBlock — 블록을 누르면 보낼 신호', () => {
  it('출처가 없는 블록(글·도형)은 신호가 없다', () => {
    expect(blockSource(textBlock)).toBeNull()
    expect(pointTargetForBlock(textBlock, [])).toBeNull()
  })

  it('메모(형광펜)와 같은 자리의 발췌는 memo 신호', () => {
    const highlights = [memo('h1', 'docA', 2, [100, 140])]
    expect(pointTargetForBlock(pdfBlock('docA', 2, [110, 130]), highlights)).toEqual({ kind: 'memo', memoId: 'h1' })
  })

  it('이어진 메모가 없으면 place 신호: 문서·쪽(1부터)·글자 범위', () => {
    const others = [memo('h1', 'docA', 3, [110, 130]), memo('h2', 'docA', 2, [200, 210]), memo('h3', 'docB', 2, [110, 130])]
    expect(pointTargetForBlock(pdfBlock('docA', 2, [110, 130]), others)).toEqual({ kind: 'place', docId: 'docA', page: 3, range: [110, 130] })
  })

  it('영역 메모는 글 자리가 없어 잇지 않는다', () => {
    const region: PointableHighlight = { ...memo('r', 'docA', 2, [0, 0]), kind: 'region' }
    expect(highlightsAtSource(blockSource(pdfBlock('docA', 2, [0, 50]))!, [region])).toEqual([])
  })

  it('Markdown 발췌는 파일 경로가 문서 id 이고 쪽은 1', () => {
    expect(pointTargetForBlock(mdBlock('a/b.md', 5, 20), [])).toEqual({ kind: 'place', docId: 'a/b.md', page: 1, range: [5, 20] })
    expect(pointTargetForBlock(mdBlock('a/b.md', 5, 20), [memo('m', 'a/b.md', 0, [10, 12])])).toEqual({ kind: 'memo', memoId: 'm' })
  })

  it('출처가 있는 번역 블록도 신호를 보낸다', () => {
    const translation = { kind: 'translation', width: 200, height: 80, style, text: 't', sourceBlockId: 'x', targetLanguage: 'ko', model: 'm', source: { relation: 'translation', anchor: anchor('docA', 0, [1, 5]) } } as CanvasBlockData
    expect(pointTargetForBlock(translation, [])).toEqual({ kind: 'place', docId: 'docA', page: 1, range: [1, 5] })
  })

  it('글자 범위 겹침: 한쪽을 모르면 겹친다고 본다', () => {
    expect(rangesOverlap([0, 10], [10, 20])).toBe(false)
    expect(rangesOverlap([0, 10], [9, 20])).toBe(true)
    expect(rangesOverlap(null, [1, 2])).toBe(true)
  })
})

describe('blocksForTarget — 신호가 가리키는 블록', () => {
  const nodes = [
    node('a', pdfBlock('docA', 2, [100, 140])),
    node('b', pdfBlock('docA', 2, [300, 340])),
    node('c', pdfBlock('docB', 2, [100, 140])),
    node('d', textBlock),
    node('e', mdBlock('n.md', 0, 50)),
  ]
  const highlights = [memo('h1', 'docA', 2, [120, 130]), memo('hm', 'n.md', 0, [10, 20])]

  it('memo 신호: 그 메모와 같은 자리에서 온 블록', () => {
    expect(blocksForTarget(nodes, { kind: 'memo', memoId: 'h1' }, highlights)).toEqual(['a'])
    expect(blocksForTarget(nodes, { kind: 'memo', memoId: 'hm' }, highlights)).toEqual(['e'])
  })

  it('이어진 블록이 없거나 모르는 메모면 빈 목록(캔버스는 아무것도 하지 않는다)', () => {
    expect(blocksForTarget(nodes, { kind: 'memo', memoId: 'nope' }, highlights)).toEqual([])
    expect(blocksForTarget([node('x', pdfBlock('docZ', 0, [0, 1]))], { kind: 'memo', memoId: 'h1' }, highlights)).toEqual([])
  })

  it('place 신호: 문서·쪽이 같고 글자 범위가 겹치는 블록(범위가 없으면 그 쪽의 블록)', () => {
    expect(blocksForTarget(nodes, { kind: 'place', docId: 'docA', page: 3, range: [90, 110] }, [])).toEqual(['a'])
    expect(blocksForTarget(nodes, { kind: 'place', docId: 'docA', page: 3, range: [200, 250] }, [])).toEqual([])
    expect(blocksForTarget(nodes, { kind: 'place', docId: 'docA', page: 3 }, [])).toEqual(['a', 'b'])
    expect(blocksForTarget(nodes, { kind: 'place', docId: 'docA', page: 4 }, [])).toEqual([])
    expect(blocksForTarget(nodes, { kind: 'place', docId: 'n.md', page: 1, range: [40, 60] }, [])).toEqual(['e'])
  })
})

describe('연결선 재료 — 보이는 블록만, 확대·이동을 따른다', () => {
  const body = { left: 100, top: 50, right: 500, bottom: 350 }
  const nodes = [
    node('a', pdfBlock('docA', 0, [0, 10], { width: 200, height: 100 }), 20, 20),
    node('far', pdfBlock('docA', 0, [0, 10], { width: 200, height: 100 }), 2000, 20),
    node('plain', textBlock, 20, 150),
  ]

  it('메모에 이어진 블록은 메모 id 로, 아니면 출처 자리 id(src:블록)로 잇는다', () => {
    expect(linkIdsOfBlock('a', pdfBlock('docA', 0, [0, 10]), [memo('h', 'docA', 0, [2, 4])])).toEqual(['h'])
    expect(linkIdsOfBlock('a', pdfBlock('docA', 0, [0, 10]), [])).toEqual(['src:a'])
    expect(linkIdsOfBlock('p', textBlock, [])).toEqual([])
  })

  it('화면에 보이는 출처 블록만 내놓고 글 블록·화면 밖 블록은 뺀다', () => {
    const items = visibleBlockLinkItems(nodes, { x: 0, y: 0, zoom: 1 }, body, [])
    expect(items.map((item) => item.id)).toEqual(['src:a'])
    expect(items[0]!.rect).toEqual({ left: 120, top: 70, right: 320, bottom: 170 })
    expect(items[0]!.y).toBe(120)
  })

  it('확대하면 사각형도 커지고, 이동하면 따라간다', () => {
    const zoomed = visibleBlockLinkItems(nodes, { x: 10, y: -10, zoom: 2 }, body, [])
    expect(zoomed[0]!.rect).toEqual({ left: 150, top: 80, right: 500, bottom: 280 })
    // 화면 밖으로 밀면 안 나온다
    expect(visibleBlockLinkItems(nodes, { x: -1000, y: 0, zoom: 1 }, body, [])).toEqual([])
    expect(blockScreenRect(nodes[0]!, { x: 0, y: 0, zoom: 0.5 }, body)).toEqual({ left: 110, top: 60, right: 210, bottom: 110 })
  })

  it('틀에 걸친 블록은 사각형을 틀 안으로 잘라 가까운 가장자리가 보이게 하고 선은 보이는 부분의 한가운데로 든다', () => {
    const [item] = visibleBlockLinkItems([node('a', pdfBlock('docA', 0, [0, 10]), 350, -40)], { x: 0, y: 0, zoom: 1 }, body, [])
    expect(item!.rect).toEqual({ left: 450, top: 50, right: 500, bottom: 110 })
    expect(item!.y).toBe(80)
  })

  it('블록을 틀 가운데로 가져오는 viewport(확대는 그대로)', () => {
    const view = viewportCenteredOn(node('a', pdfBlock('docA', 0, [0, 10]), 1000, 400), 2, { width: 800, height: 600 })
    expect(view).toEqual({ x: 400 - 1100 * 2, y: 300 - 450 * 2, zoom: 2 })
  })
})

describe('pickCanvasPane — 캔버스로 보내기가 받을 창', () => {
  const tab = (id: string, kind: Tab['kind']): Tab => ({ id, title: id, kind })
  const strip = (...tabs: Tab[]) => ({ tabs, activeId: tabs[0]?.id ?? null })
  const state = (p: Partial<PanesState>): PanesState => ({ left: emptyTabs, right: emptyTabs, third: emptyTabs, fourth: emptyTabs, ...p })
  const visible = ['left', 'right', 'third', 'fourth'] as const

  it('보이는 캔버스 창들(활성 탭이 캔버스인 창만)', () => {
    const panes = state({ left: strip(tab('A', 'pdf')), right: strip(tab('C', 'canvas')), third: { tabs: [tab('X', 'canvas'), tab('B', 'pdf')], activeId: 'B' } })
    expect(visibleCanvasPanes(panes, visible)).toEqual(['right'])
  })

  it('보내는 문서 창과 같은 색 창의 캔버스가 먼저다(다른 색의 캔버스보다)', () => {
    const panes = state({ left: strip(tab('A', 'pdf')), right: strip(tab('C1', 'canvas')), third: strip(tab('C2', 'canvas')) })
    const channels = { ...DEFAULT_CHANNELS, left: 'green' as const, right: 'blue' as const, third: 'green' as const }
    expect(pickCanvasPane({ panes, channels, visible, active: 'left', from: 'left' })).toBe('third')
  })

  it('같은 색 캔버스가 없으면 만진 창 → 같은 색 → 아무 캔버스 차례로 예전처럼', () => {
    const panes = state({ left: strip(tab('A', 'pdf')), right: strip(tab('C1', 'canvas')), third: strip(tab('C2', 'canvas')) })
    const channels = { ...DEFAULT_CHANNELS, left: 'green' as const, right: 'blue' as const, third: 'orange' as const }
    expect(pickCanvasPane({ panes, channels, visible, active: 'third', from: 'left' })).toBe('third')
    expect(pickCanvasPane({ panes, channels, visible, active: 'left', from: 'left' })).toBe('right')
  })

  it('색이 없는 문서 창은 같은 색 단계를 건너뛰고, 캔버스가 안 보이면 null', () => {
    const panes = state({ left: strip(tab('A', 'pdf')), right: strip(tab('C', 'canvas')) })
    expect(pickCanvasPane({ panes, channels: { ...DEFAULT_CHANNELS, left: null, right: null }, visible, active: 'left', from: 'left' })).toBe('right')
    expect(pickCanvasPane({ panes: state({ left: strip(tab('A', 'pdf')) }), channels: DEFAULT_CHANNELS, visible, active: 'left', from: 'left' })).toBeNull()
  })
})
