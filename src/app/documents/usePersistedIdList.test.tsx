// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearUndo, undo } from '../undoStack'
import {
  createBrowserListStorage,
  sameValue,
  usePersistedIdList,
  type PersistedListOptions,
  type PersistedListStorage,
} from './usePersistedIdList'

interface Item { readonly id: string; readonly text: string }
const a: Item = { id: 'a', text: 'A' }
const b: Item = { id: 'b', text: 'B' }
const c: Item = { id: 'c', text: 'C' }

const options: PersistedListOptions<Item> = {
  normalize: (list) => list,
  undoKey: 'test',
  saveError: (error) => `fail:${error}`,
}

function makeStorage(initial: readonly Item[], extra: Partial<PersistedListStorage<Item>> = {}) {
  return {
    load: vi.fn().mockResolvedValue(initial),
    save: vi.fn().mockResolvedValue(undefined),
    ...extra,
  } satisfies PersistedListStorage<Item>
}

afterEach(() => clearUndo())

describe('usePersistedIdList', () => {
  it('불러온 목록을 보여 주고 더하기·고치기·지우기를 저장한다', async () => {
    const storage = makeStorage([a])
    const { result } = renderHook(() => usePersistedIdList(storage, options))
    await waitFor(() => expect(result.current.items).toEqual([a]))

    act(() => result.current.add(b))
    await waitFor(() => expect(storage.save).toHaveBeenLastCalledWith([a, b]))
    act(() => result.current.update('a', (item) => ({ ...item, text: 'A2' })))
    await waitFor(() => expect(storage.save).toHaveBeenLastCalledWith([{ id: 'a', text: 'A2' }, b]))
    act(() => result.current.remove('a'))
    await waitFor(() => expect(storage.save).toHaveBeenLastCalledWith([b]))
  })

  it('이미 있는 id 를 더하거나 없는 id 를 고치거나 같은 값으로 고치면 저장하지 않는다', async () => {
    const storage = makeStorage([a])
    const { result } = renderHook(() => usePersistedIdList(storage, options))
    await waitFor(() => expect(result.current.items).toEqual([a]))
    act(() => {
      result.current.add({ id: 'a', text: 'other' })
      result.current.update('zzz', (item) => ({ ...item, text: 'x' }))
      result.current.update('a', (item) => ({ ...item }))
    })
    expect(storage.save).not.toHaveBeenCalled()
    expect(result.current.items).toEqual([a])
  })

  it('addMany 는 중복을 빼고 한 번만 저장하며 더한 개수를 돌려준다', async () => {
    const storage = makeStorage([a])
    const { result } = renderHook(() => usePersistedIdList(storage, options))
    await waitFor(() => expect(result.current.items).toEqual([a]))
    let count = -1
    act(() => { count = result.current.addMany([a, b, b, c]) })
    expect(count).toBe(2)
    expect(storage.save).toHaveBeenCalledTimes(1)
    expect(storage.save).toHaveBeenLastCalledWith([a, b, c])
    act(() => { count = result.current.addMany([a]) })
    expect(count).toBe(0)
    expect(storage.save).toHaveBeenCalledTimes(1)
  })

  it('mapAll 은 null 을 지우고, undoable: false 는 되돌리기에 남기지 않는다', async () => {
    const storage = makeStorage([a, b])
    const { result } = renderHook(() => usePersistedIdList(storage, options))
    await waitFor(() => expect(result.current.items).toEqual([a, b]))
    act(() => result.current.mapAll((item) => item.id === 'a' ? null : item, { undoable: false }))
    expect(result.current.items).toEqual([b])
    expect(undo()).toBe(false)
    act(() => result.current.mapAll((item) => ({ ...item, text: 'M' })))
    expect(result.current.items).toEqual([{ id: 'b', text: 'M' }])
    act(() => { undo() })
    expect(result.current.items).toEqual([b])
  })

  it('되돌리면 그 동작만 되돌리고 다시 저장한다', async () => {
    const storage = makeStorage([a])
    const { result } = renderHook(() => usePersistedIdList(storage, options))
    await waitFor(() => expect(result.current.items).toEqual([a]))
    act(() => result.current.add(b))
    act(() => { undo() })
    expect(result.current.items).toEqual([a])
    await waitFor(() => expect(storage.save).toHaveBeenLastCalledWith([a]))
  })

  it('불러오기 전에 더하고 지운 것은 불러온 뒤 한 번 합쳐 저장한다', async () => {
    let finish: (list: readonly Item[]) => void = () => undefined
    const storage = makeStorage([], { load: vi.fn(() => new Promise<readonly Item[]>((resolve) => { finish = resolve })) })
    const { result } = renderHook(() => usePersistedIdList(storage, options))
    act(() => {
      result.current.add(c)
      result.current.remove('a')
    })
    expect(storage.save).not.toHaveBeenCalled()
    await act(async () => { finish([a, b]) })
    await waitFor(() => expect(result.current.items).toEqual([b, c]))
    expect(storage.save).toHaveBeenCalledTimes(1)
    expect(storage.save).toHaveBeenLastCalledWith([b, c])
  })

  it('다른 창의 변경은 rebase 로 합치고, 같은 목록이면 다시 그리지 않는다', async () => {
    let remote: (rebase: (local: readonly Item[]) => readonly Item[]) => void = () => undefined
    const storage = makeStorage([a], {
      subscribe: (onRemote) => { remote = onRemote; return () => undefined },
    })
    const { result } = renderHook(() => usePersistedIdList(storage, options))
    await waitFor(() => expect(result.current.items).toEqual([a]))
    act(() => remote((local) => [...local, b]))
    expect(result.current.items).toEqual([a, b])
    const before = result.current.items
    act(() => remote((local) => local))
    expect(result.current.items).toBe(before)
    expect(storage.save).not.toHaveBeenCalled()
  })

  it('저장이 실패해도 화면 목록은 유지한다', async () => {
    const storage = makeStorage([a], { save: vi.fn().mockRejectedValue(new Error('disk')) })
    const { result } = renderHook(() => usePersistedIdList(storage, options))
    await waitFor(() => expect(result.current.items).toEqual([a]))
    act(() => result.current.add(b))
    act(() => result.current.add(c))
    await waitFor(() => expect(storage.save).toHaveBeenCalledTimes(2))
    expect(result.current.items).toEqual([a, b, c])
  })

  it('불러오기가 실패해도 목록은 빈 채로 멈추지 않는다', async () => {
    const storage = makeStorage([], { load: vi.fn().mockRejectedValue(new Error('broken')) })
    const { result } = renderHook(() => usePersistedIdList(storage, options))
    await waitFor(() => expect(storage.load).toHaveBeenCalled())
    expect(result.current.items).toEqual([])
  })

  it('onAdd 는 새로 더할 때만 부른다', async () => {
    const onAdd = vi.fn()
    const storage = makeStorage([a])
    const { result } = renderHook(() => usePersistedIdList(storage, { ...options, onAdd }))
    await waitFor(() => expect(result.current.items).toEqual([a]))
    act(() => { result.current.add(a); result.current.add(b) })
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith(b)
  })
})

describe('createBrowserListStorage', () => {
  it('비어 있으면 [] 이고, 저장한 모양을 다시 읽는다', async () => {
    const data = new Map<string, string>()
    const fake = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
    const storage = createBrowserListStorage<Item>(fake, 'k', (raw) => (raw as { items: Item[] }).items, (items) => ({ items }))
    expect(await storage.load()).toEqual([])
    await storage.save([a])
    expect(data.get('k')).toBe('{"items":[{"id":"a","text":"A"}]}')
    expect(await storage.load()).toEqual([a])
  })
})

describe('sameValue', () => {
  it('키 순서와 undefined 값은 무시한다', () => {
    expect(sameValue({ x: 1, y: [1, { z: 2 }] }, { y: [1, { z: 2 }], x: 1, w: undefined })).toBe(true)
    expect(sameValue({ x: 1 }, { x: 2 })).toBe(false)
    expect(sameValue([1], { 0: 1 })).toBe(false)
  })
})
