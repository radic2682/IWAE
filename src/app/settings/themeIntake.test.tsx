// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAppPrefs } from '../appPrefs'
import { serializeThemeFile } from '../../core/themeFile'
import { themeFromPalette } from '../../core/userTheme'
import { ThemeIntakeHost } from './ThemeIntakeHost'
import {
  checkIncomingThemeFile,
  importThemeFile,
  offerThemeFiles,
  partitionThemeDrop,
  setThemeDropHover,
} from './themeIntake'
import { MAX_USER_THEMES, getUserThemeState, reloadUserThemesForTest, saveUserTheme, setFolderThemes } from './userThemeStore'

vi.mock('../actionFeedback', () => ({ announceAction: vi.fn() }))

const forest = themeFromPalette('default', '숲')
const fileOf = (name: string, text: string) => ({ name, text })

beforeEach(() => {
  window.localStorage.clear()
  reloadUserThemesForTest()
})
afterEach(() => {
  setFolderThemes([], [])
  setThemeDropHover(false)
})

describe('끌어 놓은 경로 가르기', () => {
  it('.iwtheme 는 어디에 놓아도 테마 파일, 나머지는 그대로 문서 쪽으로', () => {
    expect(partitionThemeDrop(['C:\\a\\숲.iwtheme', 'C:\\a\\x.pdf', 'C:\\a\\y.json'], false)).toEqual({ themePaths: ['C:\\a\\숲.iwtheme'], rest: ['C:\\a\\x.pdf', 'C:\\a\\y.json'] })
  })

  it('.json 은 설정의 테마 구역 위에서만 테마 파일', () => {
    expect(partitionThemeDrop(['a.json', 'b.pdf', 'c.iwtheme'], true)).toEqual({ themePaths: ['a.json', 'c.iwtheme'], rest: ['b.pdf'] })
  })
})

describe('파일 검사', () => {
  it('좋은 파일은 ok, 나쁜 파일은 이유와 함께 error, 못 읽은 파일은 그 이유', () => {
    expect(checkIncomingThemeFile(fileOf('a.iwtheme', serializeThemeFile(forest))).kind).toBe('ok')
    const bad = checkIncomingThemeFile(fileOf('b.iwtheme', '{"format":"iwae-theme","version":1,"theme":{"name":"x","base":"whale","light":{},"dark":{}}}'))
    expect(bad).toMatchObject({ kind: 'error', file: 'b.iwtheme' })
    expect(bad.kind === 'error' && bad.error).toContain('빠져 있습니다')
    expect(checkIncomingThemeFile({ name: 'c.iwtheme', readError: '파일을 읽지 못했습니다.' })).toEqual({ kind: 'error', file: 'c.iwtheme', error: '파일을 읽지 못했습니다.' })
  })
})

function content(text = serializeThemeFile(forest)) {
  const check = checkIncomingThemeFile(fileOf('a.iwtheme', text))
  if (check.kind !== 'ok') throw new Error('bad fixture')
  return check.content
}

describe('importThemeFile', () => {
  it('추가만: 목록에 들어가고 쓰던 테마는 그대로', () => {
    const result = importThemeFile(content(), { apply: false, withHighlights: false })
    expect(result).toMatchObject({ ok: true, name: '숲', added: true, applied: false })
    const state = getUserThemeState()
    expect(state.themes.map((theme) => theme.name)).toEqual(['숲'])
    expect(state.activeId).toBeNull()
  })

  it('추가하고 적용', () => {
    importThemeFile(content(), { apply: true, withHighlights: false })
    const state = getUserThemeState()
    expect(state.activeId).toBe(state.themes[0]!.id)
  })

  it('같은 이름의 다른 색이면 「숲 (2)」, 폴더 테마 이름과도 겹치지 않는다', () => {
    saveUserTheme({ ...forest, id: 'ut-1' })
    const other = themeFromPalette('navy', '숲')
    const result = importThemeFile(content(serializeThemeFile(other)), { apply: false, withHighlights: false })
    expect(result).toMatchObject({ ok: true, name: '숲 (2)', added: true })
    setFolderThemes([{ ...forest, id: 'vf-x', name: '숲 (3)', file: 'x.iwtheme' }], [])
    const third = themeFromPalette('paper', '숲')
    expect(importThemeFile(content(serializeThemeFile(third)), { apply: false, withHighlights: false })).toMatchObject({ name: '숲 (4)' })
  })

  it('똑같은 테마를 또 놓으면 새로 만들지 않고 그것을 적용', () => {
    importThemeFile(content(), { apply: false, withHighlights: false })
    const again = importThemeFile(content(), { apply: true, withHighlights: false })
    expect(again).toMatchObject({ ok: true, added: false, applied: true })
    const state = getUserThemeState()
    expect(state.themes).toHaveLength(1)
    expect(state.activeId).toBe(state.themes[0]!.id)
  })

  it('내 테마가 가득 찼으면 거절', () => {
    for (let index = 0; index < MAX_USER_THEMES; index++) saveUserTheme({ ...themeFromPalette('whale', `t${index}`), id: `ut-${index}` })
    const result = importThemeFile(content(), { apply: false, withHighlights: false })
    expect(result.ok).toBe(false)
    expect(getUserThemeState().themes).toHaveLength(MAX_USER_THEMES)
  })

  it('형광펜 색은 고르면 바꾸고, 안 고르면 그대로', () => {
    const before = getAppPrefs().highlightColors
    const withColors = JSON.parse(serializeThemeFile(forest))
    withColors.highlightColors = [{ name: '청록', fill: '#1abc9c' }]
    const parsed = content(JSON.stringify(withColors))
    importThemeFile(parsed, { apply: false, withHighlights: false })
    expect(getAppPrefs().highlightColors).toBe(before)
    const result = importThemeFile(parsed, { apply: false, withHighlights: true })
    expect(result).toMatchObject({ ok: true, highlightColors: true })
    expect(getAppPrefs().highlightColors.map((color) => color.name)).toEqual(['청록'])
  })
})

