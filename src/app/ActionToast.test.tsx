// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionToast, TOAST_MAX, TOAST_SHOW_MS } from './ActionToast'
import { announceAction } from './actionFeedback'
import { NoticeStack } from './NoticeStack'

describe('ActionToast', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('알림을 쌓아 보여 주고 시간이 지나면 걷는다', () => {
    render(<ActionToast />)
    act(() => { announceAction('첫째'); announceAction('둘째') })
    expect(screen.getByText('첫째')).toBeTruthy()
    expect(screen.getByText('둘째')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(TOAST_SHOW_MS + 400) })
    expect(screen.queryByText('첫째')).toBeNull()
    expect(screen.queryByText('둘째')).toBeNull()
  })

  it('같은 글은 겹쳐 쌓지 않는다', () => {
    render(<ActionToast />)
    act(() => { announceAction('같은 글'); announceAction('같은 글') })
    expect(screen.getAllByText('같은 글')).toHaveLength(1)
  })

  it('최대 개수를 넘기면 오래된 것부터 걷는다', () => {
    render(<ActionToast />)
    act(() => { for (let index = 0; index <= TOAST_MAX; index += 1) announceAction(`글 ${index}`) })
    expect(screen.queryByText('글 0')).toBeNull()
    expect(screen.getByText(`글 ${TOAST_MAX}`)).toBeTruthy()
  })

  it('닫기 단추(키보드로 닿는다)로 바로 걷는다', () => {
    render(<ActionToast />)
    act(() => { announceAction('닫을 글') })
    fireEvent.click(screen.getByRole('button', { name: '알림 닫기' }))
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.queryByText('닫을 글')).toBeNull()
  })

  it('초점이 있는 동안에는 사라지지 않는다', () => {
    render(<ActionToast />)
    act(() => { announceAction('붙잡은 글') })
    fireEvent.focus(screen.getByRole('button', { name: '알림 닫기' }))
    act(() => { vi.advanceTimersByTime(TOAST_SHOW_MS * 3) })
    expect(screen.getByText('붙잡은 글')).toBeTruthy()
  })
})

describe('NoticeStack', () => {
  it('토스트 위에 오래 남는 알림을 아래로 놓는다', () => {
    render(<NoticeStack><p>오래 남는 알림</p></NoticeStack>)
    const region = screen.getByRole('region', { name: '알림' })
    expect(region.firstElementChild?.className).toContain('notice-toasts')
    expect(region.lastElementChild?.textContent).toBe('오래 남는 알림')
  })
})
