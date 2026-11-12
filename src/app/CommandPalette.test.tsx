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

describe('CommandPalette: 명령줄의 Tab 완성과 ↑/↓ 기록', () => {
  const lineInput = () => screen.getByRole('combobox', { name: '명령 찾기' }) as HTMLInputElement
  const open = (history: string[] = [], initialQuery = ':') => {
    window.localStorage.setItem('iwae:command-history:v1', JSON.stringify(history))
    return render(<CommandPalette commands={[]} onClose={vi.fn()} initialQuery={initialQuery} onRunLine={vi.fn()} completion={{ screenNames: ['읽기', '쓰기'], templateNames: [] }} />)
  }
  const key = (name: string) => fireEvent.keyDown(lineInput(), { key: name })
  beforeEach(() => window.localStorage.clear())

  it('Tab 은 명령 이름을 완성하고, 후보가 여럿이면 공통 앞부분까지 채우고 후보를 목록에 보인다', () => {
    open([], ':select-wi')
    key('Tab')
    expect(lineInput().value).toBe(':select-window ')
    // 후보가 여럿: 「sel」 은 select-… 들의 공통 앞부분(select-)까지만 채우고 후보를 한 줄로 보인다
    fireEvent.change(lineInput(), { target: { value: ':sel' } })
    key('Tab')
    expect(lineInput().value).toBe(':select-')
    expect(screen.getByRole('option').textContent).toContain('select-window')
    expect(screen.getByRole('option').textContent).toContain('select-pane')
    // 다시 치면 후보 목록은 사라지고 실행 줄 모양으로 돌아온다
    fireEvent.change(lineInput(), { target: { value: ':select-window -t ' } })
    expect(screen.getByRole('option').textContent).toContain('명령 실행')
  })

  it('Tab 은 화면 이름도 완성한다(select-window -t)', () => {
    open([], ':select-window -t 읽')
    key('Tab')
    expect(lineInput().value).toBe(':select-window -t 읽기 ')
  })

  it('↑ 는 최근 줄부터 거슬러 오르고(맨 앞에서 멈춘다), ↓ 는 되돌아와 쓰던 줄로 끝난다', () => {
    open(['kill-pane', 'split-window -h', 'new-window'], ':이어서')
    key('ArrowUp'); expect(lineInput().value).toBe(':new-window')
    key('ArrowUp'); expect(lineInput().value).toBe(':split-window -h')
    key('ArrowUp'); expect(lineInput().value).toBe(':kill-pane')
    key('ArrowUp'); expect(lineInput().value).toBe(':kill-pane')
    key('ArrowDown'); expect(lineInput().value).toBe(':split-window -h')
    key('ArrowDown'); expect(lineInput().value).toBe(':new-window')
    key('ArrowDown'); expect(lineInput().value).toBe(':이어서')
    key('ArrowDown'); expect(lineInput().value).toBe(':이어서')
  })

  it('불러온 줄을 고친 뒤 ↓ 를 눌러도 고친 줄이 남는다 · 다시 ↑ 는 가장 최근 기록부터다', () => {
    open(['kill-pane', 'new-window'], ':')
    key('ArrowUp')
    expect(lineInput().value).toBe(':new-window')
    // 불러온 줄을 고친다
    fireEvent.change(lineInput(), { target: { value: ':new-window -n 둘' } })
    key('ArrowDown')
    expect(lineInput().value).toBe(':new-window -n 둘')
    // 고친 줄에서 ↑ 를 누르면 가장 최근 기록부터 오르고, ↓ 로 돌아오면 고친 줄이다
    key('ArrowUp')
    expect(lineInput().value).toBe(':new-window')
    key('ArrowDown')
    expect(lineInput().value).toBe(':new-window -n 둘')
  })

  it('Tab 으로 완성한 줄도 새 줄로 삼는다(기록을 거닐다 돌아와도 완성한 글이 남는다)', () => {
    open(['kill-pane'], ':select-wi')
    key('Tab')
    key('ArrowUp')
    expect(lineInput().value).toBe(':kill-pane')
    key('ArrowDown')
    expect(lineInput().value).toBe(':select-window ')
  })

  it('Enter 로 실행한 줄은 기록에 남는다(같은 줄은 맨 뒤로)', () => {
    vi.useFakeTimers()
    open(['kill-pane', 'new-window'], ':kill-pane')
    key('Enter')
    act(() => { vi.runAllTimers() })
    expect(JSON.parse(window.localStorage.getItem('iwae:command-history:v1')!)).toEqual(['new-window', 'kill-pane'])
  })
})
