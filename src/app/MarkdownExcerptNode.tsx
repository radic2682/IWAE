import { useEffect } from 'react'
import { type Node, type NodeProps } from '@xyflow/react'
import type { MarkdownExcerptCanvasBlock } from '../core/canvasDocument'
import { createMarkdownSourceJumpRequest } from '../core/markdownExcerpt'
import { CanvasBlockShell, useCanvasBlockRuntime } from './CanvasBlockShell'
import type { CanvasSide } from '../core/canvasPorts'
import { t } from '../i18n'

export interface MarkdownExcerptNodeData extends Record<string, unknown> {
  readonly block: MarkdownExcerptCanvasBlock
  readonly touchingSides?: ReadonlySet<CanvasSide>
}

export type MarkdownExcerptFlowNode = Node<MarkdownExcerptNodeData, 'markdownExcerpt'>

export function MarkdownExcerptNode({ id, data, selected }: NodeProps<MarkdownExcerptFlowNode>) {
  const runtime = useCanvasBlockRuntime()
  const { block } = data
  const { selection } = block

  useEffect(() => {
    if (selected) runtime.onSourceTraceChange?.({ blockId: id, selection })
  }, [id, runtime, selected, selection])

  const sourceFooter = (
    <button
      type="button"
      className="markdown-excerpt-source nodrag"
      aria-label={t('{title} Markdown 출처 열기', { title: selection.title })}
      data-markdown-excerpt-source={id}
      data-source-trace-side="left"
      onClick={() => runtime.onOpenSource?.(createMarkdownSourceJumpRequest(selection))}
    >
      <span>REF</span>
      <span>{selection.title}</span>
    </button>
  )

  return (
    <div
      className="markdown-excerpt-node drag-handle"
      role="group"
      aria-label={t('Markdown 발췌: {quote}', { quote: selection.quote })}
      data-markdown-excerpt-node={id}
    >
      <CanvasBlockShell
        id={id}
        block={block}
        selected={selected}
        touchingSides={data.touchingSides}
        sourceFooter={sourceFooter}
        onResizeFrame={runtime.onResizeFrame}
        onResizeCommit={runtime.onResizeCommit}
        onDelete={runtime.onDeleteBlock}
      >
        {block.capture === undefined ? (
          <div className={`markdown-excerpt-content markdown-excerpt-content-${selection.format}`}>
            {selection.quote}
          </div>
        ) : (
          <div
            className={`markdown-excerpt-content markdown-excerpt-content-${selection.format} markdown-capture-content`}
            dangerouslySetInnerHTML={{ __html: block.capture.renderedSnapshot }}
          />
        )}
      </CanvasBlockShell>
    </div>
  )
}

export const markdownExcerptNodeTypes = { markdownExcerpt: MarkdownExcerptNode }
