import { applyBlockFormat, type BlockFormatCommand } from './blockFormatting'
import {
  createDefaultTextBlockStyle,
  normalizeCanvasPosition,
  type CanvasBlockData,
  type CanvasBlockPreset,
  type CanvasDocumentV2,
  type CanvasEdgeMarker,
  type PersistedCanvasNode,
} from './canvasDocument'

export type CanvasCommand =
  | { readonly type: 'add-block'; readonly preset: CanvasBlockPreset }
  | { readonly type: 'delete-selection' }
  | { readonly type: 'duplicate-selection' }
  | { readonly type: 'format-selection'; readonly format: BlockFormatCommand }
  | { readonly type: 'set-block-background'; readonly color: string }
  | { readonly type: 'set-block-border'; readonly color: string }
  | { readonly type: 'set-edge-markers'; readonly start: CanvasEdgeMarker; readonly end: CanvasEdgeMarker }
  | { readonly type: 'bring-forward' }
  | { readonly type: 'send-backward' }

export interface CanvasCommandContext {
  readonly selectedNodeIds: readonly string[]
  readonly selectedEdgeIds: readonly string[]
  readonly insertionPoint?: { readonly x: number; readonly y: number }
}

function nextSequence(ids: ReadonlySet<string>, prefix: string): number {
  let sequence = 0
  while (ids.has(`${prefix}${sequence}`)) sequence += 1
  return sequence
}

function defaultBlock(preset: CanvasBlockPreset): CanvasBlockData {
  const style = createDefaultTextBlockStyle(preset === 'title' ? 'h1' : 'paragraph')
  if (preset === 'arrow') {
    return { kind: 'arrow', width: 200, height: 40, direction: 'right', style }
  }
  if (preset === 'rectangle' || preset === 'square' || preset === 'ellipse' || preset === 'diamond') {
    const square = preset === 'square' || preset === 'diamond'
    return {
      kind: preset,
      width: square ? 180 : 240,
      height: square ? 180 : 120,
      style: { ...style, background: 'transparent', borderColor: '#ef4444' },
    }
  }
  return {
    kind: preset,
    width: preset === 'title' ? 320 : preset === 'code' ? 360 : 280,
    height: preset === 'title' ? 60 : preset === 'code' ? 120 : 80,
    style: preset === 'code' ? { ...style, code: true } : style,
    text: '',
  }
}

function addBlock(document: CanvasDocumentV2, preset: CanvasBlockPreset, context: CanvasCommandContext): CanvasDocumentV2 {
  const ids = new Set(document.nodes.map(({ id }) => id))
  const id = `${preset}-${nextSequence(ids, `${preset}-`)}`
  const block = defaultBlock(preset)
  const node: PersistedCanvasNode = {
    id,
    type: preset === 'rectangle' || preset === 'square' || preset === 'ellipse' || preset === 'diamond' || preset === 'arrow'
      ? 'presetBlock'
      : 'textBlock',
    position: normalizeCanvasPosition(context.insertionPoint ?? { x: 0, y: 0 }),
    data: { block },
  }
  return { ...document, nodes: [...document.nodes, node] }
}

function deleteSelection(document: CanvasDocumentV2, context: CanvasCommandContext): CanvasDocumentV2 {
  const nodeIds = new Set(context.selectedNodeIds)
  const edgeIds = new Set(context.selectedEdgeIds)
  return {
    ...document,
    nodes: document.nodes.filter(({ id }) => !nodeIds.has(id)),
    edges: document.edges.filter((edge) => (
      !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target)
    )),
  }
}

function copiedId(ids: Set<string>, sourceId: string): string {
  let sequence = 1
  while (ids.has(`${sourceId}-copy-${sequence}`)) sequence += 1
  const id = `${sourceId}-copy-${sequence}`
  ids.add(id)
  return id
}

function duplicateSelection(document: CanvasDocumentV2, context: CanvasCommandContext): CanvasDocumentV2 {
  const selectedNodes = new Set(context.selectedNodeIds)
  const selectedEdges = new Set(context.selectedEdgeIds)
  const nodeIds = new Set(document.nodes.map(({ id }) => id))
  const edgeIds = new Set(document.edges.map(({ id }) => id))
  const copies = new Map<string, string>()
  const nodes = document.nodes.flatMap((node) => {
    if (!selectedNodes.has(node.id)) return [node]
    const id = copiedId(nodeIds, node.id)
    copies.set(node.id, id)
    return [node, {
      ...structuredClone(node),
      id,
      position: normalizeCanvasPosition({ x: node.position.x + 20, y: node.position.y + 10 }),
    }]
  })
  const duplicatedEdges = document.edges.flatMap((edge) => {
    const source = copies.get(edge.source)
    const target = copies.get(edge.target)
    if (source === undefined || target === undefined || !selectedEdges.has(edge.id)) return [edge]
    return [edge, { ...structuredClone(edge), id: copiedId(edgeIds, edge.id), source, target }]
  })
  return { ...document, nodes, edges: duplicatedEdges }
}

function styleSelection(
  document: CanvasDocumentV2,
  context: CanvasCommandContext,
  update: (block: CanvasBlockData) => CanvasBlockData,
): CanvasDocumentV2 {
  const selected = new Set(context.selectedNodeIds)
  return {
    ...document,
    nodes: document.nodes.map((node) => selected.has(node.id)
      ? { ...node, data: { block: update(node.data.block) } }
      : node),
  }
}

function reorderSelection(document: CanvasDocumentV2, context: CanvasCommandContext, forward: boolean): CanvasDocumentV2 {
  const selected = new Set(context.selectedNodeIds)
  const stationary = document.nodes.filter(({ id }) => !selected.has(id))
  const moving = document.nodes.filter(({ id }) => selected.has(id))
  return { ...document, nodes: forward ? [...stationary, ...moving] : [...moving, ...stationary] }
}

export function executeCanvasCommand(
  document: CanvasDocumentV2,
  command: CanvasCommand,
  context: CanvasCommandContext,
): CanvasDocumentV2 {
  switch (command.type) {
    case 'add-block':
      return addBlock(document, command.preset, context)
    case 'delete-selection':
      return deleteSelection(document, context)
    case 'duplicate-selection':
      return duplicateSelection(document, context)
    case 'format-selection':
      return { ...document, nodes: applyBlockFormat(document.nodes, new Set(context.selectedNodeIds), command.format) }
    case 'set-block-background':
      return styleSelection(document, context, (block) => ({ ...block, style: { ...block.style, background: command.color } } as CanvasBlockData))
    case 'set-block-border':
      return styleSelection(document, context, (block) => ({ ...block, style: { ...block.style, borderColor: command.color } } as CanvasBlockData))
    case 'set-edge-markers': {
      const selected = new Set(context.selectedEdgeIds)
      return {
        ...document,
        edges: document.edges.map((edge) => selected.has(edge.id)
          ? { ...edge, startMarker: command.start, endMarker: command.end }
          : edge),
      }
    }
    case 'bring-forward':
      return reorderSelection(document, context, true)
    case 'send-backward':
      return reorderSelection(document, context, false)
  }
}
