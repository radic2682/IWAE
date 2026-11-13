// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PaneHead } from './PaneHead'

afterEach(cleanup)

const open = (props: Partial<Parameters<typeof PaneHead>[0]> = {}) => {
  render(<PaneHead tabs={null} paneCount={2} zoomed={false} onSplit={vi.fn()} onToggleZoom={vi.fn()} onBreak={vi.fn()} onSwap={vi.fn()} onFloat={vi.fn()} onCycleChannel={vi.fn()} onClose={vi.fn()} channel="blue" {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '칸 메뉴' }))
  return screen.getByRole('menu', { name: '칸 메뉴' })
}

describe('PaneHead ⋯ 메뉴의 말과 힌트', () => {
  it('「이 칸 확대」 · 켜 있으면 「원래 크기로」(「되돌리기」 는 실행 취소의 말이다)', () => {
    const menu = open()
    expect(within(menu).getByRole('menuitem', { name: /이 칸 확대/u })).toBeDefined()
    cleanup()
    const zoomed = open({ zoomed: true })
    expect(within(zoomed).getByRole('menuitem', { name: /^원래 크기로/u })).toBeDefined()
    expect(within(zoomed).queryByRole('menuitem', { name: /되돌리기/u })).toBeNull()
  })

  it('단축키는 키캡(kbd)이고, 키가 없는 「띄우기」에는 힌트가 없다(float-pane 같은 명령 이름을 힌트로 달지 않는다)', () => {
    const menu = open()
    const float = within(menu).getByRole('menuitem', { name: /띄우기/u })
    expect(float.querySelector('kbd')).toBeNull()
    expect(float.textContent).toBe('띄우기')
    expect(menu.textContent).not.toContain('float-pane')
    expect(within(menu).getByRole('menuitem', { name: /오른쪽으로 나누기/u }).querySelector('kbd')?.textContent).toBe('Ctrl+B %')
  })

  it('「색 바꾸기」 는 키캡이 아니라 값 모양(색 점 + 이름)이다', () => {
    const menu = open({ channel: 'green' })
    const item = within(menu).getByRole('menuitem', { name: /색 바꾸기/u })
    expect(item.querySelector('kbd')).toBeNull()
    const value = item.querySelector<HTMLElement>('.menu-value')!
    expect(value.textContent).toBe('초록')
    expect(value.dataset.channel).toBe('green')
    expect(value.querySelector('.menu-value-dot')).not.toBeNull()
  })
})
