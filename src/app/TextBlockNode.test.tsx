// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultTextBlockStyle, type TextCanvasBlock } from '../core/canvasDocument'
import { CanvasBlockRuntimeProvider } from './CanvasBlockShell'
import { TextBlockNode, textBlockCss } from './TextBlockNode'

vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  Handle: ({ id, className }: { id: string; className: string }) => <span data-handleid={id} className={className} />,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  useUpdateNodeInternals: () => vi.fn(),
}))

const block: TextCanvasBlock = {
  kind: 'paragraph',
  width: 300,
  height: 120,
  style: { ...createDefaultTextBlockStyle(), bold: true, align: 'center', fontSize: 18 },
  text: '선택 가능한 본문',
}

describe('TextBlockNode', () => {
  it('기본 상태에서는 블록 전체가 드래그 대상이고 텍스트를 선택하지 않는다', () => {
    const props = { id: 'node-1', data: { block }, selected: false } as unknown as Parameters<typeof TextBlockNode>[0]
    render(
      <CanvasBlockRuntimeProvider value={{}}>
        <TextBlockNode {...props} />
      </CanvasBlockRuntimeProvider>,
    )

    const editor = screen.getByRole('textbox')
    expect(editor.getAttribute('contenteditable')).toBe('false')
    expect(editor.classList.contains('drag-handle')).toBe(true)
    expect(editor.classList.contains('nodrag')).toBe(false)
    expect(editor.style.cursor).toBe('grab')
    expect(editor.style.userSelect).toBe('none')
  })

  it('첫 클릭은 블록만 선택하고 편집 모드로 전환하지 않는다', () => {
    const onSelectBlock = vi.fn()
    const props = { id: 'node-1', data: { block }, selected: false } as unknown as Parameters<typeof TextBlockNode>[0]
    render(
      <CanvasBlockRuntimeProvider value={{ onSelectBlock }}>
        <TextBlockNode {...props} />
      </CanvasBlockRuntimeProvider>,
    )

    const editor = screen.getByRole('textbox')
    fireEvent.click(editor)

    expect(onSelectBlock).toHaveBeenCalledWith('node-1')
    expect(editor.getAttribute('contenteditable')).toBe('false')
  })

  it('선택된 블록을 두 번 클릭하면 편집 모드로 전환하고 Escape에서 빠져나온다', () => {
    const onTextCommit = vi.fn()
    const onSelectBlock = vi.fn()
    const props = { id: 'node-1', data: { block }, selected: true } as unknown as Parameters<typeof TextBlockNode>[0]
    render(
      <CanvasBlockRuntimeProvider value={{ onTextCommit, onSelectBlock }}>
        <TextBlockNode {...props} />
      </CanvasBlockRuntimeProvider>,
    )

    const editor = screen.getByRole('textbox')
    fireEvent.doubleClick(editor)
    expect(editor.getAttribute('contenteditable')).toBe('true')
    expect(editor.classList.contains('nodrag')).toBe(true)
    expect(editor.style.cursor).toBe('text')
    expect(editor.style.userSelect).toBe('text')

    editor.textContent = '키보드 수정'
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(onTextCommit).toHaveBeenCalledWith('node-1', '키보드 수정')
    expect(editor.getAttribute('contenteditable')).toBe('false')
  })

  it('선택된 블록에서 Enter를 누르면 편집 모드로 전환한다', () => {
    const props = { id: 'node-1', data: { block }, selected: true } as unknown as Parameters<typeof TextBlockNode>[0]
    render(
      <CanvasBlockRuntimeProvider value={{}}>
        <TextBlockNode {...props} />
      </CanvasBlockRuntimeProvider>,
    )

    const editor = screen.getByRole('textbox')
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(editor.getAttribute('contenteditable')).toBe('true')
  })

  it('blur에서 수정한 텍스트를 한 번 확정한다', () => {
    const onTextCommit = vi.fn()
    const props = { id: 'node-1', data: { block }, selected: true } as unknown as Parameters<typeof TextBlockNode>[0]
    render(
      <CanvasBlockRuntimeProvider value={{ onTextCommit }}>
        <TextBlockNode {...props} />
      </CanvasBlockRuntimeProvider>,
    )
    const editor = screen.getByRole('textbox')
    fireEvent.doubleClick(editor)
    editor.textContent = '수정한 본문'
    fireEvent.blur(editor)
    expect(onTextCommit).toHaveBeenCalledWith('node-1', '수정한 본문')
  })

  it('blur 뒤 부모 상태가 갱신되어도 수정한 텍스트를 중복 렌더링하지 않는다', () => {
    function StatefulTextBlock() {
      const [currentBlock, setCurrentBlock] = useState(block)
      const props = {
        id: 'node-1',
        data: { block: currentBlock },
        selected: true,
      } as unknown as Parameters<typeof TextBlockNode>[0]

      return (
        <CanvasBlockRuntimeProvider
          value={{
            onTextCommit: (_id, text) => setCurrentBlock((current) => ({ ...current, text })),
          }}
        >
          <TextBlockNode {...props} />
        </CanvasBlockRuntimeProvider>
      )
    }

    render(<StatefulTextBlock />)
    const editor = screen.getByRole('textbox')
    fireEvent.doubleClick(editor)
    editor.innerHTML = '수정한 본문'
    fireEvent.blur(editor)

    expect(editor.textContent).toBe('수정한 본문')
    expect(editor.querySelectorAll('.canvas-text-highlight')).toHaveLength(1)
  })

  it('블록 서식을 CSS로 변환한다', () => {
    expect(textBlockCss(block.style)).toMatchObject({
      fontSize: '18px',
      fontWeight: 700,
      textAlign: 'center',
    })
    expect(textBlockCss({ ...block.style, highlight: '#fff2a8' }).backgroundColor).toBeUndefined()
  })

  it('글머리와 번호 목록을 실제 목록 표식으로 렌더한다', () => {
    expect(textBlockCss({ ...block.style, list: 'bullet' })).toMatchObject({
      display: 'list-item',
      listStyleType: 'disc',
      listStylePosition: 'inside',
    })
    expect(textBlockCss({ ...block.style, list: 'number' })).toMatchObject({
      display: 'list-item',
      listStyleType: 'decimal',
      listStylePosition: 'inside',
    })
  })

  it('텍스트 highlight는 블록 배경이 아니라 글자 영역에만 적용한다', () => {
    const highlighted = { ...block, style: { ...block.style, highlight: '#fff2a8', background: '#e8f1ff' } }
    const props = { id: 'node-1', data: { block: highlighted }, selected: false } as unknown as Parameters<typeof TextBlockNode>[0]
    const view = render(
      <CanvasBlockRuntimeProvider value={{}}>
        <TextBlockNode {...props} />
      </CanvasBlockRuntimeProvider>,
    )

    expect(screen.getByRole('textbox').style.backgroundColor).toBe('')
    expect((view.container.querySelector('.canvas-text-highlight') as HTMLElement).style.backgroundColor).toBe('rgb(255, 242, 168)')
    expect((view.container.querySelector('.canvas-block-shell') as HTMLElement).style.backgroundColor).toBe('rgb(232, 241, 255)')
  })

  it('화살표 블록을 텍스트 편집기 없이 렌더한다', () => {
    const arrow = {
      kind: 'arrow' as const,
      width: 200,
      height: 40,
      direction: 'right' as const,
      style: { ...createDefaultTextBlockStyle(), background: 'transparent' },
    }
    const props = { id: 'arrow-0', data: { block: arrow }, selected: false } as unknown as Parameters<typeof TextBlockNode>[0]
    const view = render(
      <CanvasBlockRuntimeProvider value={{}}>
        <TextBlockNode {...props} />
      </CanvasBlockRuntimeProvider>,
    )

    expect(view.container.querySelector('.canvas-arrow-block')).not.toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('본문은 내부 스크롤 없이 셸 자동 높이 측정 대상이 된다', () => {
    const props = { id: 'node-1', data: { block }, selected: false } as unknown as Parameters<typeof TextBlockNode>[0]
    render(
      <CanvasBlockRuntimeProvider value={{}}>
        <TextBlockNode {...props} />
      </CanvasBlockRuntimeProvider>,
    )

    const editor = screen.getByRole('textbox')
    expect(editor.style.overflow).toBe('visible')
    expect(editor.dataset.canvasAutoGrow).toBe('true')
  })
})
