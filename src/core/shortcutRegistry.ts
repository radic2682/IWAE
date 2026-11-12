import { isMacPlatform } from './platform'

/**
 * 단축키 등록부: 앱의 모든 단축키가 여기 한 곳에서 나온다(id · 이름 · 기본 키 · 범위).
 * 설정 「단축키·마우스」와 「단축키 보기」 창, 명령 팔레트의 표기, 키 입력 해석이 모두 이 표를 읽는다.
 *
 * 범위(scope)
 *  - `app`    앱 명령. 바꿀 수 있다. 글 쓰는 칸에서도 되는지는 `inEditable` 로 정한다.
 *  - `editor` 글·캔버스를 고치는 명령(굵게·기울임·밑줄·제목·되돌리기·복사 등). 글 쓰는 칸의 기본 동작과
 *             같은 키라서 바꾸지 못하게 고정한다. 바꾸면 Ctrl+B/I/U 같은 편집 키가 깨진다.
 *
 * 키 표기(combo): `Mod+Shift+F`, `Alt+ArrowLeft`, `Ctrl+Tab`, `Delete`.
 *  - Mod  = 맥의 ⌘ / 그 밖의 Ctrl(맞추기는 Ctrl·⌘ 둘 다 받는다)
 *  - Ctrl = 맥의 ⌃(맥이 아니면 Mod 와 같다). Alt, Shift. 마지막이 키 이름(`+` 는 `Plus`).
 */
export type ShortcutScope = 'app' | 'editor'

export type ShortcutGroup = 'general' | 'tabs' | 'view' | 'editor'

export interface ShortcutDef {
  readonly id: string
  /** 한국어 이름(번역 열쇠) */
  readonly label: string
  readonly group: ShortcutGroup
  readonly scope: ShortcutScope
  /** 기본 키. 첫 것이 화면에 보이고, 나머지는 같은 동작의 별칭이다 */
  readonly defaultKeys: readonly string[]
  /** 글 쓰는 칸(input·textarea·contenteditable)에 커서가 있어도 되는가 */
  readonly inEditable: boolean
  /** 검색용 영어 낱말 */
  readonly keywords?: string
}

const app = (id: string, label: string, group: ShortcutGroup, defaultKeys: readonly string[], inEditable: boolean, keywords?: string): ShortcutDef =>
  ({ id, label, group, scope: 'app', defaultKeys, inEditable, keywords })
const editor = (id: string, label: string, defaultKeys: readonly string[], inEditable: boolean, keywords?: string): ShortcutDef =>
  ({ id, label, group: 'editor', scope: 'editor', defaultKeys, inEditable, keywords })

