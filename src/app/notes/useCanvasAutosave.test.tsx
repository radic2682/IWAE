// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDefaultTextBlockStyle,
  type CanvasDocumentV1,
  type CanvasDocumentV2,
} from '../../core/canvasDocument'
import {
  createBrowserCanvasStorage,
  createMemoryCanvasStorage,
  flushCanvasSaves,
  StorageConflictError,
  useCanvasAutosave,
  type CanvasStorage,
} from './useCanvasAutosave'

function documentWithLabel(label: string): CanvasDocumentV2 {
  return {
    version: 2,
    nodes: [{
      id: 'title',
      position: { x: 0, y: 0 },
      data: {
        block: {
          kind: 'title',
          width: 320,
          height: 96,
          style: createDefaultTextBlockStyle('h1'),
          text: label,
        },
      },
    }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

function legacyDocumentWithLabel(label: string): CanvasDocumentV1 {
  return {
    version: 1,
    nodes: [{ id: 'title', position: { x: 0, y: 0 }, data: { label } }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

describe('useCanvasAutosave', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('복원을 마친 뒤 마지막 변경 500ms 후 한 번만 저장한다', async () => {
    const first = documentWithLabel('first')
    const second = documentWithLabel('second')
    const third = documentWithLabel('third')
    const storage: CanvasStorage = {
      load: vi.fn().mockResolvedValue(first),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => useCanvasAutosave({
      noteId: 'n.canvas',
      fallbackDocument: documentWithLabel('fallback'),
      storage,
      delay: 500,
    }))

    await waitFor(() => expect(result.current.status).toBe('saved'))
    expect(result.current.document).toEqual(first)
    vi.useFakeTimers()

    act(() => result.current.setDocument(second))
    expect(result.current.status).toBe('dirty')
    act(() => result.current.setDocument(third))
    await act(() => vi.advanceTimersByTimeAsync(499))
    expect(storage.save).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    await act(async () => Promise.resolve())

    expect(storage.save).toHaveBeenCalledTimes(1)
    expect(storage.save).toHaveBeenCalledWith('n.canvas', expect.objectContaining({ version: 2 }))
    expect(result.current.status).toBe('saved')
  })

  it('편집 중 dirty를 알리고 저장 완료 뒤에만 해제한다', async () => {
    let finishSave: (() => void) | undefined
    const onDirtyChange = vi.fn()
    const storage: CanvasStorage = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finishSave = resolve })),
    }
    const { result } = renderHook(() => useCanvasAutosave({
      noteId: 'dirty.canvas',
      fallbackDocument: documentWithLabel('fallback'),
      storage,
      delay: 1,
      onDirtyChange,
    }))
    await waitFor(() => expect(result.current.status).toBe('saved'))

    act(() => result.current.setDocument(documentWithLabel('changed')))
    await waitFor(() => expect(result.current.status).toBe('saving'))
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    finishSave?.()
    await waitFor(() => expect(result.current.status).toBe('saved'))
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('저장 전 원래 내용으로 되돌리면 대기 저장과 dirty 상태를 취소한다', async () => {
    vi.useFakeTimers()
    const onDirtyChange = vi.fn()
    const fallback = documentWithLabel('fallback')
    const storage: CanvasStorage = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => useCanvasAutosave({
      noteId: 'revert.canvas',
      fallbackDocument: fallback,
      storage,
      delay: 500,
      onDirtyChange,
    }))
    await act(async () => Promise.resolve())

    act(() => result.current.setDocument(documentWithLabel('changed')))
    act(() => result.current.setDocument(fallback))
    await act(() => vi.advanceTimersByTimeAsync(500))

    expect(storage.save).not.toHaveBeenCalled()
    expect(result.current.status).toBe('saved')
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('마운트 해제 시 대기 중인 변경을 즉시 저장한다', async () => {
    const storage: CanvasStorage = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const fallback = documentWithLabel('fallback')
    const changed = documentWithLabel('changed')
    const { result, unmount } = renderHook(() => useCanvasAutosave({
      noteId: 'n.canvas',
      fallbackDocument: fallback,
      storage,
      delay: 500,
    }))
    await waitFor(() => expect(result.current.status).toBe('saved'))
    vi.useFakeTimers()
    act(() => result.current.setDocument(changed))
    unmount()
    await Promise.resolve()
    expect(storage.save).toHaveBeenCalledWith('n.canvas', expect.objectContaining({ version: 2 }))
  })

  it('탭을 닫기 전 flush 요청은 debounce 중인 최신 변경까지 기다린다', async () => {
    let finishSave: (() => void) | undefined
    const storage: CanvasStorage = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finishSave = resolve })),
    }
    const { result } = renderHook(() => useCanvasAutosave({
      noteId: 'flush.canvas',
      fallbackDocument: documentWithLabel('fallback'),
      storage,
      delay: 10_000,
    }))
    await waitFor(() => expect(result.current.status).toBe('saved'))
    vi.useFakeTimers()
    act(() => result.current.setDocument(documentWithLabel('latest')))

    let flushed = false
    const flush = flushCanvasSaves('flush.canvas').then(() => { flushed = true })
    await act(async () => Promise.resolve())

    expect(storage.save).toHaveBeenCalledWith('flush.canvas', documentWithLabel('latest'))
    expect(flushed).toBe(false)
    finishSave?.()
    await act(async () => flush)
    expect(flushed).toBe(true)
  })

  it('저장 실패 뒤 다음 변경에서 다시 시도한다', async () => {
    const storage: CanvasStorage = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn()
        .mockRejectedValueOnce(new Error('disk full'))
        .mockResolvedValueOnce(undefined),
    }
    const { result } = renderHook(() => useCanvasAutosave({
      noteId: 'n.canvas',
      fallbackDocument: documentWithLabel('fallback'),
      storage,
      delay: 500,
    }))
    await waitFor(() => expect(result.current.status).toBe('saved'))
    vi.useFakeTimers()

    act(() => result.current.setDocument(documentWithLabel('failed')))
    await act(() => vi.advanceTimersByTimeAsync(500))
    await act(async () => Promise.resolve())
    expect(result.current.status).toBe('error')

    act(() => result.current.setDocument(documentWithLabel('retry')))
    await act(() => vi.advanceTimersByTimeAsync(500))
    await act(async () => Promise.resolve())
    expect(storage.save).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('saved')
  })

  it('외부 변경 충돌을 일반 저장 오류와 구분한다', async () => {
    const storage: CanvasStorage = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockRejectedValue(new StorageConflictError('external change')),
    }
    const { result } = renderHook(() => useCanvasAutosave({
      noteId: 'n.canvas',
      fallbackDocument: documentWithLabel('fallback'),
      storage,
      delay: 10,
    }))
    await waitFor(() => expect(result.current.status).toBe('saved'))

    act(() => result.current.setDocument(documentWithLabel('local')))
    await waitFor(() => expect(result.current.status).toBe('conflict'))
    expect(result.current.error).toBe('external change')
  })
})

