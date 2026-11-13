// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CommandPalette, matchCatalogEntry, type PaletteCommand } from './CommandPalette'
import { commandCatalog } from './workspace/workspaceCommands'

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

  it('initialQuery 로 열면 「:」 가 미리 들어 있다. 아직 고른 줄이 없어 Enter 는 아무것도 실행하지 않는다', () => {
    vi.useFakeTimers()
    const onRunLine = vi.fn()
    const onClose = vi.fn()
    render(<CommandPalette commands={[]} onClose={onClose} initialQuery=":" onRunLine={onRunLine} />)
    const input = screen.getByRole('combobox', { name: '명령 찾기' }) as HTMLInputElement
    expect(input.value).toBe(':')
    expect(screen.getAllByRole('option').every((option) => option.getAttribute('aria-selected') === 'false')).toBe(true)
    fireEvent.keyDown(input, { key: 'Enter' })
    act(() => { vi.runAllTimers() })
    expect(onRunLine).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('「:」 가 아니면 보통 검색이다', () => {
    const onRunLine = vi.fn()
    render(<CommandPalette commands={[command('a', '새 창'), command('b', '설정 열기')]} onClose={vi.fn()} onRunLine={onRunLine} />)
    fireEvent.change(screen.getByRole('combobox', { name: '명령 찾기' }), { target: { value: '설정' } })
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['설정 열기'])
  })
})