export const SHORTCUT_DEFS: readonly ShortcutDef[] = [
  app('commandPalette', '명령 팔레트', 'general', ['Mod+Shift+P'], true, 'command palette'),
  app('newWindow', '새 창', 'general', ['Mod+Shift+N'], true, 'new window'),
  app('openSettings', '설정', 'general', ['Mod+,'], true, 'settings preferences'),
  app('showShortcuts', '단축키 보기', 'general', ['Mod+/'], true, 'keyboard shortcuts help'),
  app('documentSearch', '모든 문서에서 찾기', 'general', ['Mod+Shift+F'], true, 'search vault'),
  app('search', '이 문서에서 찾기', 'general', ['Mod+F'], true, 'find search'),
  app('goTo', '쪽으로 가기', 'general', ['Mod+G'], false, 'go to page'),
  app('print', '인쇄', 'general', ['Mod+P'], false, 'print'),
  app('toggleLibrary', '라이브러리 펼치기·접기', 'view', ['Mod+Shift+L'], true, 'library'),
  app('toggleSinglePane', '화면 나누기 바꾸기', 'view', ['Mod+\\'], true, 'split pane'),
  app('toggleNoteBeside', '옆에 노트 열기·닫기', 'view', ['Mod+Shift+M'], false, 'note beside open close memo reading'),
  app('focusLeftPane', '왼쪽 칸으로', 'view', ['Mod+1'], true, 'focus left pane'),
  app('focusRightPane', '오른쪽 칸으로', 'view', ['Mod+2'], true, 'focus right pane'),
  app('nextTab', '다음 탭', 'tabs', ['Ctrl+Tab'], true, 'next tab'),
  app('prevTab', '이전 탭', 'tabs', ['Ctrl+Shift+Tab'], true, 'previous tab'),
  app('closeTab', '탭 닫기', 'tabs', ['Mod+W'], true, 'close tab'),
  app('zoomIn', '확대', 'view', ['Mod+=', 'Mod+Plus', 'Mod+Shift+=', 'Mod+Shift+Plus'], true, 'zoom in'),
  app('zoomOut', '축소', 'view', ['Mod+-'], true, 'zoom out'),
  app('zoomReset', '폭에 맞추기', 'view', ['Mod+0'], true, 'zoom reset fit width'),
  app('navBack', '뒤로 (문서 점프)', 'tabs', ['Alt+ArrowLeft'], false, 'back history'),
  app('navForward', '앞으로 (문서 점프)', 'tabs', ['Alt+ArrowRight'], false, 'forward history'),
  editor('undo', '되돌리기', ['Mod+Z'], false, 'undo'),
  editor('redo', '다시 하기', ['Mod+Shift+Z', 'Mod+Y'], false, 'redo'),
  editor('save', '저장', ['Mod+S'], true, 'save'),
  editor('bold', '굵게', ['Mod+B'], true, 'bold'),
  editor('italic', '기울임', ['Mod+I'], true, 'italic'),
  editor('underline', '밑줄', ['Mod+U'], true, 'underline'),
  editor('heading1', '제목 1', ['Mod+Alt+1'], true, 'heading'),
  editor('heading2', '제목 2', ['Mod+Alt+2'], true, 'heading'),
  editor('heading3', '제목 3', ['Mod+Alt+3'], true, 'heading'),
  editor('heading4', '제목 4', ['Mod+Alt+4'], true, 'heading'),
  editor('heading5', '제목 5', ['Mod+Alt+5'], true, 'heading'),
  editor('heading6', '제목 6', ['Mod+Alt+6'], true, 'heading'),
  editor('selectAll', '모두 선택', ['Mod+A'], false, 'select all'),
  editor('copy', '복사', ['Mod+C'], false, 'copy'),
  editor('cut', '잘라내기', ['Mod+X'], false, 'cut'),
  editor('paste', '붙여넣기', ['Mod+V'], false, 'paste'),
  editor('duplicate', '복제', ['Mod+D'], false, 'duplicate'),
  editor('delete', '지우기', ['Delete', 'Backspace'], false, 'delete'),
]

/** 키 입력과 상관없이 늘 같은 한 키(바꿀 수 없는 것). Esc 는 등록부 밖에서 따로 본다 */
export const GROUP_ORDER: readonly ShortcutGroup[] = ['general', 'tabs', 'view', 'editor']
export const GROUP_LABEL: Readonly<Record<ShortcutGroup, string>> = {
  general: '일반',
  tabs: '탭·문서',
  view: '화면',
  editor: '편집기 (바꿀 수 없음)',
}

const BY_ID = new Map(SHORTCUT_DEFS.map((def) => [def.id, def]))
export function getShortcutDef(id: string): ShortcutDef | undefined {
  return BY_ID.get(id)
}
export const isRebindable = (def: ShortcutDef): boolean => def.scope === 'app'

// ───────── 키 표기 ─────────

export interface ParsedCombo {
  readonly mod: boolean
  readonly ctrl: boolean
  readonly alt: boolean
  readonly shift: boolean
  /** 소문자 키 이름 */
  readonly key: string
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
  tab: 'Tab', enter: 'Enter', space: 'Space', plus: 'Plus', escape: 'Escape', backspace: 'Backspace', delete: 'Delete',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert',
}

