// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listenForDocumentDrop } from './fileDrop'

const webviewMocks = vi.hoisted(() => ({
  onDragDropEvent: vi.fn(),
}))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => webviewMocks,
}))

function fakeTauriInternals() {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
}

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  webviewMocks.onDragDropEvent.mockReset()
})

describe('listenForDocumentDrop', () => {
  it('returns a no-op listener outside Tauri', async () => {
    const listener = vi.fn()

    const unlisten = await listenForDocumentDrop(listener)
    unlisten()

    expect(webviewMocks.onDragDropEvent).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })

  it('forwards only native drop paths and returns the Tauri unlisten callback', async () => {
    fakeTauriInternals()
    const nativeUnlisten = vi.fn()
    let handler: ((event: { payload: Record<string, unknown> }) => void) | undefined
    webviewMocks.onDragDropEvent.mockImplementation(async (next) => {
      handler = next
      return nativeUnlisten
    })
    const listener = vi.fn()

    const unlisten = await listenForDocumentDrop(listener)
    handler?.({ payload: { type: 'enter', paths: ['C:\\Docs\\ignored.pdf'] } })
    handler?.({ payload: { type: 'over' } })
    handler?.({ payload: { type: 'leave' } })
    handler?.({ payload: { type: 'drop', paths: ['C:\\Docs\\kept.pdf'] } })
    unlisten()

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(['C:\\Docs\\kept.pdf'], undefined)
    expect(nativeUnlisten).toHaveBeenCalledOnce()
  })

  it('reports native drag activity without exposing Tauri event objects', async () => {
    fakeTauriInternals()
    let handler: ((event: { payload: Record<string, unknown> }) => void) | undefined
    webviewMocks.onDragDropEvent.mockImplementation(async (next) => {
      handler = next
      return vi.fn()
    })
    const onActiveChange = vi.fn()

    await listenForDocumentDrop(vi.fn(), onActiveChange)
    handler?.({ payload: { type: 'enter', paths: ['C:\\Docs\\image.png'] } })
    handler?.({ payload: { type: 'enter', paths: ['C:\\Docs\\kept.pdf'] } })
    handler?.({ payload: { type: 'over' } })
    handler?.({ payload: { type: 'leave' } })

    // 받을 수 있는 파일을 끄는 동안(over)은 계속 자리를 알려 준다
    expect(onActiveChange.mock.calls).toEqual([[false, undefined], [true, undefined], [true, undefined], [false]])
  })

  it('놓은 자리를 CSS 좌표(물리 픽셀 ÷ 화면 배율)로 준다', async () => {
    fakeTauriInternals()
    Object.defineProperty(window, 'devicePixelRatio', { value: 1.25, configurable: true })
    let handler: ((event: { payload: Record<string, unknown> }) => void) | undefined
    webviewMocks.onDragDropEvent.mockImplementation(async (next) => {
      handler = next
      return vi.fn()
    })
    const listener = vi.fn()
    await listenForDocumentDrop(listener)
    handler?.({ payload: { type: 'drop', paths: ['C:/a.pdf'], position: { x: 500, y: 250 } } })
    expect(listener).toHaveBeenCalledWith(['C:/a.pdf'], { x: 400, y: 200 })
  })
})
