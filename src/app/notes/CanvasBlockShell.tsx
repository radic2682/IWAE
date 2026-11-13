import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react'
import { Handle, NodeResizer, Position, useUpdateNodeInternals } from '@xyflow/react'
import { DotsSixVertical, Trash } from '@phosphor-icons/react'
import type { Anchor } from '../../core/anchor'
import {
  CANVAS_MIN_HEIGHT,
  CANVAS_MIN_WIDTH,
  CANVAS_SHAPE_MIN_SIZE,
  isCanvasShapeKind,
  normalizeCanvasBlockSize,
  type CanvasBlockData,
} from '../../core/canvasDocument'
import type { SourceJumpRequest } from '../../core/pdfExcerpt'
import type { ExcerptHighlight, ExcerptHighlightColor } from '../../core/excerptHighlights'
import type { MarkdownExcerptSelection, MarkdownSourceJumpRequest } from '../../core/markdownExcerpt'
import { visibleCanvasPorts, type CanvasSide } from '../../core/canvasPorts'
import { createFrameScheduler } from '../../core/frameScheduler'
import { t } from '../../i18n'

export type SourceOpenRequest = SourceJumpRequest | MarkdownSourceJumpRequest
export type ActiveSourceTrace =
  | { readonly blockId: string; readonly anchor: Anchor }
  | { readonly blockId: string; readonly selection: MarkdownExcerptSelection }

export interface CanvasBlockRuntime {
  readonly onOpenSource?: (request: SourceOpenRequest) => void
  readonly onResizeFrame?: (blockId: string, width: number, height: number) => void
  readonly onResizeCommit?: (blockId: string, width: number, height: number, source?: 'manual' | 'content') => void
  readonly onTextCommit?: (blockId: string, text: string) => void
  readonly onSelectBlock?: (blockId: string) => void
  readonly onDeleteBlock?: (blockId: string) => void
  readonly onSourceTraceChange?: (active: ActiveSourceTrace | null) => void
  /** 형광펜 도구가 켜져 있으면 그 색. 켜져 있으면 발췌 위를 끌어 칠한다 */
  readonly highlightTool?: ExcerptHighlightColor | null
  readonly onAddHighlight?: (blockId: string, highlight: ExcerptHighlight) => void
  readonly onSetHighlightColor?: (blockId: string, highlightId: string, color: ExcerptHighlightColor) => void
  readonly onDeleteHighlight?: (blockId: string, highlightId: string) => void
  /** 형광펜 옆에 메모를 만들고 선으로 잇는다 */
  readonly onWriteHighlightNote?: (blockId: string, highlightId: string) => void
  /** 막 만든 메모 블록: 만들어지자마자 글쓰기 상태로 연다 */
  readonly autoEditBlockId?: string | null
  readonly onAutoEditStarted?: (blockId: string) => void
}

const CanvasBlockRuntimeContext = createContext<CanvasBlockRuntime>({})

export function CanvasBlockRuntimeProvider({ value, children }: { value: CanvasBlockRuntime; children: ReactNode }) {
  return <CanvasBlockRuntimeContext.Provider value={value}>{children}</CanvasBlockRuntimeContext.Provider>
}

export function useCanvasBlockRuntime(): CanvasBlockRuntime {
  return useContext(CanvasBlockRuntimeContext)
}

function portStyle(side: 'top' | 'right' | 'bottom' | 'left'): CSSProperties {
  if (side === 'top') return { top: '-7px', left: '50%' }
  if (side === 'right') return { right: '-7px', top: '50%' }
  if (side === 'bottom') return { bottom: '-7px', left: '50%' }
  return { left: '-7px', top: '50%' }
}

export interface CanvasBlockShellProps {
  readonly id: string
  readonly block: CanvasBlockData
  readonly selected: boolean
  readonly children: ReactNode
  readonly sourceFooter?: ReactNode
  /** 본문 위에 겹쳐 그리는 층(잘리지 않는다). 발췌 형광펜이 여기 들어간다 */
  readonly overlay?: ReactNode
  readonly touchingSides?: ReadonlySet<CanvasSide>
  readonly onResizeFrame?: (blockId: string, width: number, height: number) => void
  readonly onResizeCommit?: (blockId: string, width: number, height: number, source?: 'manual' | 'content') => void
  readonly onDelete?: (blockId: string) => void
}

