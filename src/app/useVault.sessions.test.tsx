// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listSessionNames, loadSessions, readSessionNamed, removeSessionNamed, trashSessionNamed, writeSessionNamed, writeSessionsMeta } from '../bridge/vault'
import { useVault } from './useVault'
import { setWindowModeForTest } from '../core/windowMode'
import type { SessionsMeta } from '../core/sessionNames'
import type { SessionState } from '../core/session'
import { parseSession } from '../core/session'

vi.mock('../bridge/pdf', () => ({ invalidateDocument: vi.fn(), openPdf: vi.fn(), pageTextIndex: vi.fn(), pickPdfFile: vi.fn() }))
vi.mock('../bridge/vault', () => ({
  addToLibrary: vi.fn(),
  registerUnlistedVaultPdfs: vi.fn().mockResolvedValue([]),
  updateLibraryPageCount: vi.fn().mockResolvedValue(null),
  attachPdfToLibrary: vi.fn(),
  attachMarkdownReference: vi.fn(),
  createNote: vi.fn(),
  createMarkdownFile: vi.fn(),
  listVaultTree: vi.fn().mockResolvedValue([]),
  openVault: vi.fn().mockResolvedValue({ root: 'C:/Vault' }),
  readLibrary: vi.fn().mockResolvedValue([]),
  readMarkdown: vi.fn(),
  readSession: vi.fn(),
  loadSessions: vi.fn(),
  listSessionNames: vi.fn(),
  readSessionNamed: vi.fn(),
  writeSessionNamed: vi.fn(),
  writeSessionsMeta: vi.fn(),
  removeSessionNamed: vi.fn(),
  trashSessionNamed: vi.fn(),
  readVaultTreeOrder: vi.fn().mockResolvedValue({}),
  readVaultIndex: vi.fn().mockResolvedValue({ version: 1, entries: [] }),
  readVaultMetadata: vi.fn().mockResolvedValue({ version: 1, markdownTheme: 'light', fileActivity: {}, itemIcons: {} }),
  readVaultSearchTextCache: vi.fn().mockResolvedValue({ version: 2, documents: {} }),
  recentVaults: vi.fn().mockResolvedValue(['C:/Vault']),
  rememberVault: vi.fn(),
  relinkDocument: vi.fn(),
  writeVaultTreeOrder: vi.fn(),
  writeVaultIndex: vi.fn().mockResolvedValue(undefined),
  writeVaultMetadata: vi.fn().mockResolvedValue(undefined),
  writeVaultSearchTextCache: vi.fn().mockResolvedValue(undefined),
  subscribeVaultFile: vi.fn(() => () => undefined),
}))
vi.mock('./useVaultWatcher', () => ({ useVaultWatcher: vi.fn() }))
vi.mock('../pdf/pdfOcrText', () => ({ recognizePdfPageText: vi.fn() }))
vi.mock('../bridge/vaultFiles', () => ({
  convertReferenceToCopy: vi.fn(), copyVaultEntryPath: vi.fn(), createVaultFolder: vi.fn(), duplicateVaultEntry: vi.fn(),
  moveVaultEntry: vi.fn(), renameVaultEntry: vi.fn(), trashVaultEntry: vi.fn(),
}))

/** 메모리 위의 세션 폴더 */
let disk: Map<string, SessionState>
let meta: SessionsMeta

const baseSession = (overrides: Partial<SessionState> = {}): SessionState => ({
  pdfTabIds: [], noteTabIds: [], activePdfTabId: null, activeNoteTabId: null, sidebarCollapsed: false, sidebarPx: 280, leftFrac: 0.5, ...overrides,
})
const oneScreen = (name: string, paneId: string) => ({
  id: `s-${name}`, name, layout: { kind: 'pane' as const, paneId }, paneState: { [paneId]: { tabIds: [], activeId: null, channel: 'blue' as const } },
})
const sessionWithScreens = (names: readonly string[], prefix: string): SessionState => baseSession({
  screens: names.map((name, index) => oneScreen(name, `${prefix}${index}`)),
  activeScreen: `s-${names[0]!}`,
  lastScreen: null,
})

