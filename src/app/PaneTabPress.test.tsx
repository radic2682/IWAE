// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PaneCard } from './PaneCard'
import { PaneTabsMenu } from './PaneTabsMenu'
import type { TabsState } from './tabs'

afterEach(() => { vi.useRealTimers(); cleanup(); delete (document as { elementFromPoint?: unknown }).elementFromPoint })

const state: TabsState = {
  tabs: [
    { id: 'a', title: 'Alpha', kind: 'pdf' },
    { id: 'b', title: 'Beta', kind: 'pdf' },
  ],
  activeId: 'a',
}

/** 진짜 PaneTabsMenu 를 진짜 PaneCard 안에 둔다(안 만지는 칸의 안 보이는 탭을 누르는 경로) */
const setup = () => {
  // jsdom 에는 elementFromPoint 가 없다: 끌기가 놓을 자리를 찾을 때 쓰므로 빈 곳으로 돌려준다
  document.elementFromPoint = () => null
  if (typeof CSS === 'undefined') (globalThis as { CSS?: unknown }).CSS = { escape: (value: string) => value }
  else if (typeof CSS.escape !== 'function') (CSS as { escape?: unknown }).escape = (value: string) => value
  const onActivate = vi.fn()
  const onFocusPane = vi.fn()
  render(
    <PaneCard paneId="p2" channel={null} active={false} onFocusPane={onFocusPane}>
      <PaneTabsMenu state={state} label="탭" paneId="p2" onActivate={onActivate} onClose={vi.fn()} onReorderTab={vi.fn()} />
    </PaneCard>,
  )
  return { onActivate, onFocusPane, beta: screen.getByRole('tab', { name: 'Beta' }) }
}