describe('browserCanvasStorage', () => {
  it('note별 localStorage 키로 저장하고 복원한다', async () => {
    const storage = createBrowserCanvasStorage(localStorage)
    const document = legacyDocumentWithLabel('saved')
    await storage.save('HTTP/OPTIONS.canvas', document)

    expect(localStorage.getItem('iwae:canvas:HTTP/OPTIONS.canvas')).toContain('"version": 2')
    await expect(storage.load('HTTP/OPTIONS.canvas')).resolves.toMatchObject({ version: 2 })
  })

  it('개발 미리보기 저장소는 현재 실행 안에서만 복원하고 localStorage를 건드리지 않는다', async () => {
    const storage = createMemoryCanvasStorage()
    const document = documentWithLabel('preview')

    await storage.save('sample-note', document)

    await expect(storage.load('sample-note')).resolves.toEqual(document)
    expect(localStorage.length).toBe(0)
    await expect(createMemoryCanvasStorage().load('sample-note')).resolves.toBeNull()
  })
})

describe('저장이 실패한 채 캔버스가 사라질 때', () => {
  it('수정을 버리지 않고 flush 가 실패로 알리며, 다시 열면 이어받는다', async () => {
    let failing = true
    const saved: string[] = []
    const storage: CanvasStorage = {
      load: vi.fn(async () => documentWithLabel('original')),
      save: vi.fn(async (_id, doc) => {
        if (failing) throw new Error('disk full')
        saved.push(JSON.stringify(doc))
      }),
    }
    const onDirtyChange = vi.fn()
    const first = renderHook(() => useCanvasAutosave({ noteId: 'gone.canvas', fallbackDocument: documentWithLabel('fb'), storage, delay: 500, onDirtyChange }))
    await waitFor(() => expect(first.result.current.status).toBe('saved'))
    act(() => first.result.current.setDocument(documentWithLabel('my edit')))
    first.unmount()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    await expect(flushCanvasSaves('gone.canvas')).rejects.toThrow('disk full')

    // 디스크가 돌아오면 다음 flush 가 남은 수정을 저장한다
    failing = false
    await expect(flushCanvasSaves('gone.canvas')).resolves.toBeUndefined()
    expect(saved.at(-1)).toContain('my edit')
    await expect(flushCanvasSaves('gone.canvas')).resolves.toBeUndefined()
  })

  it('같은 노트를 다시 열면 디스크 내용 대신 저장하지 못한 수정을 이어받는다', async () => {
    let failing = true
    const storage: CanvasStorage = {
      load: vi.fn(async () => documentWithLabel('original')),
      save: vi.fn(async () => { if (failing) throw new Error('disk full') }),
    }
    const first = renderHook(() => useCanvasAutosave({ noteId: 'again.canvas', fallbackDocument: documentWithLabel('fb'), storage, delay: 20 }))
    await waitFor(() => expect(first.result.current.status).toBe('saved'))
    act(() => first.result.current.setDocument(documentWithLabel('kept edit')))
    first.unmount()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    failing = false
    const second = renderHook(() => useCanvasAutosave({ noteId: 'again.canvas', fallbackDocument: documentWithLabel('fb'), storage, delay: 20 }))
    await waitFor(() => expect(JSON.stringify(second.result.current.document)).toContain('kept edit'))
    await waitFor(() => expect(second.result.current.status).toBe('saved'))
    await expect(flushCanvasSaves('again.canvas')).resolves.toBeUndefined()
  })
})
