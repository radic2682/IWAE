import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Handle, Position, useUpdateNodeInternals, useViewport, type Node, type NodeProps } from '@xyflow/react'
import { NotePencil, Trash } from '@phosphor-icons/react'
import { pageImageUrl } from '../../bridge/pdf'
import type { PdfExcerptCanvasBlock } from '../../core/canvasDocument'
import { useHighlightColors } from './highlightColorStyle'
import { highlightColorLabel } from '../../core/highlightColors'
import { createSourceJumpRequest, type PdfExcerptCrop } from '../../core/pdfExcerpt'
import {
  highlightBounds,
  highlightHandleId,
  highlightRectsFromDrag,
  type ExcerptHighlight,
} from '../../core/excerptHighlights'
import {
  CanvasBlockRuntimeProvider,
  CanvasBlockShell,
  useCanvasBlockRuntime,
  type ActiveSourceTrace,
} from '../notes/CanvasBlockShell'
import type { TextBlockFlowNode } from '../notes/TextBlockNode'
import type { TranslationBlockFlowNode } from '../notes/TranslationBlockNode'
import type { MarkdownExcerptFlowNode } from './MarkdownExcerptNode'
import type { CanvasSide } from '../../core/canvasPorts'
import { t } from '../../i18n'

export interface PdfExcerptNodeData extends Record<string, unknown> {
  readonly block: PdfExcerptCanvasBlock
  readonly touchingSides?: ReadonlySet<CanvasSide>
  /** 선이 이어진 형광펜 id (선 시작점을 항상 보이게) */
  readonly linkedHighlights?: ReadonlySet<string>
}

export type PdfExcerptFlowNode = Node<PdfExcerptNodeData, 'pdfExcerpt'>
export type CanvasNode = TextBlockFlowNode | PdfExcerptFlowNode | MarkdownExcerptFlowNode | TranslationBlockFlowNode
export type { ActiveSourceTrace }

export const PdfExcerptRuntimeProvider = CanvasBlockRuntimeProvider

const NO_LINKS: ReadonlySet<string> = new Set()

function percentBox(rect: PdfExcerptCrop, crop: PdfExcerptCrop): CSSProperties {
  return {
    left: `${((rect.x - crop.x) / crop.w) * 100}%`,
    top: `${((rect.y - crop.y) / crop.h) * 100}%`,
    width: `${(rect.w / crop.w) * 100}%`,
    height: `${(rect.h / crop.h) * 100}%`,
  }
}

let highlightSequence = 0
function newHighlightId(): string {
  highlightSequence += 1
  return `h${Date.now().toString(36)}${highlightSequence.toString(36)}`
}

/**
 * 발췌 위 형광펜 층. 형광펜 도구가 켜져 있으면 끌어서 칠하고(글자가 있으면 줄마다 글자에 맞춘다),
 * 꺼져 있으면 칠한 곳을 눌러 메모 쓰기·색 바꾸기·지우기를 한다. 칠한 곳 양옆의 점에서 메모로 선이 나간다.
 */
