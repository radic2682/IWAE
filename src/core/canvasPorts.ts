export type CanvasSide = 'top' | 'right' | 'bottom' | 'left'

const CANVAS_SIDES = ['top', 'right', 'bottom', 'left'] as const

export function visibleCanvasPorts(
  _node: { readonly id: string },
  touchingSides: ReadonlySet<CanvasSide>,
  _selected: boolean,
): readonly CanvasSide[] {
  return CANVAS_SIDES.filter((side) => !touchingSides.has(side))
}

type UpdateNodeInternals = (nodeIds: string | string[]) => void

interface PendingUpdate {
  readonly ids: Set<string>
  frame: number | null
}

const pendingUpdates = new Map<UpdateNodeInternals, PendingUpdate>()

export function scheduleNodeInternalsUpdate(
  nodeIds: readonly string[],
  updateNodeInternals: UpdateNodeInternals,
): void {
  let pending = pendingUpdates.get(updateNodeInternals)
  if (pending === undefined) {
    pending = { ids: new Set<string>(), frame: null }
    pendingUpdates.set(updateNodeInternals, pending)
  }
  for (const nodeId of nodeIds) pending.ids.add(nodeId)
  if (pending.frame !== null) return

  const flush = () => {
    const current = pendingUpdates.get(updateNodeInternals)
    if (current === undefined) return
    pendingUpdates.delete(updateNodeInternals)
    updateNodeInternals([...current.ids])
  }

  if (typeof requestAnimationFrame !== 'function') {
    flush()
    return
  }
  pending.frame = requestAnimationFrame(flush)
}
