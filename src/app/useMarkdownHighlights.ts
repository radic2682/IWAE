import { useCallback, useEffect, useRef, useState } from 'react'
import { recordUndo } from './undoStack'
import { markdownHighlightsCodec, readMarkdownHighlights, subscribeVaultFile, writeMarkdownHighlights, type VaultHandle } from '../bridge/vault'
import {
  markdownHighlightFile,
  parsePersistentMarkdownHighlights,
  removePersistentMarkdownHighlight,
  type PersistentMarkdownHighlight,
} from '../core/markdownHighlight'

export interface MarkdownHighlightStorage {
  load(): Promise<readonly PersistentMarkdownHighlight[]>
  save(highlights: readonly PersistentMarkdownHighlight[]): Promise<void>
  subscribe?(onRemote: (rebase: (local: readonly PersistentMarkdownHighlight[]) => readonly PersistentMarkdownHighlight[]) => void): () => void
}

export function createBrowserMarkdownHighlightStorage(
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
): MarkdownHighlightStorage {
  const key = 'iwae:markdown-highlights:v1'
  return {
    async load() {
      const serialized = storage.getItem(key)
      if (serialized === null) return []
      return parsePersistentMarkdownHighlights(JSON.parse(serialized) as unknown)
    },
    async save(highlights) {
      storage.setItem(key, JSON.stringify(markdownHighlightFile(highlights)))
    },
  }
}

export function createVaultMarkdownHighlightStorage(vault: VaultHandle): MarkdownHighlightStorage {
  return {
    load: () => readMarkdownHighlights(vault),
    save: (highlights) => writeMarkdownHighlights(vault, highlights),
    subscribe: (onRemote) => subscribeVaultFile(vault, 'markdown-highlights.json', markdownHighlightsCodec, onRemote),
  }
}

export function useMarkdownHighlights(storage: MarkdownHighlightStorage) {
  const [highlights, setHighlights] = useState<readonly PersistentMarkdownHighlight[]>([])
  const highlightsRef = useRef<readonly PersistentMarkdownHighlight[]>([])
  const pendingRef = useRef<readonly PersistentMarkdownHighlight[]>([])
  const pendingRemovalIdsRef = useRef<ReadonlySet<string>>(new Set())
  const readyRef = useRef(false)
  const generationRef = useRef(0)

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    readyRef.current = false
    pendingRef.current = []
    pendingRemovalIdsRef.current = new Set()
    highlightsRef.current = []
    setHighlights([])
    void storage.load().then((loaded) => {
      if (generationRef.current !== generation) return
      const restored = parsePersistentMarkdownHighlights(markdownHighlightFile(loaded))
      const merged = restored.filter(({ id }) => !pendingRemovalIdsRef.current.has(id))
      for (const pending of pendingRef.current) {
        if (!merged.some(({ id }) => id === pending.id)) merged.push(pending)
      }
      readyRef.current = true
      highlightsRef.current = merged
      setHighlights(merged)
      if (pendingRef.current.length > 0 || pendingRemovalIdsRef.current.size > 0) {
        void storage.save(merged).catch(() => undefined)
      }
      pendingRef.current = []
      pendingRemovalIdsRef.current = new Set()
    }).catch(() => undefined)
    return () => {
      generationRef.current += 1
    }
  }, [storage])

  useEffect(() => storage.subscribe?.((rebase) => {
    if (!readyRef.current) return
    const next = rebase(highlightsRef.current)
    if (next === highlightsRef.current) return
    highlightsRef.current = next
    setHighlights(next)
  }), [storage])

  // 되돌리기: 바꾸기 전·후 목록을 남기고, 되돌리면 그 목록을 다시 쓴다
  const restore = useCallback((list: readonly PersistentMarkdownHighlight[]) => {
    highlightsRef.current = list
    setHighlights(list)
    if (readyRef.current) void storage.save(list).catch(() => undefined)
  }, [storage])
  const remember = useCallback((before: readonly PersistentMarkdownHighlight[], after: readonly PersistentMarkdownHighlight[], key: string) => {
    recordUndo({ key: `md-hl:${key}`, undo: () => restore(before), redo: () => restore(after) })
  }, [restore])

  const add = useCallback((highlight: PersistentMarkdownHighlight) => {
    if (highlightsRef.current.some(({ id }) => id === highlight.id)) return
    const next = [...highlightsRef.current, highlight]
    remember(highlightsRef.current, next, highlight.id)
    highlightsRef.current = next
    setHighlights(next)
    if (!readyRef.current) {
      const pendingRemovalIds = new Set(pendingRemovalIdsRef.current)
      pendingRemovalIds.delete(highlight.id)
      pendingRemovalIdsRef.current = pendingRemovalIds
      pendingRef.current = [...pendingRef.current, highlight]
      return
    }
    void storage.save(next).catch(() => undefined)
  }, [storage])

  const remove = useCallback((highlightId: string) => {
    const next = removePersistentMarkdownHighlight(highlightsRef.current, highlightId)
    remember(highlightsRef.current, next, highlightId)
    highlightsRef.current = next
    setHighlights(next)
    if (!readyRef.current) {
      pendingRef.current = pendingRef.current.filter(({ id }) => id !== highlightId)
      pendingRemovalIdsRef.current = new Set([...pendingRemovalIdsRef.current, highlightId])
      return
    }
    void storage.save(next).catch(() => undefined)
  }, [storage])

  return { highlights, add, remove }
}
