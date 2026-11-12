// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getShortcutOverrides, setShortcutOverrides } from '../core/shortcutRegistry'
import { getAppPrefs, setAppPref } from './appPrefs'
import { ShortcutSettings } from './ShortcutSettings'

const KEY = 'iwae:app-prefs:v1'

function keysButton(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name: new RegExp(`^${name}: (현재|새 키)`, 'u') }) as HTMLButtonElement
}
function record(name: string, init: KeyboardEventInit) {
  fireEvent.click(keysButton(name))
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) })
}

beforeEach(() => { setAppPref('shortcuts', {}) })
afterEach(() => { cleanup(); setAppPref('shortcuts', {}); setShortcutOverrides({}) })

describe('ShortcutSettings', () => {
  it('눌러서 새 키를 정하면 저장되고 등록부에 반영된다', () => {
    render(<ShortcutSettings />)
    record('탭 닫기', { key: 'j', ctrlKey: true })
    expect(getAppPrefs().shortcuts).toEqual({ closeTab: 'Mod+J' })
    expect(getShortcutOverrides()).toEqual({ closeTab: 'Mod+J' })
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '{}').shortcuts).toEqual({ closeTab: 'Mod+J' })
    expect(keysButton('탭 닫기').textContent).toContain('J')
  })

  it('Esc 는 취소, Backspace 는 키 지우기', () => {
    render(<ShortcutSettings />)
    record('탭 닫기', { key: 'Escape' })
    expect(getAppPrefs().shortcuts).toEqual({})
    record('탭 닫기', { key: 'Backspace' })
    expect(getAppPrefs().shortcuts).toEqual({ closeTab: '' })
    expect(keysButton('탭 닫기').textContent).toContain('없음')
  })

  it('충돌하면 안내하고, 서로 바꾸기로 맞교환한다', () => {
    render(<ShortcutSettings />)
    record('탭 닫기', { key: 'P', ctrlKey: true, shiftKey: true })
    expect(getAppPrefs().shortcuts).toEqual({})
    expect(screen.getByRole('status').textContent).toContain('명령 팔레트')
    fireEvent.click(screen.getByRole('button', { name: '서로 바꾸기' }))
    expect(getAppPrefs().shortcuts).toEqual({ closeTab: 'Mod+Shift+P', commandPalette: 'Mod+W' })
  })

  it('편집기 고정 키와 부딪치면 바꾸기 없이 거절한다', () => {
    render(<ShortcutSettings />)
    record('탭 닫기', { key: 'b', ctrlKey: true })
    expect(screen.getByRole('status').textContent).toContain('편집기 고정')
    expect(screen.queryByRole('button', { name: '서로 바꾸기' })).toBeNull()
    expect(getAppPrefs().shortcuts).toEqual({})
  })

  it('수식 키 없는 글자 키는 받지 않고 계속 기다린다', () => {
    render(<ShortcutSettings />)
    record('탭 닫기', { key: 'j' })
    expect(screen.getByRole('status').textContent).toContain('Ctrl')
    expect(getAppPrefs().shortcuts).toEqual({})
  })

  it('기본값으로(한 줄·전체)와 검색', () => {
    render(<ShortcutSettings />)
    record('탭 닫기', { key: 'j', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: '탭 닫기: 기본값으로' }))
    expect(getAppPrefs().shortcuts).toEqual({})
    record('탭 닫기', { key: 'j', ctrlKey: true })
    record('인쇄', { key: 'j', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: '모두 기본값으로' }))
    expect(getAppPrefs().shortcuts).toEqual({})
    fireEvent.change(screen.getByRole('searchbox', { name: '단축키 찾기' }), { target: { value: 'print' } })
    expect(screen.queryByText('탭 닫기')).toBeNull()
    expect(screen.getByText('인쇄')).toBeTruthy()
  })

  it('다른 창이 바꾼 키(storage 이벤트)를 따라간다', () => {
    render(<ShortcutSettings />)
    act(() => {
      window.localStorage.setItem(KEY, JSON.stringify({ shortcuts: { print: 'Mod+J' } }))
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    })
    expect(getShortcutOverrides()).toEqual({ print: 'Mod+J' })
    expect(keysButton('인쇄').textContent).toContain('J')
  })
})