beforeEach(() => {
  localStorage.clear()
  setWindowModeForTest(null)
  disk = new Map([['기본', sessionWithScreens(['읽기'], 'a')], ['논문', sessionWithScreens(['읽기', '비교'], 'b')]])
  meta = { last: '기본', used: { 기본: 100, 논문: 50 } }
  vi.mocked(loadSessions).mockImplementation(async () => ({ name: meta.last ?? '기본', names: [...disk.keys()], meta, raw: disk.get(meta.last ?? '기본') ?? null }))
  vi.mocked(readSessionNamed).mockImplementation(async (_vault, name) => disk.get(name) ?? null)
  vi.mocked(listSessionNames).mockImplementation(async () => [...disk.keys()])
  vi.mocked(writeSessionNamed).mockReset()
  vi.mocked(writeSessionNamed).mockImplementation(async (_vault, name, session) => { disk.set(name, session) })
  vi.mocked(removeSessionNamed).mockReset()
  vi.mocked(removeSessionNamed).mockImplementation(async (_vault, name) => { disk.delete(name) })
  vi.mocked(trashSessionNamed).mockReset()
  vi.mocked(trashSessionNamed).mockImplementation(async (_vault, name) => { disk.delete(name) })
  vi.mocked(writeSessionsMeta).mockReset()
  vi.mocked(writeSessionsMeta).mockImplementation(async (_vault, next) => { meta = next })
})

async function open() {
  const hook = renderHook(() => useVault())
  await waitFor(() => expect(hook.result.current.initializing).toBe(false))
  return hook
}

