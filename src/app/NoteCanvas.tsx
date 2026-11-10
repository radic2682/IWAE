import { rangeFillStyle } from '../ui/rangeFill'
import { INTERNAL_DROP_EVENT, type InternalDropDetail } from '../core/internalDrag'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import {
  Background,
  BaseEdge,
  ConnectionMode,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  addEdge,
  getBezierPath,
  useEdgesState,
  useNodesState,
  useOnViewportChange,
  useReactFlow,
  useUpdateNodeInternals,
  useViewport,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type Viewport,
} from '@xyflow/react'
import { CornersOut, Minus, Plus } from '@phosphor-icons/react'
import '@xyflow/react/dist/style.css'
import { announceAction } from './actionFeedback'
import { importImageFile } from './imageImport'
import '../ui/canvas-followup.css'
import {
  createPdfExcerptBlock,
  createSourceJumpRequest,
  parsePdfExcerptDrag,
  PDF_EXCERPT_DRAG_MIME,
  sizePdfExcerptToSelectedText,
  type PdfExcerptDragPayload,
} from '../core/pdfExcerpt'
import {
  createMarkdownSourceJumpRequest,
  MARKDOWN_EXCERPT_DRAG_MIME,
  parseMarkdownExcerptDrag,
  type MarkdownExcerptDragPayload,
  type MarkdownExcerptFormat,
} from '../core/markdownExcerpt'
import {
  CANVAS_GRID_SIZE,
  CANVAS_MIN_WIDTH,
  CANVAS_VERTICAL_GRID_SIZE,
  applyCanvasBlockCommand,
  createDefaultTextBlockStyle,
  normalizeCanvasBlockSize,
  normalizeCanvasNodePosition,
  isCanvasShapeKind,
  normalizeCanvasPosition,
  textBlockLevelFontSize,
  type CanvasBlockData,
  type CanvasBlockPreset,
  type CanvasDocumentV2,
  type CanvasEdgeMarker,
  PersistedCanvasEdge,
  PersistedCanvasNode,
  type ShapeCanvasBlock,
  type ImageCanvasBlock,
} from '../core/canvasDocument'
import { createInitialCanvasDocument } from '../core/initialCanvasDocument'
import { serializeCanvasDoc } from '../core/canvasSerialize'
import { executeCanvasCommand } from '../core/canvasCommands'
import { applyBlockFormat, type BlockFormatCommand } from '../core/blockFormatting'
import {
  pdfExcerptNodeTypes,
  type CanvasNode,
  type PdfExcerptFlowNode,
} from './PdfExcerptNode'
import {
  CanvasBlockRuntimeProvider,
  CanvasBlockShell,
  useCanvasBlockRuntime,
  type ActiveSourceTrace,
  type SourceOpenRequest,
} from './CanvasBlockShell'
import { markdownExcerptNodeTypes, type MarkdownExcerptFlowNode } from './MarkdownExcerptNode'
import { textBlockNodeTypes, type TextBlockFlowNode } from './TextBlockNode'
import { translationBlockNodeTypes, type TranslationBlockFlowNode } from './TranslationBlockNode'
import { BlockContextMenu, type BlockMenuAction } from './BlockContextMenu'
import { NoteToolbar } from './NoteToolbar'
import { useAppShortcuts } from './useAppShortcuts'
import type { CanvasSaveStatus } from './useCanvasAutosave'
import type { WorkspaceSourceState } from './useWorkspaceSources'
import { deriveCanvasNodeState } from './canvasDerivations'
import { isPresettableCanvasBlock, type UserBlockPreset } from '../core/blockPresets'
import { nearestVacantCanvasPoint } from '../core/canvasGeometry'
import {
  beginCanvasInteraction,
  cancelCanvasInteraction,
  updateCanvasInteraction,
  type CanvasInteractionState,
} from '../core/canvasInteraction'
import { scheduleNodeInternalsUpdate, type CanvasSide } from '../core/canvasPorts'
import { t } from '../i18n'
import { defaultHighlightColorId, highlightColorLabel, highlightInkOf, knownHighlightColorId } from '../core/highlightColors'
import { useHighlightColors } from './highlightColorStyle'
import {
  highlightBounds,
  highlightHandleId,
  highlightIdFromHandle,
  type ExcerptHighlight,
  type ExcerptHighlightColor,
} from '../core/excerptHighlights'

interface PresetBlockNodeData extends Record<string, unknown> {
  readonly block: ShapeCanvasBlock
  readonly touchingSides?: ReadonlySet<CanvasSide>
}

type PresetBlockFlowNode = Node<PresetBlockNodeData, 'presetBlock'>
type ImageBlockFlowNode = Node<{ block: ImageCanvasBlock; touchingSides?: ReadonlySet<CanvasSide> }, 'imageBlock'>
type NoteCanvasNode = CanvasNode | PresetBlockFlowNode | ImageBlockFlowNode

interface CanvasEdgeData extends Record<string, unknown> {
  readonly startMarker: CanvasEdgeMarker
  readonly endMarker: CanvasEdgeMarker
}

type NoteCanvasEdge = Edge<CanvasEdgeData>

function DisconnectableCanvasEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  markerStart, markerEnd, style, interactionWidth,
}: EdgeProps<NoteCanvasEdge>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const distance = Math.hypot(targetX - sourceX, targetY - sourceY) || 1
  const breakStyle = {
    '--edge-break-x': `${((targetX - sourceX) / distance) * 5}px`,
    '--edge-break-y': `${((targetY - sourceY) / distance) * 5}px`,
  } as CSSProperties
  return <>
    <BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />
    <path d={path} pathLength={100} className="canvas-edge-break canvas-edge-break-start" style={breakStyle} />
    <path d={path} pathLength={100} className="canvas-edge-break canvas-edge-break-end" style={breakStyle} />
  </>
}

const canvasEdgeTypes = { default: DisconnectableCanvasEdge }
const MATCH_PDF_TEXT_SIZE_KEY = 'iwae:canvas:match-pdf-text-size:v1'

function readMatchPdfTextSize(): boolean {
  try {
    return window.localStorage.getItem(MATCH_PDF_TEXT_SIZE_KEY) !== 'false'
  } catch {
    return true
  }
}

function PresetBlockNode({ id, data, selected }: NodeProps<PresetBlockFlowNode>) {
  const runtime = useCanvasBlockRuntime()
  const { block } = data
  return (
    <CanvasBlockShell
      id={id}
      block={block}
      selected={selected}
      touchingSides={data.touchingSides}
      onResizeFrame={runtime.onResizeFrame}
      onResizeCommit={runtime.onResizeCommit}
      onDelete={runtime.onDeleteBlock}
    >
      <div className={`canvas-shape canvas-shape-${block.kind}`} aria-label={t('{kind} 도형', { kind: block.kind })} />
    </CanvasBlockShell>
  )
}

function isShapeBlock(block: CanvasBlockData): block is ShapeCanvasBlock {
  return block.kind === 'rectangle'
    || block.kind === 'square'
    || block.kind === 'ellipse'
    || block.kind === 'diamond'
}

function ImageBlockNode({ id, data, selected }: NodeProps<ImageBlockFlowNode>) {
  const runtime = useCanvasBlockRuntime()
  return (
    <CanvasBlockShell id={id} block={data.block} selected={selected} touchingSides={data.touchingSides}
      onResizeFrame={runtime.onResizeFrame} onResizeCommit={runtime.onResizeCommit} onDelete={runtime.onDeleteBlock}>
      <img className="canvas-image-content" src={data.block.src} alt={data.block.alt} draggable={false} />
    </CanvasBlockShell>
  )
}

const canvasNodeTypes = {
  ...textBlockNodeTypes,
  ...pdfExcerptNodeTypes,
  ...markdownExcerptNodeTypes,
  ...translationBlockNodeTypes,
  presetBlock: PresetBlockNode,
  imageBlock: ImageBlockNode,
}

interface NoteCanvasProps {
  noteId: string
  title: string
  onOpenSource?: (request: SourceOpenRequest) => void
  onSourceTraceChange?: (active: ActiveSourceTrace | null) => void
  onSourceStateChange?: (state: WorkspaceSourceState) => void
  initialDocument?: CanvasDocumentV2
  onDocumentChange?: (document: CanvasDocumentV2) => void
  saveStatus?: CanvasSaveStatus
  saveError?: string | null
  onToggleFullscreen?: () => void
  onExportWithEvidence?: (document: CanvasDocumentV2) => void
  insertRequest?: ReaderExcerptInsertRequest
  onTranslateText?: (text: string) => Promise<CanvasTranslationResult | null>
  userPresets?: readonly UserBlockPreset[]
  onSaveUserPreset?: (block: CanvasBlockData) => void
}

export interface CanvasTranslationResult {
  readonly text: string
  readonly targetLanguage: string
  readonly model: string
}

export interface PdfExcerptInsertRequest {
  readonly id: number
  readonly targetNoteId?: string
  readonly payload: PdfExcerptDragPayload
  readonly translation?: {
    readonly text: string
    readonly targetLanguage: string
    readonly model: string
  }
}

export { createInitialCanvasDocument } from '../core/initialCanvasDocument'

function excerptGeometry(payload: PdfExcerptDragPayload, position: { x: number; y: number }, matchedSize: { width: number; height: number } | null = null) {
  const { crop } = payload.selection
  const displaySize = payload.displaySize
  const width = matchedSize?.width ?? (displaySize !== undefined && Number.isFinite(displaySize.width) && displaySize.width > 0
    ? displaySize.width
    : crop.w)
  const height = matchedSize?.height ?? (displaySize !== undefined && Number.isFinite(displaySize.height) && displaySize.height > 0
    ? displaySize.height
    : width * (crop.h / crop.w))
  const size = { width, height }
  const snappedPosition = normalizeCanvasPosition({
    x: position.x - size.width / 2,
    y: position.y - Math.min(size.height / 2, 48),
  })
  return {
    x: snappedPosition.x,
    y: snappedPosition.y,
    width: size.width,
    height: size.height,
  }
}

function markdownExcerptGeometry(
  payload: MarkdownExcerptDragPayload,
  position: { x: number; y: number },
) {
  const requestedWidth = payload.displaySize?.width ?? 280
  const requestedHeight = payload.displaySize?.height ?? 64
  const block = {
    kind: 'markdownExcerpt' as const,
    width: requestedWidth,
    height: requestedHeight,
    style: createDefaultTextBlockStyle(),
    selection: payload.selection,
    source: { relation: 'markdown-excerpt' as const, selection: payload.selection },
  }
  const size = normalizeCanvasBlockSize(block, block)
  const snappedPosition = normalizeCanvasPosition({
    x: position.x - size.width / 2,
    y: position.y - Math.min(size.height / 2, 48),
  })
  return { x: snappedPosition.x, y: snappedPosition.y, ...size }
}

function markdownExcerptStyle(format: MarkdownExcerptFormat) {
  const level = format === 'heading-1'
    ? 'h1'
    : format === 'heading-2'
      ? 'h2'
      : format === 'heading-3'
        ? 'h3'
        : format === 'heading-4'
          ? 'h4'
          : 'paragraph'
  const style = createDefaultTextBlockStyle(level)
  return format === 'code' ? { ...style, code: true } : style
}

function appendClassName(className: string | undefined, token: string): string {
  return [...new Set([...(className ?? '').split(/\s+/u).filter(Boolean), token])].join(' ')
}

function removeClassName(className: string | undefined, token: string): string | undefined {
  const next = (className ?? '').split(/\s+/u).filter((value) => value !== '' && value !== token).join(' ')
  return next === '' ? undefined : next
}

const TRANSIENT_NODE_CLASSES = ['canvas-node-lifted', 'canvas-node-contact', 'canvas-node-snap-settle', 'canvas-node-attached', 'canvas-node-attached-left', 'canvas-node-attached-right', 'canvas-node-attached-top', 'canvas-node-attached-bottom', 'canvas-node-linked', 'canvas-node-linked-left', 'canvas-node-linked-right', 'canvas-node-linked-top', 'canvas-node-linked-bottom', 'canvas-node-joined', 'canvas-node-joined-left', 'canvas-node-joined-right', 'canvas-node-joined-top', 'canvas-node-joined-bottom', 'canvas-node-magnet', 'canvas-node-magnet-left', 'canvas-node-magnet-right', 'canvas-node-magnet-top', 'canvas-node-magnet-bottom', 'canvas-node-join-marker'] as const
const TRANSIENT_NODE_CLASS_SET = new Set<string>(TRANSIENT_NODE_CLASSES)

function removeTransientClassNames(className: string | undefined): string | undefined {
  const next = (className ?? '')
    .split(/\s+/u)
    .filter((token) => token !== '' && !TRANSIENT_NODE_CLASS_SET.has(token))
    .join(' ')
  return next === '' ? undefined : next
}

function setClassNameToken(className: string | undefined, token: string, active: boolean): string | undefined {
  return active ? appendClassName(className, token) : removeClassName(className, token)
}

function nodeDimension(node: Node, key: 'width' | 'height'): number {
  const styled = node.style?.[key]
  if (typeof styled === 'number') return styled
  const block = (node.data as { block?: CanvasBlockData }).block
  if (typeof block?.[key] === 'number') return block[key]
  const measured = node.measured?.[key]
  return typeof measured === 'number' ? measured : 0
}

type JoinSide = 'left' | 'right' | 'top' | 'bottom'

type MagnetContact = {
  movingId: string
  targetId: string
  movingSide: JoinSide
  targetSide: JoinSide
  strength: number
}

function nearestMagnetContact(moving: Node, scene: readonly Node[]): MagnetContact | null {
  if (isDrawingOverlay(moving)) return null
  const maxDistance = 64
  let closest: MagnetContact | null = null
  for (const target of scene) {
    if (target.id === moving.id || isDrawingOverlay(target)) continue
    const horizontalOverlap = Math.min(moving.position.x + nodeDimension(moving, 'width'), target.position.x + nodeDimension(target, 'width'))
      - Math.max(moving.position.x, target.position.x)
    const verticalOverlap = Math.min(moving.position.y + nodeDimension(moving, 'height'), target.position.y + nodeDimension(target, 'height'))
      - Math.max(moving.position.y, target.position.y)
    const faces: Array<{ gap: number; movingSide: JoinSide; targetSide: JoinSide; overlap: number }> = [
      { gap: target.position.x - moving.position.x - nodeDimension(moving, 'width'), movingSide: 'right', targetSide: 'left', overlap: verticalOverlap },
      { gap: moving.position.x - target.position.x - nodeDimension(target, 'width'), movingSide: 'left', targetSide: 'right', overlap: verticalOverlap },
      { gap: target.position.y - moving.position.y - nodeDimension(moving, 'height'), movingSide: 'bottom', targetSide: 'top', overlap: horizontalOverlap },
      { gap: moving.position.y - target.position.y - nodeDimension(target, 'height'), movingSide: 'top', targetSide: 'bottom', overlap: horizontalOverlap },
    ]
    for (const face of faces) {
      if (face.gap < 0 || face.gap > maxDistance || face.overlap < 24) continue
      const strength = 1 - face.gap / maxDistance
      if (closest !== null && closest.strength >= strength) continue
      closest = {
        movingId: moving.id,
        targetId: target.id,
        movingSide: face.movingSide,
        targetSide: face.targetSide,
        strength,
      }
    }
  }
  return closest
}