function ExcerptHighlightLayer({ id, highlights, crop, glyphs, selected, linked }: {
  readonly id: string
  readonly highlights: readonly ExcerptHighlight[]
  readonly crop: PdfExcerptCrop
  readonly glyphs: PdfExcerptCanvasBlock['excerpt']['selection']['glyphs']
  readonly selected: boolean
  readonly linked: ReadonlySet<string>
}) {
  const runtime = useCanvasBlockRuntime()
  const colors = useHighlightColors()
  const layerRef = useRef<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const tool = runtime.highlightTool ?? null
  const updateNodeInternals = useUpdateNodeInternals()
  const { zoom } = useViewport()

  useEffect(() => {
    updateNodeInternals(id)
  }, [highlights, id, updateNodeInternals])

  useEffect(() => {
    if (!selected) setActiveId(null)
  }, [selected])

  useEffect(() => {
    if (activeId === null) return
    const close = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest(`[data-highlight-menu="${id}"], [data-highlight-owner="${id}"] .excerpt-highlight`) == null) setActiveId(null)
    }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [activeId, id])

  const toPdf = (clientX: number, clientY: number) => {
    const bounds = layerRef.current?.getBoundingClientRect()
    if (bounds === undefined || bounds.width === 0 || bounds.height === 0) return null
    return {
      x: crop.x + ((clientX - bounds.left) / bounds.width) * crop.w,
      y: crop.y + ((clientY - bounds.top) / bounds.height) * crop.h,
    }
  }

  const startDraw = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool === null || event.button !== 0) return
    const point = toPdf(event.clientX, event.clientY)
    if (point === null) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDraft({ x1: point.x, y1: point.y, x2: point.x, y2: point.y })
  }
  const moveDraw = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draft === null) return
    const point = toPdf(event.clientX, event.clientY)
    if (point !== null) setDraft({ ...draft, x2: point.x, y2: point.y })
  }
  const finishDraw = () => {
    if (draft === null || tool === null) return
    setDraft(null)
    const drag = {
      x: Math.min(draft.x1, draft.x2),
      y: Math.min(draft.y1, draft.y2),
      w: Math.abs(draft.x2 - draft.x1),
      h: Math.abs(draft.y2 - draft.y1),
    }
    // 끌지 않고 누르기만 했으면 칠하지 않는다
    if (drag.w < 1.5 && drag.h < 1.5) return
    const rects = highlightRectsFromDrag({ crop, glyphs }, drag)
    if (rects.length === 0) return
    const highlight: ExcerptHighlight = { id: newHighlightId(), color: tool, rects }
    runtime.onAddHighlight?.(id, highlight)
  }

  const active = highlights.find((highlight) => highlight.id === activeId)
  const activeBounds = active === undefined ? null : highlightBounds(active)

  return (
    <div
      ref={layerRef}
      className={`excerpt-highlight-layer${tool === null ? '' : ' excerpt-highlight-layer-drawing nodrag'}`}
      data-highlight-owner={id}
      onPointerDown={startDraw}
      onPointerMove={moveDraw}
      onPointerUp={finishDraw}
      onPointerCancel={() => setDraft(null)}
    >
      {highlights.map((highlight) => {
        const bounds = highlightBounds(highlight)
        const middle = `${((bounds.y + bounds.h / 2 - crop.y) / crop.h) * 100}%`
        const portClass = [
          'excerpt-highlight-port',
          linked.has(highlight.id) ? 'excerpt-highlight-port-linked' : '',
          'nodrag',
        ].filter(Boolean).join(' ')
        return (
          <div key={highlight.id} className="excerpt-highlight-group" data-highlight-id={highlight.id} data-hl={highlight.color}>
            {highlight.rects.map((rect, index) => (
              <div
                key={index}
                className={[
                  'excerpt-highlight',
                  highlight.id === activeId ? 'excerpt-highlight-active' : '',
                  tool === null ? 'nodrag' : '',
                ].filter(Boolean).join(' ')}
                style={percentBox(rect, crop)}
                role="button"
                aria-label={t('형광펜, 눌러서 메모 쓰기')}
                onPointerDown={(event) => {
                  if (tool === null) event.stopPropagation()
                }}
                onClick={(event) => {
                  if (tool !== null) return
                  event.stopPropagation()
                  // 메모 카드의 「원문 더하기」 중이면 이 형광펜을 그 메모에 잇는다
                  if (runtime.attachingMemoId != null) {
                    runtime.onAttachHighlight?.(id, highlight.id)
                    return
                  }
                  runtime.onSelectBlock?.(id)
                  setActiveId(highlight.id)
                }}
                onDoubleClick={(event) => {
                  if (tool !== null || runtime.attachingMemoId != null) return
                  event.stopPropagation()
                  setActiveId(null)
                  runtime.onWriteHighlightNote?.(id, highlight.id)
                }}
              />
            ))}
            <Handle
              id={highlightHandleId(highlight.id, 'right')}
              type="source"
              position={Position.Right}
              className={portClass}
              style={{ left: `${((bounds.x + bounds.w - crop.x) / crop.w) * 100}%`, top: middle, right: 'auto' }}
            />
            <Handle
              id={highlightHandleId(highlight.id, 'left')}
              type="source"
              position={Position.Left}
              className={portClass}
              style={{ left: `${((bounds.x - crop.x) / crop.w) * 100}%`, top: middle, right: 'auto' }}
            />
          </div>
        )
      })}
      {draft === null || tool === null ? null : (
        <div
          className="excerpt-highlight excerpt-highlight-draft"
          data-hl={tool}
          style={percentBox({
            x: Math.min(draft.x1, draft.x2),
            y: Math.min(draft.y1, draft.y2),
            w: Math.max(Math.abs(draft.x2 - draft.x1), 0.1),
            h: Math.max(Math.abs(draft.y2 - draft.y1), 0.1),
          }, crop)}
        />
      )}
      {active === undefined || activeBounds === null || tool !== null ? null : (
        <div
          className="excerpt-highlight-menu nodrag"
          data-highlight-menu={id}
          role="toolbar"
          aria-label={t('형광펜')}
          style={{
            left: `${((activeBounds.x - crop.x) / crop.w) * 100}%`,
            top: `${((activeBounds.y - crop.y) / crop.h) * 100}%`,
            // 캔버스를 줄여 봐도 메뉴는 늘 같은 크기로
            transform: `translateY(-100%) scale(${1 / (zoom > 0 ? zoom : 1)}) translateY(-6px)`,
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="excerpt-highlight-menu-note"
            onClick={() => {
              setActiveId(null)
              runtime.onWriteHighlightNote?.(id, active.id)
            }}
          >
            <NotePencil size={14} aria-hidden="true" />
            <span>{t('메모')}</span>
          </button>
          <span className="excerpt-highlight-menu-divider" aria-hidden="true" />
          {colors.map(({ id: color }) => (
            <button
              key={color}
              type="button"
              data-hl={color}
              className="excerpt-highlight-swatch"
              aria-label={t('{color} 형광펜', { color: highlightColorLabel(colors, color) })}
              aria-pressed={active.color === color}
              onClick={() => runtime.onSetHighlightColor?.(id, active.id, color)}
            />
          ))}
          <span className="excerpt-highlight-menu-divider" aria-hidden="true" />
          <button
            type="button"
            aria-label={t('형광펜 지우기')}
            onClick={() => {
              setActiveId(null)
              runtime.onDeleteHighlight?.(id, active.id)
            }}
          >
            <Trash size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}

export function PdfExcerptNode({ id, data, selected }: NodeProps<PdfExcerptFlowNode>) {
  const runtime = useCanvasBlockRuntime()
  const block = data.block
  const excerpt = block.excerpt
  const { crop, pageSize, anchor } = excerpt.selection
  const scale = block.width / crop.w
  const imageStyle: CSSProperties = {
    width: `${pageSize[0] * scale}px`,
    height: `${pageSize[1] * scale}px`,
    transform: `translate(${-crop.x * scale}px, ${-crop.y * scale}px)`,
  }
  const trace = { blockId: id, anchor }

  useEffect(() => {
    if (selected) runtime.onSourceTraceChange?.(trace)
  }, [anchor, id, runtime, selected])

  const sourceFooter = (
    <button
      type="button"
      className="pdf-excerpt-source nodrag"
      aria-label={t('{title} {page}쪽 출처 열기', { title: excerpt.sourceTitle, page: anchor.page + 1 })}
      data-excerpt-source={id}
      data-source-trace-side="left"
      onClick={() => runtime.onOpenSource?.(createSourceJumpRequest(excerpt))}
    >
      <span>REF</span>
      <span>{excerpt.sourceTitle}</span>
      <span>p.{anchor.page + 1}</span>
    </button>
  )

  return (
    <div
      className="pdf-excerpt-node drag-handle"
      role="group"
      aria-label={t('PDF 발췌: {quote}', { quote: anchor.quote })}
      data-excerpt-node={id}
    >
      <CanvasBlockShell
        id={id}
        block={block}
        selected={selected}
        touchingSides={data.touchingSides}
        sourceFooter={sourceFooter}
        overlay={(
          <ExcerptHighlightLayer
            id={id}
            highlights={block.highlights ?? []}
            crop={crop}
            glyphs={excerpt.selection.glyphs}
            selected={selected}
            linked={data.linkedHighlights ?? NO_LINKS}
          />
        )}
        onResizeFrame={runtime.onResizeFrame}
        onResizeCommit={runtime.onResizeCommit}
        onDelete={runtime.onDeleteBlock}
      >
        <div className="pdf-excerpt-node-body" style={{ overflow: 'hidden' }}>
          <div
            className="pdf-excerpt-visual"
            data-source-width={crop.w}
            data-source-height={crop.h}
            style={{ aspectRatio: `${crop.w} / ${crop.h}`, width: '100%', height: 'auto' }}
          >
            <img
              src={pageImageUrl(anchor.docId, anchor.page, Math.max(Math.round(pageSize[0] * 2), 1200))}
              alt={t('{title} {page}쪽 발췌 원문', { title: excerpt.sourceTitle, page: anchor.page + 1 })}
              draggable={false}
              style={imageStyle}
            />
            {anchor.quote === '' ? null : (
              <div
                className="pdf-excerpt-text-layer drag-handle"
                aria-label={t('발췌 텍스트')}
                aria-hidden="true"
                style={{ cursor: 'grab', userSelect: 'none' }}
              >
                {anchor.quote}
              </div>
            )}
          </div>
        </div>
      </CanvasBlockShell>
    </div>
  )
}

export const pdfExcerptNodeTypes = { pdfExcerpt: PdfExcerptNode }
