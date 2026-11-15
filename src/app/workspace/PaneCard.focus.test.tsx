// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PaneCard } from './PaneCard'

describe('PaneCard focus sync', () => {
  it('키보드로 칸 안에 초점이 들어오면 그 칸이 만지는 칸이 된다', () => {
    const onFocusPane = vi.fn()
    render(<PaneCard paneId="p2" channel={null} active={false} onFocusPane={onFocusPane}><button type="button">안쪽</button></PaneCard>)
    act(() => screen.getByRole('button', { name: '안쪽' }).focus())
    expect(onFocusPane).toHaveBeenCalledWith('p2')
  })
})