export function touchingEdgeSides(source: Node | undefined, target: Node | undefined): { source: JoinSide; target: JoinSide } | null {
  if (source === undefined || target === undefined || isDrawingOverlay(source) || isDrawingOverlay(target)) return null
  const sourceWidth = nodeDimension(source, 'width')
  const sourceHeight = nodeDimension(source, 'height')
  const targetWidth = nodeDimension(target, 'width')
  const targetHeight = nodeDimension(target, 'height')
  const horizontalOverlap = Math.min(source.position.x + sourceWidth, target.position.x + targetWidth) - Math.max(source.position.x, target.position.x)
  const verticalOverlap = Math.min(source.position.y + sourceHeight, target.position.y + targetHeight) - Math.max(source.position.y, target.position.y)
  // PDF 발췌는 잘라낸 영역의 비율 때문에 높이가 소수점이다. 저장된 위치가
  // 정수 격자여도 눈에는 붙어 보이는 작은 틈이 생기므로 이때도 선을 숨긴다.
  const touching = (distance: number) => Math.abs(distance) <= 8

  if (verticalOverlap > 1
    && touching(source.position.x + sourceWidth - target.position.x)) return { source: 'right', target: 'left' }
  if (verticalOverlap > 1
    && touching(target.position.x + targetWidth - source.position.x)) return { source: 'left', target: 'right' }
  if (horizontalOverlap > 1
    && touching(source.position.y + sourceHeight - target.position.y)) return { source: 'bottom', target: 'top' }
  if (horizontalOverlap > 1
    && touching(target.position.y + targetHeight - source.position.y)) return { source: 'top', target: 'bottom' }
  return null
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return Math.min(endA, endB) >= Math.max(startA, startB)
}

function nearestAlignment(position: number, options: readonly number[]): number | null {
  let nearest: number | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const option of options) {
    const distance = Math.abs(option - position)
    if (distance <= 28 && distance < nearestDistance) {
      nearest = option
      nearestDistance = distance
    }
  }
  return nearest
}

/**
 * 그리기 도형의 앞뒤 순서. React Flow 는 선택한 블록을 +1000 만큼 앞으로 올리므로, 그보다 높아야
 * 블록 위에 그린 네모가 그 블록을 고르거나 끌 때 블록 뒤로 숨지 않는다.
 */
const DRAWING_OVERLAY_Z = 1500

function isDrawingOverlay(node: Node): boolean {
  const kind = (node.data as { block?: CanvasBlockData }).block?.kind
  return kind === 'rectangle' || kind === 'square' || kind === 'ellipse' || kind === 'diamond'
}

/** 복사본 id. 캔버스를 다시 열면 번호가 0부터 시작하므로, 이미 있는 id 는 건너뛴다 */
function uniqueCopyId(baseId: string, scene: readonly Node[], sequence: { current: number }): string {
  const taken = new Set(scene.map(({ id }) => id))
  let id = `${baseId}-copy-${sequence.current++}`
  while (taken.has(id)) id = `${baseId}-copy-${sequence.current++}`
  return id
}

/**
 * 블록 위에 그려 둔 도형(면적의 절반 이상이 블록 안). 블록을 옮기면 함께 옮긴다.
 * 함께 선택된 도형은 React Flow 가 이미 같이 옮기므로 뺀다.
 */
export function ridingOverlays<T extends Node>(
  base: T,
  scene: readonly T[],
): { id: string; start: { x: number; y: number } }[] {
  const left = base.position.x
  const top = base.position.y
  const right = left + nodeDimension(base, 'width')
  const bottom = top + nodeDimension(base, 'height')
  return scene.flatMap((node) => {
    if (node.id === base.id || !isDrawingOverlay(node) || node.selected === true) return []
    const width = nodeDimension(node, 'width')
    const height = nodeDimension(node, 'height')
    const overlapX = Math.min(right, node.position.x + width) - Math.max(left, node.position.x)
    const overlapY = Math.min(bottom, node.position.y + height) - Math.max(top, node.position.y)
    if (overlapX <= 0 || overlapY <= 0) return []
    return overlapX * overlapY >= (width * height) / 2 ? [{ id: node.id, start: node.position }] : []
  })
}

function nearestVacantPosition<T extends Node>(
  node: T,
  position: { x: number; y: number },
  _preferred: { x: number; y: number },
  scene: readonly T[],
): { readonly position: { x: number; y: number }; readonly displaced: boolean } {
  const moving = {
    id: node.id,
    ...position,
    width: nodeDimension(node, 'width'),
    height: nodeDimension(node, 'height'),
    allowOverlap: isDrawingOverlay(node),
  }
  const settled = nearestVacantCanvasPoint(
    moving,
    scene.map((candidate) => ({
      id: candidate.id,
      ...candidate.position,
      width: nodeDimension(candidate, 'width'),
      height: nodeDimension(candidate, 'height'),
      allowOverlap: isDrawingOverlay(candidate),
    })),
    { gridX: CANVAS_GRID_SIZE, gridY: CANVAS_VERTICAL_GRID_SIZE, contactGap: 0 },
  )
  return {
    position: { x: settled.x, y: settled.y },
    displaced: settled.x !== position.x || settled.y !== position.y,
  }
}

export interface MarkdownExcerptInsertRequest {
  readonly id: number
  readonly targetNoteId?: string
  readonly payload: MarkdownExcerptDragPayload
  readonly translation?: CanvasTranslationResult
}

export type ReaderExcerptInsertRequest = PdfExcerptInsertRequest | MarkdownExcerptInsertRequest

function isMarkdownExcerptInsertRequest(
  request: ReaderExcerptInsertRequest,
): request is MarkdownExcerptInsertRequest {
  return 'path' in request.payload.selection
}

export function resolveCanvasOverlaps<T extends Node>(scene: readonly T[]): T[] {
  const placed: T[] = []
  for (const node of scene) {
    const vacant = nearestVacantPosition(node, node.position, node.position, [...placed, node])
    placed.push(vacant.displaced ? { ...node, position: vacant.position } : node)
  }
  return placed
}

export function settleCanvasNode<T extends Node>(
  node: T,
  position: { x: number; y: number },
  scene: readonly T[] = [node],
): T {
  const gridPosition = normalizeCanvasPosition(position)
  const width = nodeDimension(node, 'width')
  const height = nodeDimension(node, 'height')
  let snappedX = gridPosition.x
  let snappedY = gridPosition.y
  let horizontalDistance = Number.POSITIVE_INFINITY
  let verticalDistance = Number.POSITIVE_INFINITY
  let attached = false

  if (isDrawingOverlay(node)) {
    // 도형은 격자에 붙지 않으므로 '붙는' 움직임도 주지 않는다
    return {
      ...node,
      position: { x: Math.round(position.x), y: Math.round(position.y) },
      className: removeTransientClassNames(node.className),
    }
  }

  for (const candidate of scene) {
    if (candidate.id === node.id || isDrawingOverlay(candidate)) continue
    const candidateWidth = nodeDimension(candidate, 'width')
    const candidateHeight = nodeDimension(candidate, 'height')
    const candidateLeft = candidate.position.x
    const candidateTop = candidate.position.y
    const candidateRight = candidateLeft + candidateWidth
    const candidateBottom = candidateTop + candidateHeight

    if (rangesOverlap(snappedY, snappedY + height, candidateTop, candidateBottom)) {
      let joinedHorizontally = false
      for (const edgeX of [candidateLeft - width, candidateRight]) {
        const distance = Math.abs(edgeX - gridPosition.x)
        if (distance <= 28 && distance < horizontalDistance) {
          snappedX = edgeX
          horizontalDistance = distance
          attached = true
          joinedHorizontally = true
        }
      }
      if (joinedHorizontally) {
        const alignedY = nearestAlignment(gridPosition.y, [candidateTop, candidateBottom - height])
        if (alignedY !== null) snappedY = alignedY
      }
    }

    if (rangesOverlap(snappedX, snappedX + width, candidateLeft, candidateRight)) {
      let joinedVertically = false
      for (const edgeY of [candidateTop - height, candidateBottom]) {
        const distance = Math.abs(edgeY - gridPosition.y)
        if (distance <= 28 && distance < verticalDistance) {
          snappedY = edgeY
          verticalDistance = distance
          attached = true
          joinedVertically = true
        }
      }
      if (joinedVertically) {
        const alignedX = nearestAlignment(gridPosition.x, [candidateLeft, candidateRight - width])
        if (alignedX !== null) snappedX = alignedX
      }
    }
  }

  const vacant = nearestVacantPosition(node, { x: snappedX, y: snappedY }, gridPosition, scene)
  snappedX = vacant.position.x
  snappedY = vacant.position.y
  attached ||= vacant.displaced
  const baseClassName = appendClassName(removeTransientClassNames(node.className), 'canvas-node-snap-settle')
  return {
    ...node,
    position: { x: snappedX, y: snappedY },
    style: {
      ...node.style,
      '--snap-offset-x': `${position.x - snappedX}px`,
      '--snap-offset-y': `${position.y - snappedY}px`,
      '--snap-overshoot-x': `${(snappedX - position.x) * 0.08}px`,
      '--snap-overshoot-y': `${(snappedY - position.y) * 0.08}px`,
    } as CSSProperties,
    className: attached ? appendClassName(baseClassName, 'canvas-node-attached') : baseClassName,
  }
}

function contactingNodeIds(nodes: readonly NoteCanvasNode[], moving: NoteCanvasNode, threshold = 12): ReadonlySet<string> {
  const width = nodeDimension(moving, 'width')
  const height = nodeDimension(moving, 'height')
  const left = moving.position.x
  const top = moving.position.y
  const right = left + width
  const bottom = top + height
  const contacts = new Set<string>()
  for (const node of nodes) {
    if (node.id === moving.id || isDrawingOverlay(node) || isDrawingOverlay(moving)) continue
    const nodeLeft = node.position.x
    const nodeTop = node.position.y
    const nodeRight = nodeLeft + nodeDimension(node, 'width')
    const nodeBottom = nodeTop + nodeDimension(node, 'height')
    const horizontalGap = Math.max(nodeLeft - right, left - nodeRight, 0)
    const verticalGap = Math.max(nodeTop - bottom, top - nodeBottom, 0)
    if (horizontalGap <= threshold && verticalGap <= threshold) contacts.add(node.id)
  }
  if (contacts.size > 0) contacts.add(moving.id)
  return contacts
}

function saveLabel(status: CanvasSaveStatus | undefined): string | null {
  if (status === 'loading') return t('불러오는 중')
  if (status === 'dirty') return t('저장 대기')
  if (status === 'saving') return t('저장 중')
  if (status === 'saved') return t('저장됨')
  if (status === 'conflict') return t('외부 변경 충돌')
  if (status === 'error') return t('저장 실패')
  if (status === 'recovered') return t('복구됨')
  return null
}

function NoteBottomBar({ status, error }: { status?: CanvasSaveStatus; error?: string | null }) {
  const { fitView, zoomIn, zoomOut, zoomTo } = useReactFlow()
  const { zoom } = useViewport()
  const zoomPercent = Math.round(zoom * 100)

  return (
    <div className="note-bottom-bar" aria-label={t('캔버스 보기 도구')}>
      <div className="note-bottom-bar-surface">
        <div className="note-bottom-controls">
          <button type="button" className="bottombar-btn" aria-label={t('캔버스 화면 맞춤')} onClick={() => void fitView({ padding: 0.18, duration: 180 })}><CornersOut size={16} aria-hidden="true" /></button>
          <span className="bottombar-divider" />
          <button type="button" className="bottombar-btn" aria-label={t('캔버스 축소')} onClick={() => void zoomOut({ duration: 120 })}><Minus size={16} aria-hidden="true" /></button>
          <input aria-label={t('캔버스 배율')} type="range" min="20" max="250" step="10" value={zoomPercent} style={rangeFillStyle(zoomPercent, 20, 250)} onChange={(event) => void zoomTo(Number(event.target.value) / 100, { duration: 80 })} />
          <button type="button" className="bottombar-btn" aria-label={t('캔버스 확대')} onClick={() => void zoomIn({ duration: 120 })}><Plus size={16} aria-hidden="true" /></button>
          <span className="note-bottom-zoom">{zoomPercent}%</span>
        </div>
        <span className={`note-save-status note-save-status-${status ?? 'idle'}`} title={error ?? undefined}>
          {saveLabel(status)}
        </span>
      </div>
    </div>
  )
}

function canvasNodeStyle(block: CanvasBlockData): CSSProperties {
  return {
    width: block.width,
    height: block.height,
    '--canvas-block-border-color': block.style.borderColor === '#c9ced6'
      ? 'var(--divider-strong)'
      : block.style.borderColor,
    ...(block.style.borderWidth === undefined ? {} : { '--canvas-block-border-width': `${block.style.borderWidth}px` }),
  } as CSSProperties
}

function canvasNodePresentation(block: CanvasBlockData) {
  return {
    style: canvasNodeStyle(block),
    initialWidth: block.width,
    initialHeight: block.height,
  }
}

function edgeMarker(marker: CanvasEdgeMarker) {
  return marker === 'arrow' ? { type: MarkerType.ArrowClosed, width: 18, height: 18 } : undefined
}

function styledEdge(
  edge: Omit<NoteCanvasEdge, 'data' | 'markerStart' | 'markerEnd'>,
  startMarker: CanvasEdgeMarker,
  endMarker: CanvasEdgeMarker,
): NoteCanvasEdge {
  return {
    ...edge,
    data: { startMarker, endMarker },
    markerStart: edgeMarker(startMarker),
    markerEnd: edgeMarker(endMarker),
    interactionWidth: 22,
    selectable: true,
  }
}

function persistedNode(node: NoteCanvasNode): PersistedCanvasNode {
  const original = node.data.block as CanvasBlockData
  const className = removeTransientClassNames(node.className)
  return {
    id: node.id,
    ...(node.type === undefined ? {} : { type: node.type }),
    position: { x: node.position.x, y: node.position.y },
    data: { block: structuredClone(original) },
    ...(className === undefined ? {} : { className }),
  }
}

