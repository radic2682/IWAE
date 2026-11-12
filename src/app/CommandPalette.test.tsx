// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CommandPalette, type PaletteCommand } from './CommandPalette'

const command = (id: string, label: string, run = vi.fn()): PaletteCommand => ({ id, kind: 'action', label, run })

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('CommandPalette: 「:」 로 시작하면 명령줄', () => {
  it('나머지를 명령줄 실행기로 보낸다(Enter)', () => {
    vi.useFakeTimers()
    const onRunLine = vi.fn()
    const onClose = vi.fn()
    render(<CommandPalette commands={[command('a', '새 창')]} onClose={onClose} onRunLine={onRunLine} />)
    const input = screen.getByRole('combobox', { name: '명령 찾기' })
    fireEvent.change(input, { target: { value: ': split-window -h ; open 노트 A' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option').textContent).toContain('split-window -h ; open 노트 A')
    fireEvent.keyDown(input, { key: 'Enter' })
    act(() => { vi.runAllTimers() })
    expect(onRunLine).toHaveBeenCalledWith('split-window -h ; open 노트 A')
    expect(onClose).toHaveBeenCalled()
  })

  it('initialQuery 로 열면 「:」 가 미리 들어 있다. 빈 명령은 실행하지 않는다', () => {
    vi.useFakeTimers()
    const onRunLine = vi.fn()
    render(<CommandPalette commands={[]} onClose={vi.fn()} initialQuery=":" onRunLine={onRunLine} />)
    const input = screen.getByRole('combobox', { name: '명령 찾기' }) as HTMLInputElement
    expect(input.value).toBe(':')
    fireEvent.keyDown(input, { key: 'Enter' })
    act(() => { vi.runAllTimers() })
    expect(onRunLine).not.toHaveBeenCalled()
  })

  it('「:」 가 아니면 보통 검색이다', () => {
    const onRunLine = vi.fn()
    render(<CommandPalette commands={[command('a', '새 창'), command('b', '설정 열기')]} onClose={vi.fn()} onRunLine={onRunLine} />)
    fireEvent.change(screen.getByRole('combobox', { name: '명령 찾기' }), { target: { value: '설정' } })
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['설정 열기'])
  })
})
