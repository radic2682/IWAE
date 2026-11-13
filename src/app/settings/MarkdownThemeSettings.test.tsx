// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { setLocale } from '../../i18n'
import { MarkdownThemeSettings } from './MarkdownThemeSettings'

describe('MarkdownThemeSettings', () => {
  it('여섯 테마 중 하나를 전역 설정으로 선택한다', () => {
    const onChange = vi.fn()
    render(<MarkdownThemeSettings value="light" onChange={onChange} />)
    expect(screen.getAllByRole('radio')).toHaveLength(6)
    fireEvent.click(screen.getByRole('radio', { name: '논문 / 리포트' }))
    expect(onChange).toHaveBeenCalledWith('paper')
  })

  it('영어로 켜면 제목을 영어로 보인다', () => {
    setLocale('en')
    try {
      render(<MarkdownThemeSettings value="light" onChange={vi.fn()} />)
      expect(screen.getByRole('heading', { name: 'Markdown document theme' })).toBeTruthy()
    } finally {
      setLocale('ko')
    }
  })
})
