// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { PANE_NUMBERS_MS, PaneNumbersOverlay } from './PaneNumbersOverlay'

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = ''
  for (const [index, pane] of ['p1', 'p2'].entries()) {
    const cell = document.createElement('div')
    cell.className = 'pane-grid-cell'
    const scope = document.createElement('div')
    scope.className = 'pane-focus-scope'
    scope.dataset.paneId = pane
    cell.append(scope)
    cell.getBoundingClientRect = () => ({ left: index * 300, top: 0, width: 300, height: 400, right: index * 300 + 300, bottom: 400, x: index * 300, y: 0, toJSON: () => ({}) })
    document.body.append(cell)
  }
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('PaneNumbersOverlay', () => {
  it('칸마다 번호(0 부터)를 보이고, 만지는 칸을 표시하며, 1.5 초 뒤 닫는다', () => {
    const onDone = vi.fn()
    render(<PaneNumbersOverlay panes={['p1', 'p2']} activePane="p2" onDone={onDone} />)
    const badges = [...document.querySelectorAll<HTMLElement>('.pane-number-badge')]
    expect(badges.map((badge) => badge.textContent)).toEqual(['0', '1'])
    expect(badges.map((badge) => badge.dataset.active)).toEqual(['false', 'true'])
    expect(PANE_NUMBERS_MS).toBe(1500)
    act(() => { vi.advanceTimersByTime(PANE_NUMBERS_MS - 1) })
    expect(onDone).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(2) })
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('찾을 수 없는 칸은 건너뛴다', () => {
    render(<PaneNumbersOverlay panes={['p1', 'nope']} activePane="p1" onDone={vi.fn()} />)
    expect(document.querySelectorAll('.pane-number-badge')).toHaveLength(1)
  })
})
