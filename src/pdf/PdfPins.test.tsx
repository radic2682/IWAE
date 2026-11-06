// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { PdfPane } from './PdfPane'
import { createPdfBookmark, type PdfBookmark } from '../core/pdfBookmarks'

function setViewport(width: number, height: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height })
}

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
})

const sizes = Array.from({ length: 40 }, (): readonly [number, number] => [612, 792])

function Harness({ initial = [], onAdd, onUpdate }: {
  readonly initial?: readonly PdfBookmark[]
  readonly onAdd?: (page: number, y: number, title: string) => void
  readonly onUpdate?: (id: string, patch: { title?: string; emoji?: string | null }) => void
}) {
  const [pins, setPins] = useState<readonly PdfBookmark[]>(initial)
  return (
    <PdfPane
      docId="0123456789ab"
      pageSizes={sizes}
      hasText
      pins={pins}
      onAddPin={(page, y, title) => {
        onAdd?.(page, y, title)
        const pin = createPdfBookmark('0123456789ab', page, title, new Date(), y)
        setPins((current) => [...current, pin])
        return pin.id
      }}
      onUpdatePin={(id, patch) => {
        onUpdate?.(id, patch)
        setPins((current) => current.map((pin) => (pin.id === id ? { ...pin, ...(patch.title === undefined ? {} : { title: patch.title }) } : pin)))
      }}
      onRemovePin={(id) => setPins((current) => current.filter((pin) => pin.id !== id))}
    />
  )
}

describe('PDF 스크롤 막대 책갈피 핀', () => {
  it('꽂아 둔 핀은 막대 옆에 이름과 함께 늘 보이고, 누르면 그 자리로 간다', () => {
    setViewport(800, 600)
    const pin = { ...createPdfBookmark('0123456789ab', 10, '3.2 리셋', new Date(), 0.5), emoji: '🔥' }
    const { container } = render(<Harness initial={[pin]} />)
    const button = screen.getByRole('button', { name: '책갈피 3.2 리셋 11쪽' })
    expect(button.textContent).toContain('🔥')
    expect(container.querySelector('.pdf-pins')).not.toBeNull()
    const scroller = container.querySelector<HTMLElement>('.pdf-pane')!
    let top = 0
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value } })
    fireEvent.click(button)
    expect(top).toBeGreaterThan(0)
  })

  it('막대에 올리면 흐린 새 핀이 따라오고, 누르면 그 자리에 꽂히며 바로 이름을 고친다', () => {
    setViewport(800, 600)
    const onAdd = vi.fn()
    const onUpdate = vi.fn()
    const { container } = render(<Harness onAdd={onAdd} onUpdate={onUpdate} />)
    const bar = container.querySelector<HTMLElement>('.pdf-scrollbar')!
    fireEvent.pointerMove(bar, { clientY: 300 })
    const ghost = container.querySelector<HTMLElement>('.pdf-pin-ghost')
    expect(ghost).not.toBeNull()
    fireEvent.pointerDown(ghost!, { button: 0 })
    expect(onAdd).toHaveBeenCalledOnce()
    const [page, y] = onAdd.mock.calls[0]!
    expect(page).toBeGreaterThan(0)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y).toBeLessThanOrEqual(1)
    const input = screen.getByRole('textbox', { name: '핀 이름' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: '리셋 흐름' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onUpdate).toHaveBeenCalledWith(expect.any(String), { title: '리셋 흐름' })
    expect(screen.getByRole('button', { name: /책갈피 리셋 흐름/ })).toBeDefined()
  })

  it('막대에서 손을 떼면(벗어나면) 흐린 핀이 사라지고, 고치는 칸에서 핀을 뺄 수 있다', () => {
    setViewport(800, 600)
    const pin = createPdfBookmark('0123456789ab', 5, '빼 볼 핀', new Date(), 0.2)
    const { container } = render(<Harness initial={[pin]} />)
    const bar = container.querySelector<HTMLElement>('.pdf-scrollbar')!
    fireEvent.pointerMove(bar, { clientY: 200 })
    expect(container.querySelector('.pdf-pin-ghost')).not.toBeNull()
    fireEvent.pointerLeave(bar)
    expect(container.querySelector('.pdf-pin-ghost')).toBeNull()
    fireEvent.doubleClick(screen.getByRole('button', { name: /책갈피 빼 볼 핀/ }))
    fireEvent.click(screen.getByRole('button', { name: '핀 빼기' }))
    expect(screen.queryByRole('button', { name: /책갈피 빼 볼 핀/ })).toBeNull()
  })
})