describe('CommandPalette: 「:」 만 치면 명령 목록', () => {
  const lineInput = () => screen.getByRole('combobox', { name: '명령 찾기' }) as HTMLInputElement
  const open = (initialQuery = ':', history: string[] = []) => {
    window.localStorage.setItem('iwae:command-history:v1', JSON.stringify(history))
    const onRunLine = vi.fn()
    const view = render(<CommandPalette commands={[]} onClose={vi.fn()} initialQuery={initialQuery} onRunLine={onRunLine} completion={{ screenNames: ['읽기', '쓰기'], templateNames: [] }} />)
    return { onRunLine, view }
  }
  const key = (name: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(lineInput(), { key: name, ...init })
  const labels = () => screen.getAllByRole('option').map((option) => option.querySelector('.command-palette-label')!.textContent)
  const selected = () => screen.queryAllByRole('option').find((option) => option.getAttribute('aria-selected') === 'true')?.querySelector('.command-palette-label')?.textContent
  beforeEach(() => window.localStorage.clear())

  it('「:」 만 치면 지금 되는 모든 명령이 이름(사용법)과 한 줄 풀이와 함께 목록으로 뜬다', () => {
    open()
    expect(screen.getAllByRole('option')).toHaveLength(commandCatalog().length)
    const first = screen.getAllByRole('option')[0]!
    expect(first.querySelector('.command-palette-label')!.textContent).toBe('split-window [-h|-v]')
    expect(first.querySelector('.command-palette-desc')!.textContent).toBe('칸을 나눕니다 (-h 가로 · -v 세로)')
    // 안쪽 명령 · 아직 안 되는 명령은 없다
    expect(labels().join(' ')).not.toContain('command-prompt')
    // 사용법 뒤 괄호 설명은 이름 칸에서 떼고 풀이 칸에 풀이가 있다
    expect(labels()).toContain('source-file')
  })

  it('치는 대로 이름 · 줄임말 · 풀이에서 걸러지고 이름이 앞에서 맞는 것이 먼저다', () => {
    open()
    fireEvent.change(lineInput(), { target: { value: ':spl' } })
    expect(labels()[0]).toBe('split-window [-h|-v]')
    fireEvent.change(lineInput(), { target: { value: ':nextw' } })
    expect(labels()).toEqual(['next-window'])
    fireEvent.change(lineInput(), { target: { value: ':나눕' } })
    expect(labels()).toEqual(['split-window [-h|-v]'])
    fireEvent.change(lineInput(), { target: { value: ':window' } })
    expect(labels().every((label) => label.includes('window'))).toBe(true)
  })

  it('걸러 낸 목록이 비면 친 줄을 그대로 실행하는 한 줄이 된다', () => {
    open(':zzz')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option').textContent).toContain('명령 실행: zzz')
  })

  it('↓ 로 고르고 Enter 로 실행한다 · 실행한 명령 이름은 기록에 남는다', () => {
    vi.useFakeTimers()
    const { onRunLine } = open()
    key('ArrowDown')
    expect(selected()).toBe('split-window [-h|-v]')
    key('ArrowDown')
    key('ArrowDown')
    expect(selected()).toBe('resize-pane -Z')
    key('ArrowUp')
    expect(selected()).toBe('select-pane -L|-R|-U|-D|-t N')
    key('Enter')
    act(() => { vi.runAllTimers() })
    expect(onRunLine).toHaveBeenCalledWith('select-pane')
    expect(JSON.parse(window.localStorage.getItem('iwae:command-history:v1')!)).toEqual(['select-pane'])
  })

  it('Tab 은 고른 줄의 명령 이름을 완성하고 빈칸을 붙인다(고른 줄이 없으면 첫 줄)', () => {
    open(':sel')
    key('Tab')
    expect(lineInput().value).toBe(':select-pane ')
    fireEvent.change(lineInput(), { target: { value: ':sel' } })
    key('ArrowDown')
    key('Tab')
    expect(lineInput().value).toBe(':select-window ')
    // 빈칸 뒤에는 명령 목록이 아니라 실행 줄이다
    expect(screen.getByRole('option').textContent).toContain('명령 실행')
  })

  it('Enter 는 늘 밝은(고른) 줄을 실행한다: 줄임말을 쳐도 밝은 줄과 다른 명령이 실행되지 않는다(:new · :rename · :ls)', () => {
    vi.useFakeTimers()
    // 줄임말 new 는 new-session 의 것이지만 맨 윗줄은 new-window 다 — 밝은 줄이 실행된다
    for (const [typed, shown] of [[':new', 'new-window'], [':rename', 'rename-window'], [':ls', 'list-keys']] as const) {
      const { onRunLine, view } = open(typed)
      expect(selected()?.startsWith(shown)).toBe(true)
      key('Enter')
      act(() => { vi.runAllTimers() })
      expect(onRunLine).toHaveBeenCalledExactlyOnceWith(shown)
      view.unmount()
    }
  })

  it('↓ 로 다른 줄을 고르면 줄임말을 쳤어도 그 줄이 실행된다', () => {
    vi.useFakeTimers()
    const { onRunLine } = open(':new')
    key('ArrowDown')
    const picked = selected()!
    expect(picked.startsWith('new-session')).toBe(true)
    key('Enter')
    act(() => { vi.runAllTimers() })
    expect(onRunLine).toHaveBeenCalledExactlyOnceWith('new-session')
  })

  it('친 낱말이 명령의 정식 이름 그대로이면 그 이름의 줄이 처음부터 밝고 Enter 가 그것을 실행한다', () => {
    vi.useFakeTimers()
    const { onRunLine } = open(':new-session')
    expect(selected()?.startsWith('new-session')).toBe(true)
    key('Enter')
    act(() => { vi.runAllTimers() })
    expect(onRunLine).toHaveBeenCalledExactlyOnceWith('new-session')
  })

  it('입력기 조합 중의 Enter · 방향키(isComposing, 그리고 WebKit 의 조합 끝 Enter 인 keyCode 229)는 받지 않는다', () => {
    vi.useFakeTimers()
    const { onRunLine } = open(':new')
    const before = selected()
    fireEvent.keyDown(lineInput(), { key: 'Enter', keyCode: 229 })
    fireEvent.keyDown(lineInput(), { key: 'ArrowDown', keyCode: 229 })
    fireEvent.keyDown(lineInput(), { key: 'Enter', isComposing: true })
    act(() => { vi.runAllTimers() })
    expect(onRunLine).not.toHaveBeenCalled()
    expect(selected()).toBe(before)
    key('Enter')
    act(() => { vi.runAllTimers() })
    expect(onRunLine).toHaveBeenCalledTimes(1)
  })

  it('이름이 아닌 글(풀이로 찾은 것)에서 Enter 는 고른(맨 윗) 명령을 실행한다', () => {
    vi.useFakeTimers()
    const { onRunLine } = open(':나눕')
    key('Enter')
    act(() => { vi.runAllTimers() })
    expect(onRunLine).toHaveBeenCalledWith('split-window')
  })

  it('↑/↓ 우선순위: 목록이 보이면 고르기, 맨 윗줄(또는 고른 줄 없음)에서 ↑ 와 Alt+↑/↓ 는 기록', () => {
    open(':spl', ['kill-pane', 'new-window'])
    // 목록 맨 윗줄에서 ↑ → 기록(가장 최근 줄)
    key('ArrowUp')
    expect(lineInput().value).toBe(':new-window')
    // 불러온 줄이 떠 있는 동안은 ↑/↓ 가 계속 기록이다
    key('ArrowUp')
    expect(lineInput().value).toBe(':kill-pane')
    key('ArrowDown')
    expect(lineInput().value).toBe(':new-window')
    key('ArrowDown')
    expect(lineInput().value).toBe(':spl')
    // 글을 고치면 기록 거닐기는 끝나고 ↓ 는 목록 고르기다
    fireEvent.change(lineInput(), { target: { value: ':sel' } })
    key('ArrowDown')
    expect(selected()).toBe('select-window -t N|이름')
    // Alt+↑ 는 고른 줄이 맨 윗줄이 아니어도 기록이다
    key('ArrowUp', { altKey: true })
    expect(lineInput().value).toBe(':new-window')
  })
})

describe('CommandPalette: matchCatalogEntry', () => {
  const entry = { name: 'select-window', aliases: ['selectw'], usage: 'select-window -t N|이름', summary: '화면으로 갑니다' }
  it('이름 앞 < 줄임말 앞 < 이름 안 < 줄임말 안 < 풀이 안, 아니면 null', () => {
    expect(matchCatalogEntry(entry, 'select')).toBe(0)
    expect(matchCatalogEntry(entry, 'selectw')).toBe(1)
    expect(matchCatalogEntry(entry, 'window')).toBe(2)
    expect(matchCatalogEntry(entry, 'ctw')).toBe(3)
    expect(matchCatalogEntry(entry, '화면')).toBe(4)
    expect(matchCatalogEntry(entry, 'zzz')).toBeNull()
    expect(matchCatalogEntry(entry, '')).toBe(0)
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

  it('Tab 은 명령 이름을 완성한다. 첫 낱말 뒤에서는 인자를 완성하고, 후보가 여럿이면 공통 앞부분까지 채우고 후보를 목록에 보인다', () => {
    open([], ':select-wi')
    key('Tab')
    expect(lineInput().value).toBe(':select-window ')
    // 인자 후보가 여럿: select-layout 의 인자는 even-… · main-… · tiled — 공통 앞부분이 없으면 그대로 두고 후보를 한 줄로 보인다
    fireEvent.change(lineInput(), { target: { value: ':select-layout ' } })
    key('Tab')
    expect(screen.getByRole('option').textContent).toContain('even-horizontal')
    expect(screen.getByRole('option').textContent).toContain('tiled')
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
