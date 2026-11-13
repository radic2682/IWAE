// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FLOAT_HEAD_H, FLOAT_MIN_H, FLOAT_MIN_W } from './floatingPanes'
import { FloatLayer, type AnchorRect, type FloatLayerProps } from './FloatLayer'
import type { FloatingPane } from './screens'

afterEach(cleanup)

const float = (overrides: Partial<FloatingPane> = {}): FloatingPane => ({ paneId: 'f1', anchor: { kind: 'screen' }, x: 0.1, y: 0.1, w: 300, h: 200, collapsed: false, ...overrides })

function setup(floats: readonly FloatingPane[] = [float()], anchor: AnchorRect | null = { left: 0, top: 0, width: 800, height: 600 }, extra: Partial<FloatLayerProps> = {}) {
  const onChange = vi.fn()
  const onRaise = vi.fn()
  const view = render(
    <div>
      <FloatLayer
        floats={floats}
        anchorRect={(a) => (a.kind === 'pane' ? anchor && { ...anchor, left: anchor.left + 100 } : anchor)}
        epoch={0}
        renderHead={(id) => <><span className="pane-float-grip" data-testid={`grip-${id}`} /><button type="button">단추</button></>}
        renderBody={(id) => <div data-testid={`body-${id}`}>본문 {id}</div>}
        onChange={onChange}
        onRaise={onRaise}
        {...extra}
      />
    </div>,
  )
  const card = (id = 'f1') => view.container.querySelector<HTMLElement>(`[data-float-pane="${id}"]`)!
  const head = (id = 'f1') => card(id).querySelector<HTMLElement>('.pane-float-head')!
  const handle = (id = 'f1') => card(id).querySelector<HTMLElement>('.pane-float-resize')!
  return { ...view, onChange, onRaise, card, head, handle }
}

const px = (value: string) => Number.parseFloat(value)

