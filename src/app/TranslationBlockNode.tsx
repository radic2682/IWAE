import type { Node, NodeProps } from '@xyflow/react'
import type { TranslationCanvasBlock } from '../core/canvasDocument'
import { CanvasBlockShell, useCanvasBlockRuntime } from './CanvasBlockShell'
import { CanvasTextEditor } from './TextBlockNode'
import type { CanvasSide } from '../core/canvasPorts'

export interface TranslationBlockNodeData extends Record<string, unknown> {
  readonly block: TranslationCanvasBlock
  readonly touchingSides?: ReadonlySet<CanvasSide>
}

export type TranslationBlockFlowNode = Node<TranslationBlockNodeData, 'translation'>

export function TranslationBlockNode({ id, data, selected }: NodeProps<TranslationBlockFlowNode>) {
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
      sourceFooter={(
        <span className="translation-block-meta">
          {block.targetLanguage} · {block.model}
        </span>
      )}
    >
      <CanvasTextEditor id={id} block={block} selected={selected} />
    </CanvasBlockShell>
  )
}

export const translationBlockNodeTypes = {
  translation: TranslationBlockNode,
}