describe('안 만지는 칸의 안 보이는 탭을 누르기 · 끌기', () => {
  it('누르는 순간에는 보이는 탭도 만지는 칸도 바뀌지 않는다', () => {
    const { onActivate, onFocusPane, beta } = setup()
    fireEvent.pointerDown(beta, { button: 0, clientX: 40, clientY: 14 })
    expect(onActivate).not.toHaveBeenCalled()
    expect(onFocusPane).not.toHaveBeenCalled()
    fireEvent.pointerUp(window, { clientX: 40, clientY: 14 })
  })

  it('끌었다 놓으면 끝까지 아무것도 바뀌지 않는다(만지는 칸 · 보이는 탭 모두)', () => {
    const { onActivate, onFocusPane, beta } = setup()
    fireEvent.pointerDown(beta, { button: 0, clientX: 40, clientY: 14 })
    fireEvent.pointerMove(window, { clientX: 90, clientY: 16 })
    fireEvent.pointerMove(window, { clientX: 140, clientY: 18 })
    fireEvent.pointerUp(window, { clientX: 140, clientY: 18 })
    fireEvent.click(beta)
    expect(onFocusPane).not.toHaveBeenCalled()
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('끌지 않고 놓으면(클릭) 그때 보이는 탭과 만지는 칸이 바뀐다', () => {
    const { onActivate, onFocusPane, beta } = setup()
    fireEvent.pointerDown(beta, { button: 0, clientX: 40, clientY: 14 })
    fireEvent.pointerUp(window, { clientX: 40, clientY: 14 })
    fireEvent.click(beta)
    expect(onFocusPane).toHaveBeenCalledExactlyOnceWith('p2')
    expect(onActivate).toHaveBeenCalledExactlyOnceWith('b')
  })

  it('끌기 끝에 따라오는 click 은 끌기가 오래 걸렸어도(400ms 넘게) Esc 로 취소하고 탭 위에서 놓아도 막힌다 — 한 번만 막고 다음 click 은 통한다', () => {
    vi.useFakeTimers()
    const { onActivate, onFocusPane, beta } = setup()
    fireEvent.pointerDown(beta, { button: 0, clientX: 40, clientY: 14 })
    fireEvent.pointerMove(window, { clientX: 90, clientY: 16 })
    fireEvent.pointerMove(window, { clientX: 140, clientY: 18 })
    act(() => { vi.advanceTimersByTime(1500) })
    fireEvent.keyDown(window, { key: 'Escape' })
    act(() => { vi.advanceTimersByTime(1500) })
    fireEvent.pointerUp(beta, { clientX: 40, clientY: 14 })
    fireEvent.click(beta)
    expect(onActivate).not.toHaveBeenCalled()
    expect(onFocusPane).not.toHaveBeenCalled()
    // 놓은 뒤 한 틱이 지나면 풀린다: 다음 누름 · click 은 보통대로
    act(() => { vi.advanceTimersByTime(1) })
    fireEvent.pointerDown(beta, { button: 0, clientX: 40, clientY: 14 })
    fireEvent.pointerUp(window, { clientX: 40, clientY: 14 })
    fireEvent.click(beta)
    expect(onActivate).toHaveBeenCalledExactlyOnceWith('b')
  })

  it('끌기가 시작된 채 pointerup 이 오지 않아도(창이 따로 움직이는 끌기) 다음 누름에서 click 막기가 풀린다', () => {
    vi.useFakeTimers()
    const { onActivate, beta } = setup()
    fireEvent.pointerDown(beta, { button: 0, clientX: 40, clientY: 14 })
    fireEvent.pointerMove(window, { clientX: 140, clientY: 18 })
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.pointerDown(beta, { button: 0, clientX: 40, clientY: 14 })
    fireEvent.pointerUp(window, { clientX: 40, clientY: 14 })
    fireEvent.click(beta)
    expect(onActivate).toHaveBeenCalledExactlyOnceWith('b')
  })
})

describe('칸 누르기 규칙(PaneCard)', () => {
  it('탭 닫기 ×를 눌러도 칸이 만지는 칸이 되지 않는다(닫기만 한다)', () => {
    const { onFocusPane } = setup()
    const close = screen.getByRole('button', { name: 'Beta 닫기' })
    fireEvent.pointerDown(close, { button: 0, clientX: 100, clientY: 14 })
    fireEvent.pointerUp(window, { clientX: 100, clientY: 14 })
    expect(onFocusPane).not.toHaveBeenCalled()
  })

  it('탭의 오른쪽 여백(탭 상자 자체)은 탭처럼 놓을 때 칸이 바뀐다', () => {
    const { onFocusPane, beta } = setup()
    const box = beta.closest('.pane-top-tab') as HTMLElement
    fireEvent.pointerDown(box, { button: 0, clientX: 118, clientY: 14 })
    expect(onFocusPane).not.toHaveBeenCalled()
    fireEvent.pointerUp(window, { clientX: 118, clientY: 14 })
    expect(onFocusPane).toHaveBeenCalledExactlyOnceWith('p2')
  })

  it('끌기 문턱(TAB_DRAG_THRESHOLD_PX, 6px) 미만으로 움직이고 놓으면 누른 것이고 그 이상이면 끌기다', () => {
    const near = setup()
    fireEvent.pointerDown(near.beta, { button: 0, clientX: 40, clientY: 14 })
    fireEvent.pointerMove(window, { clientX: 45, clientY: 14 })
    fireEvent.pointerUp(window, { clientX: 45, clientY: 14 })
    expect(near.onFocusPane).toHaveBeenCalledTimes(1)
    cleanup()
    const far = setup()
    fireEvent.pointerDown(far.beta, { button: 0, clientX: 40, clientY: 14 })
    fireEvent.pointerMove(window, { clientX: 46, clientY: 14 })
    fireEvent.pointerUp(window, { clientX: 46, clientY: 14 })
    expect(far.onFocusPane).not.toHaveBeenCalled()
  })

  it.each([
    ['Esc', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ['창 포커스 잃음(blur)', () => fireEvent.blur(window)],
    ['pointercancel', () => fireEvent(window, new Event('pointercancel'))],
  ])('기다리는 중에 %s 가 오면 누름이 취소되어 놓아도 칸이 바뀌지 않는다', (_name, interrupt) => {
    const { onFocusPane, beta } = setup()
    fireEvent.pointerDown(beta, { button: 0, clientX: 40, clientY: 14 })
    interrupt()
    fireEvent.pointerUp(window, { clientX: 40, clientY: 14 })
    expect(onFocusPane).not.toHaveBeenCalled()
  })

  it('오른쪽 · 가운데 단추로 탭을 눌러도 칸을 바꾸지 않는다', () => {
    const { onFocusPane, beta } = setup()
    fireEvent.pointerDown(beta, { button: 2 })
    fireEvent.pointerDown(beta, { button: 1 })
    fireEvent.pointerUp(window)
    expect(onFocusPane).not.toHaveBeenCalled()
  })
})
