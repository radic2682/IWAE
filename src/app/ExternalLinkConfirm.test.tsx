// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ExternalLinkConfirm } from './ExternalLinkConfirm'

describe('ExternalLinkConfirm', () => {
  it('shows the destination and opens only after confirmation', () => {
    const onOpen = vi.fn()
    const onCancel = vi.fn()
    render(<ExternalLinkConfirm url="https://www.nature.com/articles/x" onOpen={onOpen} onCancel={onCancel} />)
    expect(screen.getByRole('alertdialog', { name: '외부 링크 열기' })).toBeTruthy()
    expect(screen.getByText('www.nature.com')).toBeTruthy()
    expect(screen.getByText('https://www.nature.com/articles/x')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '브라우저에서 열기' }))
    expect(onOpen).toHaveBeenCalledWith('https://www.nature.com/articles/x')
  })

  it('offers the mail app for mailto links', () => {
    render(<ExternalLinkConfirm url="mailto:a@b.com" onOpen={vi.fn()} onCancel={vi.fn()} />) // release-scan-allow: 시험용 가짜 주소
    expect(screen.getByRole('button', { name: '메일 앱에서 열기' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '브라우저에서 열기' })).toBeNull()
  })

  it('cancels with the button or Escape', () => {
    const onCancel = vi.fn()
    render(<ExternalLinkConfirm url="https://example.com" onOpen={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
