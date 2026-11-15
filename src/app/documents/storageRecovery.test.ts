// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => {
  class VaultFileCorruptError extends Error {}
  return { VaultFileCorruptError, quarantineVaultMetaFile: vi.fn(async () => 'highlights.corrupt-1.json') }
})
vi.mock('../../bridge/vault', () => bridge)

import { createSaveNotifier, loadOrQuarantine } from './storageRecovery'

function collectNotices(): string[] {
  const notices: string[] = []
  window.addEventListener('iwae:action-feedback', (event) => notices.push((event as CustomEvent<string>).detail))
  return notices
}

afterEach(() => vi.clearAllMocks())

describe('loadOrQuarantine', () => {
  it('깨진 파일은 따로 옮기고 한 번 알린 뒤 비어 있는 것으로 시작한다', async () => {
    const notices = collectNotices()
    const result = await loadOrQuarantine({ root: 'C:/v' }, 'highlights.json', '형광펜 기록', [] as string[], async () => { throw new bridge.VaultFileCorruptError('bad') })
    expect(result).toEqual([])
    expect(bridge.quarantineVaultMetaFile).toHaveBeenCalledWith({ root: 'C:/v' }, 'highlights.json')
    expect(notices.filter((text) => text.includes('highlights.corrupt-1.json'))).toHaveLength(1)
  })

  it('읽기 실패(잠김 등)는 옮기지 않고 그대로 던진다', async () => {
    await expect(loadOrQuarantine({ root: 'C:/v' }, 'highlights.json', 'x', [], async () => { throw new Error('EBUSY') })).rejects.toThrow('EBUSY')
    expect(bridge.quarantineVaultMetaFile).not.toHaveBeenCalled()
  })
})

describe('createSaveNotifier', () => {
  it('연달아 실패해도 한 번만 알리고, 성공한 뒤 다시 실패하면 다시 알린다', async () => {
    const notices = collectNotices()
    const notify = createSaveNotifier((error) => `fail ${error}`)
    notify(Promise.reject(new Error('a')))
    notify(Promise.reject(new Error('b')))
    await new Promise((resolve) => setTimeout(resolve, 0))
    notify(Promise.resolve())
    await new Promise((resolve) => setTimeout(resolve, 0))
    notify(Promise.reject(new Error('c')))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(notices.filter((text) => text.startsWith('fail'))).toEqual(['fail a', 'fail c'])
  })
})
