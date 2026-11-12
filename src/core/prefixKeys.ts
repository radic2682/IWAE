/**
 * 접두키(tmux 의 prefix) 다음 키: 자판 위치(`KeyboardEvent.code`)로 읽는다(설계 8.1).
 * 한글 입력 상태에서 `z` 가 `ㅋ` 로 오거나 Shift 조합(`%` `"` `!`)이 숫자·다른 글자로 와도 같은 키가 된다.
 * DOM 을 모르는 순수 함수만 둔다.
 */

/** Shift 를 누른 자리의 글자(미국 자판 기준) */
export const SHIFTED_CODES: Readonly<Record<string, string>> = {
  Digit1: '!', Digit2: '@', Digit3: '#', Digit4: '$', Digit5: '%', Digit6: '^', Digit7: '&', Digit8: '*', Digit9: '(', Digit0: ')',
  Quote: '"', BracketLeft: '{', BracketRight: '}', Slash: '?', Semicolon: ':', Comma: '<', Period: '>', Minus: '_', Equal: '+', Backslash: '|', Backquote: '~',
}

const PLAIN_CODES: Readonly<Record<string, string>> = {
  Quote: "'", BracketLeft: '[', BracketRight: ']', Slash: '/', Semicolon: ';', Comma: ',', Period: '.', Minus: '-', Equal: '=', Backslash: '\\', Backquote: '`', Space: ' ',
}

const NAMED_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape', 'Enter', 'Tab', 'Backspace', 'Home', 'End', 'PageUp', 'PageDown'])

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'])

type KeyLike = Pick<KeyboardEvent, 'key' | 'shiftKey'> & Partial<Pick<KeyboardEvent, 'code'>>

/** 수식 키(Shift·Ctrl 등)만 눌린 키 입력인가 — 접두키 뒤에 Shift 를 먼저 누르는 중이다 */
export function isModifierOnly(event: Pick<KeyboardEvent, 'key'>): boolean {
  return MODIFIER_KEYS.has(event.key)
}

/**
 * 키 입력 → 접두키 표의 열쇠(`x` `5` `%` `,` ` ` `ArrowLeft` `Escape` …). 모르는 키는 null.
 * code 가 있으면 code 로(입력기·Shift 에 흔들리지 않는다), 없으면 key 로 읽는다.
 */
export function prefixTokenOf(event: KeyLike): string | null {
  if (isModifierOnly(event)) return null
  const code = event.code ?? ''
  if (code !== '') {
    const letter = /^Key([A-Z])$/u.exec(code)
    if (letter !== null) return event.shiftKey ? letter[1]! : letter[1]!.toLowerCase()
    const digit = /^(?:Digit|Numpad)([0-9])$/u.exec(code)
    if (digit !== null) return event.shiftKey && code.startsWith('Digit') ? SHIFTED_CODES[code] ?? null : digit[1]!
    if (NAMED_KEYS.has(code)) return code
    if (event.shiftKey && SHIFTED_CODES[code] !== undefined) return SHIFTED_CODES[code]!
    if (PLAIN_CODES[code] !== undefined) return PLAIN_CODES[code]!
    if (code === 'NumpadEnter') return 'Enter'
  }
  // code 가 없는 입력(가상 자판·일부 시험): key 가 글자 하나면 그대로, 이름이면 이름으로
  const { key } = event
  if (key.length === 1) return /^[a-z]$/iu.test(key) ? (event.shiftKey ? key.toUpperCase() : key.toLowerCase()) : key
  return NAMED_KEYS.has(key) ? key : null
}

/** 화면에 보일 키 글자(`ArrowLeft` → `←`, 공백 → `Space`) */
export function prefixTokenLabel(token: string): string {
  const names: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ' ': 'Space', Escape: 'Esc' }
  return names[token] ?? token
}

/** 접두키 다음 키 → 명령줄(설계 8.2). `keys.conf` 의 bind-key 가 이 표를 덮어쓴다 */
export const DEFAULT_PREFIX_BINDINGS: Readonly<Record<string, string>> = {
  '%': 'split-window -h',
  '"': 'split-window -v',
  ArrowLeft: 'select-pane -L',
  ArrowRight: 'select-pane -R',
  ArrowUp: 'select-pane -U',
  ArrowDown: 'select-pane -D',
  o: 'select-pane -n',
  z: 'resize-pane -Z',
  x: 'kill-pane',
  '!': 'break-pane',
  '{': 'swap-pane -U',
  '}': 'swap-pane -D',
  ' ': 'select-layout',
  q: 'display-panes',
  c: 'new-window',
  ',': 'rename-prompt',
  '&': 'confirm-kill-window',
  n: 'next-window',
  p: 'previous-window',
  l: 'last-window',
  0: 'select-window -t 0',
  1: 'select-window -t 1',
  2: 'select-window -t 2',
  3: 'select-window -t 3',
  4: 'select-window -t 4',
  5: 'select-window -t 5',
  6: 'select-window -t 6',
  7: 'select-window -t 7',
  8: 'select-window -t 8',
  9: 'select-window -t 9',
  f: 'toggle-floating',
  w: 'display-popup',
  s: 'choose-session',
  d: 'detach',
  ':': 'command-prompt',
  '?': 'list-keys',
}

/** 열쇠에 걸린 명령줄(사용자 바인딩이 먼저). 없으면 null. 빈 글자는 unbind 한 키다 */
export function prefixBindingFor(token: string, custom: Readonly<Record<string, string>> = {}): string | null {
  const own = custom[token]
  if (own !== undefined) return own === '' ? null : own
  return DEFAULT_PREFIX_BINDINGS[token] ?? null
}
