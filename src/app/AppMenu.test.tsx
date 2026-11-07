// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppMenu } from './AppMenu'

describe('AppMenu', () => {
  it('열면 첫 항목에 초점이 가고, ↑↓·Home·End 로 항목을 옮겨 다닌다', () => {
    render(
      <AppMenu groups={[
        [{ id: 'print', label: '인쇄', onSelect: vi.fn() }],
        [{ id: 'about', label: '정보 보기', onSelect: vi.fn() }, { id: 'settings', label: '설정', onSelect: vi.fn() }],
      ]} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'IWAE 메뉴' }))
    const menu = screen.getByRole('menu')
    const items = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement).toBe(items[2])
    // 끝에서 ↓ 는 처음으로 돈다
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
  })

  it('Escape 로 닫고 로고 단추로 초점을 돌려준다', () => {
    render(<AppMenu groups={[[{ id: 'settings', label: '설정', onSelect: vi.fn() }]]} />)
    const button = screen.getByRole('button', { name: 'IWAE 메뉴' })
    fireEvent.click(button)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
  })
})
