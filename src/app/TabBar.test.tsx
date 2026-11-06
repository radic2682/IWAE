// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TabBar } from './TabBar'
import type { TabsState } from './tabs'

const state: TabsState = {
  tabs: [
    { id: 'a', title: 'HTTP Semantics v1.1', kind: 'pdf' },
    { id: 'b', title: 'Rust Handbook', kind: 'pdf' },
  ],
  activeId: 'b',
}

const noop = () => {}

describe('TabBar', () => {
  it('탭 제목을 모두 그린다', () => {
    render(<TabBar state={state} onActivate={noop} onClose={noop} />)
    expect(screen.getByRole('tab', { name: /HTTP Semantics v1.1/ })).toBeDefined()
    expect(screen.getByRole('tab', { name: /Rust Handbook/ })).toBeDefined()
  })

  it('활성 탭만 aria-selected 가 true 다', () => {
    render(<TabBar state={state} onActivate={noop} onClose={noop} />)
    expect(screen.getByRole('tab', { name: /Handbook/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: /Semantics/ }).getAttribute('aria-selected')).toBe('false')
  })

  it('탭을 누르면 onActivate 가 그 id 로 불린다', () => {
    const onActivate = vi.fn()
    render(<TabBar state={state} onActivate={onActivate} onClose={noop} />)
    fireEvent.click(screen.getByRole('tab', { name: /Semantics/ }))
    expect(onActivate).toHaveBeenCalledWith('a')
  })

  it('닫기 버튼을 누르면 onClose 만 불리고 onActivate 는 안 불린다', () => {
    const onActivate = vi.fn()
    const onClose = vi.fn()
    render(<TabBar state={state} onActivate={onActivate} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'HTTP Semantics v1.1 닫기' }))
    expect(onClose).toHaveBeenCalledWith('a')
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('탭이 없으면 빈 줄만 남는다 — 높이가 유지되어 아래 내용이 안 밀린다', () => {
    render(<TabBar state={{ tabs: [], activeId: null }} onActivate={noop} onClose={noop} />)
    expect(screen.getByRole('tablist')).toBeDefined()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })
})

describe('TabBar — 키보드', () => {
  it('활성 탭만 순차 포커스에 두고 화살표·Home·End로 순환 이동한다', () => {
    const onActivate = vi.fn()
    render(<TabBar state={state} onActivate={onActivate} onClose={noop} />)
    const first = screen.getByRole('tab', { name: /Semantics/ })
    const second = screen.getByRole('tab', { name: /Handbook/ })

    expect(first.tabIndex).toBe(-1)
    expect(second.tabIndex).toBe(0)

    second.focus()
    fireEvent.keyDown(second, { key: 'ArrowRight' })
    expect(onActivate).toHaveBeenLastCalledWith('a')
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(first, { key: 'End' })
    expect(onActivate).toHaveBeenLastCalledWith('b')
    expect(document.activeElement).toBe(second)

    fireEvent.keyDown(second, { key: 'Home' })
    expect(onActivate).toHaveBeenLastCalledWith('a')
    expect(document.activeElement).toBe(first)
  })

  it('탭에 포커스를 두고 Enter 나 Space 를 누르면 활성화된다', () => {
    // role="tab" 은 div 라서 브라우저가 Enter/Space 를 클릭으로 바꿔주지
    // 않는다. tabIndex 만 주면 '포커스는 가는데 눌리지 않는' 칸이 된다.
    const onActivate = vi.fn()
    render(<TabBar state={state} onActivate={onActivate} onClose={noop} />)
    const tab = screen.getByRole('tab', { name: /Semantics/ })

    fireEvent.keyDown(tab, { key: 'Enter' })
    expect(onActivate).toHaveBeenCalledWith('a')

    onActivate.mockClear()
    fireEvent.keyDown(tab, { key: ' ' })
    expect(onActivate).toHaveBeenCalledWith('a')
  })

  it('다른 키는 활성화하지 않는다', () => {
    const onActivate = vi.fn()
    render(<TabBar state={state} onActivate={onActivate} onClose={noop} />)
    fireEvent.keyDown(screen.getByRole('tab', { name: /Semantics/ }), { key: 'a' })
    expect(onActivate).not.toHaveBeenCalled()
  })
})
