// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listSessionNames, loadSessions, readSessionNamed, writeSessionNamed, writeSessionsMeta } from '../../bridge/vault'
import { useVault } from './useVault'
import { setWindowModeForTest } from '../../core/windowMode'
import type { SessionsMeta } from '../../core/sessionNames'
import type { SessionState } from '../../core/session'
import { CLIENT_EVENTS } from '../workspace/sessionSync'
import { emitPointSignal, REMOTE_PANE_ID, resetPointSignals, subscribePointSignal, type DeliveredSignal } from '../workspace/workspaceSignal'

vi.mock('../../bridge/pdf', () => ({ invalidateDocument: vi.fn(), openPdf: vi.fn(), pageTextIndex: vi.fn(), pickPdfFile: vi.fn() }))
vi.mock('../../bridge/vault', () => ({
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
vi.mock('../../pdf/pdfOcrText', () => ({ recognizePdfPageText: vi.fn() }))
vi.mock('../../bridge/vaultFiles', () => ({
  convertReferenceToCopy: vi.fn(), copyVaultEntryPath: vi.fn(), createVaultFolder: vi.fn(), duplicateVaultEntry: vi.fn(),
  moveVaultEntry: vi.fn(), renameVaultEntry: vi.fn(), trashVaultEntry: vi.fn(),
}))

/** 한 프로세스 안에서 창들이 주고받는 알림 길(Tauri 이벤트 대신) */
const bus = vi.hoisted(() => {
  const handlers = new Map<string, Set<(payload: unknown) => void>>()
  const sent: { event: string; payload: Record<string, unknown> }[] = []
  const transport = {
    emit: (event: string, payload: unknown) => {
      sent.push({ event, payload: payload as Record<string, unknown> })
      const copy = JSON.parse(JSON.stringify(payload)) as unknown
      setTimeout(() => { for (const handler of [...(handlers.get(event) ?? [])]) handler(copy) }, 0)
    },
    listen: (event: string, handler: (payload: unknown) => void) => {
      const set = handlers.get(event) ?? new Set()
      set.add(handler)
      handlers.set(event, set)
      return () => { set.delete(handler) }
    },
  }
  return { transport, sent, handlers, reset: () => { handlers.clear(); sent.length = 0 } }
})
vi.mock('../../bridge/clients', () => ({
  tauriClientTransport: () => bus.transport,
  openClientWindow: vi.fn(),
  hideThisWindow: vi.fn(),
  showAppWindow: vi.fn(),
}))
vi.mock('../../bridge/window', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../bridge/window')>()), currentWindowLabel: () => 'window-9' }))

let disk: Map<string, SessionState>
let meta: SessionsMeta

const baseSession = (overrides: Partial<SessionState> = {}): SessionState => ({
  pdfTabIds: [], noteTabIds: [], activePdfTabId: null, activeNoteTabId: null, sidebarCollapsed: false, sidebarPx: 280, leftFrac: 0.5, ...overrides,
})
const oneScreen = (name: string, paneId: string) => ({
  id: `s-${name}`, name, layout: { kind: 'pane' as const, paneId }, paneState: { [paneId]: { tabIds: [], activeId: null, channel: 'blue' as const } },
})
const sessionWithScreens = (names: readonly string[], prefix: string, active = names[0]!): SessionState => baseSession({
  screens: names.map((name, index) => oneScreen(name, `${prefix}${index}`)),
  activeScreen: `s-${active}`,
  lastScreen: null,
})

const MAIN_PRESENCE = { id: 'main', letter: 'A', role: 'main', session: '논문', screen: 0, hidden: false, joinedAt: 1 }
const settle = (ms = 40) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })
const emitFromMain = (event: string, payload: Record<string, unknown>) => bus.transport.emit(event, { from: 'main', ...payload })
const sentOf = (event: string) => bus.sent.filter((item) => item.event === event)

/** 메인 창 역할을 시늉한다: 「누구 있나」에 답하고, 상태 요청에 지금 파일 내용을 보낸다 */
function fakeMain(state: () => SessionState) {
  bus.transport.listen(CLIENT_EVENTS.who, () => { bus.transport.emit(CLIENT_EVENTS.presence, MAIN_PRESENCE) })
  bus.transport.listen(CLIENT_EVENTS.request, (payload) => {
    const request = payload as { from: string }
    bus.transport.emit(CLIENT_EVENTS.state, { session: '논문', from: 'main', to: request.from, state: state() })
  })
}

beforeEach(() => {
  localStorage.clear()
  bus.reset()
  resetPointSignals()
  setWindowModeForTest({ role: 'extra', docId: null, page: null, zoom: null, vaultRoot: null, session: '논문', screen: 1, client: 'B' })
  disk = new Map([['기본', sessionWithScreens(['읽기'], 'a')], ['논문', sessionWithScreens(['읽기', '비교'], 'b')]])
  meta = { last: '기본', used: { 기본: 100, 논문: 50 } }
  vi.mocked(loadSessions).mockImplementation(async () => ({ name: meta.last ?? '기본', names: [...disk.keys()], meta, raw: disk.get(meta.last ?? '기본') ?? null }))
  vi.mocked(readSessionNamed).mockImplementation(async (_vault, name) => disk.get(name) ?? null)
  vi.mocked(listSessionNames).mockImplementation(async () => [...disk.keys()])
  vi.mocked(writeSessionNamed).mockReset()
  vi.mocked(writeSessionNamed).mockImplementation(async (_vault, name, session) => { disk.set(name, session) })
  vi.mocked(writeSessionsMeta).mockReset()
  vi.mocked(writeSessionsMeta).mockImplementation(async (_vault, next) => { meta = next })
})
afterEach(() => { setWindowModeForTest(null); resetPointSignals() })

/** 붙은 직후의 상태 받기(요청 → 소유자의 답)가 끝날 때까지 */
async function joined() {
  await waitFor(() => expect(sentOf(CLIENT_EVENTS.request)).toHaveLength(1), { timeout: 3000 })
  await settle(120)
}

async function open() {
  const hook = renderHook(() => useVault())
  await waitFor(() => expect(hook.result.current.initializing).toBe(false))
  return hook
}

describe('useVault — 세션에 붙은 앱 창(client)', () => {
  it('붙기로 한 세션과 화면에서 시작하고, 이름은 B 다', async () => {
    const { result } = await open()
    expect(result.current.sessionName).toBe('논문')
    expect(result.current.screensState.screens.map((screen) => screen.name)).toEqual(['읽기', '비교'])
    expect(result.current.screensState.activeScreen).toBe('s-비교')
    expect(result.current.clients.selfLetter).toBe('B')
    expect(result.current.clients.selfId).toBe('window-9')
  })

  it('메인 창이 소유자이면 이 창은 세션 파일을 쓰지 않고, 바꾼 상태를 소유자에게 보낸다', async () => {
    fakeMain(() => disk.get('논문')!)
    const { result } = await open()
    await waitFor(() => expect(result.current.clients.registry.map((client) => client.letter)).toEqual(['A', 'B']))
    await joined()
    expect(result.current.clients.isOwner).toBe(false)
    act(() => result.current.screenOps.rename('s-읽기', '새 이름'))
    await waitFor(() => expect(sentOf(CLIENT_EVENTS.intent)).toHaveLength(1))
    expect(JSON.stringify(sentOf(CLIENT_EVENTS.intent)[0]!.payload.state)).toContain('새 이름')
    await settle(450)
    expect(vi.mocked(writeSessionNamed)).not.toHaveBeenCalled()
  })

  it('보는 화면처럼 창마다 따로인 것은 알리지 않고, 앱 창 목록의 screen 으로만 알린다', async () => {
    fakeMain(() => disk.get('논문')!)
    const { result } = await open()
    await joined()
    act(() => result.current.screenOps.switchTo('s-읽기'))
    await settle(450)
    expect(sentOf(CLIENT_EVENTS.intent)).toHaveLength(0)
    expect(vi.mocked(writeSessionNamed)).not.toHaveBeenCalled()
    await waitFor(() => expect(sentOf(CLIENT_EVENTS.presence).at(-1)!.payload).toMatchObject({ id: 'window-9', screen: 0 }))
  })

  it('소유자가 보낸 상태를 받으면 화면 목록을 따르되 보는 화면은 이 창 것을 지킨다', async () => {
    fakeMain(() => disk.get('논문')!)
    const { result } = await open()
    await joined()
    emitFromMain(CLIENT_EVENTS.state, { session: '논문', to: null, state: sessionWithScreens(['읽기', '비교', '정리'], 'b', '읽기') })
    await waitFor(() => expect(result.current.screensState.screens.map((screen) => screen.name)).toEqual(['읽기', '비교', '정리']))
    expect(result.current.screensState.activeScreen).toBe('s-비교')
    // 받은 상태를 되돌려 보내지 않는다
    await settle(300)
    expect(sentOf(CLIENT_EVENTS.intent)).toHaveLength(0)
  })

  it('소유자가 닫히면(bye) 이 창이 소유자가 되어 세션 파일을 이어서 쓴다', async () => {
    fakeMain(() => disk.get('논문')!)
    const { result } = await open()
    await joined()
    act(() => result.current.screenOps.rename('s-읽기', '이어서'))
    await settle(450)
    expect(vi.mocked(writeSessionNamed)).not.toHaveBeenCalled()
    emitFromMain(CLIENT_EVENTS.bye, { id: 'main' })
    await waitFor(() => expect(result.current.clients.isOwner).toBe(true))
    await waitFor(() => expect(vi.mocked(writeSessionNamed)).toHaveBeenCalledWith(expect.anything(), '논문', expect.objectContaining({ screens: expect.arrayContaining([expect.objectContaining({ name: '이어서' })]) })))
  })

  it('다른 세션으로 바꾸면 그 세션에는 이 창만 붙어 있어 소유자가 되고, 그 파일을 쓴다', async () => {
    fakeMain(() => disk.get('논문')!)
    const { result } = await open()
    await joined()
    await act(async () => { await result.current.sessionOps.switchTo('기본') })
    expect(result.current.sessionName).toBe('기본')
    await waitFor(() => expect(result.current.clients.isOwner).toBe(true))
    act(() => result.current.screenOps.rename(result.current.screensState.activeScreen, '독립'))
    await waitFor(() => expect(vi.mocked(writeSessionNamed)).toHaveBeenCalledWith(expect.anything(), '기본', expect.objectContaining({ screens: [expect.objectContaining({ name: '독립' })] })))
    // 이 창이 떠난 「논문」 에는 영향이 없다
    expect(disk.get('논문')!.screens).toHaveLength(2)
  })

  it('같은 세션에 다른 창이 붙어 있으면 그 세션의 이름 바꾸기 · 지우기는 막고, 목록은 붙은 앱 창 수를 알려 준다', async () => {
    fakeMain(() => disk.get('논문')!)
    const { result } = await open()
    await joined()
    let renamed: { ok: boolean; message: string } | undefined
    let removed: { ok: boolean; message: string } | undefined
    await act(async () => { renamed = await result.current.sessionOps.rename('논문', '다른 이름') })
    await act(async () => { removed = await result.current.sessionOps.remove('논문') })
    expect(renamed?.ok).toBe(false)
    expect(removed?.ok).toBe(false)
    expect(disk.has('논문')).toBe(true)
    let rows: Awaited<ReturnType<typeof result.current.sessionOps.list>> = []
    await act(async () => { rows = await result.current.sessionOps.list() })
    expect(rows.find((row) => row.name === '논문')?.attached).toBe(2)
  })

  it('다른 앱 창이 보낸 가리키기 신호는 이 창의 칸에 전해지고, 다른 세션의 신호는 무시한다. 이 창의 신호는 다른 창으로 간다', async () => {
    fakeMain(() => disk.get('논문')!)
    const { result } = await open()
    await joined()
    const seen: DeliveredSignal[] = []
    subscribePointSignal((signal) => seen.push(signal))
    const signal = { from: 'p1', channel: 'blue', target: { kind: 'memo', memoId: 'm1' }, reason: 'click' }
    emitFromMain(CLIENT_EVENTS.signal, { session: '다른 세션', signal })
    emitFromMain(CLIENT_EVENTS.signal, { session: '논문', signal })
    await waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toMatchObject({ remote: true, from: REMOTE_PANE_ID, channel: 'blue' })
    emitPointSignal({ from: 'p9', channel: 'green', target: { kind: 'memo', memoId: 'm2' }, reason: 'click' })
    const mine = () => sentOf(CLIENT_EVENTS.signal).filter((item) => item.payload.from === 'window-9')
    await waitFor(() => expect(mine()).toHaveLength(1))
    expect(mine()[0]!.payload).toMatchObject({ session: '논문' })
    // 받아서 온 신호를 다시 보내지는 않았다(보낸 것은 이 창이 만든 하나뿐)
    await settle(60)
    expect(mine()).toHaveLength(1)
  })
})
