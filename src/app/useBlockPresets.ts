import { useCallback, useEffect, useRef, useState } from 'react'
import { readBlockPresets, writeBlockPresets, type VaultHandle } from '../bridge/vault'
import {
  createUserBlockPreset,
  parseUserBlockPresets,
  userBlockPresetFile,
  type UserBlockPreset,
} from '../core/blockPresets'
import type { CanvasBlockData } from '../core/canvasDocument'

export interface BlockPresetStorage {
  load(): Promise<readonly UserBlockPreset[]>
  save(presets: readonly UserBlockPreset[]): Promise<void>
}

export function createBrowserBlockPresetStorage(
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
): BlockPresetStorage {
  const key = 'iwae:block-presets:v1'
  return {
    async load() {
      const serialized = storage.getItem(key)
      return serialized === null ? [] : parseUserBlockPresets(JSON.parse(serialized) as unknown)
    },
    async save(presets) {
      storage.setItem(key, JSON.stringify(userBlockPresetFile(presets)))
    },
  }
}

export function createVaultBlockPresetStorage(vault: VaultHandle): BlockPresetStorage {
  return {
    load: () => readBlockPresets(vault),
    save: (presets) => writeBlockPresets(vault, presets),
  }
}

export function useBlockPresets(
  storage: BlockPresetStorage,
  createId: () => string = () => `preset-${crypto.randomUUID()}`,
) {
  const [presets, setPresets] = useState<readonly UserBlockPreset[]>([])
  const [ready, setReady] = useState(false)
  const presetsRef = useRef<readonly UserBlockPreset[]>([])

  useEffect(() => {
    let alive = true
    setReady(false)
    presetsRef.current = []
    setPresets([])
    void storage.load().then((loaded) => {
      if (!alive) return
      const normalized = parseUserBlockPresets(userBlockPresetFile(loaded))
      presetsRef.current = normalized
      setPresets(normalized)
      setReady(true)
    }).catch(() => {
      if (alive) setReady(true)
    })
    return () => { alive = false }
  }, [storage])

  const add = useCallback((block: CanvasBlockData) => {
    const next = [...presetsRef.current, createUserBlockPreset(createId(), block, presetsRef.current)]
    presetsRef.current = next
    setPresets(next)
    void storage.save(next).catch(() => undefined)
  }, [createId, storage])

  return { presets, ready, add }
}
