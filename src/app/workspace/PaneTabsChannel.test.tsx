// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PaneTabsMenu } from './PaneTabsMenu'
import type { TabsState } from './tabs'

const state: TabsState = {
  tabs: [
    { id: 'spec', title: 'HTTP Semantics Guide', kind: 'pdf' },
    { id: 'peek', title: 'Rust Handbook', kind: 'pdf', preview: true },
  ],
  activeId: 'spec',
}

describe('창 머리의 색 점과 미리보기 탭', () => {
  it('색 점이 현재 채널을 보이고, 누르면 다음 채널로 바꾸라고 알린다', () => {
    const onCycleChannel = vi.fn()
    render(<PaneTabsMenu state={state} label="PDF" channel="blue" onCycleChannel={onCycleChannel} onActivate={vi.fn()} onClose={vi.fn()} />)

    const dot = screen.getByRole('button', { name: '파랑 채널: 같은 색 칸끼리 연동합니다. 눌러서 색 바꾸기, 다른 칸으로 끌어서 연결' })
    expect(dot.getAttribute('data-channel')).toBe('blue')
    fireEvent.click(dot)
    expect(onCycleChannel).toHaveBeenCalledTimes(1)
  })

  it('채널별 설명이 다르고, 없음은 다른 칸과 연동하지 않는다고 말한다', () => {
    const { rerender } = render(<PaneTabsMenu state={state} label="PDF" channel="green" onCycleChannel={vi.fn()} onActivate={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /초록 채널/ }).getAttribute('data-channel')).toBe('green')
    rerender(<PaneTabsMenu state={state} label="PDF" channel="orange" onCycleChannel={vi.fn()} onActivate={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /주황 채널/ }).getAttribute('data-channel')).toBe('orange')
    rerender(<PaneTabsMenu state={state} label="PDF" channel={null} onCycleChannel={vi.fn()} onActivate={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /채널 없음: 다른 칸과 연동하지 않습니다/ }).getAttribute('data-channel')).toBe('none')
  })

  it('빈 창에도 색 점이 있고, 점 처리기를 주지 않으면 점이 없다', () => {
    const { rerender } = render(<PaneTabsMenu state={{ tabs: [], activeId: null }} label="PDF" channel="blue" onCycleChannel={vi.fn()} onActivate={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /채널/ })).toBeTruthy()
    rerender(<PaneTabsMenu state={state} label="PDF" channel="blue" onActivate={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /채널/ })).toBeNull()
  })

  it('미리보기 탭은 기울임 표시가 붙고, 두 번 누르면 고정을 요청한다', () => {
    const onPinTab = vi.fn()
    const { container } = render(<PaneTabsMenu state={state} label="PDF" onPinTab={onPinTab} onActivate={vi.fn()} onClose={vi.fn()} />)

    const preview = container.querySelector('[data-tab-id="peek"]')!
    expect(preview.classList.contains('pane-top-tab-preview')).toBe(true)
    expect(container.querySelector('[data-tab-id="spec"]')!.classList.contains('pane-top-tab-preview')).toBe(false)
    fireEvent.doubleClick(preview)
    expect(onPinTab).toHaveBeenCalledWith('peek')
    // 보통 탭을 두 번 눌러도 아무 일 없다
    fireEvent.doubleClick(container.querySelector('[data-tab-id="spec"]')!)
    expect(onPinTab).toHaveBeenCalledTimes(1)
  })
})
