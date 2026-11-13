// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultTextBlockStyle, type TranslationCanvasBlock } from '../../core/canvasDocument'
import { CanvasBlockRuntimeProvider } from './CanvasBlockShell'
import { TranslationBlockNode } from './TranslationBlockNode'

vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  Handle: ({ id, className }: { id: string; className: string }) => <span data-handleid={id} className={className} />,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  useUpdateNodeInternals: () => vi.fn(),
}))

const block: TranslationCanvasBlock = {
  kind: 'translation',
  width: 300,
  height: 140,
  style: createDefaultTextBlockStyle(),
  text: '번역된 본문',
  sourceBlockId: 'pdf-excerpt-0',
  targetLanguage: 'ko',
  model: 'translategemma:4b',
  source: { relation: 'translation' },
}

describe('TranslationBlockNode', () => {
  it('번역문은 클릭 전 이동 모드이고 언어와 모델을 블록 내부 footer에 표시한다', () => {
    const props = { id: 'translation-0', data: { block }, selected: false } as unknown as Parameters<typeof TranslationBlockNode>[0]
    const view = render(
      <CanvasBlockRuntimeProvider value={{}}>
        <TranslationBlockNode {...props} />
      </CanvasBlockRuntimeProvider>,
    )

    expect(screen.getByRole('textbox').getAttribute('contenteditable')).toBe('false')
    expect(view.container.querySelector('.canvas-block-source-footer')?.textContent).toContain('ko')
    expect(view.container.querySelector('.canvas-block-source-footer')?.textContent).toContain('translategemma:4b')
    expect(view.container.querySelector('.canvas-block-shell')?.contains(view.container.querySelector('.canvas-block-source-footer'))).toBe(true)
  })

  it('수정한 번역문을 blur에서 확정한다', () => {
    const onTextCommit = vi.fn()
    const props = { id: 'translation-0', data: { block }, selected: true } as unknown as Parameters<typeof TranslationBlockNode>[0]
    render(
      <CanvasBlockRuntimeProvider value={{ onTextCommit }}>
        <TranslationBlockNode {...props} />
      </CanvasBlockRuntimeProvider>,
    )
    const editor = screen.getByRole('textbox')
    fireEvent.doubleClick(editor)
    editor.textContent = '수정된 번역'
    fireEvent.blur(editor)
    expect(onTextCommit).toHaveBeenCalledWith('translation-0', '수정된 번역')
  })

  it('번역문은 내부 스크롤 없이 내용 높이에 맞춰 확장된다', () => {
    const props = { id: 'translation-0', data: { block }, selected: false } as unknown as Parameters<typeof TranslationBlockNode>[0]
    render(
      <CanvasBlockRuntimeProvider value={{}}>
        <TranslationBlockNode {...props} />
      </CanvasBlockRuntimeProvider>,
    )

    const editor = screen.getByRole('textbox')
    expect(editor.style.overflow).toBe('visible')
    expect(editor.dataset.canvasAutoGrow).toBe('true')
  })

})
