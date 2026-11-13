// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { canPaintDragDirectly, dividerStyle, paneCellStyle, snapRect } from './splitDragStyles'
import { SplitPanes } from './SplitPanes'
import { layoutForLegacyId } from '../../core/layoutTree'

describe('splitDragStyles 순수 함수', () => {
  it('snapRect 는 이웃한 두 칸이 같은 경계를 나눠 쓴다', () => {
    const a = snapRect({ x: 0, y: 0, w: 0.333, h: 1 }, { width: 1000, height: 500 })!
    const b = snapRect({ x: 0.333, y: 0, w: 0.667, h: 1 }, { width: 1000, height: 500 })!
    expect(a.left + a.width).toBe(b.left)
    expect(snapRect({ x: 0, y: 0, w: 1, h: 1 }, { width: 0, height: 0 })).toBeNull()
  })

  it('크기를 모르면 비율(%)로 둔다', () => {
    expect(paneCellStyle({ x: 0, y: 0, w: 0.3, h: 1 }, { width: 0, height: 0 })).toMatchObject({ width: '30%' })
    expect(paneCellStyle(null, { width: 100, height: 100 })).toEqual({ left: 0, top: 0, width: 0, height: 0 })
  })

  it('경계선 자리는 나눈 비율의 정수 px 이다', () => {
    expect(dividerStyle({ dir: 'h', x: 0, y: 0, w: 1, h: 1, ratio: 0.3 }, { width: 1000, height: 400 })).toEqual({ left: 300, top: 0, height: 400 })
    expect(dividerStyle({ dir: 'v', x: 0, y: 0, w: 1, h: 1, ratio: 0.25 }, { width: 1000, height: 400 })).toEqual({ top: 100, left: 0, width: 1000 })
  })

  it('떠 있는 칸이 있거나 크게 보는 중이면 DOM 에 바로 쓰지 않는다', () => {
    expect(canPaintDragDirectly(0, false)).toBe(true)
    expect(canPaintDragDirectly(1, false)).toBe(false)
    expect(canPaintDragDirectly(0, true)).toBe(false)
  })
})

describe('경계선 끌기는 칸 본문을 다시 그리지 않는다', () => {
  it('끄는 동안 renderPane 이 다시 불리지 않고, 놓으면 한 번만 바깥에 알린다', () => {
    const renderPane = vi.fn((pane: string) => <div>{pane}</div>)
    const onRootChange = vi.fn()
    const root = layoutForLegacyId('cols2', ['L', 'R'])
    const { container } = render(<SplitPanes sidebar={null} topBar={() => null} sidebarCollapsed={false} root={root} renderPane={renderPane} onRootChange={onRootChange} />)
    const rect = { left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON: () => ({}) }
    const panes = container.querySelector('.panes')!
    vi.spyOn(panes, 'getBoundingClientRect').mockReturnValue(rect as DOMRect)
    Object.defineProperty(panes, 'clientWidth', { configurable: true, value: 1000 })
    Object.defineProperty(panes, 'clientHeight', { configurable: true, value: 600 })
    const before = renderPane.mock.calls.length
    const divider = screen.getByRole('separator', { name: '패널 너비 조절' })
    fireEvent.pointerDown(divider, { pointerId: 1, clientX: 500, clientY: 100 })
    for (const x of [450, 400, 350, 300]) fireEvent.pointerMove(window, { pointerId: 1, clientX: x, clientY: 100 })
    expect(renderPane.mock.calls.length).toBe(before)
    expect(onRootChange).not.toHaveBeenCalled()
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(onRootChange).toHaveBeenCalledTimes(1)
  })
})
