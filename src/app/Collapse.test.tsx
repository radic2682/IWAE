// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Collapse } from './Collapse'

describe('Collapse', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('renders open content immediately when it starts open (no animation)', () => {
    const { container } = render(<Collapse open><p>안쪽</p></Collapse>)
    expect(container.querySelector('.motion-collapse')?.hasAttribute('data-expanded')).toBe(true)
  })

  it('keeps the last content while closing, then unmounts', () => {
    const { container, rerender } = render(<Collapse open><p>안쪽</p></Collapse>)
    rerender(<Collapse open={false}>{null}</Collapse>)
    expect(container.querySelector('.motion-collapse')?.hasAttribute('data-closing')).toBe(true)
    expect(container.textContent).toBe('안쪽')
    act(() => { vi.advanceTimersByTime(400) })
    expect(container.querySelector('.motion-collapse')).toBeNull()
  })

  it('ends in the right state after rapid toggling', () => {
    const { container, rerender } = render(<Collapse open={false}>{null}</Collapse>)
    for (let i = 0; i < 5; i++) {
      rerender(<Collapse open={i % 2 === 0}><p>안쪽</p></Collapse>)
      act(() => { vi.advanceTimersByTime(30) })
    }
    act(() => { vi.advanceTimersByTime(400) })
    expect(container.querySelector('.motion-collapse')?.hasAttribute('data-expanded')).toBe(true)
    rerender(<Collapse open={false}>{null}</Collapse>)
    act(() => { vi.advanceTimersByTime(400) })
    expect(container.querySelector('.motion-collapse')).toBeNull()
  })
})
