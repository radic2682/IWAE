import { useEffect, useRef } from 'react'
import { isDesktop } from '../../bridge/window'
import type { VaultIndexEntry } from '../../core/vaultIndex'
import { classifyVaultEvents, type VaultWatchEvent } from '../../core/vaultWatch'

interface UseVaultWatcherOptions {
  vaultPath: string | null
  index: readonly VaultIndexEntry[]
  dirtyIds: ReadonlySet<string>
  onReload(id: string): void
  onConflict(id: string): void
  onReindex(): void
}

export function useVaultWatcher({
  vaultPath,
  index,
  dirtyIds,
  onReload,
  onConflict,
  onReindex,
}: UseVaultWatcherOptions): void {
  const callbacksRef = useRef({ onReload, onConflict, onReindex })
  callbacksRef.current = { onReload, onConflict, onReindex }

  useEffect(() => {
    if (vaultPath === null || !isDesktop()) return
    let disposed = false
    let unwatch: (() => void) | null = null

    void import('@tauri-apps/plugin-fs').then(async ({ watch }) => {
      const stop = await watch(vaultPath, (event) => {
        const result = classifyVaultEvents(
          [event as VaultWatchEvent],
          index,
          dirtyIds,
          vaultPath,
        )
        for (const id of result.reloadIds) callbacksRef.current.onReload(id)
        for (const id of result.conflictIds) callbacksRef.current.onConflict(id)
        if (result.shouldReindex) callbacksRef.current.onReindex()
      }, { recursive: true, delayMs: 150 })
      if (disposed) stop()
      else unwatch = stop
    })

    return () => {
      disposed = true
      unwatch?.()
    }
  }, [dirtyIds, index, vaultPath])
}

