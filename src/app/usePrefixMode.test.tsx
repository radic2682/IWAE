// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { DEFAULT_PREFIX_BINDINGS, SHIFTED_CODES } from '../core/prefixKeys'
import { setShortcutOverrides } from '../core/shortcutRegistry'
import { CONFIRM_TIMEOUT_MS, PREFIX_TIMEOUT_MS, usePrefixMode, type PrefixModeOptions, type PrefixPhase } from './usePrefixMode'

interface Spies {
  run: Mock<(line: string) => void>
  announce: Mock<(message: string) => void>
  onConfirm: Mock<() => void>
  onNumber: Mock<(index: number) => void>
  onCloseNumbers: Mock<() => void>
  editorKeys: KeyboardEvent[]
  api: { phase: PrefixPhase; enter: () => void; cancel: () => void; startConfirm: () => void }
}

let spies: Spies

function Harness({ numbersOpen = false, bindings }: Pick<PrefixModeOptions, 'numbersOpen' | 'bindings'>) {
  const prefix = usePrefixMode({ run: spies.run, announce: spies.announce, onConfirm: spies.onConfirm, onNumber: spies.onNumber, onCloseNumbers: spies.onCloseNumbers, numbersOpen, bindings })
  spies.api = prefix
  return (
    <div>
      <textarea data-testid="editor" onKeyDown={(event) => spies.editorKeys.push(event.nativeEvent)} />
      <input data-testid="off" data-prefix-off="" />
      <span data-testid="phase">{prefix.phase}</span>
    </div>
  )
}

const keydown = (target: Element | Window, init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => { target.dispatchEvent(event) })
  return event
}
const ctrlSpace = (target: Element | Window = document.body) => keydown(target, { key: ' ', code: 'Space', ctrlKey: true })
const phase = (container: HTMLElement) => container.querySelector('[data-testid="phase"]')!.textContent

beforeEach(() => {
  vi.useFakeTimers()
  spies = {
    run: vi.fn<(line: string) => void>(), announce: vi.fn<(message: string) => void>(), onConfirm: vi.fn<() => void>(), onNumber: vi.fn<(index: number) => void>(), onCloseNumbers: vi.fn<() => void>(), editorKeys: [],
    api: { phase: 'idle', enter: () => undefined, cancel: () => undefined, startConfirm: () => undefined },
  }
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setShortcutOverrides({})
})

