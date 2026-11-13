// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Edge, Node } from '@xyflow/react'
import type { Anchor } from '../../core/anchor'
import { createDefaultTextBlockStyle, type CanvasBlockData } from '../../core/canvasDocument'
import { PDF_EXCERPT_DRAG_MIME, serializePdfExcerptDrag, type PdfExcerptDragPayload } from '../../core/pdfExcerpt'
import { MARKDOWN_EXCERPT_DRAG_MIME, serializeMarkdownExcerptDrag, type MarkdownExcerptDragPayload } from '../../core/markdownExcerpt'
import { createInitialCanvasDocument, NoteCanvas, resolveCanvasOverlaps, settleCanvasNode, touchingEdgeSides } from './NoteCanvas'

const flowHooks = vi.hoisted(() => ({
  updateNodeInternals: vi.fn(),
  setViewport: vi.fn(),
  onViewportChange: undefined as undefined | (() => void),
  props: null as Record<string, unknown> | null,
}))
const imageImport = vi.hoisted(() => ({ importImageFile: vi.fn() }))

vi.mock('../vault/imageImport', () => imageImport)

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  const { createElement } = await import('react')
  return {
    ...actual,
    ReactFlow: (props: Record<string, unknown>) => {
      flowHooks.props = props
      return createElement(actual.ReactFlow, props)
    },
    useUpdateNodeInternals: () => flowHooks.updateNodeInternals,
    useReactFlow: () => ({
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      zoomTo: vi.fn(),
      fitView: vi.fn(),
      getViewport: () => ({ x: 10, y: 20, zoom: 1 }),
      setViewport: flowHooks.setViewport,
    }),
    useOnViewportChange: ({ onChange }: { onChange?: () => void }) => {
      flowHooks.onViewportChange = onChange
    },
  }
})

beforeEach(() => {
  flowHooks.props = null
  flowHooks.updateNodeInternals.mockReset()
  flowHooks.setViewport.mockReset()
  imageImport.importImageFile.mockReset()
  localStorage.removeItem('iwae:canvas:match-pdf-text-size:v1')
})

const anchor: Anchor = {
  docId: '5511aa99cc33',
  page: 301,
  coordSpace: 'pdfium-page',
  rects: [
    { x: 72, y: 640.2, w: 379.3, h: 12.1 },
    { x: 72, y: 626, w: 308.5, h: 12.1 },
  ],
  charRange: [1840, 1902],
  quote: 'The OPTIONS response shall be returned by the Controller.',
  prefix: 'Command response: ',
  suffix: ' See Section 5.1.9.3.4.',
}

