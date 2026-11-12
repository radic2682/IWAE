import { afterEach, describe, expect, it, vi } from 'vitest'
import { hideThisWindow, openClientWindow, showAppWindow, tauriClientTransport } from './clients'
import * as windowBridge from './window'
import { parseWindowMode } from '../core/windowMode'

const invoke = vi.hoisted(() => vi.fn())
const emit = vi.hoisted(() => vi.fn(async () => undefined))
const listen = vi.hoisted(() => vi.fn(async (_event: string, _handler: (message: { payload: unknown }) => void) => () => undefined))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ emit, listen, emitTo: vi.fn() }))

afterEach(() => {
  vi.restoreAllMocks()
  invoke.mockReset()
  emit.mockClear()
  listen.mockClear()
})

describe('앱 창 사이 알림 길', () => {
  it('데스크톱이 아니면(브라우저 · 시험) 길도 창 조작도 없다', async () => {
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(false)
    expect(tauriClientTransport()).toBeNull()
    await expect(openClientWindow({ session: '기본', screen: 0, letter: 'B', vaultRoot: null })).resolves.toBeNull()
    await hideThisWindow()
    await showAppWindow('main')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('emit 은 모든 창에 보내고, listen 은 받은 알림의 내용(payload)만 넘긴다', async () => {
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(true)
    const transport = tauriClientTransport()!
    await transport.emit('iwae:client-state', { a: 1 })
    expect(emit).toHaveBeenCalledWith('iwae:client-state', { a: 1 })
    const handler = vi.fn()
    await transport.listen('iwae:client-signal', handler)
    expect(listen).toHaveBeenCalledWith('iwae:client-signal', expect.any(Function))
    listen.mock.calls[0]![1]({ payload: { session: '기본' } })
    expect(handler).toHaveBeenCalledWith({ session: '기본' })
  })

  it('새 앱 창은 세션 · 화면 · 이름을 주소로 받아 열린다(Rust open_app_window, kind extra)', async () => {
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(true)
    invoke.mockResolvedValue({ label: 'window-1', existing: false })
    await expect(openClientWindow({ session: '논문 3장', screen: 1, letter: 'B', vaultRoot: 'D:\\Notes' })).resolves.toEqual({ label: 'window-1' })
    const [command, args] = invoke.mock.calls[0]! as [string, { kind: string; query: string }]
    expect(command).toBe('open_app_window')
    expect(args.kind).toBe('extra')
    expect(parseWindowMode(`?${args.query}`)).toMatchObject({ role: 'extra', session: '논문 3장', screen: 1, client: 'B', vaultRoot: 'D:\\Notes' })
  })

  it('다른 세션에 붙을 때는 화면 번호를 정하지 않는다', async () => {
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(true)
    invoke.mockResolvedValue({ label: 'window-2', existing: false })
    await openClientWindow({ session: '발표', screen: null, letter: 'C', vaultRoot: null })
    const args = invoke.mock.calls[0]![1] as { query: string }
    expect(args.query).not.toContain('screen=')
    expect(parseWindowMode(`?${args.query}`)).toMatchObject({ session: '발표', screen: null, client: 'C' })
  })

  it('창 숨기기 · 보이기는 Rust 명령을 부른다', async () => {
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(true)
    await hideThisWindow()
    await showAppWindow('main')
    expect(invoke).toHaveBeenCalledWith('hide_this_window')
    expect(invoke).toHaveBeenCalledWith('show_app_window', { label: 'main' })
  })
})