describe('접두키 받기', () => {
  it('Ctrl+Space 를 누르면 다음 키를 기다리고, 그 키 입력은 삼킨다', () => {
    const { container } = render(<Harness />)
    const event = ctrlSpace()
    expect(event.defaultPrevented).toBe(true)
    expect(phase(container)).toBe('prefix')
    expect(spies.run).not.toHaveBeenCalled()
  })

  it('한글 입력기가 key 를 Process 로 바꿔도 Ctrl+Space(물리 키 Space)는 접두키다', () => {
    const { container } = render(<Harness />)
    keydown(document.body, { key: 'Process', code: 'Space', ctrlKey: true })
    expect(phase(container)).toBe('prefix')
  })

  it('접두키 다음 키는 명령줄을 실행하고 평소로 돌아온다', () => {
    const { container } = render(<Harness />)
    ctrlSpace()
    const next = keydown(document.body, { key: 'x', code: 'KeyX' })
    expect(next.defaultPrevented).toBe(true)
    expect(spies.run).toHaveBeenCalledWith('kill-pane')
    expect(phase(container)).toBe('idle')
    // 평소로 돌아왔으니 다음 x 는 삼키지 않는다
    expect(keydown(document.body, { key: 'x', code: 'KeyX' }).defaultPrevented).toBe(false)
  })

  it('2초 안에 다음 키가 없으면 그만둔다', () => {
    const { container } = render(<Harness />)
    ctrlSpace()
    act(() => { vi.advanceTimersByTime(PREFIX_TIMEOUT_MS - 1) })
    expect(phase(container)).toBe('prefix')
    act(() => { vi.advanceTimersByTime(2) })
    expect(phase(container)).toBe('idle')
    const late = keydown(document.body, { key: 'x', code: 'KeyX' })
    expect(late.defaultPrevented).toBe(false)
    expect(spies.run).not.toHaveBeenCalled()
  })

  it('Esc 는 그만둔다(삼킨다)', () => {
    const { container } = render(<Harness />)
    ctrlSpace()
    const esc = keydown(document.body, { key: 'Escape', code: 'Escape' })
    expect(esc.defaultPrevented).toBe(true)
    expect(phase(container)).toBe('idle')
    expect(spies.run).not.toHaveBeenCalled()
  })

  it('수식 키(Shift·Ctrl)만 눌러서는 기다림이 끝나지 않는다', () => {
    const { container } = render(<Harness />)
    ctrlSpace()
    keydown(document.body, { key: 'Shift', code: 'ShiftLeft', shiftKey: true })
    keydown(document.body, { key: 'Control', code: 'ControlLeft', ctrlKey: true })
    expect(phase(container)).toBe('prefix')
  })

  it('모르는 키는 알리고 끝낸다', () => {
    const { container } = render(<Harness />)
    ctrlSpace()
    keydown(document.body, { key: 'j', code: 'KeyJ' })
    expect(spies.announce).toHaveBeenCalledOnce()
    expect(String(spies.announce.mock.calls[0]![0])).toContain('j')
    expect(phase(container)).toBe('idle')
    expect(spies.run).not.toHaveBeenCalled()
  })

  it('누르고 있어서 반복되는 접두키는 두 번 누른 것으로 치지 않는다', () => {
    const { container } = render(<Harness />)
    ctrlSpace()
    keydown(document.body, { key: ' ', code: 'Space', ctrlKey: true, repeat: true })
    expect(phase(container)).toBe('prefix')
  })

  it('상태 줄 칩(enter)으로도 접두키 모드에 들어가고, 한 번 더 누르면(cancel) 나온다', () => {
    const { container } = render(<Harness />)
    act(() => spies.api.enter())
    expect(phase(container)).toBe('prefix')
    keydown(document.body, { key: 'n', code: 'KeyN' })
    expect(spies.run).toHaveBeenCalledWith('next-window')
    act(() => spies.api.enter())
    act(() => spies.api.cancel())
    expect(phase(container)).toBe('idle')
  })

  it('명령줄·팔레트 입력칸(data-prefix-off)과 단축키 녹음 중에는 접두키를 받지 않는다', () => {
    const { container, getByTestId } = render(<Harness />)
    const event = ctrlSpace(getByTestId('off'))
    expect(event.defaultPrevented).toBe(false)
    expect(phase(container)).toBe('idle')
    const recording = document.createElement('button')
    recording.className = 'sk-keys-recording'
    document.body.append(recording)
    ctrlSpace()
    expect(phase(container)).toBe('idle')
    recording.remove()
  })
})

