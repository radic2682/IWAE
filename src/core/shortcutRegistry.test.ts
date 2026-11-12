// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { resolveAppShortcut } from './keyboardShortcuts'
import {
  SHORTCUT_DEFS, comboCaps, comboText, effectiveKeys, eventToCombo, findConflict, isSafeBinding, normalizeCombo, resolveShortcut,
  sanitizeOverrides, setShortcutOverrides, shortcutText, withBinding, withSwap, withoutBinding,
} from './shortcutRegistry'

function press(key: string, options: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
}

afterEach(() => setShortcutOverrides({}))

describe('등록부', () => {
  it('id 는 겹치지 않고, 기본 키도 두 명령이 나눠 쓰지 않는다', () => {
    expect(new Set(SHORTCUT_DEFS.map((def) => def.id)).size).toBe(SHORTCUT_DEFS.length)
    const seen = new Map<string, string>()
    for (const def of SHORTCUT_DEFS) {
      for (const key of effectiveKeys(def, {}, false)) {
        expect(seen.get(key), `${def.id} 와 ${seen.get(key)} 의 ${key}`).toBeUndefined()
        seen.set(key, def.id)
      }
    }
  })

  it('편집기 범위(굵게·기울임·밑줄 등)는 바꿀 수 없다', () => {
    const editorIds = SHORTCUT_DEFS.filter((def) => def.scope === 'editor').map((def) => def.id)
    expect(editorIds).toEqual(expect.arrayContaining(['bold', 'italic', 'underline', 'undo', 'redo']))
    expect(sanitizeOverrides({ bold: 'Mod+K' })).toEqual({})
    expect(withBinding({}, 'bold', 'Mod+K')).toEqual({})
  })
})

describe('키 표기', () => {
  it('표준형으로 바꾸고 맥에서는 기호로 그린다', () => {
    expect(normalizeCombo('shift+ctrl+f', false)).toBe('Mod+Shift+F')
    expect(normalizeCombo('Ctrl+Tab', true)).toBe('Ctrl+Tab')
    expect(normalizeCombo('Cmd+Option+1', true)).toBe('Mod+Alt+1')
    expect(normalizeCombo('Mod+', false)).toBeNull()
    expect(comboCaps('Mod+Shift+F', false)).toEqual(['Ctrl', 'Shift', 'F'])
    expect(comboCaps('Mod+Shift+F', true)).toEqual(['⇧', '⌘', 'F'])
    expect(comboText('Alt+ArrowLeft', false)).toBe('Alt+←')
    expect(comboText('Mod+Shift+P', true)).toBe('⇧⌘P')
    expect(comboCaps('Mod+Plus', false)).toEqual(['Ctrl', '+'])
  })

  it('키 입력을 조합으로 읽는다(수식 키만이면 null, 맥은 ⌘ 이 Mod)', () => {
    expect(eventToCombo(press('k', { ctrlKey: true, shiftKey: true }), false)).toBe('Mod+Shift+K')
    expect(eventToCombo(press('Control', { ctrlKey: true }), false)).toBeNull()
    expect(eventToCombo(press('k', { metaKey: true }), true)).toBe('Mod+K')
    expect(eventToCombo(press('k', { ctrlKey: true }), true)).toBe('Ctrl+K')
    expect(eventToCombo(press('ArrowLeft', { altKey: true }), false)).toBe('Alt+ArrowLeft')
  })

  it('글자 키 하나만으로는 정할 수 없고, Ctrl·Alt·F 키는 된다', () => {
    expect(isSafeBinding('K', false)).toBe(false)
    expect(isSafeBinding('Shift+K', false)).toBe(false)
    expect(isSafeBinding('Mod+K', false)).toBe(true)
    expect(isSafeBinding('Alt+K', false)).toBe(true)
    expect(isSafeBinding('F6', false)).toBe(true)
  })
})

