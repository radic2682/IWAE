export interface CanvasPoint {
  readonly x: number
  readonly y: number
}

export interface CanvasSize {
  readonly width: number
  readonly height: number
}

export interface CanvasRect extends CanvasPoint, CanvasSize {
  readonly id: string
  readonly allowOverlap: boolean
}

export interface PlacementPolicy {
  readonly gridX: number
  readonly gridY: number
  readonly contactGap: number
}

export interface SettledPlacement extends CanvasPoint {
  readonly attachedTo: string | null
  readonly side: 'left' | 'right' | 'top' | 'bottom' | null
}

function snap(value: number, grid: number, mode: 'nearest' | 'ceil' = 'nearest'): number {
  const units = value / grid
  const result = (mode === 'ceil' ? Math.ceil(units) : Math.round(units)) * grid
  return Object.is(result, -0) ? 0 : result
}

export function snapCanvasPoint(point: CanvasPoint, policy: PlacementPolicy): CanvasPoint {
  return {
    x: snap(point.x, policy.gridX),
    y: snap(point.y, policy.gridY),
  }
}

export function resizeCanvasBlock(
  block: { readonly kind: string; readonly aspectRatio?: number },
  requested: CanvasSize,
  contentHeight = 0,
): CanvasSize {
  if (block.aspectRatio !== undefined && Number.isFinite(block.aspectRatio) && block.aspectRatio > 0) {
    const width = Math.max(1, requested.width)
    return { width, height: width / block.aspectRatio }
  }

  const width = Math.max(180, snap(requested.width, 20))
  const requestedHeight = contentHeight > 0 ? contentHeight : requested.height
  const height = Math.max(40, snap(requestedHeight, 10, contentHeight > 0 ? 'ceil' : 'nearest'))
  return { width, height }
}

function overlaps(left: CanvasRect, right: CanvasRect, gap: number): boolean {
  return left.x < right.x + right.width + gap
    && left.x + left.width + gap > right.x
    && left.y < right.y + right.height + gap
    && left.y + left.height + gap > right.y
}

function moved(rect: CanvasRect, point: CanvasPoint): CanvasRect {
  return { ...rect, ...point }
}

function sideCandidates(moving: CanvasRect, fixed: CanvasRect, policy: PlacementPolicy): readonly SettledPlacement[] {
  return [
    {
      x: fixed.x + fixed.width + policy.contactGap,
      y: moving.y,
      attachedTo: fixed.id,
      side: 'right',
    },
    {
      x: moving.x,
      y: fixed.y + fixed.height + policy.contactGap,
      attachedTo: fixed.id,
      side: 'bottom',
    },
    {
      x: fixed.x - moving.width - policy.contactGap,
      y: moving.y,
      attachedTo: fixed.id,
      side: 'left',
    },
    {
      x: moving.x,
      y: fixed.y - moving.height - policy.contactGap,
      attachedTo: fixed.id,
      side: 'top',
    },
  ]
}

export function nearestVacantCanvasPoint(
  moving: CanvasRect,
  scene: readonly CanvasRect[],
  policy: PlacementPolicy,
): SettledPlacement {
  const desired = { x: moving.x, y: moving.y }
  if (moving.allowOverlap) return { ...desired, attachedTo: null, side: null }

  const obstacles = scene.filter((candidate) => candidate.id !== moving.id && !candidate.allowOverlap)
  const atDesired = moved(moving, desired)
  const blockers = obstacles.filter((candidate) => overlaps(atDesired, candidate, policy.contactGap))
  if (blockers.length === 0) return { ...desired, attachedTo: null, side: null }

  const orderedBlockers = [...blockers].sort((left, right) => {
    const leftDistance = (left.x - desired.x) ** 2 + (left.y - desired.y) ** 2
    const rightDistance = (right.x - desired.x) ** 2 + (right.y - desired.y) ** 2
    return leftDistance - rightDistance || left.id.localeCompare(right.id)
  })

  const sideOrder = new Map([['right', 0], ['bottom', 1], ['left', 2], ['top', 3]] as const)
  const vacantCandidates = orderedBlockers
    .flatMap((blocker) => sideCandidates(atDesired, blocker, policy))
    .filter((candidate) => !obstacles.some((obstacle) => overlaps(moved(moving, candidate), obstacle, policy.contactGap)))
    .sort((left, right) => {
      const leftDistance = (left.x - desired.x) ** 2 + (left.y - desired.y) ** 2
      const rightDistance = (right.x - desired.x) ** 2 + (right.y - desired.y) ** 2
      return leftDistance - rightDistance
        || (sideOrder.get(left.side!) ?? 4) - (sideOrder.get(right.side!) ?? 4)
        || left.attachedTo!.localeCompare(right.attachedTo!)
    })
  if (vacantCandidates[0] !== undefined) return vacantCandidates[0]

  for (let ring = 1; ring <= 512; ring += 1) {
    const candidates = [
      { x: desired.x + ring * policy.gridX, y: desired.y },
      { x: desired.x, y: desired.y + ring * policy.gridY },
      { x: desired.x - ring * policy.gridX, y: desired.y },
      { x: desired.x, y: desired.y - ring * policy.gridY },
    ]
    for (const candidate of candidates) {
      if (!obstacles.some((obstacle) => overlaps(moved(moving, candidate), obstacle, policy.contactGap))) {
        return { ...candidate, attachedTo: null, side: null }
      }
    }
  }

  return { ...desired, attachedTo: null, side: null }
}

export function settleCanvasPlacement(
  moving: CanvasRect,
  desired: CanvasPoint,
  scene: readonly CanvasRect[],
  policy: PlacementPolicy,
): SettledPlacement {
  const snapped = snapCanvasPoint(desired, policy)
  return nearestVacantCanvasPoint({ ...moving, ...snapped }, scene, policy)
}
