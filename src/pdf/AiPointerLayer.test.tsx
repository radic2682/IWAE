// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Anchor } from '../core/anchor'
import { AiPointerLayer, useAiPointerDismiss, type AiPointer } from './AiPointerLayer'

const anchor = (rects: Anchor['rects'], quote = '인용문'): Anchor => ({
  docId: 'd1', page: 1, coordSpace: 'pdfium-page', rects, charRange: [0, 3], quote, prefix: '', suffix: '',
})
const pointer = (over: Partial<AiPointer> = {}): AiPointer => ({
  id: 'p1', docId: 'd1', page: 1,
  anchor: anchor([{ x: 10, y: 10, w: 40, h: 10 }, { x: 10, y: 30, w: 20, h: 10 }]),
  ...over,
})

function Harness({ active, onDismiss }: { active: boolean; onDismiss: () => void }) {
  useAiPointerDismiss(active, onDismiss)
  return (
    <div>
      <div className="pdf-page-slot" data-testid="slot" />
      <input aria-label="입력" />
      <div data-testid="outside" />
    </div>
  )
}

describe('AiPointerLayer', () => {
  it('줄마다 점선 네모를 그리고 첫 네모에만 「AI」 칩을 단다', () => {
    const { container } = render(<AiPointerLayer pointer={pointer({ message: '여기 정의' })} renderScale={2} />)
    expect(container.querySelectorAll('[data-ai-pointer-rect]')).toHaveLength(2)
    const chip = screen.getByRole('img', { name: 'AI가 가리키는 곳' })
    expect(chip.textContent).toBe('AI')
    expect(chip.getAttribute('title')).toBe('여기 정의')
    expect(container.querySelectorAll('.ai-pointer-chip')).toHaveLength(1)
  })

  it('말이 없으면 인용문을 말풍선으로 보인다', () => {
    render(<AiPointerLayer pointer={pointer()} renderScale={1} />)
    expect(screen.getByRole('img', { name: 'AI가 가리키는 곳' }).getAttribute('title')).toBe('인용문')
  })

  it('영역(박스) 메모의 네모 하나도 같은 모양으로 그린다', () => {
    const { container } = render(<AiPointerLayer pointer={pointer({ anchor: anchor([{ x: 5, y: 5, w: 100, h: 80 }], '') })} renderScale={1} />)
    expect(container.querySelectorAll('[data-ai-pointer-rect]')).toHaveLength(1)
    expect(screen.getByRole('img', { name: 'AI가 가리키는 곳' })).toBeTruthy()
  })
})

describe('useAiPointerDismiss', () => {
  it('Esc 로 지우되 글 입력 중에는 지우지 않는다', () => {
    const onDismiss = vi.fn()
    render(<Harness active onDismiss={onDismiss} />)
    fireEvent.keyDown(screen.getByLabelText('입력'), { key: 'Escape' })
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByTestId('outside'), { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('PDF 쪽 영역을 누르면 지우고, 바깥을 누르면 두다', () => {
    const onDismiss = vi.fn()
    render(<Harness active onDismiss={onDismiss} />)
    fireEvent.pointerDown(screen.getByTestId('outside'))
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.pointerDown(screen.getByTestId('slot'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('가리킴이 없으면 아무것도 듣지 않는다', () => {
    const onDismiss = vi.fn()
    render(<Harness active={false} onDismiss={onDismiss} />)
    fireEvent.keyDown(screen.getByTestId('outside'), { key: 'Escape' })
    fireEvent.pointerDown(screen.getByTestId('slot'))
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