describe('글 쓰는 칸 안에서', () => {
  it('접두키도 다음 키도 편집기에 닿지 않는다(tmux 와 같다)', () => {
    const { container, getByTestId } = render(<Harness />)
    const editor = getByTestId('editor')
    editor.focus()
    ctrlSpace(editor)
    keydown(editor, { key: 'z', code: 'KeyZ' })
    expect(spies.editorKeys).toHaveLength(0)
    expect(spies.run).toHaveBeenCalledWith('resize-pane -Z')
    expect(phase(container)).toBe('idle')
    // 접두키 모드가 아닐 때의 글자는 편집기로 간다
    keydown(editor, { key: 'z', code: 'KeyZ' })
    expect(spies.editorKeys).toHaveLength(1)
  })

  it('접두키가 Ctrl+B 이면 한 번 누르면 가로채고, 두 번 누르면(send-prefix) 굵게가 편집기로 간다', () => {
    setShortcutOverrides({ prefixKey: 'Mod+B' })
    const { container, getByTestId } = render(<Harness />)
    const editor = getByTestId('editor')
    const first = keydown(editor, { key: 'b', code: 'KeyB', ctrlKey: true })
    expect(first.defaultPrevented).toBe(true)
    expect(spies.editorKeys).toHaveLength(0)
    expect(phase(container)).toBe('prefix')
    const second = keydown(editor, { key: 'b', code: 'KeyB', ctrlKey: true })
    expect(second.defaultPrevented).toBe(false)
    expect(spies.editorKeys).toHaveLength(1)
    expect(spies.editorKeys[0]!.key).toBe('b')
    expect(spies.editorKeys[0]!.ctrlKey).toBe(true)
    expect(phase(container)).toBe('idle')
    expect(spies.run).not.toHaveBeenCalled()
    // Ctrl+B 다음에 다른 키는 명령이다
    keydown(editor, { key: 'b', code: 'KeyB', ctrlKey: true })
    keydown(editor, { key: 'c', code: 'KeyC' })
    expect(spies.run).toHaveBeenCalledWith('new-window')
  })

  it('Ctrl+A 를 접두키로 골라도 같다(두 번째는 전체 선택으로 간다)', () => {
    setShortcutOverrides({ prefixKey: 'Mod+A' })
    const { getByTestId } = render(<Harness />)
    const editor = getByTestId('editor')
    keydown(editor, { key: 'a', code: 'KeyA', ctrlKey: true })
    const second = keydown(editor, { key: 'a', code: 'KeyA', ctrlKey: true })
    expect(second.defaultPrevented).toBe(false)
    expect(spies.editorKeys).toHaveLength(1)
  })

  it('Ctrl+Space 를 두 번 누르면 접두키 모드가 풀린다', () => {
    const { container } = render(<Harness />)
    ctrlSpace()
    ctrlSpace()
    expect(phase(container)).toBe('idle')
  })
})

describe('다음 키 읽기(code)', () => {
  it('한글 입력 상태(z → ㅋ)와 Shift 조합', () => {
    render(<Harness />)
    const after = (init: KeyboardEventInit) => { ctrlSpace(); keydown(document.body, init) }
    after({ key: 'ㅋ', code: 'KeyZ' })
    expect(spies.run).toHaveBeenLastCalledWith('resize-pane -Z')
    after({ key: 'ㅌ', code: 'KeyX' })
    expect(spies.run).toHaveBeenLastCalledWith('kill-pane')
    // Shift 를 먼저 누른 뒤 조합 키
    ctrlSpace()
    keydown(document.body, { key: 'Shift', code: 'ShiftLeft', shiftKey: true })
    keydown(document.body, { key: '5', code: 'Digit5', shiftKey: true })
    expect(spies.run).toHaveBeenLastCalledWith('split-window -h')
    after({ key: "'", code: 'Quote', shiftKey: true })
    expect(spies.run).toHaveBeenLastCalledWith('split-window -v')
    after({ key: '1', code: 'Digit1', shiftKey: true })
    expect(spies.run).toHaveBeenLastCalledWith('break-pane')
    after({ key: '[', code: 'BracketLeft', shiftKey: true })
    expect(spies.run).toHaveBeenLastCalledWith('swap-pane -U')
    after({ key: ']', code: 'BracketRight', shiftKey: true })
    expect(spies.run).toHaveBeenLastCalledWith('swap-pane -D')
    after({ key: '7', code: 'Digit7', shiftKey: true })
    expect(spies.run).toHaveBeenLastCalledWith('confirm-kill-window')
    after({ key: '/', code: 'Slash', shiftKey: true })
    expect(spies.run).toHaveBeenLastCalledWith('list-keys')
    after({ key: ';', code: 'Semicolon', shiftKey: true })
    expect(spies.run).toHaveBeenLastCalledWith('command-prompt')
  })

  it('표의 모든 키가 걸린 명령을 실행한다', () => {
    render(<Harness />)
    const codeOf = (token: string): { code: string; shiftKey: boolean } => {
      if (/^[a-z]$/u.test(token)) return { code: `Key${token.toUpperCase()}`, shiftKey: false }
      if (/^[0-9]$/u.test(token)) return { code: `Digit${token}`, shiftKey: false }
      if (token === ',') return { code: 'Comma', shiftKey: false }
      if (token === ' ') return { code: 'Space', shiftKey: false }
      if (token.startsWith('Arrow')) return { code: token, shiftKey: false }
      const shifted = Object.entries(SHIFTED_CODES).find(([, char]) => char === token)
      if (shifted === undefined) throw new Error(`키를 모른다: ${token}`)
      return { code: shifted[0], shiftKey: true }
    }
    let checked = 0
    for (const [token, line] of Object.entries(DEFAULT_PREFIX_BINDINGS)) {
      const { code, shiftKey } = codeOf(token)
      spies.run.mockClear()
      ctrlSpace()
      // 한글 자판처럼 key 가 엉뚱해도 code 로 읽는다
      keydown(document.body, { key: 'ㅎ', code, shiftKey })
      expect(spies.run, `${token} → ${line}`).toHaveBeenCalledWith(line)
      checked += 1
    }
    expect(checked).toBe(Object.keys(DEFAULT_PREFIX_BINDINGS).length)
    expect(checked).toBe(36)
  })

  it('사용자가 바꾼 바인딩(keys.conf)이 먼저다', () => {
    render(<Harness bindings={{ x: 'kill-window', y: 'next-window' }} />)
    ctrlSpace()
    keydown(document.body, { key: 'x', code: 'KeyX' })
    expect(spies.run).toHaveBeenLastCalledWith('kill-window')
    ctrlSpace()
    keydown(document.body, { key: 'y', code: 'KeyY' })
    expect(spies.run).toHaveBeenLastCalledWith('next-window')
  })
})