describe('useVault — 이름 붙은 세션', () => {
  it('마지막으로 쓴 세션으로 시작하고, 그 이름과 목록을 갖는다', async () => {
    const { result } = await open()
    expect(result.current.sessionName).toBe('기본')
    expect(result.current.sessionNames).toEqual(['기본', '논문'])
    expect(result.current.screensState.screens.map((screen) => screen.name)).toEqual(['읽기'])
  })

  it('자동 저장은 지금 세션의 이름 파일에 쓴다', async () => {
    const { result } = await open()
    act(() => result.current.screenOps.rename(result.current.screensState.activeScreen, '새 이름'))
    await waitFor(() => expect(vi.mocked(writeSessionNamed)).toHaveBeenCalledWith(expect.anything(), '기본', expect.objectContaining({ screens: [expect.objectContaining({ name: '새 이름' })] })))
  })

  it('세션을 바꾸면 지금 것을 먼저 저장하고 그 세션의 화면으로 모두 갈아 낀다', async () => {
    const { result } = await open()
    act(() => result.current.screenOps.rename(result.current.screensState.activeScreen, '고친 이름'))
    const epoch = result.current.sessionEpoch
    let outcome: { ok: boolean; message: string } | undefined
    await act(async () => { outcome = await result.current.sessionOps.switchTo('논문') })
    expect(outcome?.ok).toBe(true)
    // 떠나기 전 저장: 「기본」에 고친 이름이 들어 있다
    expect(parseSession(disk.get('기본')).screens?.[0]?.name).toBe('고친 이름')
    expect(result.current.sessionName).toBe('논문')
    expect(result.current.screensState.screens.map((screen) => screen.name)).toEqual(['읽기', '비교'])
    expect(result.current.sessionEpoch).toBe(epoch + 1)
    // 마지막으로 쓴 세션이 바뀐다
    expect(meta.last).toBe('논문')
    // 바꾼 뒤 자동 저장은 새 이름으로 간다
    act(() => result.current.screenOps.rename(result.current.screensState.activeScreen, '논문 읽기'))
    await waitFor(() => expect(parseSession(disk.get('논문')).screens?.[0]?.name).toBe('논문 읽기'))
    expect(parseSession(disk.get('기본')).screens?.[0]?.name).toBe('고친 이름')
  })

  it('없는 세션으로 바꾸면 알리고 아무것도 바꾸지 않는다', async () => {
    const { result } = await open()
    let outcome: { ok: boolean; message: string } | undefined
    await act(async () => { outcome = await result.current.sessionOps.switchTo('없음') })
    expect(outcome?.ok).toBe(false)
    expect(result.current.sessionName).toBe('기본')
  })

  it('새 세션은 「빈 화면」 하나로 만들어 그 세션으로 간다', async () => {
    const { result } = await open()
    await act(async () => { await result.current.sessionOps.create('발표') })
    expect(result.current.sessionName).toBe('발표')
    expect(result.current.sessionNames).toContain('발표')
    expect(result.current.screensState.screens.map((screen) => screen.name)).toEqual(['빈 화면'])
    expect(disk.has('발표')).toBe(true)
  })

  it('새 세션의 이름이 없으면 겹치지 않는 이름을 붙이고, 겹치는 이름은 막는다', async () => {
    const { result } = await open()
    await act(async () => { await result.current.sessionOps.create() })
    expect(result.current.sessionName).toBe('세션')
    let outcome: { ok: boolean; message: string } | undefined
    await act(async () => { outcome = await result.current.sessionOps.create('논문') })
    expect(outcome?.ok).toBe(false)
    expect(result.current.sessionName).toBe('세션')
  })

  it('다른 이름으로 저장하면 같은 상태의 새 세션이 생기고 그 세션으로 이어 간다', async () => {
    const { result } = await open()
    await act(async () => { await result.current.sessionOps.fork('기본 복사') })
    expect(result.current.sessionName).toBe('기본 복사')
    expect(parseSession(disk.get('기본 복사')).screens?.[0]?.name).toBe('읽기')
    expect(disk.has('기본')).toBe(true)
  })

  it('이름 바꾸기: 지금 세션도 다른 세션도 바꾸고, 겹치는 이름은 막는다', async () => {
    const { result } = await open()
    let outcome: { ok: boolean; message: string } | undefined
    await act(async () => { outcome = await result.current.sessionOps.rename('기본', '논문') })
    expect(outcome?.ok).toBe(false)
    await act(async () => { outcome = await result.current.sessionOps.rename('기본', '  첫 세션  ') })
    expect(outcome?.ok).toBe(true)
    expect(result.current.sessionName).toBe('첫 세션')
    expect(disk.has('기본')).toBe(false)
    expect(disk.has('첫 세션')).toBe(true)
    await act(async () => { await result.current.sessionOps.rename('논문', '연구') })
    expect(result.current.sessionNames).toEqual(['첫 세션', '연구'])
    expect(disk.has('연구')).toBe(true)
    expect(meta.used['연구']).toBe(50)
  })

  it('경로 구분자가 든 이름은 만들기·이름 바꾸기 모두 막는다', async () => {
    const { result } = await open()
    let outcome: { ok: boolean; message: string } | undefined
    await act(async () => { outcome = await result.current.sessionOps.create('a/b') })
    expect(outcome?.ok).toBe(false)
    await act(async () => { outcome = await result.current.sessionOps.rename('논문', '..\\x') })
    expect(outcome?.ok).toBe(false)
  })

  it('지우기: 다른 세션은 휴지통으로, 지금 세션이면 가장 최근에 쓴 다른 세션으로 옮긴 뒤 지운다', async () => {
    const { result } = await open()
    await act(async () => { await result.current.sessionOps.create('발표') })
    await act(async () => { await result.current.sessionOps.remove('논문') })
    expect(vi.mocked(trashSessionNamed)).toHaveBeenCalledWith(expect.anything(), '논문')
    expect(result.current.sessionNames).not.toContain('논문')
    await act(async () => { await result.current.sessionOps.remove('발표') })
    expect(result.current.sessionName).toBe('기본')
    expect(result.current.sessionNames).toEqual(['기본'])
  })

  it('마지막 세션은 지우지 않는다', async () => {
    const { result } = await open()
    await act(async () => { await result.current.sessionOps.remove('논문') })
    let outcome: { ok: boolean; message: string } | undefined
    await act(async () => { outcome = await result.current.sessionOps.remove('기본') })
    expect(outcome?.ok).toBe(false)
    expect(result.current.sessionNames).toEqual(['기본'])
    expect(disk.has('기본')).toBe(true)
  })

  it('목록은 화면 수와 마지막으로 쓴 때를 담고 지금 세션이 맨 앞이다', async () => {
    const { result } = await open()
    let rows: Awaited<ReturnType<typeof result.current.sessionOps.list>> = []
    await act(async () => { rows = await result.current.sessionOps.list() })
    expect(rows.map((row) => [row.name, row.screenCount, row.lastUsedAt])).toEqual([['기본', 1, 100], ['논문', 2, 50]])
  })

  it('메인 창이 아니면 세션을 바꾸지 않는다', async () => {
    setWindowModeForTest({ role: 'extra', docId: null, page: null, zoom: null, vaultRoot: null })
    const { result } = await open()
    let outcome: { ok: boolean; message: string } | undefined
    await act(async () => { outcome = await result.current.sessionOps.switchTo('논문') })
    expect(outcome?.ok).toBe(false)
    expect(result.current.sessionName).toBe('기본')
  })

  it('세션 저장(saveNow)은 지금 상태를 바로 쓴다', async () => {
    const { result } = await open()
    vi.mocked(writeSessionNamed).mockClear()
    await act(async () => { await result.current.sessionOps.saveNow() })
    expect(vi.mocked(writeSessionNamed)).toHaveBeenCalledWith(expect.anything(), '기본', expect.anything())
  })
})

