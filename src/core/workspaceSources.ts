import type { Anchor } from './anchor'
import type { CanvasDocumentV2 } from './canvasDocument'
import type { MarkdownExcerptSelection } from './markdownExcerpt'

export interface PdfCanvasSourceReference {
  readonly blockId: string
  readonly anchor: Anchor
  readonly relation: 'excerpt' | 'translation'
}

export interface MarkdownCanvasSourceReference {
  readonly blockId: string
  readonly selection: MarkdownExcerptSelection
  readonly relation: 'markdown-excerpt'
}

export type CanvasSourceReference = PdfCanvasSourceReference | MarkdownCanvasSourceReference

export interface SourceInteractionState {
  readonly selectedIds: ReadonlySet<string>
  readonly hoveredId: string | null
}

interface VisibleSourceState {
  readonly selected: boolean
  readonly hovered: boolean
  readonly visibleOnCurrentPage: boolean
}

export type VisiblePdfSourceReference = PdfCanvasSourceReference & VisibleSourceState
export type VisibleMarkdownSourceReference = MarkdownCanvasSourceReference & VisibleSourceState
export type VisibleSourceReference = VisiblePdfSourceReference | VisibleMarkdownSourceReference

export interface WorkspaceSourceInput extends SourceInteractionState {
  readonly references: readonly CanvasSourceReference[]
  readonly activeDocId: string
  readonly activeMarkdownPath?: string
  readonly currentPage: number
}

export function canvasSourceReferences(document: CanvasDocumentV2): readonly CanvasSourceReference[] {
  const references: CanvasSourceReference[] = []
  for (const node of document.nodes) {
    const { block } = node.data
    if (block.kind === 'pdfExcerpt') {
      references.push({ blockId: node.id, anchor: block.source.anchor, relation: 'excerpt' })
    } else if (block.kind === 'translation' && block.source.anchor !== undefined) {
      references.push({ blockId: node.id, anchor: block.source.anchor, relation: 'translation' })
    } else if (block.kind === 'markdownExcerpt') {
      references.push({
        blockId: node.id,
        relation: 'markdown-excerpt',
        selection: block.source.selection,
      })
    }
  }
  return references
}

export function visibleWorkspaceSources(
  input: WorkspaceSourceInput,
): readonly VisibleSourceReference[] {
  const visible: VisibleSourceReference[] = []

  for (const reference of input.references) {
    const selected = input.selectedIds.has(reference.blockId)
    const hovered = input.hoveredId === reference.blockId
    const belongsToActiveDocument = reference.relation === 'markdown-excerpt'
      ? reference.selection.path === input.activeMarkdownPath
      : reference.anchor.docId === input.activeDocId
    const visibleOnCurrentPage = reference.relation === 'markdown-excerpt'
      ? belongsToActiveDocument
      : belongsToActiveDocument && reference.anchor.page === input.currentPage

    if (!selected && !hovered && !belongsToActiveDocument) continue

    visible.push({
      ...reference,
      selected,
      hovered,
      visibleOnCurrentPage,
    })
  }

  return visible
}
