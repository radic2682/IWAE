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