function persistedEdge(edge: NoteCanvasEdge): PersistedCanvasEdge {
  const startMarker = edge.data?.startMarker ?? 'none'
  const endMarker = edge.data?.endMarker ?? 'none'
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle === undefined ? {} : { sourceHandle: edge.sourceHandle }),
    ...(edge.targetHandle === undefined ? {} : { targetHandle: edge.targetHandle }),
    startMarker,
    endMarker,
  }
}

function canvasDocument(nodes: readonly NoteCanvasNode[], edges: readonly NoteCanvasEdge[], viewport: Viewport): CanvasDocumentV2 {
  return {
    version: 2,
    nodes: nodes.map(persistedNode),
    edges: edges.map(persistedEdge),
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
  }
}

function restoredNodes(document: CanvasDocumentV2): NoteCanvasNode[] {
  const restored = document.nodes.map((node) => {
    const block = node.data.block
    const size = normalizeCanvasBlockSize(block, block)
    const position = normalizeCanvasNodePosition(block, node.position)
    const normalizedBlock = block.kind === 'pdfExcerpt'
      ? { ...block, ...size, excerpt: { ...block.excerpt, ...size } }
      : { ...block, ...size }
    const className = removeTransientClassNames(node.className)
    if (block.kind === 'pdfExcerpt') {
      return {
        id: node.id,
        type: 'pdfExcerpt',
        position,
        data: { block: structuredClone(normalizedBlock) },
        ...canvasNodePresentation(normalizedBlock),
        dragHandle: '.drag-handle',
        ...(className === undefined ? {} : { className }),
      } as PdfExcerptFlowNode
    }
    if (block.kind === 'markdownExcerpt') {
      return {
        id: node.id,
        type: 'markdownExcerpt',
        position,
        data: { block: structuredClone(normalizedBlock) },
        ...canvasNodePresentation(normalizedBlock),
        dragHandle: '.drag-handle',
        ...(className === undefined ? {} : { className }),
      } as MarkdownExcerptFlowNode
    }
    if (block.kind === 'image') {
      return {
        id: node.id,
        type: 'imageBlock',
        position,
        data: { block: structuredClone(normalizedBlock) },
        ...canvasNodePresentation(normalizedBlock),
        dragHandle: '.drag-handle',
        ...(className === undefined ? {} : { className }),
      } as ImageBlockFlowNode
    }
    if (block.kind === 'rectangle' || block.kind === 'square' || block.kind === 'ellipse' || block.kind === 'diamond') {
      return {
        id: node.id,
        type: 'presetBlock',
        position,
        data: { block: structuredClone(normalizedBlock) },
        ...canvasNodePresentation(normalizedBlock),
        dragHandle: '.drag-handle',
        zIndex: DRAWING_OVERLAY_Z,
        ...(className === undefined ? {} : { className }),
      } as PresetBlockFlowNode
    }
    const restored = {
      id: node.id,
      type: block.kind === 'translation' ? 'translation' : 'textBlock',
      position,
      data: { block: structuredClone(normalizedBlock) },
      ...canvasNodePresentation(normalizedBlock),
      dragHandle: '.drag-handle',
      ...(className === undefined ? {} : { className }),
    }
    return block.kind === 'translation'
      ? restored as TranslationBlockFlowNode
      : restored as TextBlockFlowNode
  })
  return resolveCanvasOverlaps(restored)
}

function withoutSides(sides: ReadonlySet<CanvasSide> | undefined, remove: readonly string[]): ReadonlySet<CanvasSide> | undefined {
  if (sides === undefined || remove.length === 0) return sides
  return new Set([...sides].filter((side) => !remove.includes(side)))
}

/** 다른 블록과 닿지 않는 자리(겹치면 그 블록 오른쪽으로 비켜 간다) */
function vacantSpotRightOf(
  desired: { x: number; y: number },
  size: { width: number; height: number },
  nodes: readonly NoteCanvasNode[],
  gap = 40,
): { x: number; y: number } {
  let x = desired.x
  for (let tries = 0; tries < 50; tries += 1) {
    const blocker = nodes.find((node) => {
      const block = node.data.block as CanvasBlockData
      if (isCanvasShapeKind(block.kind)) return false
      return node.position.x < x + size.width + gap / 2 && node.position.x + block.width + gap / 2 > x
        && node.position.y < desired.y + size.height + gap / 2 && node.position.y + block.height + gap / 2 > desired.y
    })
    if (blocker === undefined) break
    x = blocker.position.x + (blocker.data.block as CanvasBlockData).width + gap
  }
  return { x, y: desired.y }
}

/** 형광펜에서 나온 선이면 그 형광펜 색, 아니면 null */
function highlightLinkColor(edge: Pick<NoteCanvasEdge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>, nodes: readonly NoteCanvasNode[]): ExcerptHighlightColor | null {
  for (const [nodeId, handle] of [[edge.source, edge.sourceHandle], [edge.target, edge.targetHandle]] as const) {
    const highlightId = highlightIdFromHandle(handle)
    if (highlightId === null) continue
    const block = nodes.find((node) => node.id === nodeId)?.data.block as CanvasBlockData | undefined
    if (block?.kind !== 'pdfExcerpt') continue
    const highlight = block.highlights?.find(({ id }) => id === highlightId)
    if (highlight !== undefined) return highlight.color
  }
  return null
}

function highlightExists(document: CanvasDocumentV2, nodeId: string, handle: string | null | undefined): boolean {
  const highlightId = highlightIdFromHandle(handle)
  if (highlightId === null) return true
  const block = document.nodes.find((node) => node.id === nodeId)?.data.block
  return block?.kind === 'pdfExcerpt' && (block.highlights ?? []).some(({ id }) => id === highlightId)
}

function restoredEdges(document: CanvasDocumentV2): NoteCanvasEdge[] {
  const nodeIds = new Set(document.nodes.map(({ id }) => id))
  const sideHandle = (handle: string | null | undefined) => {
    if (handle === undefined || handle === null) return handle
    return /^(?:source-|target-)?(top|right|bottom|left)$/u.exec(handle)?.[1] ?? handle
  }
  return document.edges
    // 'snap-' 선은 예전에 블록이 맞닿을 때 저절로 생기던 것이다. 선은 직접 연결한 것만 둔다
    .filter((edge) => !edge.id.startsWith('snap-'))
    .filter((edge) => edge.source !== edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .filter((edge) => highlightExists(document, edge.source, edge.sourceHandle) && highlightExists(document, edge.target, edge.targetHandle))
    .map((edge) => styledEdge({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: sideHandle(edge.sourceHandle),
      targetHandle: sideHandle(edge.targetHandle),
    }, edge.startMarker ?? 'none', edge.endMarker ?? 'none'))
}

function CanvasEdgeGeometrySync({ nodeIds }: { nodeIds: readonly string[] }) {
  const updateNodeInternals = useUpdateNodeInternals()
  const updateGeometry = useCallback((ids: string | string[]) => {
    updateNodeInternals(ids)
    window.dispatchEvent(new Event('iwae:canvas-geometry'))
  }, [updateNodeInternals])
  const refresh = useCallback(() => {
    if (nodeIds.length > 0) scheduleNodeInternalsUpdate(nodeIds, updateGeometry)
  }, [nodeIds, updateGeometry])

  useOnViewportChange({ onChange: refresh })
  useEffect(refresh, [refresh])
  return null
}

function nextExcerptSequence(document: CanvasDocumentV2): number {
  return document.nodes.reduce((next, node) => {
    const match = /^pdf-excerpt-(\d+)$/u.exec(node.id)
    return match === null ? next : Math.max(next, Number(match[1]) + 1)
  }, 0)
}

function nextMarkdownExcerptSequence(document: CanvasDocumentV2): number {
  return document.nodes.reduce((next, node) => {
    const match = /^markdown-excerpt-(\d+)$/u.exec(node.id)
    return match === null ? next : Math.max(next, Number(match[1]) + 1)
  }, 0)
}

function nextTranslationSequence(document: CanvasDocumentV2): number {
  return document.nodes.reduce((next, node) => {
    const match = /^translation-(\d+)$/u.exec(node.id)
    return match === null ? next : Math.max(next, Number(match[1]) + 1)
  }, 0)
}

function nextBlockSequence(document: CanvasDocumentV2, prefix: CanvasBlockPreset | 'image'): number {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, 'u')
  return document.nodes.reduce((next, node) => {
    const match = pattern.exec(node.id)
    return match === null ? next : Math.max(next, Number(match[1]) + 1)
  }, 0)
}

