// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LinkLayer } from './LinkLayer'
import type { PdfLink } from '../bridge/pdf'

const links: PdfLink[] = [
  { rect: { x: 40, y: 172, w: 160, h: 20 }, target: { kind: 'page', page: 4, y: 292 } },
  { rect: { x: 40, y: 212, w: 160, h: 20 }, target: { kind: 'uri', uri: 'https://example.com/paper' } },
]

describe('LinkLayer', () => {
  it('scales link areas to the rendered page', () => {
    render(<LinkLayer links={links} renderScale={2} onInternal={vi.fn()} onExternal={vi.fn()} />)
    const internal = screen.getByRole('link', { name: '5쪽으로 이동' })
    expect(internal.style.left).toBe('80px')
    expect(internal.style.top).toBe('344px')
    expect(internal.style.width).toBe('320px')
    expect(internal.style.height).toBe('40px')
  })

  it('sends internal links to the page and web links to the confirmation', () => {
    const onInternal = vi.fn()
    const onExternal = vi.fn()
    render(<LinkLayer links={links} renderScale={1} onInternal={onInternal} onExternal={onExternal} />)
    fireEvent.click(screen.getByRole('link', { name: '5쪽으로 이동' }))
    expect(onInternal).toHaveBeenCalledWith({ page: 4, y: 292 })
    fireEvent.click(screen.getByRole('link', { name: '외부 링크 example.com' }))
    expect(onExternal).toHaveBeenCalledWith('https://example.com/paper')
  })

  it('ignores clicks with a modifier so text selection gestures still work', () => {
    const onInternal = vi.fn()
    render(<LinkLayer links={links} renderScale={1} onInternal={onInternal} onExternal={vi.fn()} />)
    fireEvent.click(screen.getByRole('link', { name: '5쪽으로 이동' }), { shiftKey: true })
    expect(onInternal).not.toHaveBeenCalled()
  })
})
