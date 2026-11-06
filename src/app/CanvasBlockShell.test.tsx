// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CSSProperties } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultTextBlockStyle, type CanvasBlockData } from '../core/canvasDocument'
import { CanvasBlockShell } from './CanvasBlockShell'

const resizeCallbacks: {
  onResize?: (_event: unknown, value: { width: number; height: number; x: number; y: number }) => void
  onResizeEnd?: (_event: unknown, value: { width: number; height: number; x: number; y: number }) => void
} = {}
const updateNodeInternals = vi.fn()
let resizeProps: Record<string, unknown> = {}

vi.mock('@xyflow/react', () => ({
  NodeResizer: (props: typeof resizeCallbacks & Record<string, unknown>) => {
    resizeCallbacks.onResize = props.onResize
    resizeCallbacks.onResizeEnd = props.onResizeEnd
    resizeProps = props
    return <div>{Array.from({ length: 8 }, (_, index) => <span key={index} className="react-flow__resize-control" />)}</div>
  },
  Handle: ({ id, type, className, style }: { id: string; type: string; className: string; style?: CSSProperties }) => (
    <span data-handleid={id} data-handletype={type} className={className} style={style} />
  ),
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  useUpdateNodeInternals: () => updateNodeInternals,
}))

const block: CanvasBlockData = {
  kind: 'paragraph',
  width: 320,
  height: 140,
  style: createDefaultTextBlockStyle(),
  text: '본문',
}