function NoteFlow({
  noteId,
  initialDocument,
  onDocumentChange,
  onOpenSource,
  onSourceTraceChange,
  onSourceStateChange,
  onToggleFullscreen,
  onExportWithEvidence,
  insertRequest,
  onTranslateText,
  userPresets = [],
  onSaveUserPreset,
}: Pick<NoteCanvasProps, 'noteId' | 'onDocumentChange' | 'onOpenSource' | 'onSourceTraceChange' | 'onSourceStateChange' | 'onExportWithEvidence' | 'insertRequest' | 'onTranslateText' | 'userPresets' | 'onSaveUserPreset'> & {
  initialDocument: CanvasDocumentV2
  onToggleFullscreen?: () => void
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<NoteCanvasNode>(restoredNodes(initialDocument))
  const [edges, setEdges, onEdgesChange] = useEdgesState<NoteCanvasEdge>(restoredEdges(initialDocument))
  const [matchPdfTextSize, setMatchPdfTextSize] = useState(readMatchPdfTextSize)
  const { getViewport, screenToFlowPosition, setViewport, zoomIn, zoomOut, zoomTo } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const nextExcerptId = useRef(nextExcerptSequence(initialDocument))
  const nextImageId = useRef(nextBlockSequence(initialDocument, 'image'))
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const nextMarkdownExcerptId = useRef(nextMarkdownExcerptSequence(initialDocument))
  const nextTranslationId = useRef(nextTranslationSequence(initialDocument))
  const nextBlockId = useRef({
    title: nextBlockSequence(initialDocument, 'title'),
    paragraph: nextBlockSequence(initialDocument, 'paragraph'),
    code: nextBlockSequence(initialDocument, 'code'),
    rectangle: nextBlockSequence(initialDocument, 'rectangle'),
    square: nextBlockSequence(initialDocument, 'square'),
    ellipse: nextBlockSequence(initialDocument, 'ellipse'),
    diamond: nextBlockSequence(initialDocument, 'diamond'),
    arrow: nextBlockSequence(initialDocument, 'arrow'),
  })
  const flowRef = useRef<HTMLDivElement | null>(null)
  const [connectionMarkers, setConnectionMarkers] = useState<{
    start: CanvasEdgeMarker
    end: CanvasEdgeMarker
  }>({ start: 'none', end: 'arrow' })
  const [drawingTool, setDrawingTool] = useState<ShapeCanvasBlock['kind'] | null>(null)
  // 형광펜 도구: 켜져 있으면 발췌 위를 끌어 칠한다. 색은 마지막에 쓴 색을 기억한다
  const [highlightTool, setHighlightTool] = useState<ExcerptHighlightColor | null>(null)
  const highlightColors = useHighlightColors()
  const [highlightColor, setHighlightColor] = useState<ExcerptHighlightColor>(() => defaultHighlightColorId(highlightColors))
  const [autoEditBlockId, setAutoEditBlockId] = useState<string | null>(null)
  // 형광펜에서 만든 메모: 아무것도 안 쓰고 나가면 지운다
  const highlightNoteIds = useRef(new Set<string>())
  useEffect(() => {
    if (highlightTool === null) return
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHighlightTool(null)
    }
    window.addEventListener('keydown', exit)
    return () => window.removeEventListener('keydown', exit)
  }, [highlightTool])
  const [drawingDraft, setDrawingDraft] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const lastInsertRequestId = useRef<number | null>(null)
  const viewportRef = useRef<Viewport>(initialDocument.viewport)
  const lastDocumentSignature = useRef(serializeCanvasDoc(initialDocument))
  const [hoveredSourceId, setHoveredSourceId] = useState<string | null>(null)
  const [magnetContact, setMagnetContact] = useState<MagnetContact | null>(null)
  const [contextMenu, setContextMenu] = useState<
    | { kind: 'block'; nodeId: string; x: number; y: number }
    | { kind: 'edge'; edgeId: string; x: number; y: number }
    | { kind: 'pane'; x: number; y: number; position: { x: number; y: number } }
    | null
  >(null)
  const resizeHistoryRecordedRef = useRef(false)
  const interactionRef = useRef<CanvasInteractionState>({ kind: 'idle' })
  // 블록을 끄는 동안 함께 움직일 도형(블록 위에 그려 둔 것)과 끌기 시작 위치
  // 끌기 시작할 때의 모든 블록 위치. Ctrl 을 누른 채 놓으면 원본을 여기로 되돌리고 놓은 자리에 복사본을 둔다
  const dragStartPositionsRef = useRef<ReadonlyMap<string, { x: number; y: number }>>(new Map())
  const ridersRef = useRef<{ nodeId: string; origin: { x: number; y: number }; riders: { id: string; start: { x: number; y: number } }[] } | null>(null)
  const rightPanRef = useRef({ active: false, moved: false, x: 0, y: 0 })
  const suppressContextMenuRef = useRef(false)
  const duplicateSequence = useRef(0)
  const clipboardRef = useRef<{ nodes: NoteCanvasNode[]; edges: NoteCanvasEdge[] } | null>(null)
  const [historyRevision, setHistoryRevision] = useState(0)
  const historyRef = useRef<{ past: CanvasDocumentV2[]; future: CanvasDocumentV2[] }>({ past: [], future: [] })
  const settleTimers = useRef(new Map<string, number>())
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const edgesRef = useRef(edges)
  edgesRef.current = edges
  useEffect(() => {
    try {
      window.localStorage.setItem(MATCH_PDF_TEXT_SIZE_KEY, String(matchPdfTextSize))
    } catch {
      // Keep the option available even when browser storage is disabled.
    }
  }, [matchPdfTextSize])
  const joinedEdges = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    return new Map(edges.flatMap((edge) => {
      const sides = touchingEdgeSides(byId.get(edge.source), byId.get(edge.target))
      return sides === null ? [] : [[edge.id, sides] as const]
    }))
  }, [nodes, edges])
  const touchingSidesByNode = useMemo(() => {
    const sidesByNode = new Map<string, Set<CanvasSide>>()
    const addSide = (nodeId: string, side: CanvasSide) => {
      const sides = sidesByNode.get(nodeId) ?? new Set<CanvasSide>()
      sides.add(side)
      sidesByNode.set(nodeId, sides)
    }
    for (const [sourceIndex, source] of nodes.entries()) {
      for (let targetIndex = sourceIndex + 1; targetIndex < nodes.length; targetIndex += 1) {
        const target = nodes[targetIndex]
        if (target === undefined) continue
        const touching = touchingEdgeSides(source, target)
        if (touching === null) continue
        addSide(source.id, touching.source)
        addSide(target.id, touching.target)
      }
    }
    return sidesByNode
  }, [nodes])
  const displayedEdges = useMemo(() => edges.map((edge) => {
    let className = setClassNameToken(edge.className, 'canvas-edge-joined', joinedEdges.has(edge.id))
    const color = highlightLinkColor(edge, nodes)
    className = setClassNameToken(className, 'canvas-edge-highlight', color !== null)
    // 선 요소에는 data-hl 을 달 수 없어, 그 색의 진한 색을 변수로 넘긴다(canvas-paper.css 의 .canvas-edge-highlight)
    if (color === null) return { ...edge, className }
    return { ...edge, className, style: { ...edge.style, '--edge-hl-ink': highlightInkOf(highlightColors, color) } as CSSProperties }
  }), [edges, joinedEdges, nodes, highlightColors])
  const displayedNodes = useMemo(() => nodes.map((node) => {
    const linkedSides = edges.flatMap((edge) => edge.source === node.id && edge.sourceHandle
      ? [edge.sourceHandle]
      : edge.target === node.id && edge.targetHandle
        ? [edge.targetHandle]
        : []).filter((handle) => highlightIdFromHandle(handle) === null)
    const linkedHighlights = new Set(edges.flatMap((edge) => [
      edge.source === node.id ? highlightIdFromHandle(edge.sourceHandle) : null,
      edge.target === node.id ? highlightIdFromHandle(edge.targetHandle) : null,
    ].filter((value): value is string => value !== null)))
    const joinedSides = edges.flatMap((edge) => {
      const sides = joinedEdges.get(edge.id)
      return sides === undefined ? [] : edge.source === node.id ? [sides.source] : edge.target === node.id ? [sides.target] : []
    })
    const magnetSide = magnetContact?.movingId === node.id
      ? magnetContact.movingSide
      : magnetContact?.targetId === node.id ? magnetContact.targetSide : null
    const pull = magnetSide === null ? 0 : magnetContact!.strength ** 2 * (magnetContact!.movingId === node.id ? 1.5 : 3)
    let className = removeTransientClassNames(node.className)
    if (linkedSides.length > 0) className = appendClassName(className, 'canvas-node-linked')
    for (const side of linkedSides) className = appendClassName(className, `canvas-node-linked-${side}`)
    if (joinedSides.length > 0) className = appendClassName(className, 'canvas-node-joined')
    for (const side of joinedSides) className = appendClassName(className, `canvas-node-joined-${side}`)
    if (magnetSide !== null) {
      className = appendClassName(className, 'canvas-node-magnet')
      className = appendClassName(className, `canvas-node-magnet-${magnetSide}`)
    }
    for (const token of (node.className ?? '').split(/\s+/u)) {
      if (token.startsWith('canvas-node-') && !token.startsWith('canvas-node-linked') && !token.startsWith('canvas-node-joined') && !token.startsWith('canvas-node-magnet') && token !== 'canvas-node-join-marker') className = appendClassName(className, token)
    }
    const style = magnetSide === null ? node.style : {
      ...node.style,
      '--magnet-pull-x': `${magnetSide === 'right' ? pull : magnetSide === 'left' ? -pull : 0}px`,
      '--magnet-pull-y': `${magnetSide === 'bottom' ? pull : magnetSide === 'top' ? -pull : 0}px`,
    } as CSSProperties
    return {
      ...node,
      className,
      style,
      data: {
        ...node.data,
        // 맞닿은 쪽의 연결점은 숨기지만, 다른 블록과 이어진 선(맞닿아 숨긴 선이 아닌)의 연결점은 남긴다(없으면 선이 안 그려진다)
        touchingSides: withoutSides(touchingSidesByNode.get(node.id), edges.flatMap((edge) => {
          if (joinedEdges.has(edge.id)) return []
          if (edge.source === node.id && edge.sourceHandle) return [edge.sourceHandle]
          if (edge.target === node.id && edge.targetHandle) return [edge.targetHandle]
          return []
        })),
        ...(node.type === 'pdfExcerpt' ? { linkedHighlights } : {}),
      },
    } as NoteCanvasNode
  }), [nodes, edges, joinedEdges, magnetContact, touchingSidesByNode])
  const edgeGeometryNodeIds = useMemo(() => nodes.map(({ id }) => id), [nodes])
  const derivedNodeState = useMemo(
    () => deriveCanvasNodeState(nodes as unknown as readonly CanvasNode[]),
    [nodes],
  )
  const selectedEdges = useMemo(() => edges.filter(({ selected }) => selected), [edges])
  const sourceState = useMemo<WorkspaceSourceState>(() => ({
    references: derivedNodeState.sourceReferences,
    selectedIds: derivedNodeState.selectedSourceIds,
    hoveredId: hoveredSourceId,
  }), [derivedNodeState.selectedSourceIds, derivedNodeState.sourceReferences, hoveredSourceId])

  const rememberCurrentDocument = useCallback(() => {
    historyRef.current = {
      past: [...historyRef.current.past.slice(-99), canvasDocument(nodes, edges, viewportRef.current)],
      future: [],
    }
    setHistoryRevision((value) => value + 1)
  }, [edges, nodes])

  const visibleCanvasCenter = useCallback(() => {
    const rect = flowRef.current?.getBoundingClientRect()
    const screenPosition = rect !== undefined && rect.width > 0 && rect.height > 0
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    return screenToFlowPosition(screenPosition)
  }, [screenToFlowPosition])

  useEffect(() => () => {
    for (const timeout of settleTimers.current.values()) window.clearTimeout(timeout)
    settleTimers.current.clear()
  }, [])

  const emitDocument = useCallback((nextNodes: readonly NoteCanvasNode[], nextEdges: readonly NoteCanvasEdge[], viewport: Viewport) => {
    if (onDocumentChange === undefined) return
    const nextDocument = canvasDocument(nextNodes, nextEdges, viewport)
    const signature = serializeCanvasDoc(nextDocument)
    if (signature === lastDocumentSignature.current) return
    lastDocumentSignature.current = signature
    onDocumentChange(nextDocument)
  }, [onDocumentChange])

  useEffect(() => {
    if (interactionRef.current.kind !== 'idle') return
    emitDocument(nodes, edges, viewportRef.current)
  }, [edges, emitDocument, nodes])

  useEffect(() => {
    if (onSourceStateChange === undefined) return
    onSourceStateChange(sourceState)
  }, [onSourceStateChange, sourceState])

  const onConnect = useCallback((connection: Connection) => {
    rememberCurrentDocument()
    setEdges((current) => addEdge(
      styledEdge({
        id: `edge-${connection.source}-${connection.target}-${current.length}`,
        ...connection,
      }, connectionMarkers.start, connectionMarkers.end),
      current,
    ))
    announceAction(t('블록을 선으로 연결했습니다'))
  }, [connectionMarkers.end, connectionMarkers.start, rememberCurrentDocument, setEdges])

  const resizedNodes = useCallback((current: readonly NoteCanvasNode[], blockId: string, width: number, height: number, source: 'manual' | 'content'): NoteCanvasNode[] => current.map((node) => {
    if (node.id !== blockId) return node
    const block = node.data.block as CanvasBlockData
    const resized: CanvasBlockData = block.kind === 'pdfExcerpt'
      ? { ...block, width, height, excerpt: { ...block.excerpt, width, height } }
      : { ...block, width, height, ...(source === 'manual' && (block.kind === 'title' || block.kind === 'paragraph' || block.kind === 'code' || block.kind === 'translation') ? { manualHeight: true as const } : {}) }
    return {
      ...node,
      data: { block: resized },
      style: { ...node.style, ...canvasNodeStyle(resized) },
    } as NoteCanvasNode
  }), [])

  const handleNodesChange = useCallback((changes: NodeChange<NoteCanvasNode>[]) => {
    const dimensions = changes.flatMap((change) => change.type === 'dimensions'
      && change.dimensions !== undefined
      && change.resizing !== undefined
      ? [{ id: change.id, width: change.dimensions.width, height: change.dimensions.height, resizing: change.resizing === true }]
      : [])
    // 격자 맞춤은 블록마다 한다: 그리기 도형은 자유롭게, 나머지는 격자에
    const otherChanges = changes
      .filter((change) => change.type !== 'dimensions')
      .map((change) => {
        if (change.type !== 'position' || change.position === undefined) return change
        const node = nodesRef.current.find((candidate) => candidate.id === change.id)
        if (node === undefined || isDrawingOverlay(node)) return change
        return { ...change, position: normalizeCanvasPosition(change.position) }
      })
    // 블록 위의 도형은 블록과 같은 변경 묶음으로 옮긴다(따로 옮기면 한 박자 늦게 따라온다)
    const riding = ridersRef.current
    if (riding !== null) {
      for (const change of [...otherChanges]) {
        if (change.type !== 'position' || change.id !== riding.nodeId || change.position === undefined) continue
        const { x, y } = change.position
        for (const { id, start } of riding.riders) {
          otherChanges.push({ type: 'position', id, position: { x: start.x + x - riding.origin.x, y: start.y + y - riding.origin.y }, dragging: change.dragging })
        }
      }
    }
    if (otherChanges.length > 0) onNodesChange(otherChanges)
    if (dimensions.length === 0) return
    if (dimensions.length > 0 && !resizeHistoryRecordedRef.current) {
      rememberCurrentDocument()
      resizeHistoryRecordedRef.current = true
    }
    const first = dimensions[0]!
    if (interactionRef.current.kind === 'idle') {
      const node = nodesRef.current.find((candidate) => candidate.id === first.id)
      const block = node?.data.block as CanvasBlockData | undefined
      if (block !== undefined) {
        interactionRef.current = beginCanvasInteraction(interactionRef.current, {
          kind: 'resizing',
          nodeId: first.id,
          origin: { width: block.width, height: block.height },
          current: { width: first.width, height: first.height },
        })
      }
    }
    const finished = dimensions.some(({ resizing }) => !resizing)
    // 왼쪽·위 테두리로 줄이고 늘리면 React Flow 는 위치도 함께 바꾼다. 그 위치를 여기서 같이 반영해야
    // 아래 setNodes 가 위치 변경을 덮어쓰지 않는다(덮어쓰면 반대쪽 테두리가 움직인다)
    const moved = new Map(otherChanges.flatMap((change) => change.type === 'position' && change.position !== undefined
      ? [[change.id, change.position] as const]
      : []))
    let next: NoteCanvasNode[] = moved.size === 0
      ? nodesRef.current
      : nodesRef.current.map((node) => {
          const position = moved.get(node.id)
          return position === undefined ? node : { ...node, position } as NoteCanvasNode
        })
    for (const { id, width, height } of dimensions) {
      const node = next.find((candidate) => candidate.id === id)
      if (node === undefined) continue
      const size = normalizeCanvasBlockSize(node.data.block as CanvasBlockData, { width, height })
      interactionRef.current = updateCanvasInteraction(interactionRef.current, size)
      next = resizedNodes(next, id, size.width, size.height, 'manual')
    }
    if (finished) next = resolveCanvasOverlaps(next)
    nodesRef.current = next
    setNodes(next)
    if (finished) {
      interactionRef.current = cancelCanvasInteraction()
      resizeHistoryRecordedRef.current = false
      emitDocument(next, edgesRef.current, viewportRef.current)
    }
  }, [emitDocument, onNodesChange, rememberCurrentDocument, resizedNodes, setNodes])

  const onResizeFrame = useCallback((blockId: string, width: number, height: number) => {
    if (interactionRef.current.kind === 'idle') {
      const block = nodesRef.current.find((node) => node.id === blockId)?.data.block as CanvasBlockData | undefined
      if (block !== undefined) {
        rememberCurrentDocument()
        interactionRef.current = beginCanvasInteraction(interactionRef.current, {
          kind: 'resizing',
          nodeId: blockId,
          origin: { width: block.width, height: block.height },
          current: { width, height },
        })
      }
    }
    interactionRef.current = updateCanvasInteraction(interactionRef.current, { width, height })
    const next = resizedNodes(nodesRef.current, blockId, width, height, 'manual')
    nodesRef.current = next
    setNodes(next)
  }, [rememberCurrentDocument, resizedNodes, setNodes])

  const onResizeCommit = useCallback((blockId: string, width: number, height: number, source: 'manual' | 'content' = 'manual') => {
    const next = resolveCanvasOverlaps(resizedNodes(nodesRef.current, blockId, width, height, source))
    nodesRef.current = next
    interactionRef.current = cancelCanvasInteraction()
    setNodes(next)
    emitDocument(next, edgesRef.current, viewportRef.current)
    if (source === 'manual') announceAction(t('크기 조절 완료'))
  }, [emitDocument, resizedNodes, setNodes])

  const settleNode = useCallback((nodeId: string, position: { x: number; y: number }) => {
    setMagnetContact(null)
    const currentNodes = nodesRef.current
    const moving = currentNodes.find((node) => node.id === nodeId)
    if (moving === undefined) {
      interactionRef.current = cancelCanvasInteraction()
      return
    }
    const settled = settleCanvasNode(moving, position, currentNodes) as NoteCanvasNode
    // 블록 위에 그린 도형은 블록이 놓인 자리만큼 같이 옮긴다
    const riding = ridersRef.current
    ridersRef.current = null
    const riderPositions = new Map(riding === null ? [] : riding.riders.map(({ id, start }) => [id, {
      x: start.x + settled.position.x - riding.origin.x,
      y: start.y + settled.position.y - riding.origin.y,
    }]))
    const scene = currentNodes.map((node) => node.id === nodeId
      ? settled
      : riderPositions.has(node.id) ? { ...node, position: riderPositions.get(node.id)! } as NoteCanvasNode : node)
    let attachmentSide: string | null = null
    let nextEdges = edgesRef.current
    if (!isDrawingOverlay(moving)) {
      const near = currentNodes.find((candidate) => {
        if (candidate.id === nodeId || isDrawingOverlay(candidate)) return false
        const xGap = Math.max(candidate.position.x - (settled.position.x + nodeDimension(settled, 'width')), settled.position.x - (candidate.position.x + nodeDimension(candidate, 'width')), 0)
        const yGap = Math.max(candidate.position.y - (settled.position.y + nodeDimension(settled, 'height')), settled.position.y - (candidate.position.y + nodeDimension(candidate, 'height')), 0)
        return xGap <= 1 && yGap <= 1
      })
      if (near !== undefined && (settled.className?.includes('canvas-node-attached') ?? false)) {
        const dx = near.position.x + nodeDimension(near, 'width') / 2 - settled.position.x - nodeDimension(settled, 'width') / 2
        const dy = near.position.y + nodeDimension(near, 'height') / 2 - settled.position.y - nodeDimension(settled, 'height') / 2
        const sourceHandle = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top')
        // 맞닿기만 한다. 선은 사용자가 연결점에서 직접 끌어야만 생긴다
        attachmentSide = sourceHandle
      }
    }
    const magneticallyAttached = settled.className?.split(/\s+/u).includes('canvas-node-attached') ?? false
    const attachedIds = magneticallyAttached ? contactingNodeIds(scene, settled, 1) : new Set<string>()
    const nextNodes = scene.map((node) => {
      const className = node.id === nodeId
        ? node.className
        : removeTransientClassNames(node.className)
      return {
        ...node,
        className: node.id === nodeId && attachmentSide !== null && attachedIds.has(node.id)
          ? appendClassName(setClassNameToken(className, 'canvas-node-attached', true), `canvas-node-attached-${attachmentSide}`)
          : setClassNameToken(className, 'canvas-node-attached', attachedIds.has(node.id)),
      } as NoteCanvasNode
    })
    nodesRef.current = nextNodes
    edgesRef.current = nextEdges
    interactionRef.current = cancelCanvasInteraction()
    setNodes(nextNodes)
    setEdges(nextEdges)
    emitDocument(nextNodes, nextEdges, viewportRef.current)
    scheduleNodeInternalsUpdate([nodeId], updateNodeInternals)
    const pending = settleTimers.current.get(nodeId)
    if (pending !== undefined) window.clearTimeout(pending)
    settleTimers.current.set(nodeId, window.setTimeout(() => {
      setNodes((current) => {
        const next = current.map((node) => node.id === nodeId
          ? { ...node, className: removeClassName(node.className, 'canvas-node-snap-settle') } as NoteCanvasNode
          : node)
        nodesRef.current = next
        return next
      })
      settleTimers.current.delete(nodeId)
      scheduleNodeInternalsUpdate([nodeId], updateNodeInternals)
    }, 360))
  }, [emitDocument, setEdges, setNodes, updateNodeInternals])

  const onTextCommit = useCallback((blockId: string, text: string) => {
    if (highlightNoteIds.current.has(blockId)) {
      highlightNoteIds.current.delete(blockId)
      if (text.trim().length === 0) {
        // 형광펜에서 메모를 열고 아무것도 안 썼으면 메모와 선을 함께 없앤다
        setNodes((current) => current.filter((node) => node.id !== blockId))
        setEdges((current) => current.filter((edge) => edge.source !== blockId && edge.target !== blockId))
        return
      }
    }
    const changed = nodes.some((node) => {
      if (node.id !== blockId) return false
      const block = node.data.block as CanvasBlockData
      return block.kind !== 'pdfExcerpt'
        && block.kind !== 'markdownExcerpt'
        && block.kind !== 'arrow'
        && block.kind !== 'image'
        && !isShapeBlock(block)
        && block.text !== text
    })
    if (!changed) return
    rememberCurrentDocument()
    setNodes((current) => current.map((node) => {
      if (node.id !== blockId) return node
      const block = node.data.block as CanvasBlockData
      if (
        block.kind === 'pdfExcerpt'
        || block.kind === 'markdownExcerpt'
        || block.kind === 'arrow'
        || block.kind === 'image'
        || isShapeBlock(block)
        || block.text === text
      ) return node
      return { ...node, data: { block: { ...block, text } } } as NoteCanvasNode
    }))
  }, [nodes, rememberCurrentDocument, setNodes])

  const deleteBlock = useCallback((nodeId: string) => {
    if (!nodes.some((node) => node.id === nodeId)) return
    const drawing = nodes.some((node) => node.id === nodeId && isDrawingOverlay(node))
    rememberCurrentDocument()
    setNodes((current) => current.filter((node) => node.id !== nodeId))
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))
    announceAction(drawing ? t('도형을 삭제했습니다') : t('블록을 삭제했습니다'))
  }, [nodes, rememberCurrentDocument, setEdges, setNodes])

  const handleMenuAction = useCallback((action: BlockMenuAction) => {
    if (contextMenu === null || contextMenu.kind !== 'block') return
    const nodeId = contextMenu.nodeId
    const target = nodes.find((node) => node.id === nodeId)
    if (target === undefined) return

    if (action === 'delete') {
      deleteBlock(nodeId)
      return
    }
    if (action === 'disconnect') {
      if (!edges.some((edge) => edge.source === nodeId || edge.target === nodeId)) return
      rememberCurrentDocument()
      setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))
      announceAction(t('블록 연결을 해제했습니다'))
      return
    }
    if (action === 'duplicate') {
      const id = uniqueCopyId(nodeId, nodes, duplicateSequence)
      const block = structuredClone(target.data.block as CanvasBlockData)
      const copiedBlock = block.kind === 'pdfExcerpt'
        ? { ...block, excerpt: { ...block.excerpt, id } }
        : block
      setNodes((current) => [...current, {
        ...target,
        id,
        selected: false,
        position: normalizeCanvasPosition({ x: target.position.x + CANVAS_GRID_SIZE, y: target.position.y + CANVAS_GRID_SIZE }),
        data: { block: copiedBlock },
      } as NoteCanvasNode])
      return
    }
    if (action === 'savePreset') {
      const block = target.data.block as CanvasBlockData
      if (isPresettableCanvasBlock(block)) onSaveUserPreset?.(structuredClone(block))
      return
    }
    if (action === 'resetStyle') {
      const block = target.data.block as CanvasBlockData
      const style = createDefaultTextBlockStyle(block.style.level)
      rememberCurrentDocument()
      setNodes((current) => current.map((node) => {
        if (node.id !== nodeId) return node
        const currentBlock = node.data.block as CanvasBlockData
        const resetStyle = isShapeBlock(currentBlock)
          ? { ...style, background: 'transparent', borderColor: '#ef4444' }
          : currentBlock.kind === 'code'
            ? { ...style, code: true }
            : style
        return {
          ...node,
          data: { block: { ...currentBlock, style: resetStyle } as CanvasBlockData },
          style: canvasNodeStyle({ ...currentBlock, style: resetStyle } as CanvasBlockData),
        } as NoteCanvasNode
      }))
      announceAction(t('블록 스타일을 초기화했습니다'))
      return
    }
    if (action === 'bringForward') {
      rememberCurrentDocument()
      setNodes((current) => [...current.filter((node) => node.id !== nodeId), target])
      return
    }
    if (action === 'sendBackward') {
      rememberCurrentDocument()
      setNodes((current) => [target, ...current.filter((node) => node.id !== nodeId)])
      return
    }
    if (action === 'openSource') {
      const block = target.data.block as CanvasBlockData
      if (block.kind === 'pdfExcerpt') onOpenSource?.(createSourceJumpRequest(block.excerpt))
      if (block.kind === 'markdownExcerpt') onOpenSource?.(createMarkdownSourceJumpRequest(block.selection))
      return
    }
    if (action === 'translate' && onTranslateText !== undefined) {
      const block = target.data.block as CanvasBlockData
      if (
        block.kind === 'arrow'
        || block.kind === 'image'
        || isShapeBlock(block)
      ) return
      const text = block.kind === 'pdfExcerpt'
        ? block.source.anchor.quote
        : block.kind === 'markdownExcerpt'
          ? block.selection.quote
          : block.text
      if (text.trim() === '') return
      void onTranslateText(text).then((result) => {
        if (result === null) return
        if (!nodesRef.current.some(({ id }) => id === target.id)) return
        const translationId = `translation-${nextTranslationId.current++}`
        const translationWidth = 300
        const translationHeight = 140
        const anchor = block.kind === 'pdfExcerpt'
          ? block.source.anchor
          : block.kind === 'translation'
            ? block.source.anchor
            : undefined
        const translationNode: TranslationBlockFlowNode = {
          id: translationId,
          type: 'translation',
          position: normalizeCanvasPosition({
            x: target.position.x + block.width + 32,
            y: target.position.y,
          }),
          data: {
            block: {
              kind: 'translation',
              width: translationWidth,
              height: translationHeight,
              style: createDefaultTextBlockStyle(),
              text: result.text,
              sourceBlockId: target.id,
              targetLanguage: result.targetLanguage,
              model: result.model,
              source: {
                relation: 'translation',
                ...(anchor === undefined ? {} : { anchor }),
              },
            },
          },
          style: { width: translationWidth, height: translationHeight },
          dragHandle: '.drag-handle',
        }
        setNodes((current) => current.some(({ id }) => id === target.id)
          ? [...current, settleCanvasNode(translationNode, translationNode.position, [...current, translationNode])]
          : current)
        setEdges((current) => [...current, styledEdge({
          id: `edge-${target.id}-${translationId}`,
          source: target.id,
          target: translationId,
          sourceHandle: 'right',
          targetHandle: 'left',
        }, 'none', 'arrow')])
      }).catch(() => undefined)
    }
  }, [contextMenu, deleteBlock, edges, nodes, onOpenSource, onSaveUserPreset, onTranslateText, rememberCurrentDocument, setEdges, setNodes])

  const { selectedIds, selectedTextNodes, selectionStyle } = derivedNodeState

  const setBlockBackground = useCallback((background: string) => {
    const targetIds = contextMenu?.kind === 'block'
      ? new Set([contextMenu.nodeId])
      : selectedIds
    if (targetIds.size === 0) return
    rememberCurrentDocument()
    setNodes((current) => current.map((node) => targetIds.has(node.id)
      ? {
          ...node,
          data: { block: applyCanvasBlockCommand(node.data.block as CanvasBlockData, { type: 'setBlockBackground', background }) },
          style: {
            ...node.style,
            '--canvas-block-border-color': (node.data.block as CanvasBlockData).style.borderColor,
          } as CSSProperties,
        } as NoteCanvasNode
      : node))
    setContextMenu(null)
  }, [contextMenu, rememberCurrentDocument, selectedIds, setNodes])

  const setBlockBorderColor = useCallback((borderColor: string) => {
    if (selectedIds.size === 0) return
    rememberCurrentDocument()
    setNodes((current) => current.map((node) => {
      if (!selectedIds.has(node.id)) return node
      const block = applyCanvasBlockCommand(node.data.block as CanvasBlockData, {
        type: 'setBlockBorderColor',
        borderColor,
      })
      return {
        ...node,
        data: { block },
        style: { ...node.style, '--canvas-block-border-color': borderColor } as CSSProperties,
      } as NoteCanvasNode
    }))
  }, [rememberCurrentDocument, selectedIds, setNodes])

  const setBlockBorderWidth = useCallback((borderWidth: number) => {
    if (selectedIds.size === 0) return
    rememberCurrentDocument()
    setNodes((current) => current.map((node) => {
      if (!selectedIds.has(node.id)) return node
      const block = applyCanvasBlockCommand(node.data.block as CanvasBlockData, { type: 'setBlockBorderWidth', borderWidth })
      return { ...node, data: { block }, style: { ...node.style, ...canvasNodeStyle(block) } } as NoteCanvasNode
    }))
  }, [rememberCurrentDocument, selectedIds, setNodes])

  const applyFormat = useCallback((command: BlockFormatCommand) => {
    if (selectedIds.size === 0) return
    const before = canvasDocument(nodes, edges, viewportRef.current)
    let formatted = applyBlockFormat(before.nodes, selectedIds, command)
    if (command.type === 'setLevel') {
      formatted = applyBlockFormat(formatted, selectedIds, {
        type: 'setFontSize',
        fontSize: textBlockLevelFontSize(command.level),
      })
    }
    if (formatted === before.nodes) return
    historyRef.current = {
      past: [...historyRef.current.past.slice(-99), before],
      future: [],
    }
    const blocks = new Map(formatted.map((node) => [node.id, node.data.block]))
    setNodes((current) => current.map((node) => {
      const block = blocks.get(node.id)
      return block === undefined ? node : {
        ...node,
        data: { block },
        style: { ...node.style, '--canvas-block-border-color': block.style.borderColor } as CSSProperties,
      } as NoteCanvasNode
    }))
    setHistoryRevision((value) => value + 1)
  }, [edges, nodes, selectedIds, setNodes])

  const restoreHistory = useCallback((direction: 'undo' | 'redo') => {
    const source = direction === 'undo' ? historyRef.current.past : historyRef.current.future
    const target = source[source.length - 1]
    if (target === undefined) return
    const current = canvasDocument(nodes, edges, viewportRef.current)
    historyRef.current = direction === 'undo'
      ? { past: source.slice(0, -1), future: [...historyRef.current.future, current].slice(-100) }
      : { past: [...historyRef.current.past, current].slice(-100), future: source.slice(0, -1) }
    setNodes(restoredNodes(target))
    setEdges(restoredEdges(target))
    setHistoryRevision((value) => value + 1)
  }, [edges, nodes, setEdges, setNodes])

  const copySelected = useCallback(() => {
    if (selectedIds.size === 0) return
    clipboardRef.current = {
      nodes: nodes.filter((node) => selectedIds.has(node.id)).map((node) => ({
        ...node,
        data: { block: structuredClone(node.data.block as CanvasBlockData) },
      }) as NoteCanvasNode),
      edges: edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target)).map((edge) => ({ ...edge })),
    }
  }, [edges, nodes, selectedIds])

  const deleteSelected = useCallback(() => {
    const selectedEdgeIds = new Set(selectedEdges.map(({ id }) => id))
    if (selectedIds.size === 0 && selectedEdgeIds.size === 0) return
    rememberCurrentDocument()
    const next = executeCanvasCommand(
      canvasDocument(nodes, edges, viewportRef.current),
      { type: 'delete-selection' },
      { selectedNodeIds: [...selectedIds], selectedEdgeIds: [...selectedEdgeIds] },
    )
    setNodes(restoredNodes(next))
    setEdges(restoredEdges(next))
  }, [edges, nodes, rememberCurrentDocument, selectedEdges, selectedIds, setEdges, setNodes])

  const deleteSelectedEdges = useCallback(() => {
    const targetEdges = selectedEdges.length > 0
      ? selectedEdges
      : edges.filter((edge) => selectedIds.has(edge.source) || selectedIds.has(edge.target))
    if (targetEdges.length === 0) return
    rememberCurrentDocument()
    const selectedEdgeIds = new Set(targetEdges.map(({ id }) => id))
    setEdges((current) => current.filter(({ id }) => !selectedEdgeIds.has(id)))
    announceAction(t('연결선을 삭제했습니다'))
  }, [edges, rememberCurrentDocument, selectedEdges, selectedIds, setEdges])

  const disconnectEdge = useCallback((edgeId: string) => {
    if (!edges.some((edge) => edge.id === edgeId)) return
    rememberCurrentDocument()
    setEdges((current) => current.filter((edge) => edge.id !== edgeId))
    announceAction(t('연결선을 삭제했습니다'))
  }, [edges, rememberCurrentDocument, setEdges])

  const setEdgeMarker = useCallback((
    edgeId: string,
    end: 'start' | 'end',
    marker: CanvasEdgeMarker,
  ) => {
    if (!edges.some((edge) => edge.id === edgeId)) return
    rememberCurrentDocument()
    setEdges((current) => current.map((edge) => {
      if (edge.id !== edgeId) return edge
      const startMarker = end === 'start' ? marker : edge.data?.startMarker ?? 'none'
      const endMarker = end === 'end' ? marker : edge.data?.endMarker ?? 'none'
      return styledEdge(edge, startMarker, endMarker)
    }))
    setContextMenu(null)
    announceAction(t('연결선 끝 모양을 바꿨습니다'))
  }, [edges, rememberCurrentDocument, setEdges])

  const selectedBlockEdgeCount = edges.filter((edge) => selectedIds.has(edge.source) || selectedIds.has(edge.target)).length

  const pasteClipboard = useCallback(() => {
    const clipboard = clipboardRef.current
    if (clipboard === null || clipboard.nodes.length === 0) return
    rememberCurrentDocument()
    const idMap = new Map<string, string>()
    const pasted = clipboard.nodes.map((node) => {
      const id = uniqueCopyId(node.id, nodesRef.current, duplicateSequence)
      idMap.set(node.id, id)
      const block = structuredClone(node.data.block as CanvasBlockData)
      const copiedBlock = block.kind === 'pdfExcerpt'
        ? { ...block, excerpt: { ...block.excerpt, id } }
        : block
      return {
        ...node,
        id,
        selected: true,
        position: normalizeCanvasPosition({
          x: node.position.x + CANVAS_GRID_SIZE,
          y: node.position.y + CANVAS_GRID_SIZE,
        }),
        data: { block: copiedBlock },
      } as NoteCanvasNode
    })
    const pastedEdges = clipboard.edges.map((edge, index) => ({
      ...edge,
      id: `${edge.id}-copy-${duplicateSequence.current}-${index}`,
      source: idMap.get(edge.source) ?? edge.source,
      target: idMap.get(edge.target) ?? edge.target,
    }))
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false }) as NoteCanvasNode),
      ...pasted,
    ])
    setEdges((current) => [...current, ...pastedEdges])
  }, [rememberCurrentDocument, setEdges, setNodes])

  const duplicateSelected = useCallback(() => {
    copySelected()
    pasteClipboard()
  }, [copySelected, pasteClipboard])

  useAppShortcuts({
    save: () => emitDocument(nodes, edges, viewportRef.current),
    undo: () => restoreHistory('undo'),
    redo: () => restoreHistory('redo'),
    selectAll: () => setNodes((current) => current.map((node) => ({ ...node, selected: true }) as NoteCanvasNode)),
    copy: copySelected,
    cut: () => {
      copySelected()
      deleteSelected()
    },
    paste: pasteClipboard,
    duplicate: duplicateSelected,
    bold: () => applyFormat({ type: 'toggleBold' }),
    italic: () => applyFormat({ type: 'toggleItalic' }),
    underline: () => applyFormat({ type: 'toggleUnderline' }),
    heading1: () => applyFormat({ type: 'setLevel', level: 'h1' }),
    heading2: () => applyFormat({ type: 'setLevel', level: 'h2' }),
    heading3: () => applyFormat({ type: 'setLevel', level: 'h3' }),
    heading4: () => applyFormat({ type: 'setLevel', level: 'h4' }),
    heading5: () => applyFormat({ type: 'setLevel', level: 'h5' }),
    heading6: () => applyFormat({ type: 'setLevel', level: 'h6' }),
    delete: deleteSelected,
    escape: () => {
      setContextMenu(null)
      setNodes((current) => current.map((node) => ({ ...node, selected: false }) as NoteCanvasNode))
      setEdges((current) => current.map((edge) => ({ ...edge, selected: false })))
    },
    zoomIn: () => void zoomIn({ duration: 120 }),
    zoomOut: () => void zoomOut({ duration: 120 }),
    zoomReset: () => void zoomTo(1, { duration: 120 }),
  })

  const handleSourceTraceChange = useCallback((active: ActiveSourceTrace | null) => {
    setHoveredSourceId(active?.blockId ?? null)
    onSourceTraceChange?.(active)
  }, [onSourceTraceChange])

  const selectBlock = useCallback((blockId: string) => {
    setNodes((current) => current.map((node) => {
      const selected = node.id === blockId
      return node.selected === selected ? node : { ...node, selected } as NoteCanvasNode
    }))
    setEdges((current) => current.map((edge) => edge.selected ? { ...edge, selected: false } : edge))
  }, [setEdges, setNodes])

  const updateExcerptHighlights = useCallback((blockId: string, update: (highlights: readonly ExcerptHighlight[]) => readonly ExcerptHighlight[]) => {
    setNodes((current) => current.map((node) => {
      if (node.id !== blockId) return node
      const block = node.data.block as CanvasBlockData
      if (block.kind !== 'pdfExcerpt') return node
      const next = update(block.highlights ?? [])
      const { highlights: _previous, ...rest } = block
      return { ...node, data: { ...node.data, block: next.length === 0 ? rest : { ...rest, highlights: next } } } as NoteCanvasNode
    }))
  }, [setNodes])

  const addHighlight = useCallback((blockId: string, highlight: ExcerptHighlight) => {
    rememberCurrentDocument()
    updateExcerptHighlights(blockId, (current) => [...current, highlight])
    setHighlightColor(highlight.color)
    announceAction(t('형광펜을 칠했습니다'))
  }, [rememberCurrentDocument, updateExcerptHighlights])

  const recolorHighlight = useCallback((blockId: string, highlightId: string, color: ExcerptHighlightColor) => {
    rememberCurrentDocument()
    updateExcerptHighlights(blockId, (current) => current.map((highlight) => highlight.id === highlightId ? { ...highlight, color } : highlight))
    setHighlightColor(color)
  }, [rememberCurrentDocument, updateExcerptHighlights])

  const deleteHighlight = useCallback((blockId: string, highlightId: string) => {
    rememberCurrentDocument()
    updateExcerptHighlights(blockId, (current) => current.filter((highlight) => highlight.id !== highlightId))
    setEdges((current) => current.filter((edge) => !(
      (edge.source === blockId && highlightIdFromHandle(edge.sourceHandle) === highlightId)
      || (edge.target === blockId && highlightIdFromHandle(edge.targetHandle) === highlightId)
    )))
    announceAction(t('형광펜을 지웠습니다'))
  }, [rememberCurrentDocument, setEdges, updateExcerptHighlights])

  /** 형광펜 옆(발췌 오른쪽)에 메모를 만들고 형광펜에서 선을 잇는다. 메모는 바로 글쓰기 상태로 열린다 */
  const writeHighlightNote = useCallback((blockId: string, highlightId: string) => {
    const excerptNode = nodes.find((node) => node.id === blockId)
    const block = excerptNode?.data.block as CanvasBlockData | undefined
    if (excerptNode === undefined || block?.kind !== 'pdfExcerpt') return
    const highlight = block.highlights?.find(({ id }) => id === highlightId)
    if (highlight === undefined) return
    const { crop } = block.excerpt.selection
    const bounds = highlightBounds(highlight)
    const scale = block.width / crop.w
    const anchorY = excerptNode.position.y + (bounds.y + bounds.h / 2 - crop.y) * scale
    rememberCurrentDocument()
    const id = `paragraph-${nextBlockId.current.paragraph++}`
    const style = createDefaultTextBlockStyle('paragraph')
    const requested: CanvasBlockData = { kind: 'paragraph', width: 340, height: 40, style, text: '' }
    const size = normalizeCanvasBlockSize(requested, requested)
    const noteBlock = { ...requested, ...size } as CanvasBlockData
    const desired = normalizeCanvasPosition({ x: excerptNode.position.x + block.width + 80, y: anchorY - size.height / 2 })
    const note = {
      id,
      type: 'textBlock',
      position: normalizeCanvasPosition(vacantSpotRightOf(desired, size, nodes)),
      data: { block: noteBlock },
      ...canvasNodePresentation(noteBlock),
      dragHandle: '.drag-handle',
      className: 'note-canvas-node',
      selected: true,
    } as NoteCanvasNode
    highlightNoteIds.current.add(id)
    setNodes((current) => [
      ...current.map((node) => node.selected ? { ...node, selected: false } as NoteCanvasNode : node),
      note,
    ])
    setEdges((current) => [...current, styledEdge({
      id: `edge-${blockId}-${highlightId}-${id}`,
      source: blockId,
      sourceHandle: highlightHandleId(highlightId, 'right'),
      target: id,
      targetHandle: 'left',
    }, 'none', 'none')])
    setAutoEditBlockId(id)
    announceAction(t('형광펜 메모를 만들었습니다'))
  }, [nodes, rememberCurrentDocument, setEdges, setNodes])

  const runtime = useMemo(() => ({
    highlightTool,
    onAddHighlight: addHighlight,
    onSetHighlightColor: recolorHighlight,
    onDeleteHighlight: deleteHighlight,
    onWriteHighlightNote: writeHighlightNote,
    autoEditBlockId,
    onAutoEditStarted: () => setAutoEditBlockId(null),
    onOpenSource,
    onResizeFrame,
    onResizeCommit,
    onTextCommit,
    onSelectBlock: selectBlock,
    onDeleteBlock: deleteBlock,
    onSourceTraceChange: handleSourceTraceChange,
  }), [addHighlight, autoEditBlockId, deleteBlock, deleteHighlight, handleSourceTraceChange, highlightTool, onOpenSource, onResizeCommit, onResizeFrame, onTextCommit, recolorHighlight, selectBlock, writeHighlightNote])

  const onDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const createExcerptNode = useCallback((payload: PdfExcerptDragPayload, position: { x: number; y: number }) => {
    const id = `pdf-excerpt-${nextExcerptId.current++}`
    const matchedSize = matchPdfTextSize ? sizePdfExcerptToSelectedText(payload, viewportRef.current.zoom) : null
    const geometry = excerptGeometry(payload, position, matchedSize)
    const block = createPdfExcerptBlock({ id, ...payload, geometry })
    const canvasBlock: CanvasBlockData = {
      kind: 'pdfExcerpt',
      width: geometry.width,
      height: geometry.height,
      visualAspectRatio: geometry.width / geometry.height,
      style: createDefaultTextBlockStyle(),
      excerpt: block,
      source: { relation: 'excerpt', anchor: block.iwae.anchor },
    }
    const node: PdfExcerptFlowNode = {
      id,
      type: 'pdfExcerpt',
      position: { x: geometry.x, y: geometry.y },
      data: { block: canvasBlock },
      ...canvasNodePresentation(canvasBlock),
      dragHandle: '.drag-handle',
    }
    return { node, geometry, matchedTextSize: matchedSize !== null }
  }, [matchPdfTextSize])

  const insertExcerpt = useCallback((payload: PdfExcerptDragPayload, position: { x: number; y: number }) => {
    rememberCurrentDocument()
    const { node, matchedTextSize } = createExcerptNode(payload, position)
    setNodes((current) => [...current, settleCanvasNode(node, node.position, [...current, node]) as PdfExcerptFlowNode])
    if (matchPdfTextSize) announceAction(matchedTextSize ? t('PDF 글자 크기에 맞춰 붙였습니다') : t('선택 영역에 글자가 없어 원본 크기로 붙였습니다'))
  }, [createExcerptNode, matchPdfTextSize, rememberCurrentDocument, setNodes])

  const createMarkdownExcerptNode = useCallback((
    payload: MarkdownExcerptDragPayload,
    position: { x: number; y: number },
  ) => {
    const id = `markdown-excerpt-${nextMarkdownExcerptId.current++}`
    const geometry = markdownExcerptGeometry(payload, position)
    const canvasBlock: CanvasBlockData = {
      kind: 'markdownExcerpt',
      width: geometry.width,
      height: geometry.height,
      style: markdownExcerptStyle(payload.selection.format),
      selection: payload.selection,
      ...(payload.capture === undefined ? {} : { capture: payload.capture }),
      source: { relation: 'markdown-excerpt', selection: payload.selection },
    }
    const node: MarkdownExcerptFlowNode = {
      id,
      type: 'markdownExcerpt',
      position: { x: geometry.x, y: geometry.y },
      data: { block: canvasBlock },
      ...canvasNodePresentation(canvasBlock),
      dragHandle: '.drag-handle',
    }
    return { node, geometry }
  }, [])

  const insertMarkdownExcerpt = useCallback((
    payload: MarkdownExcerptDragPayload,
    position: { x: number; y: number },
  ) => {
    rememberCurrentDocument()
    const { node } = createMarkdownExcerptNode(payload, position)
    setNodes((current) => [
      ...current,
      settleCanvasNode(node, node.position, [...current, node]) as MarkdownExcerptFlowNode,
    ])
  }, [createMarkdownExcerptNode, rememberCurrentDocument, setNodes])

  useEffect(() => {
    if (
      insertRequest === undefined
      || insertRequest.targetNoteId !== undefined && insertRequest.targetNoteId !== noteId
      || lastInsertRequestId.current === insertRequest.id
    ) return
    lastInsertRequestId.current = insertRequest.id
    rememberCurrentDocument()
    const markdownRequest = isMarkdownExcerptInsertRequest(insertRequest)
    const created = markdownRequest
      ? createMarkdownExcerptNode(insertRequest.payload, visibleCanvasCenter())
      : createExcerptNode(insertRequest.payload, visibleCanvasCenter())
    const { node: excerptNode, geometry } = created
    if (!markdownRequest && matchPdfTextSize) {
      announceAction('matchedTextSize' in created && created.matchedTextSize
        ? t('PDF 글자 크기에 맞춰 붙였습니다')
        : t('선택 영역에 글자가 없어 원본 크기로 붙였습니다'))
    }
    if (insertRequest.translation === undefined) {
      setNodes((current) => [...current, settleCanvasNode(excerptNode, excerptNode.position, [...current, excerptNode]) as NoteCanvasNode])
      return
    }
    const translationId = `translation-${nextTranslationId.current++}`
    const translationWidth = 300
    const translationHeight = 140
    const translationBlock: CanvasBlockData = {
      kind: 'translation',
      width: translationWidth,
      height: translationHeight,
      style: createDefaultTextBlockStyle(),
      text: insertRequest.translation.text,
      sourceBlockId: excerptNode.id,
      targetLanguage: insertRequest.translation.targetLanguage,
      model: insertRequest.translation.model,
      source: markdownRequest
        ? { relation: 'translation' }
        : { relation: 'translation', anchor: insertRequest.payload.selection.anchor },
    }
    const translationNode: TranslationBlockFlowNode = {
      id: translationId,
      type: 'translation',
      position: normalizeCanvasPosition({ x: geometry.x + geometry.width + 32, y: geometry.y }),
      data: { block: translationBlock },
      style: canvasNodeStyle(translationBlock),
      initialWidth: translationWidth,
      initialHeight: translationHeight,
      dragHandle: '.drag-handle',
    }
    setNodes((current) => {
      const placedExcerpt = settleCanvasNode(excerptNode, excerptNode.position, [...current, excerptNode]) as NoteCanvasNode
      const placedTranslation = settleCanvasNode(
        translationNode,
        translationNode.position,
        [...current, placedExcerpt, translationNode],
      ) as TranslationBlockFlowNode
      return [...current, placedExcerpt, placedTranslation]
    })
    setEdges((current) => [...current, styledEdge({
      id: `edge-${excerptNode.id}-${translationId}`,
      source: excerptNode.id,
      target: translationId,
      sourceHandle: 'right',
      targetHandle: 'left',
    }, 'none', 'arrow')])
  }, [createExcerptNode, createMarkdownExcerptNode, insertRequest, matchPdfTextSize, noteId, rememberCurrentDocument, setEdges, setNodes, visibleCanvasCenter])

  const insertImageFiles = useCallback(async (files: readonly File[], position: { x: number; y: number }) => {
    if (files.length === 0) return
    try {
      const imported = await Promise.all(files.map((file) => importImageFile(file)))
      const images = imported.map((image, index) => {
        const width = Math.min(520, Math.max(180, image.width))
        const height = width * image.height / image.width
        const block: ImageCanvasBlock = {
          kind: 'image', width, height, src: image.src, alt: files[index]?.name ?? t('이미지'),
          style: createDefaultTextBlockStyle(),
        }
        return {
          id: `image-${nextImageId.current++}`,
          type: 'imageBlock',
          position: normalizeCanvasPosition({ x: position.x + index * 24, y: position.y + index * 24 }),
          data: { block }, ...canvasNodePresentation(block), dragHandle: '.drag-handle', className: 'note-canvas-node',
        } as ImageBlockFlowNode
      })
      rememberCurrentDocument()
      setNodes((current) => [...current, ...images])
      announceAction(t('이미지 {count}개를 추가했습니다', { count: images.length }))
    } catch (error) {
      announceAction(error instanceof Error ? error.message : t('이미지를 추가하지 못했습니다'))
    }
  }, [rememberCurrentDocument, setNodes])

  const dropData = useCallback((
    getData: (type: string) => string,
    files: readonly File[],
    clientX: number,
    clientY: number,
  ): boolean => {
    const pdfPayload = parsePdfExcerptDrag(getData(PDF_EXCERPT_DRAG_MIME))
    const markdownPayload = parseMarkdownExcerptDrag(getData(MARKDOWN_EXCERPT_DRAG_MIME))
    const imageFiles = files.filter((file) => file.type.startsWith('image/'))
    if (pdfPayload === null && markdownPayload === null && imageFiles.length === 0) return false
    const clientPosition = {
      x: Number.isFinite(clientX) ? clientX : 0,
      y: Number.isFinite(clientY) ? clientY : 0,
    }
    const requested = screenToFlowPosition(clientPosition)
    const position = Number.isFinite(requested.x) && Number.isFinite(requested.y)
      ? requested
      : clientPosition
    if (pdfPayload !== null) insertExcerpt(pdfPayload, position)
    else if (markdownPayload !== null) insertMarkdownExcerpt(markdownPayload, position)
    else void insertImageFiles(imageFiles, position)
    return true
  }, [insertExcerpt, insertImageFiles, insertMarkdownExcerpt, screenToFlowPosition])

  const onDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const handled = dropData(
      (type) => event.dataTransfer.getData(type),
      Array.from(event.dataTransfer.files ?? []),
      event.clientX,
      event.clientY,
    )
    if (handled) event.preventDefault()
  }, [dropData])

  // 앱 안 끌기(PDF·Markdown 발췌)는 포인터로 오고, 이 이벤트로 놓인다(core/internalDrag)
  useEffect(() => {
    const zone = flowRef.current
    if (zone === null) return
    const onInternalDrop = (event: Event) => {
      const detail = (event as CustomEvent<InternalDropDetail>).detail
      dropData((type) => detail.data[type] ?? '', [], detail.clientX, detail.clientY)
    }
    zone.addEventListener(INTERNAL_DROP_EVENT, onInternalDrop)
    return () => zone.removeEventListener(INTERNAL_DROP_EVENT, onInternalDrop)
  }, [dropData])

  /** Ctrl+끌어 놓기: 움직인 블록(과 그 위의 도형)을 놓은 자리에 복사하고 원본은 제자리로 */
  const copyDraggedNodes = useCallback(() => {
    const origins = dragStartPositionsRef.current
    ridersRef.current = null
    setMagnetContact(null)
    interactionRef.current = cancelCanvasInteraction()
    const current = nodesRef.current
    const moved = current.filter((node) => {
      const origin = origins.get(node.id)
      return origin !== undefined && (origin.x !== node.position.x || origin.y !== node.position.y)
    })
    if (moved.length === 0) return
    const copies = moved.map((node) => {
      const id = uniqueCopyId(node.id, current, duplicateSequence)
      const block = structuredClone(node.data.block as CanvasBlockData)
      const copiedBlock = block.kind === 'pdfExcerpt' ? { ...block, excerpt: { ...block.excerpt, id } } : block
      return {
        ...node,
        id,
        selected: true,
        position: normalizeCanvasNodePosition(copiedBlock, node.position),
        className: removeTransientClassNames(node.className),
        data: { block: copiedBlock },
      } as NoteCanvasNode
    })
    const next = [
      ...current.map((node) => {
        const origin = origins.get(node.id)
        const wasMoved = moved.some((candidate) => candidate.id === node.id)
        return wasMoved && origin !== undefined
          ? { ...node, position: origin, selected: false, className: removeTransientClassNames(node.className) } as NoteCanvasNode
          : node
      }),
      ...copies,
    ]
    nodesRef.current = next
    setNodes(next)
    emitDocument(next, edgesRef.current, viewportRef.current)
    announceAction(copies.length === 1 ? t('복사해서 놓았습니다') : t('{count}개를 복사해서 놓았습니다', { count: copies.length }))
  }, [emitDocument, setNodes])

  const startNodeDrag = useCallback((node: NoteCanvasNode) => {
    rememberCurrentDocument()
    dragStartPositionsRef.current = new Map(nodesRef.current.map((candidate) => [candidate.id, candidate.position]))
    ridersRef.current = isDrawingOverlay(node)
      ? null
      : { nodeId: node.id, origin: node.position, riders: ridingOverlays(node, nodesRef.current) }
    interactionRef.current = beginCanvasInteraction(interactionRef.current, {
      kind: 'dragging',
      nodeId: node.id,
      origin: node.position,
      current: node.position,
    })
    setMagnetContact(null)
    setNodes((current) => current.map((candidate) => ({
      ...candidate,
      className: setClassNameToken(
        removeClassName(candidate.className, 'canvas-node-snap-settle'),
        'canvas-node-lifted',
        candidate.id === node.id,
      ),
    }) as NoteCanvasNode))
  }, [rememberCurrentDocument, setNodes])

  const dragNode = useCallback((moving: NoteCanvasNode) => {
    interactionRef.current = updateCanvasInteraction(interactionRef.current, moving.position)
    scheduleNodeInternalsUpdate([moving.id], updateNodeInternals)
    window.dispatchEvent(new Event('iwae:canvas-geometry'))
    setMagnetContact(nearestMagnetContact(moving, nodesRef.current))
    setNodes((current) => {
      const scene = current.map((node) => node.id === moving.id ? { ...node, position: moving.position } as NoteCanvasNode : node)
      const contacts = contactingNodeIds(scene, { ...moving, data: moving.data } as NoteCanvasNode)
      return current.map((node) => ({
        ...node,
        className: setClassNameToken(
          setClassNameToken(node.className, 'canvas-node-lifted', node.id === moving.id),
          'canvas-node-contact',
          contacts.has(node.id),
        ),
      }) as NoteCanvasNode)
    })
  }, [setNodes, updateNodeInternals])

  const addCanvasBlock = useCallback((kind: CanvasBlockPreset) => {
    if (kind === 'rectangle' || kind === 'square' || kind === 'ellipse' || kind === 'diamond') {
      setDrawingTool((current) => current === kind ? null : kind)
      announceAction(t('캔버스 위에서 드래그해 도형을 그리세요'))
      setContextMenu(null)
      return
    }
    rememberCurrentDocument()
    const id = `${kind}-${nextBlockId.current[kind]++}`
    const style = createDefaultTextBlockStyle(kind === 'title' ? 'h1' : 'paragraph')
    const block: CanvasBlockData = kind === 'arrow'
      ? {
          kind: 'arrow',
          width: 200,
          height: 40,
          direction: 'right',
          style,
        }
      : {
          kind,
          width: kind === 'title' ? 320 : kind === 'code' ? 360 : 280,
          height: kind === 'title' ? 60 : kind === 'code' ? 120 : 80,
          style: kind === 'code' ? { ...style, code: true } : style,
          text: '',
        }
    const size = normalizeCanvasBlockSize(block, block)
    const center = visibleCanvasCenter()
    const requestedPosition = contextMenu?.kind === 'pane'
      ? contextMenu.position
      : { x: center.x - size.width / 2, y: center.y - size.height / 2 }
    const normalizedBlock = { ...block, ...size } as CanvasBlockData
    const node: NoteCanvasNode = {
      id,
      type: 'textBlock',
      position: normalizeCanvasPosition(requestedPosition),
      data: { block: normalizedBlock },
      ...canvasNodePresentation(normalizedBlock),
      dragHandle: '.drag-handle',
      className: 'note-canvas-node',
    } as NoteCanvasNode
    setNodes((current) => [...current, settleCanvasNode(node, node.position, [...current, node]) as NoteCanvasNode])
    announceAction(t('블록을 추가했습니다'))
    setContextMenu(null)
  }, [contextMenu, rememberCurrentDocument, setNodes, visibleCanvasCenter])

  const finishDrawing = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (drawingTool === null || drawingDraft === null) return
    const bounds = flowRef.current?.getBoundingClientRect()
    if (bounds === undefined) return
    const left = Math.min(drawingDraft.x1, event.clientX - bounds.left)
    const top = Math.min(drawingDraft.y1, event.clientY - bounds.top)
    const right = Math.max(drawingDraft.x1, event.clientX - bounds.left)
    const bottom = Math.max(drawingDraft.y1, event.clientY - bounds.top)
    const origin = screenToFlowPosition({ x: bounds.left + left, y: bounds.top + top })
    const opposite = screenToFlowPosition({ x: bounds.left + right, y: bounds.top + bottom })
    const style = { ...createDefaultTextBlockStyle(), background: 'transparent', borderColor: '#ef4444' }
    const drawnWidth = Math.max(opposite.x - origin.x, 24)
    const drawnHeight = Math.max(opposite.y - origin.y, 24)
    const squareSide = Math.max(drawnWidth, drawnHeight)
    const requested = { kind: drawingTool, width: drawingTool === 'square' ? squareSide : drawnWidth, height: drawingTool === 'square' ? squareSide : drawnHeight, style }
    const size = normalizeCanvasBlockSize(requested, requested)
    const block = { ...requested, ...size } as ShapeCanvasBlock
    const id = `${drawingTool}-${nextBlockId.current[drawingTool]++}`
    const node: NoteCanvasNode = {
      id, type: 'presetBlock', position: normalizeCanvasNodePosition(block, origin), data: { block },
      ...canvasNodePresentation(block), dragHandle: '.drag-handle', className: 'note-canvas-node', zIndex: DRAWING_OVERLAY_Z,
    } as NoteCanvasNode
    rememberCurrentDocument()
    setNodes((current) => [...current, node])
    setDrawingDraft(null)
    setDrawingTool(null)
    announceAction(t('그리기 도형을 추가했습니다'))
  }, [drawingDraft, drawingTool, rememberCurrentDocument, screenToFlowPosition, setNodes])

  const addUserPreset = useCallback((presetId: string) => {
    const preset = userPresets.find(({ id }) => id === presetId)
    if (preset === undefined) return
    rememberCurrentDocument()
    const block = structuredClone(preset.block)
    const kind = block.kind
    const id = `${kind}-${nextBlockId.current[kind]++}`
    const center = visibleCanvasCenter()
    const node: NoteCanvasNode = {
      id,
      type: isShapeBlock(block) ? 'presetBlock' : 'textBlock',
      position: normalizeCanvasPosition({ x: center.x - block.width / 2, y: center.y - block.height / 2 }),
      data: { block },
      ...canvasNodePresentation(block),
      dragHandle: '.drag-handle',
      className: 'note-canvas-node',
      ...(isShapeBlock(block) ? { zIndex: DRAWING_OVERLAY_Z } : {}),
    } as NoteCanvasNode
    setNodes((current) => [...current, settleCanvasNode(node, node.position, [...current, node]) as NoteCanvasNode])
  }, [rememberCurrentDocument, setNodes, userPresets, visibleCanvasCenter])

  const setConnectionMarker = useCallback((end: 'start' | 'end', marker: CanvasEdgeMarker) => {
    setConnectionMarkers((current) => ({ ...current, [end]: marker }))
    if (selectedEdges.length > 0) rememberCurrentDocument()
    setEdges((current) => current.map((edge) => {
      if (!edge.selected) return edge
      const startMarker = end === 'start' ? marker : edge.data?.startMarker ?? connectionMarkers.start
      const endMarker = end === 'end' ? marker : edge.data?.endMarker ?? connectionMarkers.end
      return styledEdge(edge, startMarker, endMarker)
    }))
  }, [connectionMarkers.end, connectionMarkers.start, rememberCurrentDocument, selectedEdges.length, setEdges])

  const setConnectionMode = useCallback((start: CanvasEdgeMarker, end: CanvasEdgeMarker) => {
    setConnectionMarkers({ start, end })
    if (selectedEdges.length > 0) rememberCurrentDocument()
    setEdges((current) => current.map((edge) => edge.selected ? styledEdge(edge, start, end) : edge))
    announceAction(t('연결선 종류를 바꿨습니다'))
  }, [rememberCurrentDocument, selectedEdges.length, setEdges])

  const shiftWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    const distance = event.deltaX === 0 ? event.deltaY : event.deltaX
    const viewport = getViewport()
    void setViewport({ ...viewport, x: viewport.x - distance })
  }, [getViewport, setViewport])

  const startRightPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 2 || (event.target as Element).closest('.react-flow__node') !== null) return
    rightPanRef.current = { active: true, moved: false, x: event.clientX, y: event.clientY }
  }, [])

  const trackRightPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = rightPanRef.current
    if (!gesture.active || gesture.moved) return
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= 4) {
      gesture.moved = true
    }
  }, [])

  const finishRightPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 2 || !rightPanRef.current.active) return
    suppressContextMenuRef.current = rightPanRef.current.moved
    rightPanRef.current.active = false
  }, [])

  const openPaneContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    if ((event.target as Element).closest('.react-flow__node') !== null) return
    if (suppressContextMenuRef.current) {
      suppressContextMenuRef.current = false
      return
    }
    setContextMenu({
      kind: 'pane',
      x: event.clientX,
      y: event.clientY,
      position: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    })
  }, [screenToFlowPosition])

  return (
    <>
      <NoteToolbar
        selectionStyle={selectionStyle}
        canFormat={selectedTextNodes.length > 0}
        canStyleBlock={selectedIds.size > 0}
        canUndo={historyRef.current.past.length > 0 && historyRevision >= 0}
        canRedo={historyRef.current.future.length > 0 && historyRevision >= 0}
        connectionStartMarker={connectionMarkers.start}
        connectionEndMarker={connectionMarkers.end}
        selectedEdgeCount={selectedEdges.length}
        selectedBlockEdgeCount={selectedBlockEdgeCount}
        matchPdfTextSize={matchPdfTextSize}
        onMatchPdfTextSizeChange={(enabled) => {
          setMatchPdfTextSize(enabled)
          announceAction(enabled ? t('PDF 글자 크기 맞춤 켜짐') : t('PDF 글자 크기 맞춤 꺼짐'))
        }}
        onCommand={applyFormat}
        onUndo={() => { restoreHistory('undo'); announceAction(t('실행을 취소했습니다')) }}
        onRedo={() => { restoreHistory('redo'); announceAction(t('다시 실행했습니다')) }}
        onSetConnectionStartMarker={(marker) => setConnectionMarker('start', marker)}
        onSetConnectionEndMarker={(marker) => setConnectionMarker('end', marker)}
        onSetConnectionMode={setConnectionMode}
        onDeleteSelectedEdges={deleteSelectedEdges}
        onAddPreset={addCanvasBlock}
        onAddImage={() => imageInputRef.current?.click()}
        activeDrawingTool={drawingTool}
        highlightToolActive={highlightTool !== null}
        onToggleHighlightTool={() => {
          setDrawingTool(null)
          setHighlightTool((current) => current === null ? knownHighlightColorId(highlightColors, highlightColor) : null)
        }}
        userPresets={userPresets}
        onAddUserPreset={addUserPreset}
        onSetBlockBackground={setBlockBackground}
        onSetBlockBorderColor={setBlockBorderColor}
        onSetBlockBorderWidth={setBlockBorderWidth}
        onToggleFullscreen={onToggleFullscreen ?? (() => undefined)}
        onExportWithEvidence={onExportWithEvidence === undefined
          ? undefined
          : () => onExportWithEvidence(canvasDocument(nodes, edges, viewportRef.current))}
      />
      <input ref={imageInputRef} type="file" accept="image/*" multiple hidden aria-label={t('이미지 파일 선택')}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          const center = visibleCanvasCenter()
          void insertImageFiles(files, { x: center.x - 180, y: center.y - 120 })
        }} />
      <div
        ref={flowRef}
        className="note-flow"
        data-internal-drop="canvas"
        onWheel={shiftWheel}
        onPointerDownCapture={startRightPan}
        onPointerMoveCapture={trackRightPan}
        onPointerUpCapture={finishRightPan}
        onContextMenu={openPaneContextMenu}
      >
      <CanvasBlockRuntimeProvider value={runtime}>
        <ReactFlow
          nodes={displayedNodes}
          edges={displayedEdges}
          edgeTypes={canvasEdgeTypes}
          nodeTypes={canvasNodeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onEdgeClick={(_, edge) => disconnectEdge(edge.id)}
          onEdgeContextMenu={(event, edge) => {
            event.preventDefault()
            event.stopPropagation()
            setContextMenu({ kind: 'edge', edgeId: edge.id, x: event.clientX, y: event.clientY })
          }}
          onConnect={onConnect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onNodeDragStart={(_, node) => startNodeDrag(node)}
          onNodeDrag={(_, node) => dragNode(node)}
          onNodeDragStop={(event, node) => {
            if (event.ctrlKey) copyDraggedNodes()
            else settleNode(node.id, node.position)
          }}
          onNodeContextMenu={(event, node) => {
            event.preventDefault()
            setContextMenu({ kind: 'block', nodeId: node.id, x: event.clientX, y: event.clientY })
          }}
          onPaneClick={() => setContextMenu(null)}
          onNodesDelete={(deleted) => setNodes((current) => current.filter((node) => !deleted.some(({ id }) => id === node.id)))}
          onEdgesDelete={(deleted) => setEdges((current) => current.filter((edge) => !deleted.some(({ id }) => id === edge.id)))}
          connectionMode={ConnectionMode.Loose}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          panOnDrag={[1, 2]}
          deleteKeyCode={null}
          minZoom={0.2}
          maxZoom={2.5}
          defaultViewport={initialDocument.viewport}
          onMoveEnd={(_, viewport) => {
            viewportRef.current = viewport
            emitDocument(nodes, edges, viewport)
          }}
        >
          <CanvasEdgeGeometrySync nodeIds={edgeGeometryNodeIds} />
          <Background gap={20} size={1} />
        </ReactFlow>
        {drawingTool !== null && (
          <div
            className="canvas-drawing-surface"
            role="application"
            aria-label={t('{tool} 그리기 영역', { tool: drawingTool })}
            onPointerDown={(event) => {
              if (event.button !== 0 || (event.target as Element).closest('button')) return
              const bounds = event.currentTarget.getBoundingClientRect()
              event.currentTarget.setPointerCapture?.(event.pointerId)
              setDrawingDraft({ x1: event.clientX - bounds.left, y1: event.clientY - bounds.top, x2: event.clientX - bounds.left, y2: event.clientY - bounds.top })
            }}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect()
              setDrawingDraft((draft) => draft === null ? null : { ...draft, x2: event.clientX - bounds.left, y2: event.clientY - bounds.top })
            }}
            onPointerUp={finishDrawing}
            onPointerCancel={() => setDrawingDraft(null)}
          >
            <div className="canvas-drawing-hint">{t('드래그해 도형 그리기')} <button type="button" onClick={() => { setDrawingTool(null); setDrawingDraft(null) }}>{t('취소')}</button></div>
            {drawingDraft !== null && <div className={`canvas-drawing-preview canvas-drawing-preview-${drawingTool}`} style={{ left: Math.min(drawingDraft.x1, drawingDraft.x2), top: Math.min(drawingDraft.y1, drawingDraft.y2), width: Math.abs(drawingDraft.x2 - drawingDraft.x1), height: Math.abs(drawingDraft.y2 - drawingDraft.y1) }} />}
          </div>
        )}
        {highlightTool === null ? null : (
          <div className="canvas-highlight-hint" role="toolbar" aria-label={t('형광펜 도구')}>
            <span>{t('발췌 위를 끌어서 칠하기')}</span>
            {highlightColors.map(({ id: color }) => (
              <button
                key={color}
                type="button"
                data-hl={color}
                className="excerpt-highlight-swatch"
                aria-label={t('{color} 형광펜', { color: highlightColorLabel(highlightColors, color) })}
                aria-pressed={highlightTool === color}
                onClick={() => {
                  setHighlightTool(color)
                  setHighlightColor(color)
                }}
              />
            ))}
            <button type="button" className="canvas-highlight-hint-done" onClick={() => setHighlightTool(null)}>{t('끝내기')}</button>
          </div>
        )}
        {contextMenu === null || contextMenu.kind !== 'block' ? null : (() => {
          const node = nodes.find((candidate) => candidate.id === contextMenu.nodeId)
          const block = node?.data.block as CanvasBlockData | undefined
          const canOpenSource = block?.kind === 'pdfExcerpt' || block?.kind === 'markdownExcerpt'
          const canSavePreset = block !== undefined && isPresettableCanvasBlock(block)
          const canTranslate = onTranslateText !== undefined
            && block !== undefined
            && block.kind !== 'arrow'
            && block.kind !== 'image'
            && !isShapeBlock(block)
            && (block.kind === 'pdfExcerpt'
              ? block.source.anchor.quote.length > 0
              : block.kind === 'markdownExcerpt'
                ? block.selection.quote.length > 0
                : block.text.length > 0)
          return (
            <BlockContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              canOpenSource={canOpenSource}
              canTranslate={canTranslate}
              canSavePreset={canSavePreset}
              canDisconnect={edges.some((edge) => edge.source === contextMenu.nodeId || edge.target === contextMenu.nodeId)}
              onAction={handleMenuAction}
              onClose={() => setContextMenu(null)}
            />
          )
        })()}
        {contextMenu === null || contextMenu.kind !== 'block' ? null : (
          <div
            className="canvas-block-background-menu"
            role="menu"
            aria-label={t('블록 배경')}
            style={{ left: `${contextMenu.x + 132}px`, top: `${contextMenu.y}px` }}
          >
            <button type="button" role="menuitem" onClick={() => setBlockBackground('#fff6c7')}>{t('블록 배경 노랑')}</button>
            <button type="button" role="menuitem" onClick={() => setBlockBackground('transparent')}>{t('블록 배경 없음')}</button>
          </div>
        )}
        {contextMenu === null || contextMenu.kind !== 'edge' ? null : (
          <>
            <button type="button" className="canvas-menu-backdrop" aria-label={t('연결선 메뉴 닫기')} onClick={() => setContextMenu(null)} />
            <div
              className="canvas-create-menu canvas-edge-menu"
              role="menu"
              aria-label={t('연결선 편집')}
              style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
            >
              <button type="button" role="menuitem" onClick={() => setEdgeMarker(contextMenu.edgeId, 'start', 'none')}>{t('시작점 없음')}</button>
              <button type="button" role="menuitem" onClick={() => setEdgeMarker(contextMenu.edgeId, 'start', 'arrow')}>{t('시작점 화살표')}</button>
              <button type="button" role="menuitem" onClick={() => setEdgeMarker(contextMenu.edgeId, 'end', 'none')}>{t('끝점 없음')}</button>
              <button type="button" role="menuitem" onClick={() => setEdgeMarker(contextMenu.edgeId, 'end', 'arrow')}>{t('끝점 화살표')}</button>
              <button
                type="button"
                role="menuitem"
                className="canvas-menu-danger"
                onClick={() => {
                  disconnectEdge(contextMenu.edgeId)
                  setContextMenu(null)
                }}
              >
                {t('연결선 삭제')}
              </button>
            </div>
          </>
        )}
        {contextMenu === null || contextMenu.kind !== 'pane' ? null : (
          <>
            <button type="button" className="canvas-menu-backdrop" aria-label={t('캔버스 메뉴 닫기')} onClick={() => setContextMenu(null)} />
            <div
              className="canvas-create-menu"
              role="menu"
              aria-label={t('블록 추가')}
              style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
            >
              <button
                type="button"
                role="menuitem"
                disabled={clipboardRef.current === null}
                onClick={() => { pasteClipboard(); setContextMenu(null) }}
              >
                {t('붙여넣기')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setNodes((current) => current.map((node) => ({ ...node, selected: true }) as NoteCanvasNode))
                  setContextMenu(null)
                }}
              >
                {t('모두 선택')}
              </button>
              <button type="button" role="menuitem" onClick={() => addCanvasBlock('title')}>{t('제목 블록 추가')}</button>
              <button type="button" role="menuitem" onClick={() => addCanvasBlock('paragraph')}>{t('본문 블록 추가')}</button>
              <button type="button" role="menuitem" onClick={() => addCanvasBlock('code')}>{t('코드 블록 추가')}</button>
              <button type="button" role="menuitem" onClick={() => addCanvasBlock('rectangle')}>{t('사각형 추가')}</button>
              <button type="button" role="menuitem" onClick={() => addCanvasBlock('square')}>{t('정사각형 추가')}</button>
              <button type="button" role="menuitem" onClick={() => addCanvasBlock('ellipse')}>{t('타원 추가')}</button>
              <button type="button" role="menuitem" onClick={() => addCanvasBlock('diamond')}>{t('마름모 추가')}</button>
              <button type="button" role="menuitem" onClick={() => addCanvasBlock('arrow')}>{t('화살표 블록 추가')}</button>
              {userPresets.map((preset) => (
                <button key={preset.id} type="button" role="menuitem" onClick={() => { addUserPreset(preset.id); setContextMenu(null) }}>
                  {t('{name} 프리셋 추가', { name: preset.name })}
                </button>
              ))}
            </div>
          </>
        )}
      </CanvasBlockRuntimeProvider>
      </div>
    </>
  )
}