describe('ThemeIntakeHost', () => {
  it('파일이 오면 「「숲」 테마를 추가할까요?」 를 묻고 [추가하고 적용] 으로 적용', () => {
    render(<ThemeIntakeHost resolvedTheme="light" />)
    act(() => offerThemeFiles([fileOf('숲.iwtheme', serializeThemeFile(forest))]))
    expect(screen.getByRole('alertdialog').textContent).toContain('「숲」 테마를 추가할까요?')
    fireEvent.click(screen.getByRole('button', { name: '추가하고 적용' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(getUserThemeState().themes.map((theme) => theme.name)).toEqual(['숲'])
    expect(getUserThemeState().activeId).not.toBeNull()
  })

  it('[추가] 는 적용하지 않는다, [취소] 는 아무것도 하지 않는다', () => {
    render(<ThemeIntakeHost resolvedTheme="dark" />)
    act(() => offerThemeFiles([fileOf('a.iwtheme', serializeThemeFile(forest))]))
    fireEvent.click(screen.getByRole('button', { name: '추가' }))
    expect(getUserThemeState().themes).toHaveLength(1)
    expect(getUserThemeState().activeId).toBeNull()
    act(() => offerThemeFiles([fileOf('b.iwtheme', serializeThemeFile(themeFromPalette('navy', '다른')))]))
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(getUserThemeState().themes).toHaveLength(1)
  })

  it('나쁜 파일은 이유를 보여 주고, 다음 파일로 넘어간다(앱은 멈추지 않는다)', () => {
    render(<ThemeIntakeHost resolvedTheme="light" />)
    act(() => offerThemeFiles([fileOf('bad.iwtheme', 'not json'), fileOf('ok.iwtheme', serializeThemeFile(forest))]))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('bad.iwtheme')
    expect(dialog.textContent).toContain('JSON')
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    expect(screen.getByRole('alertdialog').textContent).toContain('「숲」')
    expect(getUserThemeState().themes).toHaveLength(0)
  })

  it('형광펜 색이 든 파일은 같이 바꿀지 고르게 한다', () => {
    const withColors = JSON.parse(serializeThemeFile(forest))
    withColors.highlightColors = [{ name: '청록', fill: '#1abc9c' }]
    render(<ThemeIntakeHost resolvedTheme="light" />)
    act(() => offerThemeFiles([fileOf('c.iwtheme', JSON.stringify(withColors))]))
    const box = screen.getByRole('checkbox')
    expect((box as HTMLInputElement).checked).toBe(false)
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: '추가' }))
    expect(getAppPrefs().highlightColors.map((color) => color.name)).toEqual(['청록'])
  })

  it('테마 파일을 끌고 있는 동안 안내가 뜬다', () => {
    render(<ThemeIntakeHost resolvedTheme="light" />)
    expect(screen.queryByText('테마 파일을 놓아 추가할 수 있습니다')).toBeNull()
    act(() => setThemeDropHover(true))
    expect(screen.getByText('테마 파일을 놓아 추가할 수 있습니다')).toBeTruthy()
  })

  it('브라우저에서 파일을 DOM 으로 끌어 놓으면(.iwtheme) 같은 확인 창', async () => {
    render(<ThemeIntakeHost resolvedTheme="light" />)
    const file = new File([serializeThemeFile(forest)], '숲.iwtheme', { type: '' })
    const event = new Event('drop', { cancelable: true }) as Event & { dataTransfer: unknown }
    event.dataTransfer = { types: ['Files'], files: [file] }
    await act(async () => { window.dispatchEvent(event); await Promise.resolve(); await Promise.resolve() })
    await vi.waitFor(() => expect(screen.getByRole('alertdialog').textContent).toContain('「숲」'))
    expect(event.defaultPrevented).toBe(true)
  })
})