export function CanvasBlockShell({
  id,
  block,
  selected,
  children,
  sourceFooter,
  overlay,
  touchingSides = new Set<CanvasSide>(),
  onResizeFrame,
  onResizeCommit,
  onDelete,
}: CanvasBlockShellProps) {
  const frameRef = useRef<number | null>(null)
  const pendingRef = useRef<{ width: number; height: number } | null>(null)
  const manualResizeRef = useRef(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [settling, setSettling] = useState(false)
  const updateNodeInternals = useUpdateNodeInternals()
  const resizeRuntimeRef = useRef({ block, id, onResizeFrame, onResizeCommit, updateNodeInternals })
  resizeRuntimeRef.current = { block, id, onResizeFrame, onResizeCommit, updateNodeInternals }
  const affordancesVisible = selected || hovered || focused
  const drawing = block.kind === 'rectangle' || block.kind === 'square' || block.kind === 'ellipse' || block.kind === 'diamond'
  const visualCapture = block.kind === 'pdfExcerpt'
    || block.kind === 'image'
    || block.kind === 'markdownExcerpt' && block.capture !== undefined
  const immutableContent = block.kind === 'pdfExcerpt'
    || block.kind === 'image'
    || block.kind === 'markdownExcerpt'

  useEffect(() => {
    if (!hovered) return
    const trackPointer = (event: PointerEvent) => {
      const bounds = shellRef.current?.getBoundingClientRect()
      if (bounds === undefined) return
      const margin = 24
      if (event.clientX < bounds.left - margin || event.clientX > bounds.right + margin
        || event.clientY < bounds.top - margin || event.clientY > bounds.bottom + margin) {
        setHovered(false)
      }
    }
    document.addEventListener('pointermove', trackPointer)
    return () => document.removeEventListener('pointermove', trackPointer)
  }, [hovered])

  useEffect(() => {
    updateNodeInternals(id)
    window.dispatchEvent(new Event('iwae:canvas-geometry'))
  }, [block.height, block.width, id, updateNodeInternals])

  useLayoutEffect(() => {
    const body = bodyRef.current
    if (body === null || onResizeCommit === undefined) return
    const measure = () => {
      if (manualResizeRef.current) return
      const content = body.querySelector<HTMLElement>('[data-canvas-auto-grow="true"]')
      if (content === null) return
      const next = normalizeCanvasBlockSize(block, block, content.scrollHeight)
      const height = block.manualHeight === true ? Math.max(block.height, next.height) : next.height
      if (height !== block.height) {
        onResizeCommit(id, next.width, height, 'content')
      }
    }
    const scheduler = createFrameScheduler(measure)
    scheduler.schedule()
    if (typeof ResizeObserver === 'undefined') return () => scheduler.cancel()
    const observer = new ResizeObserver(() => scheduler.schedule())
    observer.observe(body)
    const content = body.querySelector<HTMLElement>('[data-canvas-auto-grow="true"]')
    if (content !== null) observer.observe(content)
    return () => {
      observer.disconnect()
      scheduler.cancel()
    }
  }, [block, id, onResizeCommit])

  useEffect(() => () => {
    if (frameRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameRef.current)
    }
  }, [])

  useEffect(() => {
    if (!settling) return
    const timeout = window.setTimeout(() => setSettling(false), 180)
    return () => window.clearTimeout(timeout)
  }, [settling])

  const scheduleFrame = useCallback((_: unknown, params: { width: number; height: number }) => {
    const { block, id, onResizeFrame, updateNodeInternals } = resizeRuntimeRef.current
    const normalized = normalizeCanvasBlockSize(block, params)
    pendingRef.current = normalized
    if (frameRef.current !== null) return
    if (typeof requestAnimationFrame !== 'function') {
      pendingRef.current = null
      onResizeFrame?.(id, normalized.width, normalized.height)
      updateNodeInternals(id)
      window.dispatchEvent(new Event('iwae:canvas-geometry'))
      return
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const pending = pendingRef.current
      pendingRef.current = null
      if (pending !== null) {
        const runtime = resizeRuntimeRef.current
        runtime.onResizeFrame?.(runtime.id, pending.width, pending.height)
        runtime.updateNodeInternals(runtime.id)
        window.dispatchEvent(new Event('iwae:canvas-geometry'))
      }
    })
  }, [])

  const finishResize = useCallback((_: unknown, params: { width: number; height: number }) => {
    const { block, id, onResizeCommit, updateNodeInternals } = resizeRuntimeRef.current
    const normalized = normalizeCanvasBlockSize(block, params)
    pendingRef.current = null
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    manualResizeRef.current = false
    // 도형은 격자에 맞추지 않으니 '붙는' 움직임도 없다
    if (!isCanvasShapeKind(block.kind)) setSettling(true)
    onResizeCommit?.(id, normalized.width, normalized.height)
    updateNodeInternals(id)
    window.dispatchEvent(new Event('iwae:canvas-geometry'))
  }, [])
  const startResize = useCallback(() => {
    manualResizeRef.current = true
  }, [])

  return (
    <div
      ref={shellRef}
      className={[
        'canvas-block-shell',
        `canvas-block-${block.kind}`,
        drawing ? 'canvas-drawing-overlay' : '',
        affordancesVisible ? 'canvas-block-affordances-visible' : '',
        settling ? 'canvas-block-snap-settle' : '',
      ].filter(Boolean).join(' ')}
      style={{
        width: `${block.width}px`,
        height: `${block.height}px`,
        minWidth: visualCapture || drawing ? '0px' : `${CANVAS_MIN_WIDTH}px`,
        minHeight: visualCapture || drawing ? '0px' : `${CANVAS_MIN_HEIGHT}px`,
        overflow: 'visible',
        backgroundColor: block.style.background,
      }}
      tabIndex={0}
      data-source-trace-side="left"
      data-canvas-block-id={id}
      data-snap-settling={settling ? 'true' : 'false'}
      onMouseEnter={() => setHovered(true)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
      }}
      onAnimationEnd={() => setSettling(false)}
    >
      <NodeResizer
        minWidth={visualCapture ? 1 : drawing ? CANVAS_SHAPE_MIN_SIZE : CANVAS_MIN_WIDTH}
        minHeight={visualCapture || block.kind === 'markdownExcerpt' ? 1 : drawing ? CANVAS_SHAPE_MIN_SIZE : CANVAS_MIN_HEIGHT}
        isVisible={selected}
        keepAspectRatio={visualCapture || block.kind === 'square'}
        handleClassName="canvas-block-resize-handle"
        lineClassName="canvas-block-resize-line"
        onResizeStart={startResize}
        onResize={scheduleFrame}
        onResizeEnd={finishResize}
      />
      {!drawing && visibleCanvasPorts({ id }, touchingSides, selected).map((side) => {
        const position = {
          top: Position.Top,
          right: Position.Right,
          bottom: Position.Bottom,
          left: Position.Left,
        }[side]
        return (
          <Handle
            key={side}
            id={side}
            type="source"
            position={position}
            style={portStyle(side)}
            className={[
              'canvas-block-port',
              'canvas-block-port-external',
              `canvas-block-port-${side}`,
              selected ? 'canvas-block-port-visible' : '',
            ].join(' ')}
          />
        )
      })}
      {drawing ? (
        // 도형 안쪽은 아래 블록을 누를 수 있게 비워 두고, 테두리 둘레만 마우스를 받는다(올리면 핸들이 보이고, 잡고 끌 수 있다)
        (['top', 'right', 'bottom', 'left'] as const).map((edge) => (
          <span key={edge} className={`canvas-shape-edge canvas-shape-edge-${edge} drag-handle`} aria-hidden="true" />
        ))
      ) : null}
      <button
        type="button"
        className="canvas-block-drag-handle canvas-block-hover-affordance drag-handle"
        aria-label={drawing ? t('도형 이동') : t('블록 이동')}
        hidden={!affordancesVisible}
      >
        <DotsSixVertical size={18} weight="bold" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="canvas-block-delete canvas-block-hover-affordance nodrag"
        aria-label={drawing ? t('도형 삭제') : t('블록 삭제')}
        hidden={!affordancesVisible}
        onClick={() => onDelete?.(id)}
      >
        <Trash size={15} aria-hidden="true" />
      </button>
      <div
        ref={bodyRef}
        className={`canvas-block-body${immutableContent ? ' canvas-block-visual-body drag-handle' : ''}`}
        style={{
          overflow: immutableContent ? 'hidden' : 'visible',
          userSelect: immutableContent ? 'none' : undefined,
        }}
      >
        {children}
      </div>
      {overlay}
      {sourceFooter === undefined ? null : (
        <div
          className="canvas-block-source-footer canvas-block-hover-affordance"
          data-ref-footer="true"
          hidden={!affordancesVisible}
          style={{ left: 0, right: 0, bottom: 0 }}
        >
          {sourceFooter}
        </div>
      )}
    </div>
  )
}
