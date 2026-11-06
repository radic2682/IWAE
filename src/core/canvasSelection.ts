import type { CanvasViewport } from './canvasDocument'

export interface CanvasSelectionRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface CanvasSelectableRect extends CanvasSelectionRect {
  readonly id: string
  readonly selectable: boolean
}

export interface CanvasPoint {
  readonly x: number
  readonly y: number
}

function normalizedRect(rect: CanvasSelectionRect): CanvasSelectionRect {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  }
}

function intersects(left: CanvasSelectionRect, right: CanvasSelectionRect): boolean {
  return left.x <= right.x + right.width
    && left.x + left.width >= right.x
    && left.y <= right.y + right.height
    && left.y + left.height >= right.y
}

export function intersectingNodeIds(
  selectionRect: CanvasSelectionRect,
  nodes: readonly CanvasSelectableRect[],
): string[] {
  const selection = normalizedRect(selectionRect)
  return nodes
    .filter((node) => node.selectable && intersects(selection, normalizedRect(node)))
    .map(({ id }) => id)
}

export function screenPointToCanvas(point: CanvasPoint, viewport: CanvasViewport): CanvasPoint {
  const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1
  return {
    x: (point.x - viewport.x) / zoom,
    y: (point.y - viewport.y) / zoom,
  }
}

export function rightDragCrossedThreshold(
  origin: CanvasPoint,
  current: CanvasPoint,
  threshold = 5,
): boolean {
  return Math.hypot(current.x - origin.x, current.y - origin.y) > threshold
}
