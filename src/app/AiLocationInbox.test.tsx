// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { AiLocationInbox } from './AiLocationInbox'
import type { AiLocation } from '../bridge/ai'

const make = (id: string, over: Partial<AiLocation> = {}): AiLocation => ({
  id, docId: 'd1', page: 12, message: '정의가 여기 있습니다', receivedAt: '1790000000000', ...over,
})

describe('AiLocationInbox', () => {
  it('shows each location with document, page, and message', () => {
    render(<AiLocationInbox items={[make('a')]} docTitles={{ d1: 'HTTP 사양' }} onOpen={vi.fn()} onDismiss={vi.fn()} />)
    const card = screen.getByRole('alert')
    expect(within(card).getByText('AI가 위치를 보냈습니다')).toBeTruthy()
    expect(within(card).getByText('HTTP 사양')).toBeTruthy()
    expect(within(card).getByText('p.12')).toBeTruthy()
    expect(within(card).getByText('정의가 여기 있습니다')).toBeTruthy()
  })

  it('opens and dismisses a card', () => {
    const onOpen = vi.fn()
    const onDismiss = vi.fn()
    render(<AiLocationInbox items={[make('a')]} docTitles={{}} onOpen={onOpen} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: '이동' }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(onDismiss).toHaveBeenCalledWith('a')
    expect(screen.getByText('알 수 없는 문서')).toBeTruthy()
  })

  it('shows at most five cards and counts the rest', () => {
    const items = Array.from({ length: 7 }, (_, index) => make(String(index)))
    render(<AiLocationInbox items={items} docTitles={{ d1: '논문' }} onOpen={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getAllByRole('alert')).toHaveLength(5)
    expect(screen.getByText('+2')).toBeTruthy()
  })

  it('renders nothing without items', () => {
    const { container } = render(<AiLocationInbox items={[]} docTitles={{}} onOpen={vi.fn()} onDismiss={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})
