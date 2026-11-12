// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { isDesktop, minimizeWindow, toggleMaximizeWindow, closeWindow, interceptWindowClose } from './window'

const windowMocks = vi.hoisted(() => ({
  destroy: vi.fn(),
  onCloseRequested: vi.fn(),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => windowMocks,
}))

/**
 * 이 파일이 지키는 것은 창 조작 기능이 아니라 실행 경로 세 개다
 * (스펙 §9.1). bridge 가 Tauri 밖에서 조용히 아무 일도 하지 않는 한
 * `npm run dev` 와 `npm test` 가 산다. 이 성질이 깨지면 Tauri 가 없는
 * 곳에서 앱이 화면을 그리기도 전에 터지므로, 못박아 둘 값어치가 있다.
 */

/** 웹뷰에 주입되는 내부 객체를 흉내낸다. 실제 모양은 알 필요가 없다 — 판별은 존재 여부로만 한다 */
function fakeTauriInternals() {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
}

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  windowMocks.destroy.mockReset()
  windowMocks.onCloseRequested.mockReset()
})

describe('isDesktop', () => {
  it('__TAURI_INTERNALS__ 가 없으면 false — 브라우저와 jsdom 이 여기 걸린다', () => {
    expect(isDesktop()).toBe(false)
  })

  it('__TAURI_INTERNALS__ 가 있으면 true', () => {
    fakeTauriInternals()
    expect(isDesktop()).toBe(true)
  })
})

describe('창 조작', () => {
  it('운영체제 종료 요청도 저장 완료 뒤에만 창을 파괴한다', async () => {
    fakeTauriInternals()
    let listener: ((event: { preventDefault(): void }) => Promise<void>) | undefined
    windowMocks.onCloseRequested.mockImplementation(async (next) => {
      listener = next
      return () => undefined
    })
    windowMocks.destroy.mockResolvedValue(undefined)
    let finishFlush: (() => void) | undefined
    const flush = vi.fn(() => new Promise<void>((resolve) => { finishFlush = resolve }))
    const preventDefault = vi.fn()

    await interceptWindowClose(flush, vi.fn())
    const closing = listener?.({ preventDefault })
    await Promise.resolve()

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(windowMocks.destroy).not.toHaveBeenCalled()
    finishFlush?.()
    await closing
    expect(windowMocks.destroy).toHaveBeenCalledOnce()
  })

  it('닫기 전 처리가 「keep」 을 돌려주면 창을 파괴하지 않는다(메인 창을 닫는 대신 숨길 때)', async () => {
    fakeTauriInternals()
    let listener: ((event: { preventDefault(): void }) => Promise<void>) | undefined
    windowMocks.onCloseRequested.mockImplementation(async (next) => {
      listener = next
      return () => undefined
    })
    windowMocks.destroy.mockResolvedValue(undefined)
    const preventDefault = vi.fn()
    await interceptWindowClose(async () => 'keep', vi.fn())
    await listener?.({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(windowMocks.destroy).not.toHaveBeenCalled()
    // 다음 닫기 요청은 평소처럼 파괴한다
    const again = vi.fn()
    await interceptWindowClose(async () => undefined, vi.fn())
    await listener?.({ preventDefault: again })
    expect(windowMocks.destroy).toHaveBeenCalledOnce()
  })

  it('Tauri 밖에서는 던지지도 거부되지도 않고 조용히 지나간다', async () => {
    // 세 함수는 void 를 돌려주고 안에서 Promise 를 띄운다. 그래서 동기
    // 단언만 하면 "터지지 않았다"가 거의 공짜로 통과한다 — 실제 실패는
    // 나중에 unhandled rejection 으로 온다(Tauri 없이 invoke 를 부르면
    // __TAURI_INTERNALS__ 가 없어 TypeError 가 난다). 그것까지 붙잡는다.
    const rejections: unknown[] = []
    const collect = (reason: unknown) => {
      rejections.push(reason)
    }
    process.on('unhandledRejection', collect)
    try {
      expect(() => {
        minimizeWindow()
        toggleMaximizeWindow()
        closeWindow()
      }).not.toThrow()

      // 거부는 이번 턴이 끝나야 "처리되지 않음"으로 판정된다.
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      process.off('unhandledRejection', collect)
    }
    expect(rejections).toEqual([])
  })
})
