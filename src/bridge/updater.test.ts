import { describe, expect, it, vi } from 'vitest'
import { createUpdaterClient, type NativeUpdate } from './updater'

describe('updater bridge', () => {
  it('다운로드 바이트와 설치를 동일한 업데이트 객체에 유지한다', async () => {
    const events: number[] = []
    const native: NativeUpdate = {
      currentVersion: '0.1.2',
      version: '0.1.3',
      body: 'Changes',
      date: '2026-10-01',
      download: vi.fn(async (onEvent) => {
        onEvent?.({ event: 'Started', data: { contentLength: 100 } })
        onEvent?.({ event: 'Progress', data: { chunkLength: 40 } })
        onEvent?.({ event: 'Finished' })
      }),
      install: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    }
    const relaunch = vi.fn(async () => undefined)
    const client = createUpdaterClient({ check: async () => native, relaunch })
    const update = await client.check()

    await update?.download((progress) => events.push(progress.downloaded))
    await update?.installAndRelaunch()

    expect(events).toEqual([0, 40, 100])
    expect(native.install).toHaveBeenCalledOnce()
    expect(relaunch).toHaveBeenCalledOnce()
  })
})