beforeEach(() => {
  resizeCallbacks.onResize = undefined
  resizeCallbacks.onResizeEnd = undefined
  resizeProps = {}
  updateNodeInternals.mockReset()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('CanvasBlockShell', () => {
  it('hover 또는 focus일 때만 이동 손잡이와 블록 내부 REF footer를 노출한다', () => {
    const { container } = render(
      <CanvasBlockShell
        id="node-1"
        block={block}
        selected={false}
        sourceFooter={<span>REF · Source p.1</span>}
        onResizeFrame={vi.fn()}
        onResizeCommit={vi.fn()}
      >
        <span>내용</span>
      </CanvasBlockShell>,
    )

    const shell = container.querySelector('.canvas-block-shell') as HTMLElement
    expect(shell.dataset.canvasBlockId).toBe('node-1')
    const drag = container.querySelector('button[aria-label="블록 이동"]') as HTMLButtonElement
    const footer = container.querySelector('.canvas-block-source-footer') as HTMLElement
    expect(shell.contains(footer)).toBe(true)
    expect(footer.style.bottom).toBe('0px')
    expect(drag.hidden).toBe(true)
    expect(footer.hidden).toBe(true)

    fireEvent.mouseEnter(shell)
    expect(drag.hidden).toBe(false)
    expect(footer.hidden).toBe(false)
    expect(shell.classList.contains('canvas-block-affordances-visible')).toBe(true)

    fireEvent.mouseLeave(shell)
    fireEvent.focus(shell)
    expect(drag.hidden).toBe(false)
    expect(footer.hidden).toBe(false)
    expect(shell.dataset.sourceTraceSide).toBe('left')
  })

  it('블록 경계 밖 24px까지 호버를 유지하고 그 밖에서 해제한다', () => {
    const { container } = render(<CanvasBlockShell id="node-1" block={block} selected={false}><span>내용</span></CanvasBlockShell>)
    const shell = container.querySelector('.canvas-block-shell') as HTMLElement
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 420, top: 100, bottom: 240, width: 320, height: 140, x: 100, y: 100, toJSON: () => ({}) })
    const drag = container.querySelector('button[aria-label="블록 이동"]') as HTMLButtonElement
    fireEvent.mouseEnter(shell)
    fireEvent.mouseLeave(shell)
    fireEvent.pointerMove(document, { clientX: 432, clientY: 150 })
    expect(drag.hidden).toBe(false)
    fireEvent.pointerMove(document, { clientX: 450, clientY: 150 })
    expect(drag.hidden).toBe(true)
  })

  it('여덟 개 리사이즈 컨트롤과 블록 밖의 상하좌우 단일 포트를 제공한다', () => {
    const { container } = render(
      <CanvasBlockShell id="node-1" block={block} selected onResizeFrame={vi.fn()} onResizeCommit={vi.fn()}>
        <span>내용</span>
      </CanvasBlockShell>,
    )

    expect(container.querySelectorAll('.react-flow__resize-control')).toHaveLength(8)
    expect(container.querySelectorAll('.canvas-block-port-external')).toHaveLength(4)
    expect(container.querySelectorAll('[data-handletype="source"]')).toHaveLength(4)
    expect(container.querySelectorAll('[data-handletype="target"]')).toHaveLength(0)
    const left = container.querySelector('[data-handleid="left"]') as HTMLElement
    expect(left.classList.contains('canvas-block-port-left')).toBe(true)
    expect(left.style.left).toBe('-7px')
    expect(left.style.top).toBe('50%')
    expect(resizeProps.handleClassName).toBe('canvas-block-resize-handle')
    expect(resizeProps.lineClassName).toBe('canvas-block-resize-line')
  })

  it('선택되지 않으면 포트를 숨기고 선택된 블록의 맞닿은 면만 제외한다', () => {
    const view = render(
      <CanvasBlockShell id="node-1" block={block} selected={false} touchingSides={new Set(['right'])}>
        <span>내용</span>
      </CanvasBlockShell>,
    )

    expect(view.container.querySelectorAll('.canvas-block-port-external')).toHaveLength(3)
    expect(view.container.querySelectorAll('.canvas-block-port-visible')).toHaveLength(0)

    view.rerender(
      <CanvasBlockShell id="node-1" block={block} selected touchingSides={new Set(['right'])}>
        <span>내용</span>
      </CanvasBlockShell>,
    )

    expect(view.container.querySelectorAll('.canvas-block-port-external')).toHaveLength(3)
    expect(view.container.querySelectorAll('.canvas-block-port-visible')).toHaveLength(3)
    expect(view.container.querySelector('[data-handleid="right"]')).toBeNull()
    expect(view.container.querySelector('[data-handleid="left"]')).not.toBeNull()
  })

  it('리사이즈를 매 프레임 격자 크기로 적용하고 끝에서 한 번 확정한다', () => {
    const onResizeFrame = vi.fn()
    const onResizeCommit = vi.fn()
    const { container } = render(
      <CanvasBlockShell id="node-1" block={block} selected onResizeFrame={onResizeFrame} onResizeCommit={onResizeCommit}>
        <span>내용</span>
      </CanvasBlockShell>,
    )

    act(() => {
      resizeCallbacks.onResize?.({}, { width: 413, height: 177, x: 0, y: 0 })
      resizeCallbacks.onResizeEnd?.({}, { width: 413, height: 177, x: 0, y: 0 })
    })

    expect(onResizeFrame).toHaveBeenCalledWith('node-1', 420, 180)
    expect(onResizeCommit).toHaveBeenCalledTimes(1)
    expect(onResizeCommit).toHaveBeenCalledWith('node-1', 420, 180)
    expect(updateNodeInternals).toHaveBeenCalledWith('node-1')
    const shell = container.querySelector('.canvas-block-shell') as HTMLElement
    expect(shell.classList.contains('canvas-block-snap-settle')).toBe(true)
  })

  it('드래그 중 블록이 다시 그려져도 리사이즈 콜백을 교체하지 않는다', () => {
    const firstFrame = vi.fn()
    const nextFrame = vi.fn()
    const commit = vi.fn()
    const { rerender } = render(
      <CanvasBlockShell id="node-1" block={block} selected onResizeFrame={firstFrame} onResizeCommit={commit}>
        <span>내용</span>
      </CanvasBlockShell>,
    )
    const start = resizeProps.onResizeStart
    const resize = resizeCallbacks.onResize
    const end = resizeCallbacks.onResizeEnd

    rerender(
      <CanvasBlockShell id="node-1" block={{ ...block, height: 180, manualHeight: true }} selected onResizeFrame={nextFrame} onResizeCommit={commit}>
        <span>내용</span>
      </CanvasBlockShell>,
    )

    expect(resizeProps.onResizeStart).toBe(start)
    expect(resizeCallbacks.onResize).toBe(resize)
    expect(resizeCallbacks.onResizeEnd).toBe(end)
    act(() => resize?.({}, { width: 413, height: 207, x: 0, y: 0 }))
    expect(nextFrame).toHaveBeenCalledWith('node-1', 420, 210)
    expect(firstFrame).not.toHaveBeenCalled()
  })

  it('내용 높이가 블록을 넘으면 다음 격자 높이로 자동 확장한다', async () => {
    const onResizeCommit = vi.fn()
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.canvasAutoGrow === 'true' ? 153 : 0
      })

    render(
      <CanvasBlockShell id="node-1" block={block} selected={false} onResizeCommit={onResizeCommit}>
        <div data-canvas-auto-grow="true">긴 내용</div>
      </CanvasBlockShell>,
    )

    await waitFor(() => expect(onResizeCommit).toHaveBeenCalledWith('node-1', 320, 160, 'content'))
    scrollHeight.mockRestore()
  })

  it('텍스트 내용이 줄면 반 칸 높이로 자동 축소한다', async () => {
    const onResizeCommit = vi.fn()
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.canvasAutoGrow === 'true' ? 63 : 0
      })

    render(
      <CanvasBlockShell id="node-1" block={block} selected={false} onResizeCommit={onResizeCommit}>
        <div data-canvas-auto-grow="true">짧은 내용</div>
      </CanvasBlockShell>,
    )

    await waitFor(() => expect(onResizeCommit).toHaveBeenCalledWith('node-1', 320, 70, 'content'))
    scrollHeight.mockRestore()
  })

  it('손잡이로 정한 높이는 짧은 텍스트 때문에 다시 줄이지 않는다', async () => {
    const onResizeCommit = vi.fn()
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.canvasAutoGrow === 'true' ? 63 : 0
      })

    render(
      <CanvasBlockShell id="node-1" block={{ ...block, height: 200, manualHeight: true }} selected onResizeCommit={onResizeCommit}>
        <div data-canvas-auto-grow="true">짧은 내용</div>
      </CanvasBlockShell>,
    )

    await waitFor(() => expect(onResizeCommit).not.toHaveBeenCalled())
    scrollHeight.mockRestore()
  })

  it('블록 배경을 highlight와 별개로 셸에 적용한다', () => {
    const backgroundBlock = {
      ...block,
      style: { ...block.style, highlight: '#fff2a8', background: '#e8f1ff' },
    }
    const { container } = render(
      <CanvasBlockShell id="node-1" block={backgroundBlock} selected={false}>
        <span>내용</span>
      </CanvasBlockShell>,
    )

    expect((container.querySelector('.canvas-block-shell') as HTMLElement).style.backgroundColor).toBe('rgb(232, 241, 255)')
  })

  it('hover에서 삭제 버튼을 드러내고 블록 삭제를 요청한다', () => {
    const onDelete = vi.fn()
    const { container } = render(
      <CanvasBlockShell id="node-1" block={block} selected={false} onDelete={onDelete}>
        <span>내용</span>
      </CanvasBlockShell>,
    )

    const shell = container.querySelector('.canvas-block-shell') as HTMLElement
    const button = container.querySelector('button[aria-label="블록 삭제"]') as HTMLButtonElement
    expect(button.hidden).toBe(true)
    fireEvent.mouseEnter(shell)
    expect(button.hidden).toBe(false)
    fireEvent.click(button)
    expect(onDelete).toHaveBeenCalledWith('node-1')
  })

  it('출처는 본문 밖의 전용 footer에 둔다', () => {
    const { container } = render(
      <CanvasBlockShell
        id="node-1"
        block={block}
        selected={false}
        sourceFooter={<span>출처</span>}
        onResizeFrame={vi.fn()}
        onResizeCommit={vi.fn()}
      >
        <span>내용</span>
      </CanvasBlockShell>,
    )

    expect(container.querySelector('.canvas-block-body')?.textContent).toBe('내용')
    expect(container.querySelector('.canvas-block-source-footer')?.textContent).toBe('출처')
  })

  it('연결 포트는 hover가 아니라 선택 중에만 노출한다', () => {
    const { container, rerender } = render(
      <CanvasBlockShell id="node-1" block={block} selected={false} onResizeFrame={vi.fn()} onResizeCommit={vi.fn()}>
        <span>내용</span>
      </CanvasBlockShell>,
    )
    expect(container.querySelectorAll('.canvas-block-port-visible')).toHaveLength(0)
    const shell = container.querySelector('.canvas-block-shell')!
    fireEvent.focus(shell)
    expect(container.querySelectorAll('.canvas-block-port-visible')).toHaveLength(0)
    fireEvent.mouseEnter(shell)
    expect(container.querySelectorAll('.canvas-block-port-visible')).toHaveLength(0)
    fireEvent.pointerMove(document, { clientX: 10000, clientY: 10000 })
    expect(container.querySelectorAll('.canvas-block-port-visible')).toHaveLength(0)

    rerender(
      <CanvasBlockShell id="node-1" block={block} selected onResizeFrame={vi.fn()} onResizeCommit={vi.fn()}>
        <span>내용</span>
      </CanvasBlockShell>,
    )
    expect(container.querySelectorAll('.canvas-block-port')).toHaveLength(4)
    expect(container.querySelectorAll('.canvas-block-port-visible')).toHaveLength(4)
  })

  it('PDF 발췌 리사이즈는 원본 비율을 고정한다', () => {
    const pdfBlock: CanvasBlockData = {
      kind: 'pdfExcerpt',
      width: 320,
      height: 160,
      style: createDefaultTextBlockStyle(),
      excerpt: {
        id: 'pdf-1',
        type: 'pdfExcerpt',
        x: 0,
        y: 0,
        width: 320,
        height: 160,
        text: '> excerpt',
        sourceTitle: 'Spec',
        selection: {
          mode: 'region',
          anchor: {
            docId: 'doc', page: 0, coordSpace: 'pdfium-page', rects: [{ x: 0, y: 0, w: 200, h: 100 }],
            charRange: [0, 0], quote: '', prefix: '', suffix: '',
          },
          pageSize: [600, 800],
          crop: { x: 0, y: 0, w: 200, h: 100 },
          glyphs: [],
        },
        iwae: {
          kind: 'pdf-excerpt',
          anchor: {
            docId: 'doc', page: 0, coordSpace: 'pdfium-page', rects: [{ x: 0, y: 0, w: 200, h: 100 }],
            charRange: [0, 0], quote: '', prefix: '', suffix: '',
          },
        },
      },
      source: {
        relation: 'excerpt',
        anchor: {
          docId: 'doc', page: 0, coordSpace: 'pdfium-page', rects: [{ x: 0, y: 0, w: 200, h: 100 }],
          charRange: [0, 0], quote: '', prefix: '', suffix: '',
        },
      },
    }
    const view = render(
      <CanvasBlockShell id="pdf-1" block={{ ...pdfBlock, width: 109, height: 129 }} selected onResizeFrame={vi.fn()} onResizeCommit={vi.fn()}>
        <span>내용</span>
      </CanvasBlockShell>,
    )

    expect(resizeProps.keepAspectRatio).toBe(true)
    expect(resizeProps.minWidth).toBe(1)
    expect(resizeProps.minHeight).toBe(1)
    expect((view.container.querySelector('.canvas-block-shell') as HTMLElement).style.minWidth).toBe('0px')
  })

  it('Markdown 시각 캡처도 원본 비율과 자유 크기를 유지한다', () => {
    const selection = {
      path: 'docs/guide.md', title: 'Guide', quote: '본문', prefix: '', suffix: '',
      startOffset: 0, endOffset: 2, format: 'paragraph' as const,
    }
    const markdownBlock: CanvasBlockData = {
      kind: 'markdownExcerpt', width: 240, height: 80, style: createDefaultTextBlockStyle(),
      selection,
      capture: {
        sourceFileId: 'md-1', sourceHash: 'hash', anchor: { startOffset: 0, endOffset: 2 },
        plainText: '본문', renderedSnapshot: '<p>본문</p>', width: 240, height: 80, aspectRatio: 3,
      },
      source: { relation: 'markdown-excerpt', selection },
    }
    const view = render(
      <CanvasBlockShell id="md-1" block={markdownBlock} selected><span>본문</span></CanvasBlockShell>,
    )

    expect(resizeProps.keepAspectRatio).toBe(true)
    expect(resizeProps.minWidth).toBe(1)
    expect(resizeProps.minHeight).toBe(1)
    expect((view.container.querySelector('.canvas-block-shell') as HTMLElement).style.minWidth).toBe('0px')
  })
})
