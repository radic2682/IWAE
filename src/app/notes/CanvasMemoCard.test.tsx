// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultTextBlockStyle, type TextCanvasBlock } from '../../core/canvasDocument'
import type { CanvasMemoSource } from '../../core/canvasMemo'
import { CanvasBlockRuntimeProvider, type CanvasBlockRuntime } from './CanvasBlockShell'
import { TextBlockNode } from './TextBlockNode'

vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  Handle: ({ id, className }: { id: string; className: string }) => <span data-handleid={id} className={className} />,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  useUpdateNodeInternals: () => vi.fn(),
}))

const anchor = {
  docId: 'doc-a',
  page: 4,
  coordSpace: 'pdfium-page' as const,
  rects: [{ x: 1, y: 1, w: 10, h: 10 }],
  charRange: [0, 5] as const,
  quote: '형광펜이 덮은 글',
  prefix: '',
  suffix: '',
}
const source = (highlightId: string, quote: string, color = 'yellow'): CanvasMemoSource => ({
  excerptId: 'e1',
  highlightId,
  highlight: { id: highlightId, color, anchor: { ...anchor, quote } },
  title: 'HTTP Semantics',
  jump: { docId: 'doc-a', page: 4, anchor },
})

const block = (extra: Partial<TextCanvasBlock> = {}): TextCanvasBlock => ({
  kind: 'paragraph',
  width: 340,
  height: 120,
  style: createDefaultTextBlockStyle(),
  text: '내가 쓴 메모',
  ...extra,
})

function nodeProps(props: { block?: TextCanvasBlock; sources?: readonly CanvasMemoSource[]; selected?: boolean } = {}) {
  const data = { block: props.block ?? block(), memoSources: props.sources ?? [source('h1', '형광펜이 덮은 글')] }
  return { id: 'm1', data, selected: props.selected ?? false } as unknown as Parameters<typeof TextBlockNode>[0]
}

function renderMemo(runtime: CanvasBlockRuntime, props: Parameters<typeof nodeProps>[0] = {}) {
  return render(
    <CanvasBlockRuntimeProvider value={runtime}>
      <TextBlockNode {...nodeProps(props)} />
    </CanvasBlockRuntimeProvider>,
  )
}

afterEach(cleanup)

