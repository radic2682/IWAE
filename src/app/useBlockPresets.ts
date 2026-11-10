import { useCallback, useEffect, useRef, useState } from 'react'
import { blockPresetsCodec, readBlockPresets, subscribeVaultFile, writeBlockPresets, type VaultHandle } from '../bridge/vault'
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
  subscribe?(onRemote: (rebase: (local: readonly UserBlockPreset[]) => readonly UserBlockPreset[]) => void): () => void
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
    subscribe: (onRemote) => subscribeVaultFile(vault, 'block-presets.json', blockPresetsCodec, onRemote),
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

  useEffect(() => storage.subscribe?.((rebase) => {
    const next = rebase(presetsRef.current)
    if (next === presetsRef.current) return
    presetsRef.current = next
    setPresets(next)
  }), [storage])

  const add = useCallback((block: CanvasBlockData) => {
    const next = [...presetsRef.current, createUserBlockPreset(createId(), block, presetsRef.current)]
    presetsRef.current = next
    setPresets(next)
    void storage.save(next).catch(() => undefined)
  }, [createId, storage])

  return { presets, ready, add }
}
