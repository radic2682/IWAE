// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PdfBoxMemos } from './PdfBoxMemos'
import type { PersistentPdfHighlight } from './persistentHighlight'

const memo: PersistentPdfHighlight = {
  id: 'h1',
  color: 'green',
  note: '박스에 쓴 메모',
  box: { x: 400, y: 100, w: 170 },
  anchor: { docId: 'abc123abc123', page: 0, coordSpace: 'pdfium-page', rects: [{ x: 72, y: 110, w: 200, h: 12 }], charRange: [0, 5], quote: 'quote', prefix: '', suffix: '' },
}

function mount(extra: Partial<Parameters<typeof PdfBoxMemos>[0]> = {}) {
  const handlers = { onEdit: vi.fn(), onSave: vi.fn(), onCancelDraft: vi.fn(), onChange: vi.fn(), onDelete: vi.fn() }
  const view = render(
    <PdfBoxMemos
      memos={[memo]}
      draftId={null}
      editingId={null}
      pageSizes={[[612, 792]]}
      layoutOf={() => ({ top: 0, left: 0, width: 612 })}
      width={612}
      height={792}
      {...handlers}
      {...extra}
    />,
  )
  return { view, handlers }
}

describe('PdfBoxMemos', () => {
  it('박스는 쪽 좌표 자리에 그려지고 형광펜 끝에서 선으로 이어진다', () => {
    const { view } = mount()
    const card = view.container.querySelector<HTMLElement>('[data-box-memo="h1"]')!
    expect(card.style.left).toBe('400px')
    expect(card.style.top).toBe('100px')
    expect(card.textContent).toContain('박스에 쓴 메모')
    expect(view.container.querySelectorAll('.pdf-box-link path')).toHaveLength(1)
  })

  it('색 바꾸기·지우기를 알린다(접기 단추는 없다)', () => {
    const { handlers } = mount()
    expect(screen.queryByRole('button', { name: '박스 접기' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '색 분홍' }))
    expect(handlers.onChange).toHaveBeenCalledWith('h1', { color: 'pink' })
    fireEvent.click(screen.getByRole('button', { name: '박스 메모 지우기' }))
    expect(handlers.onDelete).toHaveBeenCalledWith('h1')
  })

  it('머리를 끌면 놓을 때 한 번 새 자리를 저장한다(확대 배율만큼 나눠 쪽 좌표로)', () => {
    const { handlers } = mount({ layoutOf: () => ({ top: 0, left: 0, width: 1224 }) })
    const grip = screen.getByRole('button', { name: '박스 옮기기' })
    fireEvent.pointerDown(grip, { button: 0, clientX: 800, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 700, clientY: 240, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 700, clientY: 240, pointerId: 1 })
    // 배율 2 → -100px = -50pt, +40px = +20pt
    expect(handlers.onChange).toHaveBeenCalledTimes(1)
    expect(handlers.onChange).toHaveBeenCalledWith('h1', { box: { x: 350, y: 120, w: 170 } })
  })

  it('새 박스를 취소하면 거둔다', () => {
    const { handlers } = mount({ draftId: 'h1', editingId: 'h1' })
    fireEvent.click(screen.getByRole('button', { name: '박스 메모 지우기' }))
    expect(handlers.onCancelDraft).toHaveBeenCalled()
    expect(handlers.onDelete).not.toHaveBeenCalled()
  })
})
