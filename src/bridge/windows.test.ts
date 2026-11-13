import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeSecondaryWindows, onCloseNow, onReattach, openAppWindow, sendReattach } from './windows'
import * as windowBridge from './window'

const invoke = vi.hoisted(() => vi.fn())
const emitTo = vi.hoisted(() => vi.fn(async () => undefined))
const listen = vi.hoisted(() => vi.fn(async () => () => undefined))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ emitTo, listen }))

afterEach(() => {
  vi.restoreAllMocks()
  invoke.mockReset()
  emitTo.mockClear()
  listen.mockClear()
})

describe('window bridge', () => {
  it('does nothing outside the desktop app', async () => {
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(false)
    await expect(openAppWindow('extra', 'role=extra')).resolves.toBeNull()
    await closeSecondaryWindows()
    await sendReattach({ docId: 'a', page: 1, zoom: null })
    expect(invoke).not.toHaveBeenCalled()
    expect(emitTo).not.toHaveBeenCalled()
  })

  it('opens a detached window by document so the same document reuses its window', async () => {
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(true)
    invoke.mockResolvedValue({ label: 'detached-a', existing: false })
    await expect(openAppWindow('detached', 'role=detached&doc=a', 'a')).resolves.toEqual({ label: 'detached-a', existing: false })
    expect(invoke).toHaveBeenCalledWith('open_app_window', { kind: 'detached', docId: 'a', query: 'role=detached&doc=a' })
  })

  it('sends the tab back to the main window only', async () => {
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(true)
    await sendReattach({ docId: 'a', page: 4, zoom: { fit: null, actual: 120 } })
    expect(emitTo).toHaveBeenCalledWith('main', 'iwae:reattach', expect.objectContaining({ docId: 'a', page: 4, source: 'main' }))
  })

  it('listens for reattach and close-now events', async () => {
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(true)
    await onReattach(() => undefined)
    await onCloseNow(() => undefined)
    expect(listen).toHaveBeenCalledWith('iwae:reattach', expect.any(Function))
    expect(listen).toHaveBeenCalledWith('iwae:close-now', expect.any(Function))
  })

  it('asks the backend to close the other windows before the main one closes', async () => {
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(true)
    invoke.mockResolvedValue(2)
    await expect(closeSecondaryWindows()).resolves.toBe(2)
    expect(invoke).toHaveBeenCalledWith('close_secondary_windows')
  })
})

describe('requestTabAttach', () => {
  const request = { tabId: 'n1', screenId: 's2', pane: 'a', x: 10 }

  it('resolves true only when the receiving window acks ok', async () => {
    const { requestTabAttach } = await import('./windows')
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(true)
    let handler: (event: { payload: unknown }) => void = () => undefined
    listen.mockImplementation((async (_name: string, cb: (event: { payload: unknown }) => void) => { handler = cb; return () => undefined }) as never)
    emitTo.mockImplementation(async () => { handler({ payload: { tabId: 'other', screenId: 's2', ok: true } }); handler({ payload: { tabId: 'n1', screenId: 's2', ok: true } }) })
    await expect(requestTabAttach('main', request)).resolves.toBe(true)
    emitTo.mockImplementation(async () => { handler({ payload: { tabId: 'n1', screenId: 's2', ok: false } }) })
    await expect(requestTabAttach('main', request)).resolves.toBe(false)
  })

  it('times out to false when nobody answers, so the torn window is kept', async () => {
    const { requestTabAttach } = await import('./windows')
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(true)
    listen.mockImplementation((async () => () => undefined) as never)
    emitTo.mockImplementation(async () => undefined)
    await expect(requestTabAttach('main', request, 20)).resolves.toBe(false)
  })
})
