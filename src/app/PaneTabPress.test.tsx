// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PaneCard } from './PaneCard'
import { PaneTabsMenu } from './PaneTabsMenu'
import type { TabsState } from './tabs'

afterEach(() => { cleanup(); delete (document as { elementFromPoint?: unknown }).elementFromPoint })

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
})
