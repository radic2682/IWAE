import type { TextBlockStyle } from '../../core/canvasDocument'
import type { CanvasSourceReference } from '../../core/workspaceSources'
import type { CanvasNode } from '../documents/PdfExcerptNode'

export interface CanvasNodeState {
  readonly selectedIds: ReadonlySet<string>
  readonly selectedTextNodes: readonly CanvasNode[]
  readonly selectionStyle: TextBlockStyle | null
  readonly sourceReferences: readonly CanvasSourceReference[]
  readonly selectedSourceIds: ReadonlySet<string>
}

export function deriveCanvasNodeState(nodes: readonly CanvasNode[]): CanvasNodeState {
  const selectedIds = new Set<string>()
  const selectedTextNodes: CanvasNode[] = []
  const references: CanvasSourceReference[] = []
  const selectedSourceIds = new Set<string>()
  let selectionStyle: TextBlockStyle | null = null

  for (const node of nodes) {
    const block = node.data.block
    if (node.selected) {
      selectedIds.add(node.id)
      if (block.kind !== 'pdfExcerpt' && block.kind !== 'markdownExcerpt' && block.kind !== 'arrow') {
        selectedTextNodes.push(node)
        selectionStyle ??= block.style
      }
    }

    if (block.kind === 'pdfExcerpt') {
      references.push({ blockId: node.id, anchor: block.source.anchor, relation: 'excerpt' })
      if (node.selected) selectedSourceIds.add(node.id)
    } else if (block.kind === 'translation' && block.source.anchor !== undefined) {
      references.push({ blockId: node.id, anchor: block.source.anchor, relation: 'translation' })
      if (node.selected) selectedSourceIds.add(node.id)
    } else if (block.kind === 'markdownExcerpt') {
      references.push({
        blockId: node.id,
        relation: 'markdown-excerpt',
        selection: block.source.selection,
      })
      if (node.selected) selectedSourceIds.add(node.id)
    }
  }

  return {
    selectedIds,
    selectedTextNodes,
    selectionStyle,
    sourceReferences: references,
    selectedSourceIds,
  }
}
