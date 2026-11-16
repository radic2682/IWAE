import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { recordUndo } from '../undoStack'
import { createSaveNotifier, reportLoadFailure } from './storageRecovery'
import { applySnapshotChange } from '../../core/jsonMerge'

/** id 로 구분하는 기록 목록(형광펜 같은 것)을 저장소에 읽고 쓰는 공통 틀. PDF·Markdown 형광펜이 함께 쓴다 */
export interface PersistedListStorage<T> {
  load(): Promise<readonly T[]>
  save(items: readonly T[]): Promise<void>
  /** 다른 창이 파일을 고치면 알려 준다. rebase 에 지금 목록을 주면 남의 변경을 얹은 목록을 돌려준다 */
  subscribe?(onRemote: (rebase: (local: readonly T[]) => readonly T[]) => void): () => void
}

export interface PersistedListOptions<T> {
  /** 읽은 목록을 파일 모양으로 한 번 거쳐 다듬는다(깨진 항목·중복을 걸러낸다) */
  readonly normalize: (items: readonly T[]) => readonly T[]
  /** 되돌리기 단계의 키 앞머리(예: 'pdf-hl') */
  readonly undoKey: string
  /** 저장 실패 알림 문구 */
  readonly saveError: (error: string) => string
  /** 새로 더해질 때(중복이 아닐 때만) 부르는 곳 */
  readonly onAdd?: (item: T) => void
}

/** 키 순서와 상관없이 값이 같은가(JSON 으로 쓰는 값만) */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left).filter((key) => left[key] !== undefined)
  const other = Object.keys(right).filter((key) => right[key] !== undefined)
  return keys.length === other.length && keys.every((key) => sameValue(left[key], right[key]))
}

/** 브라우저(localStorage) 저장소: 비어 있으면 [], 있으면 parse 로 읽고 toFile 모양으로 쓴다 */
export function createBrowserListStorage<T>(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  key: string,
  parse: (raw: unknown) => readonly T[],
  toFile: (items: readonly T[]) => unknown,
): PersistedListStorage<T> {
  return {
    async load() {
      const serialized = storage.getItem(key)
      return serialized === null ? [] : parse(JSON.parse(serialized) as unknown)
    },
    async save(items) {
      storage.setItem(key, JSON.stringify(toFile(items)))
    },
  }
}

