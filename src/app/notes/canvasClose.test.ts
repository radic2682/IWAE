import { describe, expect, it, vi } from 'vitest'
import { runAfterCanvasFlush } from './canvasClose'

describe('runAfterCanvasFlush', () => {
  it('저장이 끝난 뒤에만 탭이나 Vault를 닫는다', async () => {
    let finishFlush: (() => void) | undefined
    const flush = vi.fn(() => new Promise<void>((resolve) => { finishFlush = resolve }))
    const close = vi.fn()

    const pending = runAfterCanvasFlush('note.canvas', flush, close)
    await Promise.resolve()

    expect(flush).toHaveBeenCalledWith('note.canvas')
    expect(close).not.toHaveBeenCalled()
    finishFlush?.()
    await pending
    expect(close).toHaveBeenCalledOnce()
  })

  it('저장 실패 시 닫기 동작을 실행하지 않고 오류를 전달한다', async () => {
    const close = vi.fn()
    const failure = new Error('disk full')

    await expect(runAfterCanvasFlush(undefined, async () => { throw failure }, close)).rejects.toBe(failure)
    expect(close).not.toHaveBeenCalled()
  })
})
