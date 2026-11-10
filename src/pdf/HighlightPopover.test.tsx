// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { HighlightPopover } from './HighlightPopover'
import type { PersistentPdfHighlight } from './persistentHighlight'

const highlight: PersistentPdfHighlight = {
  id: 'h1',
  color: 'yellow',
  note: '처음 메모',
  anchor: {
    docId: '0123456789ab', page: 2, coordSpace: 'pdfium-page',
    rects: [{ x: 1, y: 1, w: 10, h: 10 }], charRange: [0, 4], quote: 'Dynamic address', prefix: '', suffix: '',
  },
}

function setup(over: Partial<React.ComponentProps<typeof HighlightPopover>> = {}) {
  const props = {
    highlight,
    point: { x: 40, y: 50 },
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  render(<HighlightPopover {...props} />)
  return props
}

describe('HighlightPopover', () => {
  it('shows the quote and existing note', () => {
    setup()
    expect(screen.getByText('Dynamic address')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: '형광펜 메모' }) as HTMLTextAreaElement).value).toBe('처음 메모')
  })

  it('changes color immediately', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: '파랑 형광펜' }))
    expect(props.onUpdate).toHaveBeenCalledWith('h1', { color: 'blue' })
  })

  it('saves the note on blur and after a pause in typing', () => {
    vi.useFakeTimers()
    try {
      const props = setup()
      const box = screen.getByRole('textbox', { name: '형광펜 메모' })
      fireEvent.change(box, { target: { value: '고친 메모' } })
      expect(props.onUpdate).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(600) })
      expect(props.onUpdate).toHaveBeenCalledWith('h1', { note: '고친 메모' })
      fireEvent.change(box, { target: { value: '또 고침' } })
      fireEvent.blur(box)
      expect(props.onUpdate).toHaveBeenLastCalledWith('h1', { note: '또 고침' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('deletes, sends to the note, and closes on Escape', () => {
    const onSendToCanvas = vi.fn()
    const props = setup({ onSendToCanvas })
    fireEvent.click(screen.getByRole('button', { name: '노트로 보내기' }))
    expect(onSendToCanvas).toHaveBeenCalledWith(highlight)
    fireEvent.click(screen.getByRole('button', { name: '형광펜 삭제' }))
    expect(props.onDelete).toHaveBeenCalledWith('h1')
    fireEvent.keyDown(screen.getByRole('dialog', { name: '형광펜' }), { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalled()
  })

  it('hides the send button when no note is open', () => {
    setup()
    expect(screen.queryByRole('button', { name: '노트로 보내기' })).toBeNull()
  })
})