export function usePersistedIdList<T extends { readonly id: string }>(storage: PersistedListStorage<T>, options: PersistedListOptions<T>) {
  const [items, setItems] = useState<readonly T[]>([])
  const itemsRef = useRef<readonly T[]>([])
  const pendingRef = useRef<readonly T[]>([])
  const pendingRemovalIdsRef = useRef<ReadonlySet<string>>(new Set())
  const readyRef = useRef(false)
  const generationRef = useRef(0)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const notifySave = useMemo(() => createSaveNotifier((error) => optionsRef.current.saveError(error)), [])
  const persist = useCallback((list: readonly T[]) => notifySave(storage.save(list)), [notifySave, storage])

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    readyRef.current = false
    pendingRef.current = []
    pendingRemovalIdsRef.current = new Set()
    itemsRef.current = []
    setItems([])
    void storage.load().then((loaded) => {
      if (generationRef.current !== generation) return
      const restored = optionsRef.current.normalize(loaded)
      const merged = restored.filter(({ id }) => !pendingRemovalIdsRef.current.has(id))
      for (const pending of pendingRef.current) {
        if (!merged.some(({ id }) => id === pending.id)) merged.push(pending)
      }
      readyRef.current = true
      itemsRef.current = merged
      setItems(merged)
      if (pendingRef.current.length > 0 || pendingRemovalIdsRef.current.size > 0) {
        persist(merged)
      }
      pendingRef.current = []
      pendingRemovalIdsRef.current = new Set()
    }).catch(reportLoadFailure)
    return () => {
      generationRef.current += 1
    }
  }, [persist, storage])

  // 다른 창(떼어 낸 창·새 창)이 고치면 이 창의 목록에 합친다
  useEffect(() => storage.subscribe?.((rebase) => {
    if (!readyRef.current) return
    const next = rebase(itemsRef.current)
    if (next === itemsRef.current) return
    itemsRef.current = next
    setItems(next)
  }), [storage])

  // 되돌리기: 바꾸기 전·후 목록을 남기고, 되돌리면 그 목록을 다시 쓴다
  const restore = useCallback((list: readonly T[]) => {
    itemsRef.current = list
    setItems(list)
    if (readyRef.current) persist(list)
  }, [persist])
  const remember = useCallback((before: readonly T[], after: readonly T[], key: string) => {
    recordUndo({ key: `${optionsRef.current.undoKey}:${key}`, // 다른 창의 변경이 들어와 있어도 이 동작의 변화만 되돌린다(병합)
      undo: () => restore(applySnapshotChange(after, before, itemsRef.current)),
      redo: () => restore(applySnapshotChange(before, after, itemsRef.current)) })
  }, [restore])

  /** 새 목록을 반영하고, 준비가 되었으면 저장한다. 준비 전이면 false 를 돌려줘 호출한 쪽이 보류 처리를 하게 한다 */
  const commit = useCallback((next: readonly T[], undoKey: string | null): boolean => {
    if (undoKey !== null) remember(itemsRef.current, next, undoKey)
    itemsRef.current = next
    setItems(next)
    if (!readyRef.current) return false
    persist(next)
    return true
  }, [persist, remember])

  const add = useCallback((item: T) => {
    if (itemsRef.current.some(({ id }) => id === item.id)) return
    optionsRef.current.onAdd?.(item)
    if (commit([...itemsRef.current, item], item.id)) return
    const pendingRemovalIds = new Set(pendingRemovalIdsRef.current)
    pendingRemovalIds.delete(item.id)
    pendingRemovalIdsRef.current = pendingRemovalIds
    pendingRef.current = [...pendingRef.current, item]
  }, [commit])

  const remove = useCallback((id: string) => {
    if (commit(itemsRef.current.filter((item) => item.id !== id), id)) return
    pendingRef.current = pendingRef.current.filter((item) => item.id !== id)
    pendingRemovalIdsRef.current = new Set([...pendingRemovalIdsRef.current, id])
  }, [commit])

  /** 한 항목을 고친다. 없는 id 는 조용히 지나가고, 바뀐 것이 없으면 되돌리기 단계도 저장도 만들지 않는다 */
  const update = useCallback((id: string, edit: (item: T) => T) => {
    const current = itemsRef.current.find((item) => item.id === id)
    if (current === undefined) return
    if (sameValue(edit(current), current)) return
    if (commit(itemsRef.current.map((item) => item.id === id ? edit(item) : item), `edit:${id}`)) return
    pendingRef.current = pendingRef.current.map((item) => item.id === id ? edit(item) : item)
  }, [commit])

  /** 여러 개를 한 번에 더한다(가져오기). 저장은 한 번이고, 더한 개수를 돌려준다 */
  const addMany = useCallback((incoming: readonly T[]): number => {
    const known = new Set(itemsRef.current.map(({ id }) => id))
    const fresh = incoming.filter(({ id }) => {
      if (known.has(id)) return false
      known.add(id)
      return true
    })
    if (fresh.length === 0) return 0
    if (!commit([...itemsRef.current, ...fresh], 'many')) pendingRef.current = [...pendingRef.current, ...fresh]
    return fresh.length
  }, [commit])

  /** 모든 항목을 한꺼번에 고친다. null 을 돌려주면 그 항목은 지운다. undoable: false 면 되돌리기에 남기지 않는다 */
  const mapAll = useCallback((map: (item: T) => T | null, mapOptions: { readonly undoable?: boolean } = {}) => {
    commit(itemsRef.current.flatMap((item) => map(item) ?? []), mapOptions.undoable !== false ? 'map' : null)
  }, [commit])

  return { items, add, addMany, remove, update, mapAll }
}
