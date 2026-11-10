// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_HIGHLIGHT_COLORS, MAX_HIGHLIGHT_COLORS } from '../core/highlightColors'
import { getAppPrefs, parseAppPrefs, setAppPref } from './appPrefs'
import { HighlightColorSettings } from './HighlightColorSettings'
import { HIGHLIGHT_STYLE_ID, applyHighlightColors, installHighlightColorStyle } from './highlightColorStyle'
import { setHighlightColorUsage } from './highlightColorUsage'

const ids = () => getAppPrefs().highlightColors.map(({ id }) => id)

describe('HighlightColorSettings', () => {
  beforeEach(() => {
    setAppPref('highlightColors', DEFAULT_HIGHLIGHT_COLORS)
    setHighlightColorUsage(new Map())
  })
  afterEach(() => {
    setAppPref('highlightColors', DEFAULT_HIGHLIGHT_COLORS)
  })

  it('기본 4색을 이름·견본·본문 표시·탭 예시와 함께 보여 준다', () => {
    render(<HighlightColorSettings />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows.map((row) => row.getAttribute('data-hl'))).toEqual(['yellow', 'green', 'blue', 'pink'])
    expect(within(rows[0]!).getByDisplayValue('노랑')).toBeTruthy()
    expect(within(rows[0]!).getByText('본문 표시')).toBeTruthy()
    expect(within(rows[0]!).getByText('노랑 · p.3')).toBeTruthy()
    expect(screen.getByText(/최대 8가지/)).toBeTruthy()
  })

  it('색 추가: 새 id 로 늘고, 8개가 되면 추가 단추가 사라진다', () => {
    render(<HighlightColorSettings />)
    fireEvent.click(screen.getByRole('button', { name: '색 추가' }))
    expect(getAppPrefs().highlightColors).toHaveLength(5)
    expect(getAppPrefs().highlightColors[4]!.id).toMatch(/^c_[a-z0-9]{6}$/)
    for (let i = 0; i < 3; i += 1) fireEvent.click(screen.getByRole('button', { name: '색 추가' }))
    expect(getAppPrefs().highlightColors).toHaveLength(MAX_HIGHLIGHT_COLORS)
    expect(screen.queryByRole('button', { name: '색 추가' })).toBeNull()
  })

  it('이름을 고치면 바로 저장되고 예시 탭에도 보인다', () => {
    render(<HighlightColorSettings />)
    fireEvent.change(screen.getByLabelText('노랑 이름'), { target: { value: '중요' } })
    expect(getAppPrefs().highlightColors[0]).toMatchObject({ id: 'yellow', name: '중요' })
    expect(screen.getByText('중요 · p.3')).toBeTruthy()
    // 비운 채 나가면 「색」으로 돌린다
    fireEvent.change(screen.getByLabelText('중요 이름'), { target: { value: '  ' } })
    fireEvent.blur(screen.getByLabelText('색 이름'))
    expect(getAppPrefs().highlightColors[0]!.name).toBe('색')
  })

  it('색을 고르면 대표 색이 바뀌고 저장값에 남는다(id 는 그대로)', () => {
    const { container } = render(<HighlightColorSettings />)
    const picker = container.querySelectorAll<HTMLInputElement>('input[type="color"]')[1]!
    fireEvent.change(picker, { target: { value: '#c7a8ff' } })
    expect(getAppPrefs().highlightColors[1]).toEqual({ id: 'green', name: '초록', fill: '#c7a8ff' })
    expect(parseAppPrefs(window.localStorage.getItem('iwae:app-prefs:v1')).highlightColors[1]!.fill).toBe('#c7a8ff')
  })

  it('쓰이지 않는 색은 바로 지우고, 마지막 한 색은 지울 수 없다', () => {
    render(<HighlightColorSettings />)
    fireEvent.click(screen.getByRole('button', { name: '초록 지우기' }))
    expect(ids()).toEqual(['yellow', 'blue', 'pink'])
    fireEvent.click(screen.getByRole('button', { name: '파랑 지우기' }))
    fireEvent.click(screen.getByRole('button', { name: '분홍 지우기' }))
    expect(ids()).toEqual(['yellow'])
    expect((screen.getByRole('button', { name: '노랑 지우기' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('형광펜이 이 색으로 칠해져 있으면 확인을 거치고, 취소하면 그대로다', () => {
    setHighlightColorUsage(new Map([['blue', 3]]))
    render(<HighlightColorSettings />)
    fireEvent.click(screen.getByRole('button', { name: '파랑 지우기' }))
    expect(ids()).toContain('blue')
    expect(screen.getByRole('alertdialog').textContent).toContain('3개')
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(ids()).toContain('blue')
    fireEvent.click(screen.getByRole('button', { name: '파랑 지우기' }))
    fireEvent.click(screen.getByRole('button', { name: '지우기' }))
    expect(ids()).toEqual(['yellow', 'green', 'pink'])
  })

  it('손잡이에서 위·아래 화살표로 순서를 바꾼다', () => {
    render(<HighlightColorSettings />)
    fireEvent.keyDown(screen.getByLabelText(/^노랑 순서 바꾸기/), { key: 'ArrowDown' })
    expect(ids()).toEqual(['green', 'yellow', 'blue', 'pink'])
    // 맨 위에서 위로는 그대로
    fireEvent.keyDown(screen.getAllByLabelText(/순서 바꾸기/)[0]!, { key: 'ArrowUp' })
    expect(ids()).toEqual(['green', 'yellow', 'blue', 'pink'])
  })
})

describe('형광펜 색 → <style id="iwae-highlight-colors">', () => {
  afterEach(() => {
    setAppPref('highlightColors', DEFAULT_HIGHLIGHT_COLORS)
    document.getElementById(HIGHLIGHT_STYLE_ID)?.remove()
  })

  it('한 개의 style 요소를 만들고 목록이 바뀌면 같은 요소를 고쳐 쓴다', () => {
    applyHighlightColors(DEFAULT_HIGHLIGHT_COLORS)
    const style = document.getElementById(HIGHLIGHT_STYLE_ID)!
    expect(style.textContent).toContain('[data-hl="yellow"]')
    applyHighlightColors([...DEFAULT_HIGHLIGHT_COLORS, { id: 'c_new', name: '반론', fill: '#c7a8ff' }])
    expect(document.querySelectorAll(`#${HIGHLIGHT_STYLE_ID}`)).toHaveLength(1)
    expect(document.getElementById(HIGHLIGHT_STYLE_ID)!.textContent).toContain('[data-hl="c_new"]')
  })

  it('설정이 바뀌면(다른 창의 storage 이벤트 포함) 바로 다시 쓴다', () => {
    installHighlightColorStyle()
    act(() => { setAppPref('highlightColors', [...DEFAULT_HIGHLIGHT_COLORS, { id: 'c_live', name: '라이브', fill: '#c7a8ff' }]) })
    expect(document.getElementById(HIGHLIGHT_STYLE_ID)!.textContent).toContain('[data-hl="c_live"]')
    // 다른 창이 localStorage 를 바꾼 뒤 storage 이벤트가 온 것처럼
    const remote = JSON.stringify({ highlightColors: [{ id: 'c_remote', name: '원격', fill: '#112233' }] })
    window.localStorage.setItem('iwae:app-prefs:v1', remote)
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'iwae:app-prefs:v1', newValue: remote })) })
    expect(getAppPrefs().highlightColors.map(({ id }) => id)).toEqual(['c_remote'])
    expect(document.getElementById(HIGHLIGHT_STYLE_ID)!.textContent).toContain('[data-hl="c_remote"]')
  })
})
