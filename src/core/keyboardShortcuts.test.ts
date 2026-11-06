// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { resolveAppShortcut } from './keyboardShortcuts'

function key(key: string, options: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: null, ...options } as KeyboardEvent
}

describe('resolveAppShortcut', () => {
  it.each([
    ['s', 'save'],
    ['z', 'undo'],
    ['y', 'redo'],
    ['a', 'selectAll'],
    ['c', 'copy'],
    ['x', 'cut'],
    ['v', 'paste'],
    ['d', 'duplicate'],
    ['f', 'search'],
    ['=', 'zoomIn'],
    ['-', 'zoomOut'],
    ['0', 'zoomReset'],
  ] as const)('Ctrl/Cmd+%s를 %s 액션으로 해석한다', (pressed, action) => {
    expect(resolveAppShortcut(key(pressed, { ctrlKey: true }))).toBe(action)
    expect(resolveAppShortcut(key(pressed, { metaKey: true }))).toBe(action)
  })

  it('글 칸에 커서가 있어도 Ctrl+F 는 앱 검색이다(WebView 기본 찾기창이 뜨지 않게)', () => {
    const input = document.createElement('input')
    expect(resolveAppShortcut(key('f', { ctrlKey: true, target: input }))).toBe('search')
  })

  it('Shift+Z와 Delete, Escape를 각각 redo/delete/escape로 해석한다', () => {
    expect(resolveAppShortcut(key('z', { ctrlKey: true, shiftKey: true }))).toBe('redo')
    expect(resolveAppShortcut(key('Delete'))).toBe('delete')
    expect(resolveAppShortcut(key('Backspace'))).toBe('delete')
    expect(resolveAppShortcut(key('Escape'))).toBe('escape')
  })

  it('텍스트 편집 중에는 저장과 Escape를 제외한 앱 단축키를 가로채지 않는다', () => {
    const input = document.createElement('input')
    expect(resolveAppShortcut(key('z', { ctrlKey: true, target: input }))).toBeNull()
    expect(resolveAppShortcut(key('Delete', { target: input }))).toBeNull()
    expect(resolveAppShortcut(key('s', { ctrlKey: true, target: input }))).toBe('save')
    expect(resolveAppShortcut(key('Escape', { target: input }))).toBe('escape')
  })

  it('텍스트 편집 중에도 기본 서식과 제목 단계 단축키를 해석한다', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    document.body.append(editor)
    expect(resolveAppShortcut(key('b', { ctrlKey: true, target: editor }))).toBe('bold')
    expect(resolveAppShortcut(key('i', { metaKey: true, target: editor }))).toBe('italic')
    expect(resolveAppShortcut(key('u', { ctrlKey: true, target: editor }))).toBe('underline')
    expect(resolveAppShortcut(key('3', { ctrlKey: true, altKey: true, target: editor }))).toBe('heading3')
    editor.remove()
  })

  it('Ctrl/Cmd+Shift+L 을 라이브러리 토글로 해석하고, 입력 칸 안에서도 동작한다', () => {
    expect(resolveAppShortcut(key('L', { ctrlKey: true, shiftKey: true }))).toBe('toggleLibrary')
    expect(resolveAppShortcut(key('l', { metaKey: true, shiftKey: true }))).toBe('toggleLibrary')
    expect(resolveAppShortcut(key('l', { ctrlKey: true }))).toBeNull()
    const input = document.createElement('input')
    expect(resolveAppShortcut(key('L', { ctrlKey: true, shiftKey: true, target: input }))).toBe('toggleLibrary')
  })

  it('Alt+←/→ 를 뒤로/앞으로로 해석하고, 입력 칸 안에서는 쓰지 않는다', () => {
    expect(resolveAppShortcut(key('ArrowLeft', { altKey: true }))).toBe('navBack')
    expect(resolveAppShortcut(key('ArrowRight', { altKey: true }))).toBe('navForward')
    expect(resolveAppShortcut(key('ArrowLeft'))).toBeNull()
    const textarea = document.createElement('textarea')
    expect(resolveAppShortcut(key('ArrowLeft', { altKey: true, target: textarea }))).toBeNull()
  })
})
