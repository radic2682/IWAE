// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultTextBlockStyle, type PdfExcerptCanvasBlock } from '../../core/canvasDocument'
import { CanvasBlockRuntimeProvider } from '../notes/CanvasBlockShell'
import { PdfExcerptNode } from './PdfExcerptNode'

vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  Handle: ({ id, type, className }: { id: string; type: string; className: string }) => (
    <span data-handleid={id} data-handletype={type} className={className} />
  ),
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  useUpdateNodeInternals: () => vi.fn(),
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
}))

const anchor = {
  docId: 'doc-a',
  page: 2,
  coordSpace: 'pdfium-page' as const,
  rects: [{ x: 60, y: 100, w: 300, h: 120 }],
  charRange: [10, 30] as const,
  quote: 'source text',
  prefix: '',
  suffix: '',
}

const block: PdfExcerptCanvasBlock = {
  kind: 'pdfExcerpt',
  width: 400,
  height: 160,
  style: createDefaultTextBlockStyle(),
  excerpt: {
    id: 'excerpt-1',
    type: 'pdfExcerpt',
    x: 0,
    y: 0,
    width: 400,
    height: 160,
    text: '> source text',
    sourceTitle: 'HTTP Semantics',
    selection: {
      mode: 'text',
      anchor,
      pageSize: [600, 800],
      crop: { x: 50, y: 90, w: 400, h: 160 },
      glyphs: [{ c: 'source text', x: 60, y: 100, w: 300, h: 20 }],
    },
    iwae: { kind: 'pdf-excerpt', anchor },
  },
  source: { relation: 'excerpt', anchor },
}

describe('PdfExcerptNode', () => {
  it('PDF 원문 visual은 선택 불가이며 블록 본문 전체가 드래그 대상이다', () => {
    const onPointerDown = vi.fn()
    const props = { id: 'excerpt-1', data: { block }, selected: false } as unknown as Parameters<typeof PdfExcerptNode>[0]
    const view = render(
      <div onPointerDown={onPointerDown}>
        <CanvasBlockRuntimeProvider value={{}}>
          <PdfExcerptNode {...props} />
        </CanvasBlockRuntimeProvider>
      </div>,
    )

    const visual = view.container.querySelector('.pdf-excerpt-visual') as HTMLElement
    const shell = view.container.querySelector('.canvas-block-shell') as HTMLElement
    const source = view.container.querySelector('[data-excerpt-source="excerpt-1"]') as HTMLElement
    expect(visual.style.aspectRatio).toBe('400 / 160')
    expect(shell.style.minHeight).toBe('0px')
    expect(visual.dataset.sourceWidth).toBe('400')
    expect(visual.dataset.sourceHeight).toBe('160')
    expect(visual.dataset.canvasAutoGrow).toBeUndefined()
    const body = view.container.querySelector('.canvas-block-body') as HTMLElement
    expect(body.style.overflow).toBe('hidden')
    expect(body.style.userSelect).toBe('none')
    expect(body.classList.contains('drag-handle')).toBe(true)
    expect((view.container.querySelector('.pdf-excerpt-node-body') as HTMLElement).style.overflow).toBe('hidden')
    expect(source.textContent).toContain('REF')
    expect(source.parentElement?.dataset.refFooter).toBe('true')
    expect(source.dataset.sourceTraceSide).toBe('left')
    const textLayer = view.container.querySelector('.pdf-excerpt-text-layer') as HTMLElement
    expect(textLayer.style.cursor).toBe('grab')
    expect(textLayer.style.userSelect).toBe('none')
    expect(textLayer.classList.contains('drag-handle')).toBe(true)
    expect(textLayer.classList.contains('nodrag')).toBe(false)
    expect((view.container.querySelector('img') as HTMLImageElement).draggable).toBe(false)
    fireEvent.pointerDown(textLayer)
    expect(onPointerDown).toHaveBeenCalledTimes(1)
  })

  it('hover만으로 출처 trace를 활성화하지 않고 선택됐을 때만 활성화한다', () => {
    const onSourceTraceChange = vi.fn()
    const unselectedProps = { id: 'excerpt-1', data: { block }, selected: false } as unknown as Parameters<typeof PdfExcerptNode>[0]
    const view = render(
      <CanvasBlockRuntimeProvider value={{ onSourceTraceChange }}>
        <PdfExcerptNode {...unselectedProps} />
      </CanvasBlockRuntimeProvider>,
    )

    fireEvent.mouseEnter(view.container.querySelector('.pdf-excerpt-node') as HTMLElement)
    expect(onSourceTraceChange).not.toHaveBeenCalled()

    const selectedProps = { ...unselectedProps, selected: true } as unknown as Parameters<typeof PdfExcerptNode>[0]
    view.rerender(
      <CanvasBlockRuntimeProvider value={{ onSourceTraceChange }}>
        <PdfExcerptNode {...selectedProps} />
      </CanvasBlockRuntimeProvider>,
    )
    expect(onSourceTraceChange).toHaveBeenCalledWith({ blockId: 'excerpt-1', anchor })
  })
})
