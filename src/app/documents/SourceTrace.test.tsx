// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Anchor } from '../../core/anchor'
import type { VisibleSourceReference } from '../../core/workspaceSources'
import { SourceTrace } from './SourceTrace'
import { registerPaneLinks, resetPaneLinks } from '../workspace/workspaceLinks'

const anchor: Anchor = {
  docId: '5511aa99cc33',
  page: 4,
  coordSpace: 'pdfium-page',
  rects: [{ x: 72, y: 100, w: 220, h: 18 }],
  charRange: [0, 12],
  quote: 'source trace',
  prefix: '',
  suffix: '',
}

function rect(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
}

function marker(attribute: string, value: string, bounds: DOMRect) {
  const element = document.createElement('div')
  element.setAttribute(attribute, value)
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(bounds)
  document.body.append(element)
  return element
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  resetPaneLinks()
})

describe('SourceTrace', () => {
  it('Markdown 발췌 블록과 현재 문서의 선택 위치 사이에 선을 그린다', () => {
    marker('data-canvas-block-id', 'markdown-1', rect(920, 500, 1040, 522))
    marker('data-markdown-source-target', 'markdown-1', rect(300, 240, 560, 280))
    marker('data-markdown-pane', 'docs/guide.md', rect(260, 40, 760, 1000))
    const source: VisibleSourceReference = {
      blockId: 'markdown-1',
      relation: 'markdown-excerpt',
      selection: {
        path: 'docs/guide.md', title: 'Guide', quote: '제목', prefix: '', suffix: '',
        startOffset: 0, endOffset: 2, format: 'heading-2',
      },
      selected: false,
      hovered: false,
      visibleOnCurrentPage: true,
    }

    render(<SourceTrace sources={[source]} />)

    const path = screen.getByTestId('source-trace-markdown-1')
    expect(path.getAttribute('d')).toContain('M 920 511')
    expect(path.getAttribute('d')).toContain('560 260')
  })

  it('활성 블록 출처와 보이는 PDF 원문 사이에 선을 그린다', () => {
    marker('data-canvas-block-id', 'block-1', rect(920, 500, 1040, 522))
    marker('data-pdf-source-target', 'block-1', rect(300, 240, 560, 280))
    marker('data-pdf-pane', anchor.docId, rect(260, 40, 760, 1000))

    render(<SourceTrace sources={[source('block-1', anchor, true)]} />)

    const path = screen.getByTestId('source-trace-block-1')
    expect(path.getAttribute('d')).toContain('M 920 511')
    expect(path.getAttribute('d')).toContain('560 260')
    expect(screen.queryByRole('button', { name: '5쪽 원문으로 이동' })).toBeNull()
  })

  it('원문 페이지가 화면 밖이면 연결선과 페이지 표식을 표시하지 않는다', () => {
    marker('data-canvas-block-id', 'block-1', rect(920, 500, 1040, 522))
    marker('data-pdf-source-target', 'block-1', rect(300, 1100, 560, 1140))
    marker('data-pdf-pane', anchor.docId, rect(260, 40, 760, 1000))

    render(<SourceTrace sources={[source('block-1', anchor, true)]} />)

    expect(screen.queryByTestId('source-trace-block-1')).toBeNull()
    expect(screen.queryByRole('button', { name: '5쪽 원문으로 이동' })).toBeNull()
  })

  it('같은 페이지의 여러 블록에 각각 독립된 연결선을 그린다', () => {
    const secondAnchor: Anchor = { ...anchor, rects: [{ x: 72, y: 160, w: 180, h: 18 }] }
    marker('data-canvas-block-id', 'block-1', rect(920, 500, 1040, 522))
    marker('data-canvas-block-id', 'block-2', rect(920, 620, 1040, 642))
    marker('data-pdf-source-target', 'block-1', rect(300, 240, 560, 280))
    marker('data-pdf-source-target', 'block-2', rect(300, 340, 520, 380))
    marker('data-pdf-pane', anchor.docId, rect(260, 40, 760, 1000))

    render(<SourceTrace sources={[source('block-1', anchor, true), source('block-2', secondAnchor, true)]} />)

    expect(screen.getByTestId('source-trace-block-1')).toBeDefined()
    expect(screen.getByTestId('source-trace-block-2')).toBeDefined()
  })

  it('캔버스 이동 알림을 받으면 같은 프레임에서 시작점을 다시 측정한다', async () => {
    let sourceRect = rect(920, 500, 1040, 522)
    const element = document.createElement('div')
    element.setAttribute('data-canvas-block-id', 'block-1')
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => sourceRect)
    document.body.append(element)
    marker('data-pdf-source-target', 'block-1', rect(300, 240, 560, 280))
    marker('data-pdf-pane', anchor.docId, rect(260, 40, 760, 1000))
    render(<SourceTrace sources={[source('block-1', anchor, true)]} />)

    sourceRect = rect(880, 420, 1000, 442)
    act(() => window.dispatchEvent(new Event('iwae:canvas-geometry')))

    await waitFor(() => {
      expect(screen.getByTestId('source-trace-block-1').getAttribute('d')).toContain('M 880 431')
    })
  })

  it('작업 공간 층이 이미 같은 문서·캔버스에 선을 그리면(이웃한 같은 색 창) 옛 선은 그리지 않는다', () => {
    const canvasBody = document.createElement('div')
    canvasBody.setAttribute('data-canvas-pane', 'right')
    const block = document.createElement('div')
    block.setAttribute('data-canvas-block-id', 'block-1')
    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(rect(920, 500, 1040, 522))
    canvasBody.append(block)
    document.body.append(canvasBody)
    marker('data-pdf-source-target', 'block-1', rect(300, 240, 560, 280))
    marker('data-pdf-pane', anchor.docId, rect(260, 40, 760, 1000))
    const snapshot = (frame: DOMRect) => ({ frame, body: frame, items: [], activeIds: [] })
    registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: anchor.docId }, () => snapshot(rect(0, 0, 400, 600)))
    registerPaneLinks({ pane: 'right', role: 'canvas', channel: 'blue' }, () => snapshot(rect(404, 0, 800, 600)))

    render(<SourceTrace sources={[source('block-1', anchor, true)]} />)

    expect(screen.queryByTestId('source-trace-block-1')).toBeNull()
  })

  it('이웃하지 않은(같은 색 문서 창이 옆에 없는) 캔버스에는 옛 선이 남는다', () => {
    const canvasBody = document.createElement('div')
    canvasBody.setAttribute('data-canvas-pane', 'right')
    const block = document.createElement('div')
    block.setAttribute('data-canvas-block-id', 'block-1')
    vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(rect(920, 500, 1040, 522))
    canvasBody.append(block)
    document.body.append(canvasBody)
    marker('data-pdf-source-target', 'block-1', rect(300, 240, 560, 280))
    marker('data-pdf-pane', anchor.docId, rect(260, 40, 760, 1000))
    // 문서 창과 캔버스 창이 다른 색이라 짝이 없다
    const snapshot = (frame: DOMRect) => ({ frame, body: frame, items: [], activeIds: [] })
    registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: anchor.docId }, () => snapshot(rect(0, 0, 400, 600)))
    registerPaneLinks({ pane: 'right', role: 'canvas', channel: 'green' }, () => snapshot(rect(404, 0, 800, 600)))

    render(<SourceTrace sources={[source('block-1', anchor, true)]} />)

    expect(screen.getByTestId('source-trace-block-1')).toBeDefined()
  })

  it('블록이 선택되거나 호버되지 않아도 PDF 출처 연결선을 그린다', () => {
    marker('data-canvas-block-id', 'block-1', rect(920, 500, 1040, 522))
    marker('data-pdf-source-target', 'block-1', rect(300, 240, 560, 280))
    marker('data-pdf-pane', anchor.docId, rect(260, 40, 760, 1000))

    render(<SourceTrace sources={[source('block-1', anchor)]} />)

    expect(screen.getByTestId('source-trace-block-1')).toBeDefined()
  })

  it('노트 전체 화면으로 PDF 패널이 숨으면 화면 밖 유령 연결선을 그리지 않는다', () => {
    marker('data-canvas-block-id', 'block-1', rect(120, 500, 240, 522))
    const hiddenPane = marker('data-pdf-pane', anchor.docId, rect(0, 38, 760, 1000))
    hiddenPane.style.visibility = 'hidden'

    render(<SourceTrace sources={[source('block-1', anchor, true)]} />)

    expect(screen.queryByTestId('source-trace-block-1')).toBeNull()
    expect(screen.queryByRole('button', { name: '5쪽 원문으로 이동' })).toBeNull()
  })
})

function source(blockId: string, sourceAnchor: Anchor, selected = false): VisibleSourceReference {
  return {
    blockId,
    anchor: sourceAnchor,
    relation: 'excerpt',
    selected,
    hovered: false,
    visibleOnCurrentPage: true,
  }
}
