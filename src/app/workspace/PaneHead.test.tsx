// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

describe('PaneHead 에 꺼내 둔 확대 · 닫기 단추', () => {
  const mount = (props: Partial<Parameters<typeof PaneHead>[0]> = {}) => {
    const fns = { onToggleZoom: vi.fn(), onClose: vi.fn() }
    render(<PaneHead tabs={null} paneCount={2} zoomed={false} onSplit={vi.fn()} onBreak={vi.fn()} onSwap={vi.fn()} onCycleChannel={vi.fn()} channel="blue" {...fns} {...props} />)
    return fns
  }
  it('메뉴와 같은 동작을 부르고, 말풍선에 접두키 힌트가 있다', () => {
    const fns = mount()
    const zoom = screen.getByRole('button', { name: '이 칸 확대' })
    const close = screen.getByRole('button', { name: '칸 닫기' })
    expect(zoom.title).toBe('이 칸 확대 (Ctrl+B z)')
    expect(close.title).toBe('칸 닫기 (Ctrl+B x)')
    fireEvent.click(zoom); fireEvent.click(close)
    expect(fns.onToggleZoom).toHaveBeenCalledTimes(1)
    expect(fns.onClose).toHaveBeenCalledTimes(1)
  })
  it('크게 보는 중이면 「원래 크기로」 가 눌린 모양', () => {
    mount({ zoomed: true })
    expect(screen.getByRole('button', { name: '원래 크기로' }).getAttribute('aria-pressed')).toBe('true')
  })
  it('칸이 하나면 숨긴다(닫기 · 확대 모두)', () => {
    mount({ paneCount: 1 })
    expect(screen.queryByRole('button', { name: '칸 닫기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '이 칸 확대' })).toBeNull()
  })
  it('좁은 머리(300px 미만)에서는 CSS 가 숨긴다', () => {
    const css = readFileSync(join(__dirname, '../../ui/workspace-surface.css'), 'utf8')
    expect(css).toContain('@container pane-head (max-width: 299px) { .pane-head .pane-head-act { display: none; } }')
  })
})
