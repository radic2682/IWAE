// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ContextMenu } from './ContextMenu'

const entries = [
  { key: 'a', icon: null, label: '하나', onSelect: vi.fn() },
  { key: 'b', icon: null, label: '둘', onSelect: vi.fn() },
]

describe('ContextMenu keyboard', () => {
  it('autoFocus 면 첫 항목에 초점이 가고 ↑↓ 로 옮기며 Esc 는 연 단추로 돌려준다', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const onClose = vi.fn()
    render(<ContextMenu x={10} y={10} label="그리기" entries={entries} onClose={onClose} autoFocus />)
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '하나' }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '둘' }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('기본은 초점을 가져가지 않는다(우클릭 메뉴)', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    render(<ContextMenu x={10} y={10} label="메뉴" entries={entries} onClose={vi.fn()} />)
    expect(document.activeElement).toBe(input)
    input.remove()
  })

  it('항목을 고르면 연 단추로 초점이 돌아간다', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    render(<ContextMenu x={10} y={10} label="그리기" entries={entries} onClose={vi.fn()} autoFocus />)
    fireEvent.click(screen.getByRole('menuitem', { name: '둘' }))
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