describe('useVault — 떠 있는 칸 복원과 열기', () => {
  const withFloat = (): SessionState => baseSession({
    screens: [{
      id: 's-읽기', name: '읽기',
      layout: { kind: 'split' as const, id: 'sp', dir: 'h' as const, ratio: 0.5, a: { kind: 'pane' as const, paneId: 'pa' }, b: { kind: 'pane' as const, paneId: 'pb' } },
      paneState: { pa: { tabIds: [], activeId: null, channel: 'blue' as const }, pb: { tabIds: [], activeId: null, channel: 'green' as const }, pf: { tabIds: ['translator:pf'], activeId: 'translator:pf', channel: 'orange' as const } },
      floats: [{ paneId: 'pf', anchor: { kind: 'pane' as const, paneId: 'pb' }, x: 0.5, y: 0.1, w: 340, h: 380, collapsed: true }],
      floatsHidden: true,
    }],
    activeScreen: 's-읽기',
    lastScreen: null,
  })

  it('저장된 떠 있는 칸을 칸 상태(번역기 탭 · 색)와 함께 되살린다', async () => {
    disk.set('기본', withFloat())
    const { result } = await open()
    const screen = result.current.screensState.screens[0]!
    expect(screen.floats).toEqual([{ paneId: 'pf', anchor: { kind: 'pane', paneId: 'pb' }, x: 0.5, y: 0.1, w: 340, h: 380, collapsed: true }])
    expect(screen.floatsHidden).toBe(true)
    expect(screen.panes.pf!.tabs).toEqual([{ id: 'translator:pf', title: '번역기', kind: 'translator' }])
    expect(screen.channels.pf).toBe('orange')
  })

  it('떠 있는 칸에도 탭을 연다(openInPane): 나누기 트리에 없는 칸 id 도 열 곳이다', async () => {
    disk.set('기본', withFloat())
    const { result } = await open()
    act(() => result.current.openInPane({ id: 'n1', title: '노트', kind: 'memoNote' }, 'pf'))
    expect(result.current.screensState.screens[0]!.panes.pf!.tabs.map((tab) => tab.id)).toEqual(['translator:pf', 'n1'])
  })

  it('다시 저장해도 떠 있는 칸이 그대로 나간다', async () => {
    disk.set('기본', withFloat())
    const { result } = await open()
    vi.mocked(writeSessionNamed).mockClear()
    await act(async () => { await result.current.sessionOps.saveNow() })
    const saved = vi.mocked(writeSessionNamed).mock.calls.at(-1)![2]
    expect(saved.screens?.[0]?.floats?.[0]).toMatchObject({ paneId: 'pf', collapsed: true })
    expect(saved.screens?.[0]?.paneState.pf).toEqual({ tabIds: ['translator:pf'], activeId: 'translator:pf', channel: 'orange' })
  })
})
