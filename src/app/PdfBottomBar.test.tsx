// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PdfBottomBar } from './PdfBottomBar'

describe('PdfBottomBar', () => {
  it('페이지 이동·맞춤·배율 조작을 한 줄에 제공한다', () => {
    render(<PdfBottomBar zoomPercent={100} page={7} pageCount={12} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onZoomChange={vi.fn()} onPageChange={vi.fn()} onFitWidth={vi.fn()} onFitPage={vi.fn()} />)

    expect(screen.getByRole('textbox', { name: '쪽' })).toHaveProperty('value', '7')
    expect(screen.getByText('/ 12')).toBeDefined()
    expect(screen.getByRole('slider', { name: '배율' })).toHaveProperty('value', '100')
    expect(screen.getByRole('spinbutton', { name: '배율 직접 입력' })).toHaveProperty('value', '100')
    // 책갈피는 스크롤 막대 옆 핀으로, 쪽 배치는 위 줄로 옮겼다
    expect(screen.queryByRole('button', { name: /책갈피/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '두 장 보기' })).toBeNull()
  })

  it('이전·다음 페이지와 배율 슬라이더가 동작한다', () => {
    const onPageChange = vi.fn()
    const onZoomChange = vi.fn()
    render(<PdfBottomBar zoomPercent={100} page={7} pageCount={12} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onZoomChange={onZoomChange} onPageChange={onPageChange} onFitWidth={vi.fn()} onFitPage={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '이전 쪽' }))
    fireEvent.click(screen.getByRole('button', { name: '다음 쪽' }))
    fireEvent.change(screen.getByRole('slider', { name: '배율' }), { target: { value: '130' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: '배율 직접 입력' }), { target: { value: '150' } })
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: '배율 직접 입력' }), { key: 'Enter' })

    expect(onPageChange).toHaveBeenNthCalledWith(1, 6)
    expect(onPageChange).toHaveBeenNthCalledWith(2, 8)
    expect(onZoomChange).toHaveBeenCalledWith(130)
    expect(onZoomChange).toHaveBeenCalledWith(150)
  })

  it('좁은 패널에서 마우스 휠로 가려진 하단 도구를 가로 이동한다', () => {
    const { container } = render(<PdfBottomBar zoomPercent={100} page={7} pageCount={12} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onZoomChange={vi.fn()} onPageChange={vi.fn()} onFitWidth={vi.fn()} onFitPage={vi.fn()} />)
    const surface = container.querySelector('.pdf-bottom-bar-surface') as HTMLElement
    Object.defineProperties(surface, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 540 },
    })

    fireEvent.wheel(surface, { deltaY: 90 })

    expect(surface.scrollLeft).toBe(90)
  })
})
