import type { CanvasPoint, CanvasSize } from './canvasGeometry'

export type CanvasInteractionState =
  | { readonly kind: 'idle' }
  | {
    readonly kind: 'dragging'
    readonly nodeId: string
    readonly origin: CanvasPoint
    readonly current: CanvasPoint
  }
  | {
    readonly kind: 'resizing'
    readonly nodeId: string
    readonly origin: CanvasSize
    readonly current: CanvasSize
  }

export function beginCanvasInteraction(
  state: CanvasInteractionState,
  input: Exclude<CanvasInteractionState, { kind: 'idle' }>,
): CanvasInteractionState {
  return state.kind === 'idle' ? input : state
}

export function updateCanvasInteraction(
  state: CanvasInteractionState,
  value: CanvasPoint | CanvasSize,
): CanvasInteractionState {
  if (state.kind === 'dragging' && 'x' in value && 'y' in value) {
    return { ...state, current: value }
  }
  if (state.kind === 'resizing' && 'width' in value && 'height' in value) {
    return { ...state, current: value }
  }
  return state
}

export function commitCanvasInteraction(state: CanvasInteractionState): { readonly nodeId: string } | null {
  return state.kind === 'idle' ? null : { nodeId: state.nodeId }
}

export function cancelCanvasInteraction(): CanvasInteractionState {
  return { kind: 'idle' }
}
