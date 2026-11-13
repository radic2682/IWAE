// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PdfPageLayoutButtons } from './PdfLayoutControls'

describe('PDF 쪽 배치 단추', () => {
  it('열린 노트 표시만 보기 단추는 눈 단추 바로 옆에서 켜고 끈다', () => {
    const onChange = vi.fn()
    const props = { layout: { spread: 'single' as const, continuous: true }, onChange: vi.fn(), buttonClassName: 'b', clean: false, onCleanChange: vi.fn(), onOnlyOpenNotesChange: onChange }
    const { container, rerender } = render(<PdfPageLayoutButtons {...props} onlyOpenNotes={false} />)
    const order = [...container.querySelectorAll('button')].map((element) => element.getAttribute('aria-label'))
    expect(order.slice(0, 2)).toEqual(['표시 모두 숨기기', '열린 노트 표시만 보기'])
    const button = screen.getByRole('button', { name: '열린 노트 표시만 보기' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.getAttribute('title')).toBe('켜면 같은 색 칸에 열린 노트의 형광펜과 메모만 PDF에 보입니다')
    fireEvent.click(button)
    expect(onChange).toHaveBeenCalledWith(true)
    rerender(<PdfPageLayoutButtons {...props} onlyOpenNotes />)
    const on = screen.getByRole('button', { name: '열린 노트 표시만 보기' })
    expect(on.getAttribute('aria-pressed')).toBe('true')
    expect(on.classList.contains('toolbar-tool-btn-active')).toBe(true)
    fireEvent.click(on)
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it('눈 단추로 표시를 모두 감추고 다시 켠다. 눈 | 한·두·세 장 | 연속 차례', () => {
    const onCleanChange = vi.fn()
    const { container, rerender } = render(
      <PdfPageLayoutButtons layout={{ spread: 'single', continuous: true }} onChange={vi.fn()} buttonClassName="b" clean={false} onCleanChange={onCleanChange} />,
    )
    const order = [...container.querySelectorAll('button, .pane-toolbar-divider')].map((element) => element.getAttribute('aria-label') ?? '|')
    expect(order).toEqual(['표시 모두 숨기기', '|', '한 장 보기', '두 장 보기', '세 장 보기', '|', '연속 보기'])
    fireEvent.click(screen.getByRole('button', { name: '표시 모두 숨기기' }))
    expect(onCleanChange).toHaveBeenCalledWith(true)
    rerender(<PdfPageLayoutButtons layout={{ spread: 'single', continuous: true }} onChange={vi.fn()} buttonClassName="b" clean onCleanChange={onCleanChange} />)
    fireEvent.click(screen.getByRole('button', { name: '표시 다시 보이기' }))
    expect(onCleanChange).toHaveBeenLastCalledWith(false)
  })
})