describe('NoteCanvas', () => {
  it('초기 블록 geometry는 가로 한 칸과 세로 반 칸 단위다', () => {
    const initial = createInitialCanvasDocument('OPTIONS').nodes[0]!
    expect(initial.position.x % 20).toBe(0)
    expect(initial.position.y % 10).toBe(0)
    expect(initial.data.block.width % 20).toBe(0)
    expect(initial.data.block.height % 10).toBe(0)
  })

  it('초기 제목 블록은 긴 노트 이름도 작업 화면을 덮지 않는 컴팩트 프리셋을 쓴다', () => {
    const initial = createInitialCanvasDocument('샘플 노트 (카드 디자인 확인용)').nodes[0]!

    expect(initial.data.block).toMatchObject({
      width: 320,
      height: 100,
      style: { level: 'h4', fontSize: 21 },
    })
  })

  it('노드 이동 종료 좌표를 가로 한 칸과 세로 반 칸 단위로 맞추고 settle class를 남긴다', () => {
    const node = {
      id: 'node-1',
      position: { x: 0, y: 0 },
      data: {
        block: {
          kind: 'paragraph' as const,
          width: 300,
          height: 120,
          style: createDefaultTextBlockStyle(),
          text: '본문',
        },
      },
      className: 'note-canvas-node',
    } as Node

    expect(settleCanvasNode(node, { x: 31, y: 46 })).toMatchObject({
      position: { x: 40, y: 50 },
      className: 'note-canvas-node canvas-node-snap-settle',
    })
  })

  it('다른 블록 가장자리 28px 안에 놓으면 자석처럼 붙이고 결합 상태를 남긴다', () => {
    const style = createDefaultTextBlockStyle()
    const moving = {
      id: 'moving',
      position: { x: 0, y: 0 },
      data: { block: { kind: 'paragraph' as const, width: 200, height: 80, style, text: '이동' } },
      style: { width: 200, height: 80 },
    } as Node
    const target = {
      id: 'target',
      position: { x: 260, y: 0 },
      data: { block: { kind: 'paragraph' as const, width: 200, height: 80, style, text: '대상' } },
      style: { width: 200, height: 80 },
    } as Node

    expect(settleCanvasNode(moving, { x: 37, y: 3 }, [moving, target])).toMatchObject({
      position: { x: 60, y: 0 },
      className: expect.stringContaining('canvas-node-attached'),
    })
  })

  it('다른 블록 위에 놓으면 가장 가까운 빈 가장자리로 밀어내 겹치지 않게 배치한다', () => {
    const style = createDefaultTextBlockStyle()
    const moving = {
      id: 'moving',
      position: { x: 0, y: 0 },
      data: { block: { kind: 'paragraph' as const, width: 100, height: 60, style, text: '이동' } },
      style: { width: 100, height: 60 },
    } as Node
    const target = {
      id: 'target',
      position: { x: 200, y: 100 },
      data: { block: { kind: 'paragraph' as const, width: 200, height: 80, style, text: '대상' } },
      style: { width: 200, height: 80 },
    } as Node

    expect(settleCanvasNode(moving, { x: 250, y: 130 }, [moving, target])).toMatchObject({
      position: { x: 260, y: 180 },
      className: expect.stringContaining('canvas-node-attached'),
    })
  })

  it('리사이즈 직후에는 오래된 measured 값보다 최신 style 크기로 겹침을 판정한다', () => {
    const style = createDefaultTextBlockStyle()
    const moving = {
      id: 'moving',
      position: { x: 0, y: 0 },
      data: { block: { kind: 'paragraph' as const, width: 200, height: 120, style, text: '확대됨' } },
      style: { width: 200, height: 120 },
      measured: { width: 100, height: 60 },
    } as Node
    const target = {
      id: 'target',
      position: { x: 150, y: 0 },
      data: { block: { kind: 'paragraph' as const, width: 100, height: 80, style, text: '대상' } },
      style: { width: 100, height: 80 },
      measured: { width: 100, height: 80 },
    } as Node

    expect(settleCanvasNode(moving, { x: 0, y: 0 }, [moving, target])).toMatchObject({
      position: { x: -50, y: 0 },
      className: expect.stringContaining('canvas-node-attached'),
    })
  })

  it('사각형 오버레이는 다른 블록 위에 겹쳐 놓을 수 있다', () => {
    const style = createDefaultTextBlockStyle()
    const overlay = {
      id: 'overlay',
      position: { x: 0, y: 0 },
      data: { block: { kind: 'rectangle' as const, width: 200, height: 100, style } },
      style: { width: 200, height: 100 },
    } as Node
    const target = {
      id: 'target',
      position: { x: 200, y: 100 },
      data: { block: { kind: 'paragraph' as const, width: 240, height: 120, style, text: '대상' } },
      style: { width: 240, height: 120 },
    } as Node

    expect(settleCanvasNode(overlay, { x: 220, y: 120 }, [overlay, target])).toMatchObject({
      position: { x: 220, y: 120 },
    })
  })

  it('붙어 있는 여러 블록과 겹치면 전체 묶음의 가장 가까운 빈자리까지 밀어낸다', () => {
    const style = createDefaultTextBlockStyle()
    const block = (id: string, x: number, y: number, width: number, height: number) => ({
      id,
      position: { x, y },
      data: { block: { kind: 'paragraph' as const, width, height, style, text: id } },
      style: { width, height },
    }) as Node
    const moving = block('moving', 0, 0, 100, 60)
    const upper = block('upper', 200, 100, 200, 80)
    const lower = block('lower', 200, 180, 200, 80)

    expect(settleCanvasNode(moving, { x: 250, y: 160 }, [moving, upper, lower])).toMatchObject({
      position: { x: 260, y: 260 },
      className: expect.stringContaining('canvas-node-attached'),
    })
  })

  it('저장된 캔버스에 겹친 블록도 로드할 때 가까운 빈자리로 정리한다', () => {
    const style = createDefaultTextBlockStyle()
    const block = (id: string) => ({
      id,
      position: { x: 100, y: 100 },
      data: { block: { kind: 'paragraph' as const, width: 200, height: 80, style, text: id } },
      style: { width: 200, height: 80 },
    }) as Node

    expect(resolveCanvasOverlaps([block('first'), block('second'), block('third')]).map(({ position }) => position)).toEqual([
      { x: 100, y: 100 },
      { x: 100, y: 180 },
      { x: 100, y: 20 },
    ])
  })

  it('드래그 중에는 격자 스냅을 적용하되 저장은 종료할 때만 한다', async () => {
    const onDocumentChange = vi.fn()
    render(<NoteCanvas noteId="HTTP/OPTIONS.canvas" title="OPTIONS" onDocumentChange={onDocumentChange} />)
    await waitFor(() => expect(onDocumentChange).toHaveBeenCalled())
    onDocumentChange.mockClear()
    const props = flowHooks.props as {
      nodes: Node[]
      onNodeDragStart?: (event: unknown, node: Node) => void
      onNodesChange: (changes: unknown[]) => void
      onNodeDragStop: (event: unknown, node: Node) => void
      snapToGrid?: boolean
      snapGrid?: [number, number]
    }
    const title = props.nodes[0]!

    act(() => {
      props.onNodeDragStart?.({}, title)
      props.onNodesChange([{ type: 'position', id: title.id, position: { x: 91, y: 86 }, dragging: true }])
    })

    await waitFor(() => {
      const current = (flowHooks.props as { nodes: Node[] }).nodes[0]!
      // 글 블록은 끄는 동안에도 격자(20 × 10)에 맞춰 움직인다
      expect(current.position).toEqual({ x: 100, y: 90 })
    })
    expect(onDocumentChange.mock.calls.some(([document]) => document.nodes[0]?.position.x === 91)).toBe(false)

    const live = (flowHooks.props as { nodes: Node[] }).nodes[0]!
    act(() => props.onNodeDragStop({}, live))

    await waitFor(() => {
      expect(onDocumentChange).toHaveBeenLastCalledWith(expect.objectContaining({
        nodes: [expect.objectContaining({ position: { x: 100, y: 90 } })],
      }))
    })
    expect(onDocumentChange.mock.calls.map(([document]) => document.nodes[0]?.position)).toEqual([{ x: 100, y: 90 }])
    fireEvent.click(screen.getByRole('button', { name: '실행 취소' }))
    await waitFor(() => {
      expect((flowHooks.props as { nodes: Node[] }).nodes[0]?.position).toEqual({ x: 80, y: 80 })
    })
    // 격자 맞춤은 블록 종류별로 앱이 한다(그리기 도형은 자유롭게)
    expect(props.snapToGrid).toBeUndefined()
    expect((flowHooks.props as { nodes: Node[] }).nodes[0]?.dragHandle).toBe('.drag-handle')
  })

  it('블록을 맞붙였다 떼어도 선은 저절로 생기지 않는다(예전 자동 선은 읽을 때 뺀다)', async () => {
    const initial = createInitialCanvasDocument('연결')
    const initialDocument = {
      ...initial,
      nodes: [...initial.nodes, {
        id: 'paragraph-0', position: { x: 420, y: 80 },
        data: { block: { kind: 'paragraph' as const, width: 280, height: 80, style: createDefaultTextBlockStyle(), text: '옆 블록' } },
        className: 'note-canvas-node',
      }],
      edges: [{ id: 'snap-paragraph-0-note-title', source: 'paragraph-0', target: 'note-title', sourceHandle: 'left', targetHandle: 'right' }],
    }
    render(<NoteCanvas noteId="snap-auto.canvas" title="연결" initialDocument={initialDocument} />)
    const props = flowHooks.props as { nodes: Node[]; edges: Edge[]; onNodeDragStop: (event: unknown, node: Node) => void }
    expect(props.edges).toHaveLength(0)
    const title = props.nodes.find(({ id }) => id === 'note-title')!
    act(() => props.onNodeDragStop({}, { ...title, position: { x: 98, y: 80 } }))
    await waitFor(() => {
      const current = flowHooks.props as { nodes: Node[]; edges: Edge[] }
      expect(current.nodes.find(({ id }) => id === 'note-title')?.className).toContain('canvas-node-attached-right')
    })
    expect((flowHooks.props as { edges: Edge[] }).edges).toHaveLength(0)
    const attached = (flowHooks.props as { nodes: Node[] }).nodes.find(({ id }) => id === 'note-title')!
    act(() => props.onNodeDragStop({}, { ...attached, position: { x: 80, y: 300 } }))
    await waitFor(() => {
      expect((flowHooks.props as { nodes: Node[] }).nodes.find(({ id }) => id === 'note-title')?.className ?? '').not.toContain('canvas-node-attached')
    })
    expect((flowHooks.props as { edges: Edge[] }).edges).toHaveLength(0)
  })

  it('직접 연결한 블록이 맞닿으면 선을 숨기고 떨어지면 다시 표시한다', async () => {
    const initial = createInitialCanvasDocument('연결')
    const initialDocument = {
      ...initial,
      nodes: [...initial.nodes, {
        id: 'paragraph-0', position: { x: 420, y: 80 },
        data: { block: { kind: 'paragraph' as const, width: 280, height: 80, style: createDefaultTextBlockStyle(), text: '옆 블록' } },
        className: 'note-canvas-node',
      }],
      edges: [{ id: 'edge-note-title-paragraph-0-0', source: 'note-title', target: 'paragraph-0', sourceHandle: 'right', targetHandle: 'left' }],
    }
    render(<NoteCanvas noteId="snap.canvas" title="연결" initialDocument={initialDocument} />)
    const props = flowHooks.props as { nodes: Node[]; onNodeDragStop: (event: unknown, node: Node) => void }
    const title = props.nodes.find(({ id }) => id === 'note-title')!
    act(() => props.onNodeDragStop({}, { ...title, position: { x: 98, y: 80 } }))
    await waitFor(() => {
      const current = flowHooks.props as { nodes: Node[]; edges: Edge[] }
      expect(current.edges).toHaveLength(1)
      expect(current.edges).toEqual(expect.arrayContaining([expect.objectContaining({
        source: 'note-title', target: 'paragraph-0', sourceHandle: 'right', targetHandle: 'left',
      })]))
      expect(current.nodes.find(({ id }) => id === 'note-title')?.className).toContain('canvas-node-linked-right')
      expect(current.nodes.find(({ id }) => id === 'note-title')?.className).toContain('canvas-node-attached-right')
      expect(current.nodes.find(({ id }) => id === 'note-title')?.className).toContain('canvas-node-joined-right')
      expect(current.nodes.find(({ id }) => id === 'paragraph-0')?.className).toContain('canvas-node-joined-left')
      expect((current.nodes.find(({ id }) => id === 'note-title')?.data.touchingSides as ReadonlySet<string>).has('right')).toBe(true)
      expect((current.nodes.find(({ id }) => id === 'paragraph-0')?.data.touchingSides as ReadonlySet<string>).has('left')).toBe(true)
      expect(current.edges[0]?.className).toContain('canvas-edge-joined')
    })
    const joinedTitle = (flowHooks.props as { nodes: Node[] }).nodes.find(({ id }) => id === 'note-title')!
    act(() => props.onNodeDragStop({}, { ...joinedTitle, position: { x: 80, y: 300 } }))
    await waitFor(() => {
      const current = flowHooks.props as { nodes: Node[]; edges: Edge[] }
      expect(current.edges[0]?.className ?? '').not.toContain('canvas-edge-joined')
      expect(current.nodes.find(({ id }) => id === 'note-title')?.className ?? '').not.toContain('canvas-node-joined-right')
    })
  })

  it('발췌 높이의 소수점 때문에 생긴 작은 틈도 맞닿은 연결로 판단한다', () => {
    const source = { id: 'source', position: { x: 80, y: 80 }, data: {}, style: { width: 320, height: 108.74 } } as Node
    const target = { id: 'target', position: { x: 80, y: 194 }, data: {}, style: { width: 280, height: 80 } } as Node
    expect(touchingEdgeSides(source, target)).toEqual({ source: 'bottom', target: 'top' })
    expect(touchingEdgeSides(source, { ...target, position: { x: 80, y: 200 } })).toBeNull()
  })

  it('폭이 다른 블록을 왼쪽 끝에 맞춰 붙이면 오른쪽 끝 정렬로 다시 밀지 않는다', () => {
    const style = createDefaultTextBlockStyle()
    const upper = { id: 'upper', position: { x: 80, y: 80 }, data: { block: { kind: 'paragraph' as const, width: 320, height: 100, style, text: '위' } } } as Node
    const lower = { id: 'lower', position: { x: 80, y: 180 }, data: { block: { kind: 'paragraph' as const, width: 340, height: 80, style, text: '아래' } } } as Node
    const settled = settleCanvasNode(lower, lower.position, [upper, lower])
    expect(settled.position).toEqual({ x: 80, y: 180 })
    expect(settled.className).toContain('canvas-node-attached')
  })

  it('다른 근처 블록은 선택된 결합 상대의 왼쪽 정렬을 덮어쓰지 않는다', () => {
    const style = createDefaultTextBlockStyle()
    const adjacent = { id: 'adjacent', position: { x: 80, y: 460 }, data: { block: { kind: 'paragraph' as const, width: 304.066, height: 75.0649, style, text: '붙일 블록' } } } as Node
    const nearby = { id: 'nearby', position: { x: 400, y: 690 }, data: { block: { kind: 'paragraph' as const, width: 109.0657, height: 129.065, style, text: '다른 블록' } } } as Node
    const moving = { id: 'moving', position: { x: 80, y: 540 }, data: { block: { kind: 'paragraph' as const, width: 440, height: 130, style, text: '이동 블록' } } } as Node
    const settled = settleCanvasNode(moving, moving.position, [adjacent, nearby, moving])
    expect(settled.position.x).toBe(80)
    expect(settled.position.y).toBeCloseTo(535.0649, 4)
  })

  it('드래그 중 블록을 들어 올리고 가까운 블록과 접촉 상태를 표시한다', async () => {
    const style = createDefaultTextBlockStyle()
    const initialDocument = {
      version: 2 as const,
      nodes: [
        { id: 'body-1', position: { x: 0, y: 0 }, data: { block: { kind: 'paragraph' as const, width: 200, height: 80, style, text: '하나' } } },
        { id: 'body-2', position: { x: 220, y: 0 }, data: { block: { kind: 'paragraph' as const, width: 200, height: 80, style, text: '둘' } } },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    render(<NoteCanvas noteId="contact.canvas" title="접촉" initialDocument={initialDocument} />)
    const props = flowHooks.props as {
      nodes: Node[]
      onNodeDragStart?: (event: unknown, node: Node) => void
      onNodeDrag?: (event: unknown, node: Node) => void
    }
    const moving = props.nodes[0]!

    act(() => props.onNodeDragStart?.({}, moving))
    await waitFor(() => {
      expect((flowHooks.props as { nodes: Node[] }).nodes[0]?.className).toContain('canvas-node-lifted')
    })

    act(() => props.onNodeDrag?.({}, { ...moving, position: { x: 10, y: 0 } }))
    await waitFor(() => {
      const nodes = (flowHooks.props as { nodes: Node[] }).nodes
      expect(nodes[0]?.className).toContain('canvas-node-contact')
      expect(nodes[1]?.className).toContain('canvas-node-contact')
      expect(nodes[0]?.className).toContain('canvas-node-magnet-right')
      expect(nodes[1]?.className).toContain('canvas-node-magnet-left')
      expect(Number.parseFloat(String((nodes[0]?.style as Record<string, unknown>)['--magnet-pull-x']))).toBeGreaterThan(0)
      expect(Number.parseFloat(String((nodes[1]?.style as Record<string, unknown>)['--magnet-pull-x']))).toBeLessThan(0)
    })
  })

  it('viewport가 움직이는 동안 모든 노드의 edge geometry를 다음 프레임에 갱신한다', async () => {
    flowHooks.updateNodeInternals.mockReset()
    render(<NoteCanvas noteId="HTTP/OPTIONS.canvas" title="OPTIONS" />)
    flowHooks.updateNodeInternals.mockClear()

    act(() => flowHooks.onViewportChange?.())

    await waitFor(() => expect(flowHooks.updateNodeInternals).toHaveBeenCalledWith(['note-title']))
  })

  it('이전 포트 id는 현재 포트로 바꾸고 자기 자신을 잇는 손상된 선은 제거한다', () => {
    const style = createDefaultTextBlockStyle()
    render(<NoteCanvas
      noteId="legacy-edges.canvas"
      title="이전 연결선"
      initialDocument={{
        version: 2,
        nodes: [
          { id: 'body-1', position: { x: 0, y: 0 }, data: { block: { kind: 'paragraph', width: 200, height: 80, style, text: '하나' } } },
          { id: 'body-2', position: { x: 240, y: 0 }, data: { block: { kind: 'paragraph', width: 200, height: 80, style, text: '둘' } } },
        ],
        edges: [
          { id: 'broken-self-edge', source: 'body-1', target: 'body-1', sourceHandle: 'source-top', targetHandle: 'target-top' },
          { id: 'legacy-edge', source: 'body-1', target: 'body-2', sourceHandle: 'source-right', targetHandle: 'target-left' },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      }}
    />)

    expect((flowHooks.props as { edges: Array<Record<string, unknown>> }).edges).toEqual([
      expect.objectContaining({
        id: 'legacy-edge',
        sourceHandle: 'right',
        targetHandle: 'left',
      }),
    ])
  })

  it('React Flow nodeTypes 참조를 렌더 사이에 재사용한다', () => {
    render(<NoteCanvas noteId="stable-types.canvas" title="고정 타입" />)
    const firstNodeTypes = (flowHooks.props as { nodeTypes: unknown }).nodeTypes
    const props = flowHooks.props as {
      nodes: Node[]
      onNodeDragStart?: (event: unknown, node: Node) => void
    }

    act(() => props.onNodeDragStart?.({}, props.nodes[0]!))

    expect((flowHooks.props as { nodeTypes: unknown }).nodeTypes).toBe(firstNodeTypes)
  })

  it('열린 노트를 실제 React Flow 캔버스로 그린다', () => {
    render(<NoteCanvas noteId="HTTP/OPTIONS.canvas" title="OPTIONS" saveStatus="saved" />)

    expect(screen.getByRole('application', { name: 'OPTIONS 캔버스' })).toBeDefined()
    expect(screen.getByText('OPTIONS')).toBeDefined()
    expect(screen.getByRole('toolbar', { name: '노트 편집 도구' })).toBeDefined()
    expect(screen.getByRole('combobox', { name: '문단 모양' })).toBeDefined()
    expect(screen.getByRole('button', { name: '굵게' })).toBeDefined()
    expect(screen.getByRole('button', { name: '번호 목록' })).toBeDefined()
    expect(screen.getByRole('button', { name: '캔버스 화면 맞춤' })).toBeDefined()
    expect(screen.getByRole('slider', { name: '캔버스 배율' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Zoom In' })).toBeNull()
    expect(screen.getByText('저장됨')).toBeDefined()
    const bottomBar = screen.getByLabelText('캔버스 보기 도구')
    const bottomSurface = bottomBar.querySelector('.note-bottom-bar-surface')
    expect(bottomSurface).not.toBeNull()
    expect(bottomSurface?.lastElementChild?.classList.contains('note-save-status')).toBe(true)
    expect((flowHooks.props as { proOptions?: unknown }).proOptions).toBeUndefined()
  })

  it('브라우저 측정 API가 없어도 초기 치수로 블록을 즉시 표시한다', () => {
    render(<NoteCanvas noteId="visible-without-observer.canvas" title="즉시 표시" />)
    const node = (flowHooks.props as { nodes: Node<{ block: CanvasBlockData }>[] }).nodes[0]!

    expect(node.initialWidth).toBe(node.data.block.width)
    expect(node.initialHeight).toBe(node.data.block.height)
  })

  it.each([
    ['dirty', '저장 대기'],
    ['conflict', '외부 변경 충돌'],
    ['recovered', '복구됨'],
  ] as const)('%s 저장 상태를 하단바에서 구분한다', (status, label) => {
    render(<NoteCanvas noteId="HTTP/OPTIONS.canvas" title="OPTIONS" saveStatus={status} />)
    expect(screen.getByText(label)).toBeDefined()
  })

  it('PDF 선택을 놓으면 원문 모양과 출처 및 연결점을 가진 발췌 블록을 만든다', async () => {
    const onOpenSource = vi.fn()
    const onDocumentChange = vi.fn()
    const onSourceStateChange = vi.fn()
    const view = render(
      <NoteCanvas
        noteId="HTTP/OPTIONS.canvas"
        title="OPTIONS"
        onOpenSource={onOpenSource}
        onDocumentChange={onDocumentChange}
        onSourceStateChange={onSourceStateChange}
      />,
    )
    const serialized = serializePdfExcerptDrag({
      sourceTitle: 'HTTP Semantics Guide v1.1',
      selection: {
        mode: 'text',
        anchor,
        pageSize: [612, 792],
        crop: { x: 68, y: 622, w: 391.3, h: 34.3 },
        glyphs: [{ c: anchor.quote, x: 72, y: 626, w: 379.3, h: 26.3 }],
      },
    })
    const dataTransfer = {
      getData: (type: string) => type === PDF_EXCERPT_DRAG_MIME ? serialized : '',
      dropEffect: 'none',
    }
    const canvas = view.container.querySelector('.react-flow')
    expect(canvas).not.toBeNull()

    fireEvent.dragOver(canvas as Element, { dataTransfer })
    fireEvent.drop(canvas as Element, { clientX: 520, clientY: 360, dataTransfer })

    await waitFor(() => {
      expect(onDocumentChange).toHaveBeenCalledWith(expect.objectContaining({
        version: 2,
        nodes: expect.arrayContaining([expect.objectContaining({ type: 'pdfExcerpt' })]),
      }))
      expect(onSourceStateChange).toHaveBeenCalledWith(expect.objectContaining({
        references: [expect.objectContaining({ blockId: 'pdf-excerpt-0', relation: 'excerpt' })],
      }))
    })

    const emittedExcerpt = onDocumentChange.mock.calls
      .map(([document]) => document.nodes.find((node: { id: string }) => node.id === 'pdf-excerpt-0'))
      .find(Boolean)
    expect(Math.abs(emittedExcerpt.position.x % 20)).toBe(0)
    expect(Math.abs(emittedExcerpt.position.y % 10)).toBe(0)
    expect(emittedExcerpt.data.block.width).toBeCloseTo(391.3)
    expect(emittedExcerpt.data.block.width / emittedExcerpt.data.block.height).toBeCloseTo(391.3 / 34.3)

    expect(view.container.querySelector('[aria-label="PDF 발췌: The OPTIONS response shall be returned by the Controller."]')).not.toBeNull()
    expect(view.container.querySelector('img[alt="HTTP Semantics Guide v1.1 302쪽 발췌 원문"]')).not.toBeNull()
    expect(view.container.querySelectorAll('.react-flow__node-pdfExcerpt .canvas-block-port')).toHaveLength(4)
    expect(view.container.querySelectorAll('.react-flow__node-pdfExcerpt .canvas-block-port-visible')).toHaveLength(0)
    const body = view.container.querySelector('.pdf-excerpt-node-body')
    const source = view.container.querySelector('.pdf-excerpt-source')
    expect(body).not.toBeNull()
    expect(source).not.toBeNull()
    expect(body?.contains(source)).toBe(false)
    expect(view.container.querySelector('.pdf-excerpt-text-layer')?.textContent).toBe(anchor.quote)
    const flowNode = view.container.querySelector('.react-flow__node-pdfExcerpt')
    expect(flowNode).not.toBeNull()
    fireEvent.click(flowNode as Element)
    expect(view.container.querySelectorAll('.react-flow__node-pdfExcerpt .canvas-block-port')).toHaveLength(4)
    expect(view.container.querySelectorAll('.react-flow__node-pdfExcerpt .canvas-block-port-visible')).toHaveLength(4)
    expect(view.container.querySelectorAll('.react-flow__resize-control')).toHaveLength(8)
    await waitFor(() => {
      expect(onSourceStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
        selectedIds: new Set(['pdf-excerpt-0']),
      }))
    })

    const sourceButton = view.container.querySelector('button[aria-label="HTTP Semantics Guide v1.1 302쪽 출처 열기"]')
    expect(sourceButton).not.toBeNull()
    expect(sourceButton?.getAttribute('data-source-trace-side')).toBe('left')
    fireEvent.click(sourceButton as Element)
    expect(onOpenSource).toHaveBeenCalledWith({ docId: anchor.docId, page: 301, anchor })
  })

  it('PDF 선택 전송 요청을 받으면 현재 캔버스에 발췌 블록을 만든다', async () => {
    const onDocumentChange = vi.fn()
    const payload: PdfExcerptDragPayload = {
      sourceTitle: 'HTTP Semantics Guide v1.1',
      selection: {
        mode: 'text',
        anchor,
        pageSize: [612, 792],
        crop: { x: 68, y: 622, w: 391.3, h: 34.3 },
        glyphs: [{ c: anchor.quote, x: 72, y: 626, w: 379.3, h: 26.3 }],
      },
    }
    const view = render(
      <NoteCanvas
        noteId="HTTP/OPTIONS.canvas"
        title="OPTIONS"
        insertRequest={{ id: 1, payload }}
        onDocumentChange={onDocumentChange}
      />,
    )

    await waitFor(() => {
      expect(view.container.querySelector('.react-flow__node-pdfExcerpt')).not.toBeNull()
      expect(onDocumentChange).toHaveBeenCalledWith(expect.objectContaining({
        nodes: expect.arrayContaining([expect.objectContaining({ type: 'pdfExcerpt' })]),
      }))
    })

    fireEvent.click(screen.getByRole('button', { name: '실행 취소' }))
    await waitFor(() => {
      expect(view.container.querySelector('.react-flow__node-pdfExcerpt')).toBeNull()
    })
  })

  it('Markdown 선택을 놓으면 의미 형식과 원문 위치를 가진 발췌 블록을 만든다', async () => {
    const onDocumentChange = vi.fn()
    const onSourceStateChange = vi.fn()
    const view = render(
      <NoteCanvas
        noteId="sample.canvas"
        title="샘플"
        onDocumentChange={onDocumentChange}
        onSourceStateChange={onSourceStateChange}
      />,
    )
    const serialized = serializeMarkdownExcerptDrag({
      selection: {
        path: 'docs/guide.md',
        title: 'Guide',
        quote: '중요한 제목',
        prefix: '',
        suffix: ' 본문',
        startOffset: 0,
        endOffset: 6,
        format: 'heading-2',
      },
      displaySize: { width: 286, height: 68 },
    })
    const dataTransfer = {
      getData: (type: string) => type === MARKDOWN_EXCERPT_DRAG_MIME ? serialized : '',
      dropEffect: 'none',
    }
    const canvas = view.container.querySelector('.react-flow')

    fireEvent.dragOver(canvas as Element, { dataTransfer })
    fireEvent.drop(canvas as Element, { clientX: 520, clientY: 360, dataTransfer })

    await waitFor(() => {
      expect(onDocumentChange).toHaveBeenCalledWith(expect.objectContaining({
        nodes: expect.arrayContaining([expect.objectContaining({
          id: 'markdown-excerpt-0',
          type: 'markdownExcerpt',
          data: { block: expect.objectContaining({ kind: 'markdownExcerpt' }) },
        })]),
      }))
      expect(onSourceStateChange).toHaveBeenCalledWith(expect.objectContaining({
        references: [expect.objectContaining({ blockId: 'markdown-excerpt-0', relation: 'markdown-excerpt' })],
      }))
    })
    expect(view.container.querySelector('.markdown-excerpt-content-heading-2')?.textContent).toBe('중요한 제목')
  })

  it('다른 노트를 대상으로 한 PDF 발췌 요청은 현재 캔버스에 넣지 않는다', async () => {
    const payload: PdfExcerptDragPayload = {
      sourceTitle: 'HTTP Semantics Guide v1.1',
      selection: {
        mode: 'text',
        anchor,
        pageSize: [612, 792],
        crop: { x: 68, y: 622, w: 391.3, h: 34.3 },
        glyphs: [{ c: anchor.quote, x: 72, y: 626, w: 379.3, h: 26.3 }],
      },
    }
    const request = { id: 1, targetNoteId: 'note-a.canvas', payload }
    const view = render(
      <NoteCanvas
        noteId="note-b.canvas"
        title="B 노트"
        insertRequest={request}
      />,
    )

    await act(async () => Promise.resolve())
    expect(view.container.querySelector('.react-flow__node-pdfExcerpt')).toBeNull()
  })

  it('PDF 선택 번역 요청은 원문과 번역 블록을 만들고 서로 연결한다', async () => {
    const onDocumentChange = vi.fn()
    const payload: PdfExcerptDragPayload = {
      sourceTitle: 'HTTP Semantics Guide v1.1',
      selection: {
        mode: 'text',
        anchor,
        pageSize: [612, 792],
        crop: { x: 68, y: 622, w: 391.3, h: 34.3 },
        glyphs: [{ c: anchor.quote, x: 72, y: 626, w: 379.3, h: 26.3 }],
      },
    }
    render(
      <NoteCanvas
        noteId="HTTP/OPTIONS.canvas"
        title="OPTIONS"
        insertRequest={{
          id: 2,
          payload,
          translation: {
            text: '컨트롤러가 OPTIONS 응답을 반환해야 합니다.',
            targetLanguage: 'ko',
            model: 'translategemma:4b',
          },
        }}
        onDocumentChange={onDocumentChange}
      />,
    )

    await waitFor(() => {
      expect(onDocumentChange).toHaveBeenCalledWith(expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: 'pdf-excerpt-0', type: 'pdfExcerpt' }),
          expect.objectContaining({
            id: 'translation-0',
            type: 'translation',
            data: { block: expect.objectContaining({
              kind: 'translation',
              sourceBlockId: 'pdf-excerpt-0',
              targetLanguage: 'ko',
              model: 'translategemma:4b',
            }) },
          }),
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({ source: 'pdf-excerpt-0', target: 'translation-0' }),
        ]),
      }))
    })
    const translation = onDocumentChange.mock.calls
      .map(([document]) => document.nodes.find((node: { id: string }) => node.id === 'translation-0'))
      .find(Boolean)
    expect(Math.abs(translation.position.x % 20)).toBe(0)
    expect(Math.abs(translation.position.y % 10)).toBe(0)
  })

  it('Markdown 선택 번역 요청은 시각 캡처와 번역 블록을 만들고 서로 연결한다', async () => {
    const onDocumentChange = vi.fn()
    const payload: MarkdownExcerptDragPayload = {
      selection: {
        path: 'docs/guide.md',
        title: 'Guide',
        quote: 'Important heading',
        prefix: '',
        suffix: ' body',
        startOffset: 0,
        endOffset: 17,
        format: 'heading-2',
      },
      displaySize: { width: 260, height: 54 },
    }
    render(
      <NoteCanvas
        noteId="markdown-translation.canvas"
        title="Markdown translation"
        insertRequest={{
          id: 3,
          payload,
          translation: {
            text: '중요한 제목',
            targetLanguage: 'ko',
            model: 'translategemma:4b',
          },
        }}
        onDocumentChange={onDocumentChange}
      />,
    )

    await waitFor(() => {
      expect(onDocumentChange).toHaveBeenCalledWith(expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: 'markdown-excerpt-0', type: 'markdownExcerpt' }),
          expect.objectContaining({
            id: 'translation-0',
            type: 'translation',
            data: { block: expect.objectContaining({
              sourceBlockId: 'markdown-excerpt-0',
              text: '중요한 제목',
            }) },
          }),
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({ source: 'markdown-excerpt-0', target: 'translation-0' }),
        ]),
      }))
    })
  })

  it('블록 우클릭 메뉴에서 삭제하면 블록과 연결 상태를 문서에서 제거한다', async () => {
    const onDocumentChange = vi.fn()
    const view = render(<NoteCanvas noteId="HTTP/OPTIONS.canvas" title="OPTIONS" onDocumentChange={onDocumentChange} />)
    const titleNode = view.container.querySelector('.react-flow__node-textBlock')
    expect(titleNode).not.toBeNull()

    fireEvent.contextMenu(titleNode as Element, { clientX: 220, clientY: 180 })
    fireEvent.click(screen.getByRole('menuitem', { name: '삭제' }))

    await waitFor(() => {
      expect(onDocumentChange).toHaveBeenLastCalledWith(expect.objectContaining({ nodes: [] }))
    })

    fireEvent.click(screen.getByRole('button', { name: '실행 취소' }))
    await waitFor(() => {
      expect((flowHooks.props as { nodes: Node[] }).nodes).toHaveLength(1)
    })
  })

  it('Ctrl+A와 Delete 단축키로 모든 블록을 선택하고 삭제한다', async () => {
    const onDocumentChange = vi.fn()
    render(<NoteCanvas noteId="HTTP/OPTIONS.canvas" title="OPTIONS" onDocumentChange={onDocumentChange} />)

    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true })
    await waitFor(() => {
      expect((flowHooks.props as { nodes: Node[] }).nodes.every((node) => node.selected)).toBe(true)
    })

    fireEvent.keyDown(document.body, { key: 'Delete' })
    await waitFor(() => {
      expect(onDocumentChange).toHaveBeenLastCalledWith(expect.objectContaining({ nodes: [] }))
    })
  })

  it('블록 배경 명령은 텍스트 highlight를 보존해 별도 속성으로 저장한다', async () => {
    const onDocumentChange = vi.fn()
    const view = render(<NoteCanvas noteId="HTTP/OPTIONS.canvas" title="OPTIONS" onDocumentChange={onDocumentChange} />)
    const titleNode = view.container.querySelector('.react-flow__node-textBlock')
    expect(titleNode).not.toBeNull()

    fireEvent.contextMenu(titleNode as Element, { clientX: 220, clientY: 180 })
    fireEvent.click(screen.getByRole('menuitem', { name: '블록 배경 노랑' }))

    await waitFor(() => {
      expect(onDocumentChange).toHaveBeenLastCalledWith(expect.objectContaining({
        nodes: [expect.objectContaining({
          data: { block: expect.objectContaining({
            style: expect.objectContaining({ background: '#fff6c7', highlight: 'transparent' }),
          }) },
        })],
      }))
    })
  })

  it('빈 캔버스 우클릭 메뉴에서 제목, 본문, 화살표 블록을 추가한다', async () => {
    const onDocumentChange = vi.fn()
    const view = render(<NoteCanvas noteId="HTTP/OPTIONS.canvas" title="OPTIONS" onDocumentChange={onDocumentChange} />)
    const pane = view.container.querySelector('.react-flow__pane')
    expect(pane).not.toBeNull()

    for (const name of ['제목 블록 추가', '본문 블록 추가', '화살표 블록 추가']) {
      fireEvent.contextMenu(pane as Element, { clientX: 420, clientY: 260 })
      fireEvent.click(screen.getByRole('menuitem', { name }))
    }

    await waitFor(() => {
      expect(onDocumentChange).toHaveBeenLastCalledWith(expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ data: { block: expect.objectContaining({ kind: 'title' }) } }),
          expect.objectContaining({ data: { block: expect.objectContaining({ kind: 'paragraph' }) } }),
          expect.objectContaining({ data: { block: expect.objectContaining({ kind: 'arrow', direction: 'right' }) } }),
        ]),
      }))
    })
  })

  it('블록 우클릭 번역은 번역 블록을 만들고 원본 블록과 연결한다', async () => {
    const onDocumentChange = vi.fn()
    const onTranslateText = vi.fn().mockResolvedValue({
      text: 'OPTIONS translated',
      targetLanguage: 'ko',
      model: 'translategemma:4b',
    })
    const view = render(
      <NoteCanvas
        noteId="HTTP/OPTIONS.canvas"
        title="OPTIONS"
        onDocumentChange={onDocumentChange}
        onTranslateText={onTranslateText}
      />,
    )
    const titleNode = view.container.querySelector('.react-flow__node-textBlock')
    expect(titleNode).not.toBeNull()

    fireEvent.contextMenu(titleNode as Element, { clientX: 220, clientY: 180 })
    fireEvent.click(screen.getByRole('menuitem', { name: '번역 블록 만들기' }))

    await waitFor(() => {
      expect(onTranslateText).toHaveBeenCalledWith('OPTIONS')
      expect(onDocumentChange).toHaveBeenLastCalledWith(expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: 'note-title' }),
          expect.objectContaining({
            id: 'translation-0',
            type: 'translation',
            data: { block: expect.objectContaining({
              text: 'OPTIONS translated',
              sourceBlockId: 'note-title',
              targetLanguage: 'ko',
              model: 'translategemma:4b',
            }) },
          }),
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({ source: 'note-title', target: 'translation-0' }),
        ]),
      }))
    })
    const translation = onDocumentChange.mock.calls
      .map(([document]) => document.nodes.find((node: { id: string }) => node.id === 'translation-0'))
      .find(Boolean)
    expect(Math.abs(translation.position.x % 20)).toBe(0)
    expect(Math.abs(translation.position.y % 20)).toBe(0)
  })

  it('번역을 기다리는 동안 원본 블록이 삭제되면 고아 연결선을 만들지 않는다', async () => {
    let resolveTranslation: ((value: { text: string; targetLanguage: string; model: string }) => void) | undefined
    const onTranslateText = vi.fn(() => new Promise<{ text: string; targetLanguage: string; model: string }>((resolve) => {
      resolveTranslation = resolve
    }))
    const view = render(
      <NoteCanvas
        noteId="translation-race.canvas"
        title="번역 경합"
        onTranslateText={onTranslateText}
      />,
    )
    const titleNode = view.container.querySelector('.react-flow__node-textBlock')
    expect(titleNode).not.toBeNull()

    fireEvent.contextMenu(titleNode as Element, { clientX: 220, clientY: 180 })
    fireEvent.click(screen.getByRole('menuitem', { name: '번역 블록 만들기' }))
    await waitFor(() => expect(onTranslateText).toHaveBeenCalledTimes(1))

    const beforeDelete = flowHooks.props as {
      nodes: Node[]
      onNodesDelete: (deleted: Node[]) => void
    }
    act(() => beforeDelete.onNodesDelete([beforeDelete.nodes[0]!]))
    await waitFor(() => expect((flowHooks.props as { nodes: Node[] }).nodes).toHaveLength(0))

    await act(async () => {
      resolveTranslation?.({ text: '번역', targetLanguage: 'ko', model: 'translategemma:4b' })
      await Promise.resolve()
    })

    expect((flowHooks.props as { edges: Edge[] }).edges).toHaveLength(0)
  })

  it('상단 툴바 서식은 선택한 텍스트 블록에 저장된다', async () => {
    const onDocumentChange = vi.fn()
    const view = render(<NoteCanvas noteId="HTTP/OPTIONS.canvas" title="OPTIONS" onDocumentChange={onDocumentChange} />)
    const titleNode = view.container.querySelector('.react-flow__node-textBlock')
    expect(titleNode).not.toBeNull()
    fireEvent.click(titleNode as Element)
    fireEvent.click(screen.getByRole('button', { name: '굵게' }))

    await waitFor(() => {
      expect(onDocumentChange).toHaveBeenLastCalledWith(expect.objectContaining({
        nodes: [expect.objectContaining({
          data: { block: expect.objectContaining({ style: expect.objectContaining({ bold: false }) }) },
        })],
      }))
    })
  })

  it('텍스트 본문을 클릭하면 블록을 선택해 상단 서식 도구를 활성화한다', async () => {
    const view = render(<NoteCanvas noteId="select-text.canvas" title="선택 가능한 제목" />)

    const editor = view.container.querySelector('.canvas-text-editor')
    expect(editor).not.toBeNull()
    fireEvent.click(editor as Element)

    await waitFor(() => {
      expect((screen.getByRole('button', { name: '굵게' }) as HTMLButtonElement).disabled).toBe(false)
      expect((screen.getByRole('combobox', { name: '문단 모양' }) as HTMLSelectElement).disabled).toBe(false)
    })
  })

  it('닿기만 해도 선택되고 우클릭·가운데 버튼 드래그로 이동하며 Shift+휠 가로 이동을 사용한다', () => {
    const view = render(<NoteCanvas noteId="selection.canvas" title="선택" />)
    const props = flowHooks.props as {
      selectionOnDrag?: boolean
      selectionMode?: string
      panOnDrag?: boolean | number[]
    }
    expect(props.selectionOnDrag).toBe(true)
    expect(props.selectionMode).toBe('partial')
    expect(props.panOnDrag).toEqual([1, 2])

    const flow = view.container.querySelector('.note-flow')
    expect(flow).not.toBeNull()
    fireEvent.wheel(flow as Element, { shiftKey: true, deltaY: 120 })
    expect(flowHooks.setViewport).toHaveBeenCalledWith({ x: -110, y: 20, zoom: 1 })

    const pane = view.container.querySelector('.react-flow__pane')
    expect(pane).not.toBeNull()
    fireEvent.pointerDown(flow as Element, { button: 2, clientX: 300, clientY: 300 })
    fireEvent.pointerMove(flow as Element, { buttons: 2, clientX: 340, clientY: 320 })
    fireEvent.pointerUp(flow as Element, { button: 2, clientX: 340, clientY: 320 })
    fireEvent.contextMenu(pane as Element, { button: 2, clientX: 340, clientY: 320 })
    expect(screen.queryByRole('menuitem', { name: '제목 블록 추가' })).toBeNull()
  })

  it('상단바의 텍스트 버튼으로 만든 블록을 현재 보이는 캔버스 중앙에 배치한다', async () => {
    const view = render(<NoteCanvas noteId="visible-create.canvas" title="보이는 위치" />)
    const flow = view.container.querySelector('.note-flow') as HTMLDivElement | null
    expect(flow).not.toBeNull()
    flow!.getBoundingClientRect = vi.fn(() => ({
      x: 700,
      y: 80,
      left: 700,
      top: 80,
      right: 1300,
      bottom: 880,
      width: 600,
      height: 800,
      toJSON: () => ({}),
    }))

    fireEvent.click(screen.getByRole('button', { name: '텍스트 블록 추가' }))

    await waitFor(() => {
      const paragraph = (flowHooks.props as { nodes: Node[] }).nodes.find(({ id }) => id === 'paragraph-0')
      expect(paragraph?.position).toEqual({ x: 860, y: 440 })
    })
  })

  it('그리기 도구로 블록 위에 도형을 놓고 코드 블록을 추가한다', async () => {
    const onDocumentChange = vi.fn()
    const view = render(<NoteCanvas noteId="presets.canvas" title="프리셋" onDocumentChange={onDocumentChange} />)
    const pane = view.container.querySelector('.react-flow__pane') as Element

    for (const name of ['사각형', '정사각형', '타원', '마름모']) {
      if (name === '사각형') fireEvent.click(screen.getByRole('button', { name: '네모 그리기' }))
      else {
        fireEvent.contextMenu(pane, { clientX: 300, clientY: 180 })
        fireEvent.click(screen.getByRole('menuitem', { name: `${name} 추가` }))
      }
      const surface = document.querySelector('.canvas-drawing-surface')!
      fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 300, clientY: 180 })
      fireEvent.pointerMove(surface, { pointerId: 1, clientX: 540, clientY: 320 })
      fireEvent.pointerUp(surface, { pointerId: 1, clientX: 540, clientY: 320 })
    }
    fireEvent.contextMenu(pane, { clientX: 300, clientY: 180 })
    fireEvent.click(screen.getByRole('menuitem', { name: '코드 블록 추가' }))

    await waitFor(() => {
      const document = onDocumentChange.mock.calls.at(-1)?.[0]
      expect(document.nodes.map((node: { data: { block: { kind: string } } }) => node.data.block.kind)).toEqual(
        expect.arrayContaining(['rectangle', 'square', 'ellipse', 'diamond', 'code']),
      )
      const nodes = document.nodes as Node<{ block: CanvasBlockData }>[]
      const rectangle = nodes.find(({ data }) => data.block.kind === 'rectangle')?.data.block
      expect(rectangle?.style).toMatchObject({ background: 'transparent', borderColor: '#ef4444' })
      for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
          const left = nodes[leftIndex]!
          const right = nodes[rightIndex]!
          const leftBlock = left.data.block
          const rightBlock = right.data.block
          if (['rectangle', 'square', 'ellipse', 'diamond'].includes(leftBlock.kind) || ['rectangle', 'square', 'ellipse', 'diamond'].includes(rightBlock.kind)) continue
          const overlaps = Math.min(left.position.x + leftBlock.width, right.position.x + rightBlock.width) > Math.max(left.position.x, right.position.x)
            && Math.min(left.position.y + leftBlock.height, right.position.y + rightBlock.height) > Math.max(left.position.y, right.position.y)
          expect(overlaps).toBe(false)
        }
      }
    })
  })

  it('블록 우클릭 메뉴에서 현재 블록을 사용자 프리셋으로 전달한다', async () => {
    const onSaveUserPreset = vi.fn()
    render(<NoteCanvas noteId="save-preset.canvas" title="저장할 제목" onSaveUserPreset={onSaveUserPreset} />)
    const props = flowHooks.props as {
      nodes: Node<{ block: CanvasBlockData }>[]
      onNodeContextMenu: (event: { preventDefault: () => void; clientX: number; clientY: number }, node: Node) => void
    }
    const title = props.nodes[0]!

    act(() => props.onNodeContextMenu({ preventDefault: vi.fn(), clientX: 40, clientY: 50 }, title))
    fireEvent.click(await screen.findByRole('menuitem', { name: '프리셋으로 추가' }))

    expect(onSaveUserPreset).toHaveBeenCalledWith(title.data.block)
  })

  it('Vault 사용자 프리셋을 캔버스 메뉴에서 새 블록으로 추가한다', async () => {
    const block = {
      kind: 'paragraph' as const,
      width: 360,
      height: 90,
      style: { ...createDefaultTextBlockStyle(), background: '#fff6c7' },
      text: '결론',
    }
    const view = render(<NoteCanvas
      noteId="custom-preset.canvas"
      title="프리셋"
      userPresets={[{ id: 'preset-1', name: '결론 카드', block }]}
    />)

    fireEvent.contextMenu(view.container.querySelector('.react-flow__pane') as Element, { clientX: 400, clientY: 240 })
    fireEvent.click(screen.getByRole('menuitem', { name: '결론 카드 프리셋 추가' }))
    await waitFor(() => {
      const added = (flowHooks.props as { nodes: Node<{ block: CanvasBlockData }>[] }).nodes
        .find(({ data }) => data.block.kind === 'paragraph' && data.block.text === '결론')
      expect(added?.data.block).toEqual(block)
    })
  })

  it('상단바로 추가한 텍스트 블록을 실행 취소하고 다시 실행한다', async () => {
    render(<NoteCanvas noteId="preset-history.canvas" title="프리셋 기록" />)

    fireEvent.click(screen.getByRole('button', { name: '텍스트 블록 추가' }))
    await waitFor(() => expect((flowHooks.props as { nodes: Node[] }).nodes).toHaveLength(2))
    expect((screen.getByRole('button', { name: '실행 취소' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '실행 취소' }))
    await waitFor(() => expect((flowHooks.props as { nodes: Node[] }).nodes).toHaveLength(1))
    expect((screen.getByRole('button', { name: '다시 실행' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '다시 실행' }))
    await waitFor(() => expect((flowHooks.props as { nodes: Node[] }).nodes).toHaveLength(2))
  })

  it('텍스트 편집을 실행 취소하면 편집 전 내용으로 돌아간다', async () => {
    const view = render(<NoteCanvas noteId="text-history.canvas" title="원래 제목" />)

    const editor = view.container.querySelector<HTMLElement>('.canvas-text-editor')
    if (editor === null) throw new Error('텍스트 편집기가 없다')
    fireEvent.click(editor)
    fireEvent.doubleClick(editor)
    editor.textContent = '수정된 제목'
    fireEvent.blur(editor)

    await waitFor(() => {
      expect((flowHooks.props as { nodes: Node<{ block: CanvasBlockData }>[] }).nodes[0]?.data.block).toMatchObject({
        text: '수정된 제목',
      })
    })
    expect((screen.getByRole('button', { name: '실행 취소' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '실행 취소' }))
    await waitFor(() => {
      expect((flowHooks.props as { nodes: Node<{ block: CanvasBlockData }>[] }).nodes[0]?.data.block).toMatchObject({
        text: '원래 제목',
      })
    })
  })

  it('상단바 블록 배경색 변경을 실행 취소한다', async () => {
    const view = render(<NoteCanvas noteId="color-history.canvas" title="색상 기록" />)

    const editor = view.container.querySelector('.canvas-text-editor')
    expect(editor).not.toBeNull()
    fireEvent.click(editor as Element)
    fireEvent.click(screen.getByRole('button', { name: '블록 배경색 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '블록 배경색 노랑' }))
    await waitFor(() => {
      expect((flowHooks.props as { nodes: Node<{ block: CanvasBlockData }>[] }).nodes[0]?.data.block.style.background).toBe('#fff2a8')
    })

    fireEvent.click(screen.getByRole('button', { name: '실행 취소' }))
    await waitFor(() => {
      expect((flowHooks.props as { nodes: Node<{ block: CanvasBlockData }>[] }).nodes[0]?.data.block.style.background).toBe('transparent')
    })
  })

  it('선택한 연결선 종류를 바꾸고 Delete와 클릭으로 삭제한다', async () => {
    const style = createDefaultTextBlockStyle()
    const onDocumentChange = vi.fn()
    render(<NoteCanvas
      noteId="edges.canvas"
      title="선"
      onDocumentChange={onDocumentChange}
      initialDocument={{
        version: 2,
        nodes: [
          { id: 'a', position: { x: 0, y: 0 }, data: { block: { kind: 'paragraph', width: 200, height: 80, style, text: 'a' } } },
          { id: 'b', position: { x: 240, y: 0 }, data: { block: { kind: 'paragraph', width: 200, height: 80, style, text: 'b' } } },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }}
    />)

    fireEvent.click(screen.getByRole('button', { name: '양방향 화살표' }))
    const props = flowHooks.props as { onConnect: (connection: Record<string, unknown>) => void }
    act(() => props.onConnect({ source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' }))
    await waitFor(() => {
      expect((flowHooks.props as { edges: Edge[] }).edges[0]).toMatchObject({
        data: { startMarker: 'arrow', endMarker: 'arrow' },
        markerStart: expect.any(Object),
        markerEnd: expect.any(Object),
      })
    })

    const edge = (flowHooks.props as { edges: Edge[] }).edges[0]!
    act(() => (flowHooks.props as { onEdgesChange: (changes: unknown[]) => void }).onEdgesChange([
      { type: 'select', id: edge.id, selected: true },
    ]))
    fireEvent.click(screen.getByRole('button', { name: '일반선' }))
    await waitFor(() => expect((flowHooks.props as { edges: Edge[] }).edges[0]?.data).toMatchObject({ startMarker: 'none', endMarker: 'none' }))
    fireEvent.keyDown(document, { key: 'Delete' })
    await waitFor(() => expect((flowHooks.props as { edges: Edge[] }).edges).toHaveLength(0))

    act(() => (flowHooks.props as { onConnect: (connection: Record<string, unknown>) => void }).onConnect({ source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' }))
    const clickedEdge = (flowHooks.props as { edges: Edge[] }).edges[0]!
    act(() => (flowHooks.props as { onEdgeClick: (event: MouseEvent, edge: Edge) => void }).onEdgeClick(new MouseEvent('click'), clickedEdge))
    await waitFor(() => expect((flowHooks.props as { edges: Edge[] }).edges).toHaveLength(0))
  })

  it('선택한 텍스트 블록에 굵게와 제목 단축키를 적용한다', async () => {
    const view = render(<NoteCanvas noteId="format-shortcut.canvas" title="서식 단축키" />)
    fireEvent.click(view.container.querySelector('.canvas-text-editor') as HTMLElement)
    await waitFor(() => {
      expect((flowHooks.props as { nodes: Node[] }).nodes[0]?.selected).toBe(true)
    })
    const editor = view.container.querySelector('.canvas-text-editor') as HTMLElement

    fireEvent.keyDown(editor, { key: 'b', ctrlKey: true })
    await waitFor(() => {
      expect((flowHooks.props as { nodes: Node<{ block: CanvasBlockData }>[] }).nodes[0]?.data.block.style.bold).toBe(false)
    })

    fireEvent.keyDown(editor, { key: '3', ctrlKey: true, altKey: true })
    await waitFor(() => {
      expect((flowHooks.props as { nodes: Node<{ block: CanvasBlockData }>[] }).nodes[0]?.data.block.style.level).toBe('h3')
    })
  })

  it('연결선 우클릭 메뉴에서 양 끝 표시를 독립 변경하고 삭제를 실행 취소한다', async () => {
    const style = createDefaultTextBlockStyle()
    render(<NoteCanvas
      noteId="edge-menu.canvas"
      title="선 메뉴"
      initialDocument={{
        version: 2,
        nodes: [
          { id: 'a', position: { x: 0, y: 0 }, data: { block: { kind: 'paragraph', width: 200, height: 80, style, text: 'a' } } },
          { id: 'b', position: { x: 240, y: 0 }, data: { block: { kind: 'paragraph', width: 200, height: 80, style, text: 'b' } } },
        ],
        edges: [{ id: 'edge-a-b', source: 'a', target: 'b', startMarker: 'none', endMarker: 'arrow' }],
        viewport: { x: 0, y: 0, zoom: 1 },
      }}
    />)

    const openEdgeMenu = () => {
      const props = flowHooks.props as {
        edges: Edge[]
        onEdgeContextMenu: (
          event: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number },
          edge: Edge,
        ) => void
      }
      act(() => props.onEdgeContextMenu(
        { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 320, clientY: 180 },
        props.edges[0]!,
      ))
    }

    openEdgeMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: '시작점 화살표' }))
    await waitFor(() => {
      expect((flowHooks.props as { edges: Edge[] }).edges[0]).toMatchObject({
        data: { startMarker: 'arrow', endMarker: 'arrow' },
      })
    })

    openEdgeMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: '연결선 삭제' }))
    await waitFor(() => expect((flowHooks.props as { edges: Edge[] }).edges).toHaveLength(0))

    fireEvent.click(screen.getByRole('button', { name: '실행 취소' }))
    await waitFor(() => {
      expect((flowHooks.props as { edges: Edge[] }).edges[0]).toMatchObject({
        id: 'edge-a-b',
        data: { startMarker: 'arrow', endMarker: 'arrow' },
      })
    })
  })

  it('빈 캔버스 메뉴에서 모든 블록을 선택한다', async () => {
    const style = createDefaultTextBlockStyle()
    const view = render(<NoteCanvas
      noteId="pane-menu.canvas"
      title="캔버스 메뉴"
      initialDocument={{
        version: 2,
        nodes: [
          { id: 'a', position: { x: 0, y: 0 }, data: { block: { kind: 'paragraph', width: 200, height: 80, style, text: 'a' } } },
          { id: 'b', position: { x: 240, y: 0 }, data: { block: { kind: 'paragraph', width: 200, height: 80, style, text: 'b' } } },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }}
    />)

    fireEvent.contextMenu(view.container.querySelector('.react-flow__pane') as Element, { clientX: 420, clientY: 260 })
    fireEvent.click(screen.getByRole('menuitem', { name: '모두 선택' }))

    await waitFor(() => {
      expect((flowHooks.props as { nodes: Node[] }).nodes.every(({ selected }) => selected)).toBe(true)
    })
  })

  it('Ctrl 을 누른 채 끌어 놓으면 원본은 제자리에 두고 놓은 자리에 복사본을 만든다', async () => {
    const onDocumentChange = vi.fn()
    render(<NoteCanvas noteId="ctrl-copy.canvas" title="복사" onDocumentChange={onDocumentChange} />)
    await waitFor(() => expect(onDocumentChange).toHaveBeenCalled())
    const props = flowHooks.props as {
      nodes: Node[]
      onNodeDragStart: (event: unknown, node: Node) => void
      onNodesChange: (changes: unknown[]) => void
      onNodeDragStop: (event: unknown, node: Node) => void
    }
    const title = props.nodes.find(({ id }) => id === 'note-title')!
    const origin = title.position
    act(() => {
      props.onNodeDragStart({}, title)
      props.onNodesChange([{ type: 'position', id: 'note-title', position: { x: origin.x + 200, y: origin.y + 100 }, dragging: true }])
    })
    const moved = (flowHooks.props as { nodes: Node[] }).nodes.find(({ id }) => id === 'note-title')!
    act(() => props.onNodeDragStop({ ctrlKey: true }, moved))
    await waitFor(() => {
      const nodes = (flowHooks.props as { nodes: Node[] }).nodes
      expect(nodes).toHaveLength(2)
      expect(nodes.find(({ id }) => id === 'note-title')?.position).toEqual(origin)
      const copy = nodes.find(({ id }) => id !== 'note-title')!
      expect(copy.id).toMatch(/^note-title-copy-/u)
      expect(copy.position).toEqual({ x: origin.x + 200, y: origin.y + 100 })
      expect(onDocumentChange.mock.calls.at(-1)?.[0].nodes).toHaveLength(2)
    })
  })

  it('왼쪽 테두리로 크기를 바꾸면 오른쪽 끝은 그대로이고 왼쪽 끝이 움직인다', async () => {
    const onDocumentChange = vi.fn()
    render(<NoteCanvas noteId="resize-left.canvas" title="크기" onDocumentChange={onDocumentChange} />)
    await waitFor(() => expect(onDocumentChange).toHaveBeenCalled())
    const before = (flowHooks.props as { nodes: Node[] }).nodes.find(({ id }) => id === 'note-title')!
    const right = before.position.x + 320
    act(() => {
      (flowHooks.props as { onNodesChange: (changes: unknown[]) => void }).onNodesChange([
        { type: 'position', id: 'note-title', position: { x: before.position.x - 100, y: before.position.y }, dragging: false },
        { type: 'dimensions', id: 'note-title', dimensions: { width: 420, height: 100 }, resizing: false, setAttributes: true },
      ])
    })
    await waitFor(() => {
      const after = (flowHooks.props as { nodes: Node[] }).nodes.find(({ id }) => id === 'note-title')!
      expect(after.position.x).toBe(before.position.x - 100)
      expect(after.position.x + (after.data.block as { width: number }).width).toBe(right)
    })
  })

  it('핸들 크기 변경이 실제 블록과 저장 문서에 반영되고 실행 취소된다', async () => {
    const onDocumentChange = vi.fn()
    const view = render(<NoteCanvas noteId="resize-sync.canvas" title="크기" onDocumentChange={onDocumentChange} />)
    await waitFor(() => expect(onDocumentChange).toHaveBeenCalled())
    onDocumentChange.mockClear()
    const resize = (resizing: boolean, width = 420, height = 220) => act(() => {
      (flowHooks.props as { onNodesChange: (changes: unknown[]) => void }).onNodesChange([{
        type: 'dimensions', id: 'note-title', dimensions: { width, height }, resizing, setAttributes: true,
      }])
    })

    for (let index = 0; index < 10; index += 1) resize(true, 330 + index * 10, 130 + index * 10)
    resize(false)
    await waitFor(() => {
      const shell = view.container.querySelector('.react-flow__node[data-id="note-title"] .canvas-block-shell') as HTMLElement
      expect(shell.style.width).toBe('420px')
      expect(shell.style.height).toBe('220px')
      expect(onDocumentChange.mock.calls.at(-1)?.[0].nodes[0].data.block).toMatchObject({ width: 420, height: 220, manualHeight: true })
    })
    expect(onDocumentChange.mock.calls.map(([document]) => ({
      width: document.nodes[0]?.data.block.width,
      height: document.nodes[0]?.data.block.height,
      manualHeight: document.nodes[0]?.data.block.manualHeight,
    }))).toEqual([{ width: 420, height: 220, manualHeight: true }])

    fireEvent.click(screen.getByRole('button', { name: '실행 취소' }))
    await waitFor(() => {
      const shell = view.container.querySelector('.react-flow__node[data-id="note-title"] .canvas-block-shell') as HTMLElement
      expect(shell.style.width).toBe('320px')
      expect(shell.style.height).toBe('100px')
    })
  })

  it('React Flow의 내부 치수 측정은 사용자 리사이즈로 저장하지 않는다', async () => {
    const onDocumentChange = vi.fn()
    render(<NoteCanvas noteId="measure-only.canvas" title="측정" onDocumentChange={onDocumentChange} />)
    await waitFor(() => expect(onDocumentChange).toHaveBeenCalled())
    onDocumentChange.mockClear()

    act(() => {
      (flowHooks.props as { onNodesChange: (changes: unknown[]) => void }).onNodesChange([{
        type: 'dimensions', id: 'note-title', dimensions: { width: 422, height: 222 }, setAttributes: true,
      }])
    })

    expect(onDocumentChange).not.toHaveBeenCalled()
    expect((flowHooks.props as { nodes: Node[] }).nodes[0]?.data.block).toMatchObject({ width: 320, height: 100 })
  })

  it('외부 이미지 파일을 놓으면 저장 가능한 이미지 블록을 만든다', async () => {
    imageImport.importImageFile.mockResolvedValue({ src: 'data:image/webp;base64,YWJj', width: 800, height: 400 })
    const onDocumentChange = vi.fn()
    const view = render(<NoteCanvas noteId="image-drop.canvas" title="이미지 노트" onDocumentChange={onDocumentChange} />)
    const file = new File(['image'], 'figure.png', { type: 'image/png' })
    const canvas = view.container.querySelector('.react-flow') as Element
    fireEvent.drop(canvas, {
      clientX: 520, clientY: 360,
      dataTransfer: { getData: () => '', files: [file] },
    })
    await waitFor(() => {
      expect(imageImport.importImageFile).toHaveBeenCalledWith(file)
      expect(onDocumentChange).toHaveBeenCalledWith(expect.objectContaining({
        nodes: expect.arrayContaining([expect.objectContaining({
          type: 'imageBlock',
          data: { block: expect.objectContaining({ kind: 'image', width: 520, height: 260, alt: 'figure.png' }) },
        })]),
      }))
    })
  })

  it('맞붙어 숨겨진 연결선도 블록 선택 후 연결 해제로 삭제한다', async () => {
    const style = createDefaultTextBlockStyle()
    render(<NoteCanvas
      noteId="joined-edges.canvas"
      title="붙은 블록"
      initialDocument={{
        version: 2,
        nodes: [
          { id: 'a', position: { x: 0, y: 0 }, data: { block: { kind: 'paragraph', width: 200, height: 80, style, text: 'a' } } },
          { id: 'b', position: { x: 200, y: 0 }, data: { block: { kind: 'paragraph', width: 200, height: 80, style, text: 'b' } } },
        ],
        edges: [{ id: 'joined', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' }],
        viewport: { x: 0, y: 0, zoom: 1 },
      }}
    />)

    expect((flowHooks.props as { edges: Edge[] }).edges[0]?.className).toContain('canvas-edge-joined')
    const firstNode = (flowHooks.props as { nodes: Node[] }).nodes.find(({ id }) => id === 'a')!
    act(() => (flowHooks.props as { onNodeContextMenu: (event: unknown, node: Node) => void }).onNodeContextMenu({ preventDefault: vi.fn(), clientX: 40, clientY: 50 }, firstNode))
    fireEvent.click(await screen.findByRole('menuitem', { name: '연결 해제' }))
    await waitFor(() => expect((flowHooks.props as { edges: Edge[] }).edges).toHaveLength(0))
    expect((flowHooks.props as { nodes: Node[] }).nodes).toHaveLength(2)
  })

  it('PDF 발췌 기본 크기는 드래그 payload의 화면 표시 크기를 그대로 사용한다', async () => {
    localStorage.setItem('iwae:canvas:match-pdf-text-size:v1', 'false')
    const onDocumentChange = vi.fn()
    const payload = {
      sourceTitle: 'Visible PDF',
      displaySize: { width: 356, height: 78 },
      selection: {
        mode: 'text' as const,
        anchor,
        pageSize: [612, 792] as const,
        crop: { x: 68, y: 622, w: 391.3, h: 34.3 },
        glyphs: [{ c: anchor.quote, x: 72, y: 626, w: 379.3, h: 26.3 }],
      },
    } as PdfExcerptDragPayload & { displaySize: { width: number; height: number } }
    render(<NoteCanvas noteId="visible-size.canvas" title="크기" insertRequest={{ id: 7, payload }} onDocumentChange={onDocumentChange} />)

    await waitFor(() => {
      const excerpt = onDocumentChange.mock.calls
        .map(([document]) => document.nodes.find((node: { id: string }) => node.id === 'pdf-excerpt-0'))
        .find(Boolean)
      expect(excerpt.data.block).toMatchObject({ width: 356, height: 78 })
    })
  })

  it('노트 옵션의 PDF 글자 크기 맞춤을 켜면 캔버스 배율에 맞춰 새 발췌 블록을 조정한다', async () => {
    localStorage.removeItem('iwae:canvas:match-pdf-text-size:v1')
    const payload = {
      sourceTitle: 'Text size source',
      displaySize: { width: 200, height: 40 },
      selection: {
        mode: 'text' as const,
        anchor,
        pageSize: [612, 792] as const,
        crop: { x: 0, y: 0, w: 200, h: 40 },
        glyphs: [{ c: 'A', x: 0, y: 0, w: 12, h: 20 }],
      },
    }
    const document = { version: 2 as const, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 0.5 } }
    const view = render(<NoteCanvas noteId="font-match.canvas" title="크기 맞춤" initialDocument={document} />)
    fireEvent.click(screen.getByRole('button', { name: '노트 옵션' }))
    const option = screen.getByRole('checkbox', { name: /PDF 글자 크기 맞춤/ }) as HTMLInputElement
    expect(option.checked).toBe(true)
    fireEvent.click(option)
    expect(localStorage.getItem('iwae:canvas:match-pdf-text-size:v1')).toBe('false')

    view.rerender(<NoteCanvas noteId="font-match.canvas" title="크기 맞춤" initialDocument={document} insertRequest={{ id: 1, payload }} />)
    await waitFor(() => expect((flowHooks.props as { nodes: Node<{ block: CanvasBlockData }>[] }).nodes.find(({ id }) => id === 'pdf-excerpt-0')?.data.block.width).toBe(200))

    fireEvent.click(option)
    view.rerender(<NoteCanvas noteId="font-match.canvas" title="크기 맞춤" initialDocument={document} insertRequest={{ id: 2, payload }} />)
    await waitFor(() => expect((flowHooks.props as { nodes: Node<{ block: CanvasBlockData }>[] }).nodes.find(({ id }) => id === 'pdf-excerpt-1')?.data.block.width).toBe(400))
    localStorage.removeItem('iwae:canvas:match-pdf-text-size:v1')
  })

})
