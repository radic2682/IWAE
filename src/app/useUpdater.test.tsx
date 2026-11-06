// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UpdatePackage, UpdaterClient } from '../bridge/updater'
import { memoryUpdatePreferencesStorage } from '../core/updatePreferences'
import { useUpdater } from './useUpdater'

function availableUpdate(overrides: Partial<UpdatePackage> = {}): UpdatePackage {
  return {
    currentVersion: '0.1.2',
    version: '0.1.3',
    body: 'Release notes',
    date: '2026-10-01',
    download: vi.fn(async (onProgress) => {
      onProgress({ downloaded: 25, total: 100 })
      onProgress({ downloaded: 100, total: 100 })
    }),
    installAndRelaunch: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('useUpdater', () => {
  it('업데이트를 확인하고 다운로드 진행률을 표시한 뒤 저장 완료 상태가 된다', async () => {
    const update = availableUpdate()
    const client: UpdaterClient = { check: vi.fn(async () => update) }
    const { result } = renderHook(() => useUpdater({
      client,
      storage: memoryUpdatePreferencesStorage(),
      autoStart: false,
      flushBeforeInstall: async () => undefined,
    }))

    await act(() => result.current.checkNow())
    expect(result.current.status).toBe('available')
    await act(() => result.current.download())
    expect(result.current.status).toBe('ready')
    expect(result.current.progress).toEqual({ downloaded: 100, total: 100 })
  })

  it('해당 버전만 숨기고 다음 버전은 다시 알린다', async () => {
    const storage = memoryUpdatePreferencesStorage()
    const client: UpdaterClient = { check: vi.fn(async () => availableUpdate()) }
    const { result } = renderHook(() => useUpdater({
      client,
      storage,
      autoStart: false,
      flushBeforeInstall: async () => undefined,
    }))

    await act(() => result.current.checkNow())
    act(() => result.current.suppressCurrentVersion())
    expect(result.current.status).toBe('idle')

    vi.mocked(client.check).mockResolvedValue(availableUpdate({ version: '0.1.4' }))
    await act(() => result.current.checkNow())
    expect(result.current.update?.version).toBe('0.1.4')
    expect(result.current.status).toBe('available')
  })

  it('설치 전 저장을 끝내고 실패하면 재시도 가능한 상태를 유지한다', async () => {
    const flush = vi.fn(async () => undefined)
    const install = vi.fn().mockRejectedValueOnce(new Error('install failed')).mockResolvedValue(undefined)
    const client: UpdaterClient = { check: vi.fn(async () => availableUpdate({ installAndRelaunch: install })) }
    const { result } = renderHook(() => useUpdater({
      client,
      storage: memoryUpdatePreferencesStorage(),
      autoStart: false,
      flushBeforeInstall: flush,
    }))

    await act(() => result.current.checkNow())
    await act(() => result.current.download())
    await act(() => result.current.install())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(flush).toHaveBeenCalledBefore(install)
    expect(result.current.error).toContain('install failed')
  })
})