export function NoteCanvas({
  noteId,
  title,
  onOpenSource,
  onSourceTraceChange,
  onSourceStateChange,
  initialDocument,
  onDocumentChange,
  saveStatus,
  saveError,
  onToggleFullscreen,
  onExportWithEvidence,
  insertRequest,
  onTranslateText,
  userPresets,
  onSaveUserPreset,
}: NoteCanvasProps) {
  const document = useMemo(
    () => initialDocument ?? createInitialCanvasDocument(title),
    [initialDocument, title],
  )
  return (
    <div className="note-canvas" role="application" aria-label={t('{title} 캔버스', { title })} data-note-id={noteId}>
      <ReactFlowProvider>
        <NoteFlow
          noteId={noteId}
          initialDocument={document}
          onDocumentChange={onDocumentChange}
          onOpenSource={onOpenSource}
          onSourceTraceChange={onSourceTraceChange}
          onSourceStateChange={onSourceStateChange}
          onToggleFullscreen={onToggleFullscreen}
          onExportWithEvidence={onExportWithEvidence}
          insertRequest={insertRequest}
      onTranslateText={onTranslateText}
      userPresets={userPresets}
      onSaveUserPreset={onSaveUserPreset}
        />
        <NoteBottomBar status={saveStatus} error={saveError} />
      </ReactFlowProvider>
    </div>
  )
}