function canonicalKeyName(raw: string): string {
  const lower = raw.toLowerCase()
  if (raw === '+') return 'Plus'
  if (raw === ' ') return 'Space'
  if (KEY_NAMES[lower] !== undefined) return KEY_NAMES[lower]
  if (/^f([1-9]|1[0-2])$/u.test(lower)) return lower.toUpperCase()
  return raw.length === 1 ? raw.toUpperCase() : raw
}

/** 글자 `Mod+Shift+F` → 조각. 모양이 틀리면 null */
export function parseCombo(combo: string, mac = isMacPlatform()): ParsedCombo | null {
  if (combo.trim() === '') return null
  const parts = combo.split('+')
  // `Mod++` 처럼 + 키가 맨 끝에 올 수 있다 → Plus 로 바꿔 읽는다
  const normalized = combo.endsWith('++') ? [...combo.slice(0, -2).split('+').filter((p) => p !== ''), 'Plus'] : parts
  const key = normalized[normalized.length - 1]
  if (key === undefined || key === '') return null
  let mod = false
  let ctrl = false
  let alt = false
  let shift = false
  for (const part of normalized.slice(0, -1)) {
    const lower = part.toLowerCase()
    if (lower === 'mod' || lower === 'cmd' || lower === 'meta') mod = true
    else if (lower === 'ctrl') { if (mac) ctrl = true; else mod = true }
    else if (lower === 'alt' || lower === 'option') alt = true
    else if (lower === 'shift') shift = true
    else return null
  }
  const name = canonicalKeyName(key)
  if (['Control', 'Shift', 'Alt', 'Meta', 'Mod', 'Ctrl'].includes(name)) return null
  return { mod, ctrl, alt, shift, key: name.toLowerCase() }
}

/** 조각 → 같은 키는 같은 글자가 되는 표준형(`Mod+Alt+Shift+키`) */
export function formatCombo(parsed: ParsedCombo): string {
  const key = canonicalKeyName(parsed.key)
  return [parsed.mod ? 'Mod' : '', parsed.ctrl ? 'Ctrl' : '', parsed.alt ? 'Alt' : '', parsed.shift ? 'Shift' : '', key].filter((p) => p !== '').join('+')
}

/** 모양이 맞으면 표준형, 아니면 null */
export function normalizeCombo(combo: string, mac = isMacPlatform()): string | null {
  const parsed = parseCombo(combo, mac)
  return parsed === null ? null : formatCombo(parsed)
}

