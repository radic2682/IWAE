// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { COMMAND_HISTORY_KEY } from './commandLine'
import { StatusBar } from './StatusBar'

const SCREENS = [{ id: 'w1', name: '읽기' }, { id: 'w2', name: '비교' }]

function renderBar(props: Partial<Parameters<typeof StatusBar>[0]> = {}) {
  const handlers = { onSelectScreen: vi.fn(), onOpenHelp: vi.fn(), onPrefixChip: vi.fn(), onRunCommand: vi.fn(), onCloseCommandLine: vi.fn() }
  const view = render(
    <StatusBar sessionName="기본" screens={SCREENS} activeId="w1" lastId="w2" screenNames={['읽기', '비교']} templateNames={['읽기', '정리']} {...handlers} {...props} />,
  )
  return { ...view, ...handlers }
}

beforeEach(() => { window.localStorage.clear() })
afterEach(cleanup)

describe('상태 줄: 접두키', () => {
  it('접두키 칩은 눌러서 접두키 모드로 들어간다', () => {
    const { onPrefixChip } = renderBar()
    const chip = screen.getByRole('button', { name: '접두키' })
    expect(chip.getAttribute('data-active')).toBe('false')
    fireEvent.click(chip)
    expect(onPrefixChip).toHaveBeenCalledOnce()
  })

  it('다음 키를 기다리는 동안 칩이 켜지고 「접두키 — 다음 키를 누르세요」 가 보인다', () => {
    renderBar({ prefixPhase: 'prefix' })
    expect(screen.getByRole('button', { name: '접두키' }).getAttribute('data-active')).toBe('true')
    expect(screen.getByRole('status').textContent).toBe('접두키 — 다음 키를 누르세요')
  })

  it('화면 닫기 확인 줄', () => {
    renderBar({ prefixPhase: 'confirm', confirmText: '화면을 닫을까요? y/n' })
    expect(screen.getByRole('status').textContent).toBe('화면을 닫을까요? y/n')
  })

  it('짧은 알림은 접두키 기다림이 끝난 뒤에 보인다', () => {
    const { rerender } = renderBar()
    act(() => { window.dispatchEvent(new CustomEvent('iwae:action-feedback', { detail: '모르는 명령: foo — ? 로 목록' })) })
    expect(screen.getByRole('status').textContent).toBe('모르는 명령: foo — ? 로 목록')
    rerender(<StatusBar sessionName="기본" screens={SCREENS} activeId="w1" lastId={null} onSelectScreen={vi.fn()} onOpenHelp={vi.fn()} prefixPhase="prefix" />)
    expect(screen.getByRole('status').textContent).toBe('접두키 — 다음 키를 누르세요')
  })
})

describe('상태 줄: 명령줄', () => {
  const input = () => screen.getByRole('textbox', { name: '명령줄' }) as HTMLInputElement

  it('명령줄이 열리면 상태 줄이 입력칸이 되고 초점이 간다. 미리 채운 글이 들어 있다', () => {
    renderBar({ commandLine: { prefill: 'rename-window 읽기' } })
    expect(input().value).toBe('rename-window 읽기')
    expect(document.activeElement).toBe(input())
    expect(screen.queryByRole('button', { name: '접두키' })).toBeNull()
  })

  it('Enter 는 닫고 실행하며 기록에 남긴다(저장됨)', () => {
    const { onRunCommand, onCloseCommandLine } = renderBar({ commandLine: { prefill: '' } })
    fireEvent.change(input(), { target: { value: 'split-window -h' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onCloseCommandLine).toHaveBeenCalled()
    expect(onRunCommand).toHaveBeenCalledWith('split-window -h')
    expect(JSON.parse(window.localStorage.getItem(COMMAND_HISTORY_KEY)!)).toEqual(['split-window -h'])
  })

  it('빈 줄은 실행하지 않고 닫기만 한다', () => {
    const { onRunCommand, onCloseCommandLine } = renderBar({ commandLine: { prefill: '' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onCloseCommandLine).toHaveBeenCalled()
    expect(onRunCommand).not.toHaveBeenCalled()
  })

  it('Esc 로 닫는다(실행하지 않는다)', () => {
    const { onRunCommand, onCloseCommandLine } = renderBar({ commandLine: { prefill: 'abc' } })
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(onCloseCommandLine).toHaveBeenCalledOnce()
    expect(onRunCommand).not.toHaveBeenCalled()
  })

  it('↑/↓ 로 기록을 넘기고, ↓ 끝에서는 쓰던 글자가 돌아온다', () => {
    window.localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(['next-window', 'kill-pane']))
    renderBar({ commandLine: { prefill: '' } })
    fireEvent.change(input(), { target: { value: 'sel' } })
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(input().value).toBe('kill-pane')
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(input().value).toBe('next-window')
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(input().value).toBe('next-window')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(input().value).toBe('kill-pane')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(input().value).toBe('sel')
  })

  it('Tab 은 명령 이름과 화면 이름을 완성하고, 후보가 여럿이면 후보를 보인다', () => {
    renderBar({ commandLine: { prefill: '' } })
    fireEvent.change(input(), { target: { value: 'selectw -t 비' } })
    fireEvent.keyDown(input(), { key: 'Tab' })
    expect(input().value).toBe('selectw -t 비교 ')
    fireEvent.change(input(), { target: { value: 'select-' } })
    fireEvent.keyDown(input(), { key: 'Tab' })
    expect(input().value).toBe('select-')
    expect(screen.getByText(/select-pane/).textContent).toContain('select-window')
    fireEvent.change(input(), { target: { value: 'kill-p' } })
    fireEvent.keyDown(input(), { key: 'Tab' })
    expect(input().value).toBe('kill-pane ')
  })

  it('입력기로 글자를 조합하는 중의 Enter 는 실행하지 않는다', () => {
    const { onRunCommand } = renderBar({ commandLine: { prefill: '' } })
    fireEvent.change(input(), { target: { value: 'open 노' } })
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true })
    expect(onRunCommand).not.toHaveBeenCalled()
  })
})
