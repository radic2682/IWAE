// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { PdfPins, type PlacedPin } from './PdfPins'
import { createPdfBookmark } from '../core/pdfBookmarks'

const placed: PlacedPin = { pin: createPdfBookmark('0123456789ab', 3, '부팅 흐름', new Date(0), 0.2), y: 100, target: 2000 }

describe('PdfPins — 꾹 눌러 옮기기', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('0.35초 넘게 누른 채 끌면 놓은 높이로 옮기고, 그 자리로 가지 않는다', () => {
    const onMove = vi.fn()
    const onJump = vi.fn()
    render(<PdfPins pins={[placed]} editingId={null} onEdit={() => {}} onJump={onJump} onMove={onMove} track={{ top: 20, bottom: 500 }} />)
    const pin = screen.getByRole('button', { name: /부팅 흐름/ })
    fireEvent.pointerDown(pin, { pointerId: 1, button: 0, clientX: 10, clientY: 100 })
    act(() => { vi.advanceTimersByTime(400) })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 260 })
    expect(pin.className).toContain('pdf-pin-dragging')
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 260 })
    fireEvent.click(pin)
    expect(onMove).toHaveBeenCalledWith(placed.pin.id, 260)
    expect(onJump).not.toHaveBeenCalled()
  })

  it('짧게 누르면 옮기지 않고 그 자리로 간다', () => {
    const onMove = vi.fn()
    const onJump = vi.fn()
    render(<PdfPins pins={[placed]} editingId={null} onEdit={() => {}} onJump={onJump} onMove={onMove} />)
    const pin = screen.getByRole('button', { name: /부팅 흐름/ })
    fireEvent.pointerDown(pin, { pointerId: 1, button: 0, clientX: 10, clientY: 100 })
    act(() => { vi.advanceTimersByTime(100) })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 100 })
    fireEvent.click(pin)
    expect(onMove).not.toHaveBeenCalled()
    expect(onJump).toHaveBeenCalledWith(2000)
  })
})
