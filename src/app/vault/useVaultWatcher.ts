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
  // 색인·수정 중 목록이 바뀔 때마다 OS 감시를 다시 만들면 그 사이 알림을 놓친다. 최신 값만 ref 로 읽는다
  const stateRef = useRef({ index, dirtyIds })
  stateRef.current = { index, dirtyIds }

  useEffect(() => {
    if (vaultPath === null || !isDesktop()) return
    let disposed = false
    let unwatch: (() => void) | null = null

    void import('@tauri-apps/plugin-fs').then(async ({ watch }) => {
      const stop = await watch(vaultPath, (event) => {
        const result = classifyVaultEvents(
          [event as VaultWatchEvent],
          stateRef.current.index,
          stateRef.current.dirtyIds,
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
  }, [vaultPath])
}