describe('해석과 바꾼 키', () => {
  it('기본 키는 지금까지와 같다', () => {
    expect(resolveAppShortcut(press('P', { ctrlKey: true, shiftKey: true }))).toBe('commandPalette')
    expect(resolveAppShortcut(press('/', { ctrlKey: true }))).toBe('showShortcuts')
    expect(resolveAppShortcut(press('Tab', { ctrlKey: true }))).toBe('nextTab')
    expect(shortcutText('closeTab', {}, false)).toBe('Ctrl+W')
  })

  it('Ctrl+K 는 Ctrl+Shift+P 와 같은 명령 팔레트다(글 칸 안에서도, 단축키 목록의 대표 키는 앞의 것)', () => {
    expect(resolveAppShortcut(press('k', { ctrlKey: true }))).toBe('commandPalette')
    expect(resolveAppShortcut(press('k', { metaKey: true }))).toBe('commandPalette')
    expect(shortcutText('commandPalette', {}, false)).toBe('Ctrl+Shift+P')
    expect(effectiveKeys(SHORTCUT_DEFS.find((def) => def.id === 'commandPalette')!, {}, false)).toEqual(['Mod+Shift+P', 'Mod+K'])
    const input = document.createElement('input')
    const event = press('k', { ctrlKey: true })
    Object.defineProperty(event, 'target', { value: input })
    expect(resolveAppShortcut(event)).toBe('commandPalette')
    // 사용자가 바꾸면 별칭도 함께 사라진다(바꾼 키 하나만 남는다)
    setShortcutOverrides({ commandPalette: 'Mod+J' })
    expect(resolveAppShortcut(press('k', { ctrlKey: true }))).toBeNull()
  })

  it('접두키 항목은 기본 Ctrl+Space 이고, 일반 해석(resolveShortcut)은 건너뛴다(Ctrl+B 를 골라도 굵게가 먼저다)', () => {
    const def = SHORTCUT_DEFS.find((candidate) => candidate.id === 'prefixKey')!
    expect(effectiveKeys(def, {}, false)).toEqual(['Mod+Space'])
    expect(resolveAppShortcut(press(' ', { ctrlKey: true }))).toBeNull()
    setShortcutOverrides({ prefixKey: 'Mod+B' })
    expect(resolveAppShortcut(press('b', { ctrlKey: true }))).toBe('bold')
  })

  it('한글 입력기가 key 를 Process 로 바꿔도 Ctrl+Space 는 물리 키로 맞는다', () => {
    const event = press('Process', { ctrlKey: true, code: 'Space' })
    setShortcutOverrides({ goTo: 'Mod+Space' })
    expect(resolveShortcut(event, false)).toBe('goTo')
  })

  it('바꾼 키가 먼저 걸리고 옛 키는 풀린다', () => {
    setShortcutOverrides({ closeTab: 'Mod+J' })
    expect(resolveAppShortcut(press('j', { ctrlKey: true }))).toBe('closeTab')
    expect(resolveAppShortcut(press('w', { ctrlKey: true }))).toBeNull()
  })

  it('지운 키(빈 글자)는 아무것도 부르지 않는다', () => {
    setShortcutOverrides({ print: '' })
    expect(resolveAppShortcut(press('p', { ctrlKey: true }))).toBeNull()
    expect(shortcutText('print')).toBeUndefined()
  })

  it('글 쓰는 칸에서는 inEditable 인 명령만 부른다(Ctrl+B 같은 편집 키는 그대로 편집기 몫)', () => {
    const input = document.createElement('input')
    const inInput = (key: string, options: Partial<KeyboardEvent>) => {
      const event = press(key, options)
      Object.defineProperty(event, 'target', { value: input })
      return resolveShortcut(event, true)
    }
    expect(inInput('g', { ctrlKey: true })).toBeNull()
    expect(inInput('p', { ctrlKey: true, shiftKey: true })).toBe('commandPalette')
    expect(inInput('b', { ctrlKey: true })).toBe('bold')
    setShortcutOverrides({ goTo: 'Mod+J' })
    expect(inInput('j', { ctrlKey: true })).toBeNull()
  })

  it('Alt 를 누른 숫자·한글 자판은 물리 키(code)로도 맞춘다', () => {
    expect(resolveAppShortcut(press('¡', { ctrlKey: true, altKey: true, code: 'Digit1' }))).toBe('heading1')
    expect(resolveAppShortcut(press('ㄹ', { ctrlKey: true, code: 'KeyF' }))).toBe('search')
  })
})

describe('충돌과 바꾸기', () => {
  it('이미 쓰는 키를 알려 준다(바꿀 수 없는 편집 키 포함)', () => {
    expect(findConflict('closeTab', 'Mod+Shift+P', {}, false)?.id).toBe('commandPalette')
    expect(findConflict('closeTab', 'Mod+B', {}, false)?.id).toBe('bold')
    expect(findConflict('closeTab', 'Mod+W', {}, false)).toBeNull()
    expect(findConflict('closeTab', 'Mod+J', {}, false)).toBeNull()
  })

  it('서로 바꾸면 두 명령의 키가 맞교환된다', () => {
    const next = withSwap({}, 'closeTab', 'Mod+Shift+P', false)
    expect(next).toEqual({ closeTab: 'Mod+Shift+P', commandPalette: 'Mod+W' })
    expect(findConflict('closeTab', 'Mod+Shift+P', next, false)).toBeNull()
  })

  it('기본값과 같게 되면 저장에서 빠지고, 하나·전체를 기본값으로 되돌린다', () => {
    const changed = withBinding({}, 'closeTab', 'Mod+J', false)
    expect(changed).toEqual({ closeTab: 'Mod+J' })
    expect(withBinding(changed, 'closeTab', 'Mod+W', false)).toEqual({})
    expect(withoutBinding(changed, 'closeTab')).toEqual({})
    expect(withBinding({}, 'closeTab', '', false)).toEqual({ closeTab: '' })
  })

  it('저장된 값에서 깨진 것·모르는 id·글자 한 키만인 것은 버린다', () => {
    expect(sanitizeOverrides({ closeTab: 'ctrl+j', nope: 'Mod+J', print: 'K', goTo: 5, search: '' }, false)).toEqual({ closeTab: 'Mod+J', search: '' })
    expect(sanitizeOverrides(null)).toEqual({})
    expect(sanitizeOverrides(['a'])).toEqual({})
  })
})