describe('FloatLayer', () => {
  it('저장된 비율 자리 · px 크기를 붙은 곳 안의 상자로 그린다', () => {
    const { card } = setup()
    expect(card().style.left).toBe('80px')
    expect(card().style.top).toBe('60px')
    expect(card().style.width).toBe('300px')
    expect(card().style.height).toBe('200px')
  })

  it('칸에 붙으면 그 칸의 사각형 안에 놓인다(칸을 따라 움직인다)', () => {
    const { card } = setup([float({ anchor: { kind: 'pane', paneId: 'a' }, x: 0, y: 0 })])
    expect(card().style.left).toBe('100px')
  })

  it('붙은 곳을 못 구하면(숨은 칸) 그리지 않는다', () => {
    const { container } = setup([float()], null)
    expect(container.querySelector('.pane-float')).toBeNull()
  })

  it('붙은 곳보다 큰 카드는 붙은 곳 안으로 줄이고, 밖에 놓인 자리는 안으로 가둔다', () => {
    const { card } = setup([float({ x: 0.9, y: 0.9, w: 2000, h: 2000 })])
    expect(card().style.width).toBe('800px')
    expect(card().style.height).toBe('600px')
    expect(card().style.left).toBe('0px')
    expect(card().style.top).toBe('0px')
  })

  it('접힌 카드는 머리 높이만 차지하고, 본문은 마운트된 채 숨기며 크기 손잡이가 없다', () => {
    const { card, handle, getByTestId } = setup([float({ collapsed: true })])
    expect(card().style.height).toBe(`${FLOAT_HEAD_H}px`)
    expect(getByTestId('body-f1').parentElement!.hasAttribute('hidden')).toBe(true)
    expect(card().querySelector('.pane-float-resize')).toBeNull()
    expect(handle).toBeDefined()
  })

  it('머리 빈자리를 끌면 옮기고, 놓을 때 한 번 비율 자리로 알린다', () => {
    const { head, card, onChange } = setup()
    fireEvent.pointerDown(head(), { button: 0, clientX: 200, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(head(), { clientX: 260, clientY: 140, pointerId: 1 })
    expect(card().style.left).toBe('140px')
    expect(card().style.top).toBe('100px')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerUp(head(), { pointerId: 1 })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('f1', { x: 140 / 800, y: 100 / 600, w: 300, h: 200 })
  })

  it('끌어도 붙은 곳 밖으로 나가지 않는다(오른쪽 아래 · 왼쪽 위)', () => {
    const { head, onChange } = setup()
    fireEvent.pointerDown(head(), { button: 0, clientX: 200, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(head(), { clientX: 9000, clientY: 9000, pointerId: 1 })
    fireEvent.pointerUp(head(), { pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith('f1', { x: 500 / 800, y: 400 / 600, w: 300, h: 200 })
    fireEvent.pointerDown(head(), { button: 0, clientX: 200, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(head(), { clientX: -9000, clientY: -9000, pointerId: 1 })
    fireEvent.pointerUp(head(), { pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith('f1', { x: 0, y: 0, w: 300, h: 200 })
  })

  it('단추 · 탭 위에서는 끌기가 시작되지 않는다', () => {
    const { card, head, onChange } = setup()
    const button = head().querySelector('button')!
    fireEvent.pointerDown(button, { button: 0, clientX: 200, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(head(), { clientX: 400, clientY: 300, pointerId: 1 })
    fireEvent.pointerUp(head(), { pointerId: 1 })
    expect(card().style.left).toBe('80px')
    expect(onChange).not.toHaveBeenCalled()
    const tab = document.createElement('div')
    tab.className = 'pane-top-tab'
    head().append(tab)
    fireEvent.pointerDown(tab, { button: 0, clientX: 200, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(head(), { clientX: 400, clientY: 300, pointerId: 1 })
    expect(card().style.left).toBe('80px')
  })

  it('오른쪽 아래 모서리로 크기를 바꾼다(최소 크기 이상, 붙은 곳 가장자리까지)', () => {
    const { handle, card, onChange } = setup()
    fireEvent.pointerDown(handle(), { button: 0, clientX: 380, clientY: 260, pointerId: 1 })
    fireEvent.pointerMove(handle(), { clientX: 480, clientY: 310, pointerId: 1 })
    expect(card().style.width).toBe('400px')
    expect(card().style.height).toBe('250px')
    fireEvent.pointerUp(handle(), { pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith('f1', { x: 80 / 800, y: 60 / 600, w: 400, h: 250 })
    fireEvent.pointerDown(handle(), { button: 0, clientX: 480, clientY: 310, pointerId: 1 })
    fireEvent.pointerMove(handle(), { clientX: -9000, clientY: -9000, pointerId: 1 })
    fireEvent.pointerUp(handle(), { pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith('f1', { x: 80 / 800, y: 60 / 600, w: FLOAT_MIN_W, h: FLOAT_MIN_H })
    fireEvent.pointerDown(handle(), { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(handle(), { clientX: 9000, clientY: 9000, pointerId: 1 })
    fireEvent.pointerUp(handle(), { pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith('f1', { x: 80 / 800, y: 60 / 600, w: 720, h: 540 })
  })

  it('오른쪽 버튼 · 움직임 없이 뗀 누름은 알리지 않는다', () => {
    const { head, onChange } = setup()
    fireEvent.pointerDown(head(), { button: 2, clientX: 200, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(head(), { clientX: 300, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(head(), { pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerDown(head(), { button: 0, clientX: 200, clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(head(), { pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('누르면 그 카드를 맨 위로 올리도록 알린다. 여러 장은 뒤에 있을수록 위에 그린다', () => {
    const { card, onRaise, container } = setup([float({ paneId: 'f1' }), float({ paneId: 'f2', x: 0.4 })])
    fireEvent.pointerDown(card('f1').querySelector('.pane-float-body')!, { button: 0, pointerId: 1 })
    expect(onRaise).toHaveBeenCalledWith('f1')
    expect([...container.querySelectorAll('.pane-float')].map((element) => element.getAttribute('data-float-pane'))).toEqual(['f1', 'f2'])
  })

  it('붙은 곳 크기를 아직 못 쟀으면(0) 저장된 크기를 왼쪽 위에 그대로 둔다', () => {
    const { card, head, onChange } = setup([float()], { left: 0, top: 0, width: 0, height: 0 })
    expect(card().style.width).toBe('300px')
    expect(px(card().style.left)).toBe(0)
    fireEvent.pointerDown(head(), { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(head(), { clientX: 50, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(head(), { pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('보통 칸과 같은 껍질 클래스를 달아 탭 끌어 놓기 · 연결선이 알아본다', () => {
    const { card } = setup()
    expect(card().classList.contains('pane-grid-cell')).toBe(true)
    expect(card().querySelector('.pane-grid-tabs.topbar-panetab-zone')).not.toBeNull()
    expect(card().querySelector('.pane-grid-body')).not.toBeNull()
  })
})