describe('캔버스 메모 카드 = 노트 메모 카드', () => {
  it('형광펜에 이은 글 블록은 노트와 같은 카드: 메모 글, 원문 줄(색 점, 인용, 쪽 칩), 위 탭에 출처', () => {
    const { container } = renderMemo({})
    const card = container.querySelector('.pdf-memo-card.pdf-memo-card-flow.note-block')!
    expect(card).not.toBeNull()
    expect(card.getAttribute('data-hl')).toBe('yellow')
    expect(card.querySelector('.pdf-memo-card-text')?.textContent).toBe('내가 쓴 메모')
    const chip = card.querySelector('.note-source-chip[data-hl="yellow"]')!
    expect(chip.textContent).toContain('형광펜이 덮은 글')
    expect(chip.querySelector('.note-source-page')?.textContent).toBe('p.5')
    expect(chip.querySelector('.note-source-dot')).not.toBeNull()
    expect(card.querySelector('.note-tab-l')?.textContent).toBe('HTTP Semantics · p.5')
    // 글 블록 편집기와 노트의 「블록 사이 +」는 없다
    expect(container.querySelector('.canvas-text-editor')).toBeNull()
    expect(container.querySelector('.note-gap-add')).toBeNull()
  })

  it('이은 형광펜이 없는 글 블록은 그대로 글 블록이다', () => {
    const node = { id: 't1', data: { block: block() }, selected: false } as unknown as Parameters<typeof TextBlockNode>[0]
    const { container } = render(
      <CanvasBlockRuntimeProvider value={{}}>
        <TextBlockNode {...node} />
      </CanvasBlockRuntimeProvider>,
    )
    expect(container.querySelector('.canvas-text-editor')).not.toBeNull()
    expect(container.querySelector('.pdf-memo-card')).toBeNull()
  })

  it('ID와 제목은 노트와 같은 머리와 호버 탭: 있으면 머리에 보이고, 없으면 「+ ID」「+ 제목」 탭', () => {
    const { container, rerender } = renderMemo({})
    const tabs = [...container.querySelectorAll('.note-tab-r .note-tab-btn')].map((button) => button.textContent)
    expect(tabs).toEqual(expect.arrayContaining(['+ ID', '+ 제목']))
    expect(container.querySelector('.note-ticket-head')).toBeNull()
    rerender(
      <CanvasBlockRuntimeProvider value={{}}>
        <TextBlockNode {...nodeProps({ block: block({ ticket: { id: 'REQ-01', title: '재시도' } }) })} />
      </CanvasBlockRuntimeProvider>,
    )
    expect(container.querySelector('.note-ticket-id')?.textContent).toBe('REQ-01')
    expect(container.querySelector('.note-ticket-title')?.textContent).toBe('재시도')
    expect(container.querySelector('.pdf-memo-card-flow')?.classList.contains('note-ticket')).toBe(true)
  })

  it('메모 글을 누르면 편집기가 열리고, 바깥을 누르면(blur) 저장하고, Escape 는 저장 없이 그만둔다', () => {
    const onMemoSave = vi.fn()
    const { container } = renderMemo({ onMemoSave })
    fireEvent.click(container.querySelector('.pdf-memo-card-text')!)
    const editor = screen.getByRole('textbox', { name: '메모' })
    expect(container.querySelector('.canvas-memo-card')?.classList.contains('nodrag')).toBe(true)
    editor.textContent = '고친 메모'
    fireEvent.blur(editor)
    expect(onMemoSave).toHaveBeenCalledWith('m1', { text: '고친 메모', html: '' }, undefined)

    fireEvent.click(container.querySelector('.pdf-memo-card-text')!)
    fireEvent.keyDown(screen.getByRole('textbox', { name: '메모' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: '메모' })).toBeNull()
    expect(onMemoSave).toHaveBeenCalledTimes(1)
  })

  it('막 만든 메모는 새 메모로 열려 바로 쓴다: 비운 채 떠나면 메모와 선이 사라지고, 쓰고 떠나면 저장된다', () => {
    const onMemoDiscard = vi.fn()
    const onMemoSave = vi.fn()
    const onAutoEditStarted = vi.fn()
    const runtime = { autoEditBlockId: 'm1', onAutoEditStarted, onMemoDiscard, onMemoSave }
    const first = renderMemo(runtime, { block: block({ text: '' }), selected: true })
    expect(onAutoEditStarted).toHaveBeenCalledWith('m1')
    fireEvent.blur(screen.getByRole('textbox', { name: '메모' }))
    expect(onMemoDiscard).toHaveBeenCalledWith('m1')
    expect(onMemoSave).not.toHaveBeenCalled()
    first.unmount()

    renderMemo(runtime, { block: block({ text: '' }), selected: true })
    const editor = screen.getByRole('textbox', { name: '메모' })
    editor.textContent = '첫 메모'
    fireEvent.blur(editor)
    expect(onMemoSave).toHaveBeenCalledWith('m1', { text: '첫 메모', html: '' }, undefined)
  })

  it('원문 줄: 점은 원문 펼치기와 접기, 칩을 누르면 출처로 간다', () => {
    const onOpenSource = vi.fn()
    const { container } = renderMemo({ onOpenSource })
    fireEvent.click(container.querySelector('.note-source-chip')!)
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ docId: 'doc-a', page: 4 }))
    fireEvent.click(screen.getByRole('button', { name: '근거 펼치기' }))
    expect(container.querySelector('.pdf-memo-card-quote.note-source')).not.toBeNull()
    expect(container.querySelector('.note-source-chip')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '근거 접기' }))
    expect(container.querySelector('.note-source-chip')).not.toBeNull()
  })

  it('메뉴: 노트와 같은 항목. 별점과 글 넣기는 없다', () => {
    const onMemoDelete = vi.fn()
    const onMemoAttachStart = vi.fn()
    const onOpenSource = vi.fn()
    const { container } = renderMemo({ onMemoDelete, onMemoAttachStart, onOpenSource })
    fireEvent.contextMenu(container.querySelector('.pdf-memo-card-flow')!)
    const names = screen.getAllByRole('menuitem').map((item) => item.textContent)
    expect(names).toEqual(['원문 추가', 'ID 붙이기', '제목 붙이기', '원문 펼치기', '원문에서 보기', '형광펜과 메모 지우기'])
    expect(screen.queryByRole('group', { name: '중요도(별점)' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '원문 추가' }))
    expect(onMemoAttachStart).toHaveBeenCalledWith('m1')
    fireEvent.contextMenu(container.querySelector('.pdf-memo-card-flow')!)
    fireEvent.click(screen.getByRole('menuitem', { name: '원문에서 보기' }))
    expect(onOpenSource).toHaveBeenCalled()
    fireEvent.contextMenu(container.querySelector('.pdf-memo-card-flow')!)
    fireEvent.click(screen.getByRole('menuitem', { name: '형광펜과 메모 지우기' }))
    expect(onMemoDelete).toHaveBeenCalledWith('m1', 'e1', 'h1')
  })

  it('원문을 더하는 중에는 안내와 취소가 보이고, 더한 원문은 줄이 늘고 「이 원문 분리」로 뗀다', () => {
    const onMemoAttachStart = vi.fn()
    const onMemoDetach = vi.fn()
    const { container } = renderMemo(
      { attachingMemoId: 'm1', onMemoAttachStart, onMemoDetach },
      { sources: [source('h1', '첫 원문'), source('h2', '더한 원문', 'green')] },
    )
    expect(container.querySelectorAll('.note-source-chip')).toHaveLength(2)
    expect(container.querySelector('.note-source-attach')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onMemoAttachStart).toHaveBeenCalledWith(null)
    fireEvent.click(screen.getByRole('button', { name: '이 원문 분리' }))
    expect(onMemoDetach).toHaveBeenCalledWith('m1', 'e1', 'h2')
  })

  it('끌기는 캔버스가 맡는다: 카드 본문이 끌기 손잡이이고 노트의 블록 끌기는 시작하지 않는다', () => {
    const { container } = renderMemo({})
    expect(container.querySelector('.canvas-memo-card')?.classList.contains('drag-handle')).toBe(true)
    fireEvent.pointerDown(container.querySelector('.pdf-memo-card-flow')!, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 80, clientY: 80 })
    expect(document.body.classList.contains('note-block-dragging')).toBe(false)
  })
})
