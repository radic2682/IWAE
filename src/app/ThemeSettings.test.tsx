// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeSettings } from './ThemeSettings'

describe('ThemeSettings', () => {
  it('시스템·라이트·다크 선택을 제공한다', () => {
    const onChange = vi.fn()
    render(<ThemeSettings preference="system" resolvedTheme="dark" onChange={onChange} />)

    expect((screen.getByRole('radio', { name: '시스템 설정' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('현재 다크 모드 적용 중')).toBeDefined()
    fireEvent.click(screen.getByRole('radio', { name: '라이트' }))
    expect(onChange).toHaveBeenCalledWith('light')
  })
})

describe('ThemeSettings 색 구성', () => {
  it('색 구성과 강조색을 고를 수 있다', () => {
    const onPaletteChange = vi.fn()
    const onAccentChange = vi.fn()
    render(<ThemeSettings preference="light" resolvedTheme="light" onChange={vi.fn()} palette="default" onPaletteChange={onPaletteChange} accent="auto" onAccentChange={onAccentChange} />)

    expect((screen.getByRole('radio', { name: '중립 회색' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: '짙은 남색' }))
    expect(onPaletteChange).toHaveBeenCalledWith('navy')
    fireEvent.click(screen.getByRole('radio', { name: '청록' }))
    expect(onAccentChange).toHaveBeenCalledWith('teal')
  })
})
