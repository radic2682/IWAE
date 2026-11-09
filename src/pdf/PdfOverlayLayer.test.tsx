// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PdfOverlayLayer, type OverlayStyle, type OverlayTool } from './PdfOverlayLayer'
import { createLine, createTextBox, type PdfOverlay } from '../core/pdfOverlays'

const style: OverlayStyle = { color: '#d9363e', textSize: 12, lineWidth: 2, bold: false, textFill: 'none', border: false, dash: 'solid', arrowStart: false, arrowEnd: true, fill: false }

function mount(overlays: PdfOverlay[] = [], extra: { editMode?: boolean; tool?: OverlayTool } = {}) {
  const handlers = { onAdd: vi.fn(), onUpdate: vi.fn(), onRemove: vi.fn() }
  const view = render(
    <PdfOverlayLayer
      overlays={overlays}
      pageSizes={[[612, 792]]}
      layoutOf={() => ({ top: 0, left: 0, width: 612 })}
      width={612}
      height={792}
      editMode={extra.editMode ?? true}
      tool={extra.tool ?? 'text'}
      style={style}
      {...handlers}
    />,
  )
  const layer = view.container.querySelector<HTMLElement>('.pdf-overlay-layer')!
  layer.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 612, bottom: 792, width: 612, height: 792, toJSON: () => ({}) })
  return { view, layer, ...handlers }
}

describe('PdfOverlayLayer', () => {
  it('글 상자 도구로 빈 곳을 누르면 그 자리에 쓰기 상자가 열리고, 글을 쓰고 빈 곳을 누르면 그때 저장한다', () => {
    const { view, layer, onAdd } = mount()
    fireEvent.pointerDown(layer, { button: 0, clientX: 120, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 120, clientY: 200, pointerId: 1 })
    // 글을 쓰기 전에는 저장하지 않는다
    expect(onAdd).not.toHaveBeenCalled()
    const editor = view.getByRole('textbox', { name: '글 상자' })
    editor.innerText = '검토 필요'
    fireEvent.input(editor)
    // 빈 곳을 누르면 쓰던 글을 저장하고 끝낸다. 새 상자는 만들지 않는다
    fireEvent.pointerDown(layer, { button: 0, clientX: 300, clientY: 300, pointerId: 2 })
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd.mock.calls[0]![0]).toMatchObject({ kind: 'text', page: 0, x: 120, y: 200, color: '#d9363e', size: 12, text: '검토 필요' })
    expect(view.queryByRole('textbox', { name: '글 상자' })).toBeNull()
  })

  it('글 상자 도구로 끌면 그 너비의 상자를 만든다', () => {
    const { view, layer, onAdd } = mount()
    fireEvent.pointerDown(layer, { button: 0, clientX: 100, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 340, clientY: 230, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 340, clientY: 230, pointerId: 1 })
    const editor = view.getByRole('textbox', { name: '글 상자' })
    editor.innerText = '넓은 상자'
    fireEvent.input(editor)
    fireEvent.pointerDown(layer, { button: 0, clientX: 500, clientY: 500, pointerId: 2 })
    expect(onAdd.mock.calls[0]![0]).toMatchObject({ kind: 'text', x: 100, y: 200, w: 240, text: '넓은 상자' })
  })

  it('글 없이 끝낸 새 글 상자는 남기지 않는다', () => {
    const { view, layer, onAdd } = mount()
    fireEvent.pointerDown(layer, { button: 0, clientX: 120, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 120, clientY: 200, pointerId: 1 })
    fireEvent.pointerDown(layer, { button: 0, clientX: 300, clientY: 300, pointerId: 2 })
    expect(onAdd).not.toHaveBeenCalled()
    expect(view.container.querySelectorAll('.pdf-overlay-text')).toHaveLength(0)
  })

  it('선 도구는 끌어서 그리고, 놓으면 한 번 만든다. 짧게 누르면 만들지 않는다', () => {
    const { layer, onAdd } = mount([], { tool: 'line' })
    fireEvent.pointerDown(layer, { button: 0, clientX: 50, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 50, clientY: 51, pointerId: 1 })
    expect(onAdd).not.toHaveBeenCalled()
    fireEvent.pointerDown(layer, { button: 0, clientX: 50, clientY: 50, pointerId: 2 })
    fireEvent.pointerMove(window, { clientX: 140, clientY: 90, pointerId: 2 })
    fireEvent.pointerUp(window, { clientX: 140, clientY: 90, pointerId: 2 })
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd.mock.calls[0]![0]).toMatchObject({ kind: 'line', x1: 50, y1: 50, x2: 140, y2: 90, arrow: true })
  })

  it('펜 도구는 끌면서 획을 모아 놓을 때 한 번 저장한다', () => {
    const { layer, onAdd } = mount([], { tool: 'pen' })
    fireEvent.pointerDown(layer, { button: 0, clientX: 50, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 60, clientY: 55, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 80, clientY: 70, pointerId: 1 })
    expect(onAdd).not.toHaveBeenCalled()
    fireEvent.pointerUp(window, { clientX: 80, clientY: 70, pointerId: 1 })
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd.mock.calls[0]![0]).toMatchObject({ kind: 'ink', page: 0, points: [[50, 50], [60, 55], [80, 70]] })
  })

  it('보기 모드에서는 덮개만 그리고 새로 만들지도 않는다', () => {
    const text = createTextBox(0, 10, 10, { text: '메모' })
    const { view, layer, onAdd } = mount([text], { editMode: false })
    expect(view.container.textContent).toContain('메모')
    expect(layer.className).not.toContain('pdf-overlay-layer-edit')
    fireEvent.pointerDown(layer, { button: 0, clientX: 300, clientY: 300, pointerId: 1 })
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('글 상자를 누르면 고른 것으로 알린다(서식은 위 도구창에서)', () => {
    const text = createTextBox(0, 10, 10, { text: '메모' })
    const onSelect = vi.fn()
    const view = render(
      <PdfOverlayLayer overlays={[text]} pageSizes={[[600, 800]]} layoutOf={() => ({ top: 0, left: 0, width: 600 })} width={600} height={800}
        editMode tool="text" style={style} onAdd={vi.fn()} onUpdate={vi.fn()} onRemove={vi.fn()} selectedId={null} onSelect={onSelect} />,
    )
    const box = view.container.querySelector<HTMLElement>('.pdf-overlay-text')!
    fireEvent.pointerDown(box, { button: 0, clientX: 15, clientY: 15, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 15, clientY: 15, pointerId: 1 })
    expect(onSelect).toHaveBeenCalledWith(text.id)
    expect(screen.queryByRole('toolbar', { name: '편집 속성' })).toBeNull()
  })

  it('고른 선은 Delete 로 지운다', () => {
    const line = createLine(0, { x: 10, y: 10 }, { x: 100, y: 10 })
    const { view, onRemove } = mount([line])
    const hit = view.container.querySelector('.pdf-overlay-line-hit')!
    fireEvent.pointerDown(hit, { button: 0, clientX: 50, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(window, { clientX: 50, clientY: 10, pointerId: 1 })
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(onRemove).toHaveBeenCalledWith(line.id)
  })
})
