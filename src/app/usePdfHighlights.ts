import { useCallback, useEffect, useRef, useState } from 'react'
import { recordUndo } from './undoStack'
import { applySnapshotChange } from '../core/jsonMerge'
import { markFreshHighlight } from '../pdf/freshHighlight'
import { pdfHighlightsCodec, readPdfHighlights, subscribeVaultFile, writePdfHighlights, type VaultHandle } from '../bridge/vault'
import {
  parsePersistentPdfHighlights,
  persistentPdfHighlightFile,
  removePersistentPdfHighlight,
  updatePersistentPdfHighlight,
  type PersistentPdfHighlight,
  type PersistentPdfHighlightPatch,
} from '../pdf/persistentHighlight'

export interface PdfHighlightStorage {
  load(): Promise<readonly PersistentPdfHighlight[]>
  save(highlights: readonly PersistentPdfHighlight[]): Promise<void>
  /** 다른 창이 파일을 고치면 알려 준다. rebase 에 지금 목록을 주면 남의 변경을 얹은 목록을 돌려준다 */
  subscribe?(onRemote: (rebase: (local: readonly PersistentPdfHighlight[]) => readonly PersistentPdfHighlight[]) => void): () => void
}

export function createBrowserPdfHighlightStorage(
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
): PdfHighlightStorage {
  const key = 'iwae:pdf-highlights:v1'
  return {
    async load() {
      const serialized = storage.getItem(key)
      if (serialized === null) return []
      return parsePersistentPdfHighlights(JSON.parse(serialized) as unknown)
    },
    async save(highlights) {
      storage.setItem(key, JSON.stringify(persistentPdfHighlightFile(highlights)))
    },
  }
}

export function createVaultPdfHighlightStorage(vault: VaultHandle): PdfHighlightStorage {
  return {
    load: () => readPdfHighlights(vault),
    save: (highlights) => writePdfHighlights(vault, highlights),
    subscribe: (onRemote) => subscribeVaultFile(vault, 'highlights.json', pdfHighlightsCodec, onRemote),
  }
}

/** 키 순서와 상관없이 값이 같은가(JSON 으로 쓰는 값만) */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left).filter((key) => left[key] !== undefined)
  const other = Object.keys(right).filter((key) => right[key] !== undefined)
  return keys.length === other.length && keys.every((key) => sameValue(left[key], right[key]))
}

export function usePdfHighlights(storage: PdfHighlightStorage) {
  const [highlights, setHighlights] = useState<readonly PersistentPdfHighlight[]>([])
  const highlightsRef = useRef<readonly PersistentPdfHighlight[]>([])
  const pendingRef = useRef<readonly PersistentPdfHighlight[]>([])
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
      const restored = parsePersistentPdfHighlights(persistentPdfHighlightFile(loaded))
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

  // 다른 창(떼어 낸 창·새 창)이 형광펜을 고치면 이 창의 목록에 합친다
  useEffect(() => storage.subscribe?.((rebase) => {
    if (!readyRef.current) return
    const next = rebase(highlightsRef.current)
    if (next === highlightsRef.current) return
    highlightsRef.current = next
    setHighlights(next)
  }), [storage])

  // 되돌리기: 바꾸기 전·후 목록을 남기고, 되돌리면 그 목록을 다시 쓴다
  const restore = useCallback((list: readonly PersistentPdfHighlight[]) => {
    highlightsRef.current = list
    setHighlights(list)
    if (readyRef.current) void storage.save(list).catch(() => undefined)
  }, [storage])
  const remember = useCallback((before: readonly PersistentPdfHighlight[], after: readonly PersistentPdfHighlight[], key: string) => {
    recordUndo({ key: `pdf-hl:${key}`, // 다른 창의 변경이 들어와 있어도 이 동작의 변화만 되돌린다(병합)
      undo: () => restore(applySnapshotChange(after, before, highlightsRef.current)),
      redo: () => restore(applySnapshotChange(before, after, highlightsRef.current)) })
  }, [restore])

  const add = useCallback((highlight: PersistentPdfHighlight) => {
    if (highlightsRef.current.some(({ id }) => id === highlight.id)) return
    markFreshHighlight(highlight.id)
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
    const next = removePersistentPdfHighlight(highlightsRef.current, highlightId)
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

  /** 색·메모·근거·주제를 고친다. 없는 id 는 조용히 지나간다 */
  const update = useCallback((highlightId: string, patch: PersistentPdfHighlightPatch) => {
    const current = highlightsRef.current.find(({ id }) => id === highlightId)
    if (current === undefined) return
    // 바뀐 것이 없으면(같은 글로 다시 저장) 되돌리기 단계도 저장도 만들지 않는다
    if (sameValue(updatePersistentPdfHighlight(current, patch), current)) return
    const next = highlightsRef.current.map((item) => item.id === highlightId ? updatePersistentPdfHighlight(item, patch) : item)
    remember(highlightsRef.current, next, `edit:${highlightId}`)
    highlightsRef.current = next
    setHighlights(next)
    if (!readyRef.current) {
      pendingRef.current = pendingRef.current.map((item) => item.id === highlightId ? updatePersistentPdfHighlight(item, patch) : item)
      return
    }
    void storage.save(next).catch(() => undefined)
  }, [storage])

  /** 여러 개를 한 번에 더한다(가져오기). 저장은 한 번이고, 더한 개수를 돌려준다 */
  const addMany = useCallback((incoming: readonly PersistentPdfHighlight[]): number => {
    const known = new Set(highlightsRef.current.map(({ id }) => id))
    const fresh = incoming.filter(({ id }) => {
      if (known.has(id)) return false
      known.add(id)
      return true
    })
    if (fresh.length === 0) return 0
    const next = [...highlightsRef.current, ...fresh]
    remember(highlightsRef.current, next, 'many')
    highlightsRef.current = next
    setHighlights(next)
    if (!readyRef.current) {
      pendingRef.current = [...pendingRef.current, ...fresh]
      return fresh.length
    }
    void storage.save(next).catch(() => undefined)
    return fresh.length
  }, [storage])

  /** PDF 쪽을 편집한 뒤처럼 형광펜을 한꺼번에 고친다. null 을 돌려주면 그 형광펜은 지운다 */
  const mapAll = useCallback((map: (highlight: PersistentPdfHighlight) => PersistentPdfHighlight | null) => {
    const next = highlightsRef.current.flatMap((item) => map(item) ?? [])
    remember(highlightsRef.current, next, 'map')
    highlightsRef.current = next
    setHighlights(next)
    if (readyRef.current) void storage.save(next).catch(() => undefined)
  }, [storage])

  return { highlights, add, addMany, remove, update, mapAll }
}
