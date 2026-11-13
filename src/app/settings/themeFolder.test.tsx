// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { serializeThemeFile } from '../../core/themeFile'
import { themeFromPalette } from '../../core/userTheme'
import { isThemeFolderPath, openThemeFolder, readThemeFolderFiles, themeFolderPath, useThemeFolder } from './themeFolder'
import { getUserThemeState, reloadUserThemesForTest, saveUserTheme, setFolderThemes } from './userThemeStore'

const fsMocks = vi.hoisted(() => ({
  exists: vi.fn(),
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  mkdir: vi.fn(),
}))
const openerMocks = vi.hoisted(() => ({ revealItemInDir: vi.fn() }))

vi.mock('@tauri-apps/plugin-fs', () => ({ exists: fsMocks.exists, readDir: fsMocks.readDir, readTextFile: fsMocks.readTextFile, mkdir: fsMocks.mkdir }))
vi.mock('@tauri-apps/plugin-opener', () => openerMocks)

const forest = themeFromPalette('default', '숲')
const files = new Map<string, string>()

beforeEach(() => {
  window.localStorage.clear()
  reloadUserThemesForTest()
  files.clear()
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
  fsMocks.exists.mockImplementation(async () => true)
  fsMocks.readDir.mockImplementation(async () => [...files.keys()].map((name) => ({ name, isFile: true, isDirectory: false })))
  fsMocks.readTextFile.mockImplementation(async (path: string) => files.get(path.split('/').at(-1) ?? '') ?? '')
  fsMocks.mkdir.mockResolvedValue(undefined)
})

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  setFolderThemes([], [])
  vi.clearAllMocks()
})

describe('테마 폴더 경로', () => {
  it('Vault 의 .iwae/themes', () => {
    expect(themeFolderPath('C:\\Vault\\')).toBe('C:\\Vault/.iwae/themes')
    expect(themeFolderPath('/v')).toBe('/v/.iwae/themes')
  })

  it('감시 경로가 테마 폴더 안(또는 그 폴더)인지', () => {
    expect(isThemeFolderPath('C:\\Vault\\.iwae\\themes\\숲.iwtheme')).toBe(true)
    expect(isThemeFolderPath('C:/Vault/.IWAE/Themes')).toBe(true)
    expect(isThemeFolderPath('C:/Vault/.iwae/state.json')).toBe(false)
    expect(isThemeFolderPath('C:/Vault/themes/a.iwtheme')).toBe(false)
    expect(isThemeFolderPath('C:/Vault/.iwae/themesX/a')).toBe(false)
  })
})

describe('폴더 읽기', () => {
  it('.iwtheme·.json 만 읽는다', async () => {
    files.set('a.iwtheme', serializeThemeFile(forest))
    files.set('b.JSON', serializeThemeFile(forest))
    files.set('memo.txt', 'x')
    const read = await readThemeFolderFiles('/v')
    expect(read.map((file) => file.name).sort()).toEqual(['a.iwtheme', 'b.JSON'])
  })

  it('폴더가 없으면 빈 목록(만들지도 않는다)', async () => {
    fsMocks.exists.mockResolvedValue(false)
    expect(await readThemeFolderFiles('/v')).toEqual([])
    expect(fsMocks.mkdir).not.toHaveBeenCalled()
  })
})

describe('useThemeFolder', () => {
  it('Vault 를 열면 폴더 테마가 스토어에 들어가고, 틀린 파일은 errors 로', async () => {
    files.set('forest.iwtheme', serializeThemeFile(forest))
    files.set('broken.iwtheme', '{"format":"iwae-theme","version":3}')
    const { unmount } = renderHook(() => useThemeFolder('/v'))
    await act(async () => { await Promise.resolve() })
    await vi.waitFor(() => expect(getUserThemeState().folderThemes).toHaveLength(1))
    const state = getUserThemeState()
    expect(state.folderThemes[0]).toMatchObject({ name: '숲', file: 'forest.iwtheme' })
    expect(state.folderErrors).toHaveLength(1)
    expect(state.folderErrors[0]!.error).toContain('버전 3')
    unmount()
    expect(getUserThemeState().folderThemes).toEqual([])
  })

  it('폴더 안 파일이 바뀌었다는 감시 알림이 오면 다시 읽는다(다른 경로는 무시)', async () => {
    let notify: (paths: string[]) => void = () => undefined
    const stop = vi.fn()
    const watcher = vi.fn(async (_root: string, onPaths: (paths: string[]) => void) => { notify = onPaths; return stop })
    const view = renderHook(() => useThemeFolder('/v', watcher))
    await vi.waitFor(() => expect(watcher).toHaveBeenCalledWith('/v', expect.any(Function)))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(getUserThemeState().folderThemes).toEqual([])
    files.set('late.iwtheme', serializeThemeFile(forest))
    notify(['/v/notes/a.md'])
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(getUserThemeState().folderThemes).toEqual([])
    notify(['/v/.iwae/themes/late.iwtheme'])
    await vi.waitFor(() => expect(getUserThemeState().folderThemes.map((theme) => theme.name)).toEqual(['숲']))
    files.clear()
    notify(['/v/.iwae/themes/late.iwtheme'])
    await vi.waitFor(() => expect(getUserThemeState().folderThemes).toEqual([]))
    view.unmount()
    expect(stop).toHaveBeenCalled()
  })

  it('내 테마와 이름이 겹치면 폴더 쪽이 「숲 (2)」', async () => {
    saveUserTheme({ ...forest, id: 'ut-own' })
    files.set('forest.iwtheme', serializeThemeFile(forest))
    renderHook(() => useThemeFolder('/v'))
    await vi.waitFor(() => expect(getUserThemeState().folderThemes.map((theme) => theme.name)).toEqual(['숲 (2)']))
  })
})

describe('테마 폴더 열기', () => {
  it('폴더를 만들고, 파일이 있으면 그 파일을, 없으면 폴더를 보여 준다', async () => {
    await openThemeFolder('C:/Vault')
    expect(fsMocks.mkdir).toHaveBeenCalledWith('C:/Vault/.iwae/themes', { recursive: true })
    expect(openerMocks.revealItemInDir).toHaveBeenLastCalledWith('C:\\Vault\\.iwae\\themes')
    files.set('a.iwtheme', '')
    await openThemeFolder('C:/Vault')
    expect(openerMocks.revealItemInDir).toHaveBeenLastCalledWith('C:\\Vault\\.iwae\\themes\\a.iwtheme')
  })
})
