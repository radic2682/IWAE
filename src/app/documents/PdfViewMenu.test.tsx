// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PdfViewMenu } from './PdfViewMenu'

function setup(over: Partial<React.ComponentProps<typeof PdfViewMenu>> = {}) {
  const props = {
    prefs: { spread: 'single' as const, invert: false },
    rotation: 0 as const,
    onPrefsChange: vi.fn(),
    onRotate: vi.fn(),
    ...over,
  }
  render(<PdfViewMenu {...props} />)
  return props
}

describe('PdfViewMenu', () => {
  it('배경 모드: 야간은 색 반전, 양피지·눈 보호는 색조', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: '배경 모드' }))
    expect(screen.getByRole('radio', { name: '기본' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: '야간' }))
    expect(props.onPrefsChange).toHaveBeenLastCalledWith({ spread: 'single', invert: true, tone: 'none' })
    fireEvent.click(screen.getByRole('radio', { name: '양피지' }))
    expect(props.onPrefsChange).toHaveBeenLastCalledWith({ spread: 'single', invert: false, tone: 'sepia' })
  })

  it('rotates', () => {
    const props = setup({ rotation: 90 })
    fireEvent.click(screen.getByRole('button', { name: '배경 모드' }))
    fireEvent.click(screen.getByRole('button', { name: '시계 방향으로 회전' }))
    expect(props.onRotate).toHaveBeenCalled()
    expect(screen.getByText('회전 중에는 보기 전용입니다')).toBeTruthy()
  })

  it('closes on Escape', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '배경 모드' }))
    fireEvent.keyDown(screen.getByRole('dialog', { name: '배경 모드' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '배경 모드' })).toBeNull()
  })
})
