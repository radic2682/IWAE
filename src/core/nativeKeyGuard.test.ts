// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { isBlockedNativeKey, installNativeKeyGuard } from './nativeKeyGuard'
import { setShortcutOverrides } from './shortcutRegistry'

function press(key: string, options: Partial<KeyboardEventInit> = {}, target?: HTMLElement): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
  if (target !== undefined) Object.defineProperty(event, 'target', { value: target })
  return event
}

afterEach(() => setShortcutOverrides({}))

describe('웹뷰 기본 단축키 막이', () => {
  it('앱이 받는 키는 막지 않는다(기본 Ctrl+P 는 인쇄 명령, Ctrl+F 는 앱 검색)', () => {
    expect(isBlockedNativeKey(press('p', { ctrlKey: true }), false)).toBe(false)
    expect(isBlockedNativeKey(press('P', { ctrlKey: true, shiftKey: true }), false)).toBe(false)
    expect(isBlockedNativeKey(press('f', { ctrlKey: true }, document.createElement('input')), false)).toBe(false)
    expect(isBlockedNativeKey(press('=', { ctrlKey: true }), false)).toBe(false)
  })

  it('단축키를 바꾸거나 지워서 앱이 안 받게 되면 웹뷰 기본 동작을 막는다', () => {
    setShortcutOverrides({ print: '', commandPalette: 'Mod+Shift+Y', search: '' })
    expect(isBlockedNativeKey(press('p', { ctrlKey: true }), false)).toBe(true)
    expect(isBlockedNativeKey(press('P', { ctrlKey: true, shiftKey: true }), false)).toBe(true)
    expect(isBlockedNativeKey(press('f', { ctrlKey: true }, document.createElement('input')), false)).toBe(true)
    setShortcutOverrides({ zoomIn: '', zoomOut: '', zoomReset: '' })
    for (const key of ['=', '-', '0']) expect(isBlockedNativeKey(press(key, { ctrlKey: true }), false), key).toBe(true)
  })

  it.each([
    ['r', { ctrlKey: true }], ['R', { ctrlKey: true, shiftKey: true }], ['F5', {}], ['u', { ctrlKey: true }], ['s', { ctrlKey: true }], ['d', { ctrlKey: true }],
    ['o', { ctrlKey: true }], ['n', { ctrlKey: true }], ['t', { ctrlKey: true }], ['h', { ctrlKey: true }], ['j', { ctrlKey: true }],
    ['Delete', { ctrlKey: true, shiftKey: true }], ['F3', {}],
  ] as const)('%s %j 는 막는다', (key, options) => {
    expect(isBlockedNativeKey(press(key, options), false)).toBe(true)
  })

  it('개발자 도구 키(F12·Ctrl+Shift+I)는 배포 빌드에서만 막는다', () => {
    expect(isBlockedNativeKey(press('F12'), false)).toBe(true)
    expect(isBlockedNativeKey(press('I', { ctrlKey: true, shiftKey: true }), false)).toBe(true)
    expect(isBlockedNativeKey(press('F12'), true)).toBe(false)
    expect(isBlockedNativeKey(press('I', { ctrlKey: true, shiftKey: true }), true)).toBe(false)
  })

  it('앱 명령(Ctrl+G 쪽으로 이동)은 막지 않는다', () => {
    expect(isBlockedNativeKey(press('g', { ctrlKey: true }), false)).toBe(false)
  })

  it('편집 키는 막지 않는다(Ctrl+B/I/U·복사·붙여넣기·되돌리기, 글 칸의 Alt+←)', () => {
    const editor = document.createElement('textarea')
    for (const key of ['b', 'i', 'u', 'c', 'v', 'x', 'z', 'a']) expect(isBlockedNativeKey(press(key, { ctrlKey: true }, editor), false), key).toBe(false)
    setShortcutOverrides({ navBack: '' })
    expect(isBlockedNativeKey(press('ArrowLeft', { altKey: true }, editor), false)).toBe(false)
    expect(isBlockedNativeKey(press('ArrowLeft', { altKey: true }), false)).toBe(true)
    expect(isBlockedNativeKey(press('a'), false)).toBe(false)
  })

  it('설치하면 keydown·Ctrl+휠·마우스 뒤로 단추의 기본 동작을 막는다', () => {
    installNativeKeyGuard()
    setShortcutOverrides({ print: '' })
    const key = press('p', { ctrlKey: true })
    document.body.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(true)
    const wheel = new WheelEvent('wheel', { ctrlKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
    const back = new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true })
    document.body.dispatchEvent(back)
    expect(back.defaultPrevented).toBe(true)
  })
})