describe('화면을 닫을까요? y/n', () => {
  it('y 만 확인이다(나머지 키·시간 초과는 그만둔다). 키는 삼킨다', () => {
    const { container } = render(<Harness />)
    act(() => spies.api.startConfirm())
    expect(phase(container)).toBe('confirm')
    const yes = keydown(document.body, { key: 'y', code: 'KeyY' })
    expect(yes.defaultPrevented).toBe(true)
    expect(spies.onConfirm).toHaveBeenCalledOnce()
    expect(phase(container)).toBe('idle')

    act(() => spies.api.startConfirm())
    keydown(document.body, { key: 'n', code: 'KeyN' })
    expect(spies.onConfirm).toHaveBeenCalledOnce()
    expect(phase(container)).toBe('idle')

    act(() => spies.api.startConfirm())
    act(() => { vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS + 1) })
    expect(phase(container)).toBe('idle')
    expect(spies.onConfirm).toHaveBeenCalledOnce()
  })

  it('한글 입력 상태에서도 y(ㅛ)로 확인한다', () => {
    render(<Harness />)
    act(() => spies.api.startConfirm())
    keydown(document.body, { key: 'ㅛ', code: 'KeyY' })
    expect(spies.onConfirm).toHaveBeenCalledOnce()
  })
})

describe('칸 번호 겹침(display-panes)', () => {
  it('숫자 키는 그 칸으로 가고 삼킨다. Esc 와 다른 키는 겹침을 닫는다', () => {
    const { rerender } = render(<Harness numbersOpen />)
    const two = keydown(document.body, { key: '2', code: 'Digit2' })
    expect(two.defaultPrevented).toBe(true)
    expect(spies.onNumber).toHaveBeenCalledWith(2)
    keydown(document.body, { key: 'ㅎ', code: 'Numpad7' })
    expect(spies.onNumber).toHaveBeenLastCalledWith(7)
    const esc = keydown(document.body, { key: 'Escape', code: 'Escape' })
    expect(esc.defaultPrevented).toBe(true)
    expect(spies.onCloseNumbers).toHaveBeenCalledTimes(1)
    const other = keydown(document.body, { key: 'q', code: 'KeyQ' })
    expect(other.defaultPrevented).toBe(false)
    expect(spies.onCloseNumbers).toHaveBeenCalledTimes(2)
    rerender(<Harness numbersOpen={false} />)
    keydown(document.body, { key: '3', code: 'Digit3' })
    expect(spies.onNumber).toHaveBeenCalledTimes(2)
  })
})