/** 화면에 그릴 키 칸(⌘ ⇧ ⌥ … 또는 Ctrl Shift Alt …) */
export function comboCaps(combo: string, mac = isMacPlatform()): string[] {
  const parsed = parseCombo(combo, mac)
  if (parsed === null) return []
  const keyLabel: Record<string, string> = { arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', plus: '+', space: 'Space', escape: 'Esc' }
  const key = keyLabel[parsed.key] ?? canonicalKeyName(parsed.key)
  const caps: string[] = []
  if (mac) {
    if (parsed.ctrl) caps.push('⌃')
    if (parsed.alt) caps.push('⌥')
    if (parsed.shift) caps.push('⇧')
    if (parsed.mod) caps.push('⌘')
  } else {
    if (parsed.mod || parsed.ctrl) caps.push('Ctrl')
    if (parsed.alt) caps.push('Alt')
    if (parsed.shift) caps.push('Shift')
  }
  caps.push(key)
  return caps
}

/** 한 줄 글자 표기: Windows `Ctrl+Shift+P`, 맥 `⇧⌘P` */
export function comboText(combo: string, mac = isMacPlatform()): string {
  const caps = comboCaps(combo, mac)
  return mac ? caps.join('') : caps.join('+')
}

function keyOfEvent(event: Pick<KeyboardEvent, 'key'>): string {
  const key = event.key
  if (key === '+') return 'plus'
  if (key === ' ') return 'space'
  return key.toLowerCase()
}

/** `Alt`·한글 자판처럼 key 가 달라지는 경우를 위해 물리 키(code)에서 글자·숫자를 읽는다 */
function codeOfEvent(event: Pick<KeyboardEvent, 'code'>): string | null {
  const code = event.code
  if (typeof code !== 'string') return null
  const letter = /^Key([A-Z])$/u.exec(code)
  if (letter !== null) return letter[1]?.toLowerCase() ?? null
  const digit = /^Digit([0-9])$/u.exec(code)
  return digit === null ? null : digit[1] ?? null
}

/** 키 입력이 이 키 조합과 맞는가(Ctrl·⌘·Alt·Shift 가 정확히 같아야 한다) */
export function eventMatches(event: KeyboardEvent, parsed: ParsedCombo): boolean {
  const mod = Boolean(event.ctrlKey || event.metaKey)
  if (parsed.ctrl) {
    if (!event.ctrlKey || event.metaKey) return false
  } else if (parsed.mod !== mod) return false
  if (parsed.alt !== Boolean(event.altKey)) return false
  if (parsed.shift !== Boolean(event.shiftKey)) return false
  if (keyOfEvent(event) === parsed.key) return true
  // 물리 키 대조는 Alt 나 한글 자판으로 key 가 엉뚱하게 나올 때만(일반 글자는 key 가 우선)
  const code = codeOfEvent(event)
  return code !== null && code === parsed.key && (parsed.alt || !/^[a-z0-9]$/u.test(keyOfEvent(event)))
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'])

/** 키 입력을 키 조합으로(녹음용). 수식 키만 눌렀으면 null */
export function eventToCombo(event: KeyboardEvent, mac = isMacPlatform()): string | null {
  if (MODIFIER_KEYS.has(event.key) || event.key === 'Process' || event.key === 'Dead') return null
  const code = codeOfEvent(event)
  // 한글 자판에서는 key 가 'ㄹ' 같은 글자라 물리 키로 읽는다. Alt 가 눌려도 같다
  const base = (code !== null && (event.altKey || !/^[\x20-\x7e]$/u.test(event.key))) ? code : event.key
  const name = canonicalKeyName(base)
  const parsed: ParsedCombo = {
    mod: mac ? event.metaKey : Boolean(event.ctrlKey || event.metaKey),
    ctrl: mac ? event.ctrlKey : false,
    alt: event.altKey,
    shift: event.shiftKey,
    key: name.toLowerCase(),
  }
  return formatCombo(parsed)
}

/** 글 쓰는 칸 밖에서도 눌러 안전한 조합인가: Ctrl/⌘/Alt 가 들어 있거나 F1~F12 */
export function isSafeBinding(combo: string, mac = isMacPlatform()): boolean {
  const parsed = parseCombo(combo, mac)
  if (parsed === null) return false
  if (parsed.mod || parsed.ctrl || parsed.alt) return true
  return /^f([1-9]|1[0-2])$/u.test(parsed.key)
}

// ───────── 사용자가 바꾼 키 ─────────

/** id → 표준형 조합. 빈 글자는 「지움(키 없음)」. 없는 id 는 기본값 */
export type ShortcutOverrides = Readonly<Record<string, string>>

let overrides: ShortcutOverrides = {}

/** 설정(appPrefs)이 바뀔 때마다 부른다. 해석기는 이 값을 읽는다 */
export function setShortcutOverrides(next: ShortcutOverrides): void {
  overrides = next
}
export function getShortcutOverrides(): ShortcutOverrides {
  return overrides
}

/** 저장된 값에서 쓸 수 있는 것만 거른다(없는 id·바꿀 수 없는 id·깨진 조합은 버린다) */
export function sanitizeOverrides(value: unknown, mac = isMacPlatform()): Record<string, string> {
  const result: Record<string, string> = {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return result
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const def = BY_ID.get(id)
    if (def === undefined || !isRebindable(def) || typeof raw !== 'string') continue
    if (raw === '') { result[id] = ''; continue }
    const normalized = normalizeCombo(raw, mac)
    if (normalized !== null && isSafeBinding(normalized, mac)) result[id] = normalized
  }
  return result
}

/** 지금 이 명령에 걸린 키들(표준형) */
export function effectiveKeys(def: ShortcutDef, map: ShortcutOverrides = overrides, mac = isMacPlatform()): string[] {
  const own = map[def.id]
  if (own !== undefined && isRebindable(def)) return own === '' ? [] : [own]
  return def.defaultKeys.map((key) => normalizeCombo(key, mac)).filter((key): key is string => key !== null)
}

/** 화면에 보일 대표 키(없으면 null) */
export function primaryKey(id: string, map: ShortcutOverrides = overrides, mac = isMacPlatform()): string | null {
  const def = BY_ID.get(id)
  return def === undefined ? null : effectiveKeys(def, map, mac)[0] ?? null
}

/** 팔레트·툴팁에 붙일 한 줄 표기. 키가 없으면 undefined */
export function shortcutText(id: string, map: ShortcutOverrides = overrides, mac = isMacPlatform()): string | undefined {
  const key = primaryKey(id, map, mac)
  return key === null ? undefined : comboText(key, mac)
}

/** 같은 키를 이미 쓰는 다른 명령(없으면 null). 바꿀 수 없는 편집 키도 센다 */
export function findConflict(id: string, combo: string, map: ShortcutOverrides = overrides, mac = isMacPlatform()): ShortcutDef | null {
  const target = normalizeCombo(combo, mac)
  if (target === null) return null
  for (const def of SHORTCUT_DEFS) {
    if (def.id === id) continue
    if (effectiveKeys(def, map, mac).includes(target)) return def
  }
  return null
}

/** 새 키를 건 뒤의 설정. 기본값과 같으면 덮어쓴 값을 지워 저장을 작게 둔다 */
export function withBinding(map: ShortcutOverrides, id: string, combo: string, mac = isMacPlatform()): Record<string, string> {
  const def = BY_ID.get(id)
  if (def === undefined || !isRebindable(def)) return { ...map }
  const next = { ...map }
  const normalized = combo === '' ? '' : normalizeCombo(combo, mac) ?? ''
  const base = def.defaultKeys.map((key) => normalizeCombo(key, mac))
  if (normalized !== '' && base.length === 1 && base[0] === normalized) delete next[id]
  else next[id] = normalized
  return next
}

/** 두 명령의 키를 서로 바꾼다(`id` 는 `combo` 를 받고, 충돌한 쪽은 `id` 가 쓰던 키를 받는다) */
export function withSwap(map: ShortcutOverrides, id: string, combo: string, mac = isMacPlatform()): Record<string, string> {
  const other = findConflict(id, combo, map, mac)
  const def = BY_ID.get(id)
  if (other === null || def === undefined || !isRebindable(other)) return withBinding(map, id, combo, mac)
  const mine = effectiveKeys(def, map, mac)[0] ?? ''
  return withBinding(withBinding(map, other.id, mine, mac), id, combo, mac)
}

/** 한 명령을 기본값으로 */
export function withoutBinding(map: ShortcutOverrides, id: string): Record<string, string> {
  const next = { ...map }
  delete next[id]
  return next
}

export function isCustomized(id: string, map: ShortcutOverrides = overrides): boolean {
  return map[id] !== undefined
}

/** 키 입력 → 명령 id(없으면 null). `editable`: 글 쓰는 칸에 커서가 있는가 */
export function resolveShortcut(event: KeyboardEvent, editable: boolean, map: ShortcutOverrides = overrides, mac = isMacPlatform()): string | null {
  for (const def of SHORTCUT_DEFS) {
    if (editable && !def.inEditable) continue
    for (const combo of effectiveKeys(def, map, mac)) {
      const parsed = parseCombo(combo, mac)
      if (parsed !== null && eventMatches(event, parsed)) return def.id
    }
  }
  return null
}
