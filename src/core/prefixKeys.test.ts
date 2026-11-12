import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFIX_BINDINGS, SHIFTED_CODES, isModifierOnly, prefixBindingFor, prefixTokenLabel, prefixTokenOf } from './prefixKeys'

/** 시험용 키 입력: key · code · shift */
const press = (key: string, code: string, shiftKey = false) => ({ key, code, shiftKey })

describe('접두키 다음 키: code 로 읽기', () => {
  it('한글 입력 상태(z → ㅋ)에서도 자판 위치로 같은 키가 된다', () => {
    expect(prefixTokenOf(press('ㅋ', 'KeyZ'))).toBe('z')
    expect(prefixTokenOf(press('ㅌ', 'KeyX'))).toBe('x')
    expect(prefixTokenOf(press('ㅐ', 'KeyO'))).toBe('o')
    expect(prefixTokenOf(press('ㅂ', 'KeyQ'))).toBe('q')
    // 입력기가 key 를 Process 로 바꿔도 마찬가지
    expect(prefixTokenOf(press('Process', 'KeyN'))).toBe('n')
  })

  it('Shift 조합 % " ! { } & ? : 는 숫자·다른 글자가 아니라 그 글자가 된다', () => {
    expect(prefixTokenOf(press('5', 'Digit5', true))).toBe('%')
    expect(prefixTokenOf(press("'", 'Quote', true))).toBe('"')
    expect(prefixTokenOf(press('1', 'Digit1', true))).toBe('!')
    expect(prefixTokenOf(press('[', 'BracketLeft', true))).toBe('{')
    expect(prefixTokenOf(press(']', 'BracketRight', true))).toBe('}')
    expect(prefixTokenOf(press('7', 'Digit7', true))).toBe('&')
    expect(prefixTokenOf(press('/', 'Slash', true))).toBe('?')
    expect(prefixTokenOf(press(';', 'Semicolon', true))).toBe(':')
    // 한글 자판의 Shift 조합도 위치로 읽는다
    expect(prefixTokenOf(press('%', 'Digit5', true))).toBe('%')
    expect(prefixTokenOf(press('ㅃ', 'KeyQ', false))).toBe('q')
  })

  it('참고 표(SHIFTED_CODES)와 같다', () => {
    const reference = { Digit1: '!', Digit5: '%', Digit7: '&', Quote: '"', BracketLeft: '{', BracketRight: '}', Slash: '?', Semicolon: ':' }
    for (const [code, char] of Object.entries(reference)) expect(SHIFTED_CODES[code]).toBe(char)
  })

  it('Shift 없이: 숫자 · , · 공백 · 화살표 · Esc', () => {
    expect(prefixTokenOf(press('3', 'Digit3'))).toBe('3')
    expect(prefixTokenOf(press('0', 'Numpad0'))).toBe('0')
    expect(prefixTokenOf(press(',', 'Comma'))).toBe(',')
    expect(prefixTokenOf(press(' ', 'Space'))).toBe(' ')
    expect(prefixTokenOf(press('ArrowLeft', 'ArrowLeft'))).toBe('ArrowLeft')
    expect(prefixTokenOf(press('ArrowDown', 'ArrowDown'))).toBe('ArrowDown')
    expect(prefixTokenOf(press('Escape', 'Escape'))).toBe('Escape')
  })

  it('Shift 로 대문자가 되는 글자는 대문자 열쇠(표에 없다)', () => {
    expect(prefixTokenOf(press('Z', 'KeyZ', true))).toBe('Z')
    expect(prefixBindingFor('Z')).toBeNull()
  })

  it('code 가 없는 입력(가상 자판)은 key 로 읽는다', () => {
    expect(prefixTokenOf({ key: 'z', shiftKey: false })).toBe('z')
    expect(prefixTokenOf({ key: '%', shiftKey: true })).toBe('%')
    expect(prefixTokenOf({ key: 'ArrowRight', shiftKey: false })).toBe('ArrowRight')
    expect(prefixTokenOf({ key: 'ㅋ', shiftKey: false })).toBe('ㅋ')
  })

  it('수식 키만이면 null(Shift 를 먼저 누르는 중이다)', () => {
    expect(isModifierOnly({ key: 'Shift' })).toBe(true)
    expect(prefixTokenOf(press('Shift', 'ShiftLeft', true))).toBeNull()
    expect(prefixTokenOf(press('Control', 'ControlLeft'))).toBeNull()
  })

  it('화면에 보일 글자', () => {
    expect(prefixTokenLabel('ArrowLeft')).toBe('←')
    expect(prefixTokenLabel(' ')).toBe('Space')
    expect(prefixTokenLabel('x')).toBe('x')
  })
})

describe('접두키 표', () => {
  it('설계 8.2 의 모든 키가 걸려 있다', () => {
    const expected: Record<string, string> = {
      '%': 'split-window -h', '"': 'split-window -v',
      ArrowLeft: 'select-pane -L', ArrowRight: 'select-pane -R', ArrowUp: 'select-pane -U', ArrowDown: 'select-pane -D', o: 'select-pane -n',
      z: 'resize-pane -Z', x: 'kill-pane', '!': 'break-pane', '{': 'swap-pane -U', '}': 'swap-pane -D', ' ': 'select-layout', q: 'display-panes',
      c: 'new-window', ',': 'rename-prompt', '&': 'confirm-kill-window', n: 'next-window', p: 'previous-window', l: 'last-window',
      f: 'toggle-floating', w: 'display-popup', s: 'choose-session', d: 'detach', ':': 'command-prompt', '?': 'list-keys',
    }
    for (const [key, line] of Object.entries(expected)) expect(prefixBindingFor(key), key).toBe(line)
    for (let digit = 0; digit <= 9; digit += 1) expect(prefixBindingFor(String(digit))).toBe(`select-window -t ${digit}`)
    expect(Object.keys(DEFAULT_PREFIX_BINDINGS).length).toBe(Object.keys(expected).length + 10)
  })

  it('사용자 바인딩이 먼저고, 빈 글자는 키를 푼다', () => {
    expect(prefixBindingFor('x', { x: 'kill-window' })).toBe('kill-window')
    expect(prefixBindingFor('x', { x: '' })).toBeNull()
    expect(prefixBindingFor('y', { y: 'next-window' })).toBe('next-window')
  })
})
