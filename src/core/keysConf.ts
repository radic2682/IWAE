/**
 * `.iwae/keys.conf`(설계 8.3): tmux 문법의 접두키 설정.
 *
 *   # 주석
 *   set prefix C-b            (C-Space · C-b · C-a · C-<글자>)
 *   bind-key v split-window -h
 *   bind-key Left select-pane -L
 *   unbind-key x
 *
 * `bind-key <키> <명령줄>` 은 접두키 다음 키에 명령을 건다(키 이름: 글자 · 숫자 · 기호 · Space · Left/Right/Up/Down).
 * `unbind-key <키>` 는 그 키를 푼다. 줄 안의 오류는 그 줄만 건너뛰고 알려 준다. DOM 을 모르는 순수 함수만 둔다.
 */

export interface KeysConf {
  /** 접두키 다음 키 열쇠 → 명령줄(빈 글자는 푼 키). prefixKeys.ts 의 prefixBindingFor 가 읽는다 */
  readonly bindings: Readonly<Record<string, string>>
  /** 접두키(등록부의 조합 글자: `Ctrl+B`). 없으면 설정을 건드리지 않는다 */
  readonly prefix: string | null
  /** 건너뛴 줄의 이유(줄 번호 포함) */
  readonly errors: readonly string[]
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  space: ' ', left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown',
  enter: 'Enter', escape: 'Escape', esc: 'Escape', tab: 'Tab',
}

/** tmux 키 이름 → 접두키 표의 열쇠(`Left` → `ArrowLeft`). 모르면 null */
export function keyTokenOf(name: string): string | null {
  const named = KEY_NAMES[name.toLowerCase()]
  if (named !== undefined) return named
  return [...name].length === 1 ? name : null
}

/** `C-b` · `C-Space` → `Ctrl+B` · `Ctrl+Space`. 모르면 null */
export function prefixComboOf(word: string): string | null {
  const match = /^(?:C|Ctrl)-(.+)$/iu.exec(word.trim())
  if (match === null) return null
  const key = match[1]!
  if (key.toLowerCase() === 'space') return 'Ctrl+Space'
  return /^[a-z]$/iu.test(key) ? `Ctrl+${key.toUpperCase()}` : null
}

/** 따옴표('"')를 지키며 낱말로 자른다(주석 `#` 는 따옴표 밖에서만) */
function words(line: string): string[] {
  const out: string[] = []
  let token = ''
  let started = false
  let quote: '"' | "'" | null = null
  for (const char of line) {
    if (quote !== null) {
      if (char === quote) quote = null
      else token += char
      continue
    }
    if (char === '"' || char === "'") { quote = char; started = true; continue }
    if (char === '#' && !started) break
    if (/\s/u.test(char)) {
      if (started) out.push(token)
      token = ''
      started = false
      continue
    }
    token += char
    started = true
  }
  if (started) out.push(token)
  return out
}

export function parseKeysConf(text: string): KeysConf {
  const bindings: Record<string, string> = {}
  let prefix: string | null = null
  const errors: string[] = []
  text.split(/\r?\n/u).forEach((raw, index) => {
    const parts = words(raw)
    if (parts.length === 0) return
    const [command, ...rest] = parts as [string, ...string[]]
    const where = `${index + 1}`
    if (command === 'bind-key' || command === 'bind') {
      // -T table / -n 같은 tmux 옵션은 받지 않는다(접두키 표 하나뿐이다)
      const [keyName, ...line] = rest
      const token = keyName === undefined ? null : keyTokenOf(keyName)
      if (token === null || line.length === 0) { errors.push(`${where}: bind-key <키> <명령>`); return }
      bindings[token] = line.join(' ')
    } else if (command === 'unbind-key' || command === 'unbind') {
      const token = rest[0] === undefined ? null : keyTokenOf(rest[0])
      if (token === null) { errors.push(`${where}: unbind-key <키>`); return }
      bindings[token] = ''
    } else if (command === 'set' || command === 'set-option' || command === 'set-window-option') {
      const flagless = rest.filter((word) => !word.startsWith('-'))
      if (flagless[0] !== 'prefix') { errors.push(`${where}: set prefix C-b|C-Space|C-a 만 됩니다`); return }
      const combo = flagless[1] === undefined ? null : prefixComboOf(flagless[1])
      if (combo === null) { errors.push(`${where}: set prefix C-b|C-Space|C-a`); return }
      prefix = combo
    } else {
      errors.push(`${where}: 모르는 설정 ${command}`)
    }
  })
  return { bindings, prefix, errors }
}
