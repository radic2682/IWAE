// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVaultWatcher } from './useVaultWatcher'

const watch = vi.hoisted(() => vi.fn())
const unwatch = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/plugin-fs', () => ({ watch }))
vi.mock('../bridge/window', () => ({ isDesktop: () => true }))

const entry = {
  id: 'note-1', kind: 'canvas' as const, storage: 'vault' as const, path: 'Notes/a.canvas', displayName: 'A',
  contentHash: null, size: null, modifiedAt: null, addedAt: '2026-09-27T00:00:00.000Z', missing: false,
}

describe('useVaultWatcher', () => {
  beforeEach(() => {
    watch.mockReset()
    unwatch.mockReset()
    watch.mockResolvedValue(unwatch)
  })

  it('watches recursively, reloads clean files, and unwatches on cleanup', async () => {
    const onReload = vi.fn()
    const onConflict = vi.fn()
    const onReindex = vi.fn()
    const view = renderHook(() => useVaultWatcher({
      vaultPath: 'C:/Vault',
      index: [entry],
      dirtyIds: new Set<string>(),
      onReload,
      onConflict,
      onReindex,
    }))
    await waitFor(() => expect(watch).toHaveBeenCalledOnce())
    expect(watch).toHaveBeenCalledWith('C:/Vault', expect.any(Function), { recursive: true, delayMs: 150 })

    const callback = watch.mock.calls[0]?.[1] as (event: { paths: string[] }) => void
    act(() => callback({ paths: ['C:/Vault/Notes/a.canvas'] }))

    expect(onReload).toHaveBeenCalledWith('note-1')
    expect(onConflict).not.toHaveBeenCalled()
    view.unmount()
    await waitFor(() => expect(unwatch).toHaveBeenCalledOnce())
  })

  it('reports a conflict instead of reloading a dirty file', async () => {
    const onReload = vi.fn()
    const onConflict = vi.fn()
    const view = renderHook(() => useVaultWatcher({
      vaultPath: 'C:/Vault',
      index: [entry],
      dirtyIds: new Set(['note-1']),
      onReload,
      onConflict,
      onReindex: vi.fn(),
    }))
    await waitFor(() => expect(watch).toHaveBeenCalledOnce())

    const callback = watch.mock.calls[0]?.[1] as (event: { paths: string[] }) => void
    act(() => callback({ paths: ['C:/Vault/Notes/a.canvas'] }))

    expect(onConflict).toHaveBeenCalledWith('note-1')
    expect(onReload).not.toHaveBeenCalled()
    view.unmount()
  })
})
