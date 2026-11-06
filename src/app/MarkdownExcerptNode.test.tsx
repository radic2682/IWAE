// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultTextBlockStyle, type MarkdownExcerptCanvasBlock } from '../core/canvasDocument'
import { CanvasBlockRuntimeProvider } from './CanvasBlockShell'
import { MarkdownExcerptNode } from './MarkdownExcerptNode'

vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  Handle: ({ id, className }: { id: string; className: string }) => <span data-handleid={id} className={className} />,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  useUpdateNodeInternals: () => vi.fn(),
}))

const selection = {
  path: 'docs/guide.md',
  title: 'Guide',
  quote: '중요한 제목',
  prefix: '',
  suffix: ' 본문',
  startOffset: 0,
  endOffset: 6,
  format: 'heading-2' as const,
}

const block: MarkdownExcerptCanvasBlock = {
  kind: 'markdownExcerpt',
  width: 280,
  height: 70,
  style: createDefaultTextBlockStyle('h2'),
  selection,
  source: { relation: 'markdown-excerpt', selection },
}

describe('MarkdownExcerptNode', () => {
  it('Markdown 의미 형식과 내부 REF를 렌더링하고 원문 열기 요청을 보낸다', () => {
    const onOpenSource = vi.fn()
    const props = { id: 'markdown-excerpt-0', data: { block }, selected: false } as unknown as Parameters<typeof MarkdownExcerptNode>[0]
    const view = render(
      <CanvasBlockRuntimeProvider value={{ onOpenSource }}>
        <MarkdownExcerptNode {...props} />
      </CanvasBlockRuntimeProvider>,
    )

    expect(view.container.querySelector('.markdown-excerpt-content-heading-2')?.textContent).toBe('중요한 제목')
    const body = view.container.querySelector('.canvas-block-body') as HTMLElement
    expect(body.style.overflow).toBe('hidden')
    expect(body.style.userSelect).toBe('none')
    expect(body.classList.contains('drag-handle')).toBe(true)
    const source = view.container.querySelector('[data-markdown-excerpt-source="markdown-excerpt-0"]') as HTMLButtonElement
    expect(source.textContent).toContain('REF')
    expect(source.parentElement?.dataset.refFooter).toBe('true')
    fireEvent.click(source)
    expect(onOpenSource).toHaveBeenCalledWith({
      kind: 'markdown',
      path: 'docs/guide.md',
      startOffset: 0,
      endOffset: 6,
      quote: '중요한 제목',
    })
  })
})
