// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Anchor } from '../core/anchor'
import { canUndo, clearUndo } from './undoStack'
import { createPersistentPdfHighlight } from '../pdf/persistentHighlight'
import {
  createBrowserPdfHighlightStorage,
  usePdfHighlights,
  type PdfHighlightStorage,
} from './usePdfHighlights'

const anchor: Anchor = {
  docId: '5511aa99cc33',
  page: 2,
  coordSpace: 'pdfium-page',
  rects: [{ x: 20, y: 30, w: 100, h: 12 }],
  charRange: [10, 20],
  quote: 'highlight me',
  prefix: '',
  suffix: '',
}

describe('usePdfHighlights', () => {
  beforeEach(() => localStorage.clear())

  it('저장된 형광펜을 복원하고 새 항목을 즉시 저장한다', async () => {
    const existing = createPersistentPdfHighlight(anchor)
    const added = createPersistentPdfHighlight({ ...anchor, charRange: [30, 40], quote: 'second' })
    const storage: PdfHighlightStorage = {
      load: vi.fn().mockResolvedValue([existing]),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => usePdfHighlights(storage))

    await waitFor(() => expect(result.current.highlights).toEqual([existing]))
    act(() => result.current.add(added))

    await waitFor(() => expect(storage.save).toHaveBeenCalledWith([existing, added]))
    expect(result.current.highlights).toEqual([existing, added])
  })

  it('브라우저 저장소에서 형광펜을 왕복한다', async () => {
    const storage = createBrowserPdfHighlightStorage(localStorage)
    const highlight = createPersistentPdfHighlight(anchor)
    await storage.save([highlight])

    expect(localStorage.getItem('iwae:pdf-highlights:v1')).toContain('highlight me')
    await expect(storage.load()).resolves.toEqual([highlight])
  })

  it('복원 중 추가한 형광펜을 저장된 항목과 병합한다', async () => {
    let resolveLoad!: (value: readonly ReturnType<typeof createPersistentPdfHighlight>[]) => void
    const load = new Promise<readonly ReturnType<typeof createPersistentPdfHighlight>[]>((resolve) => {
      resolveLoad = resolve
    })
    const existing = createPersistentPdfHighlight(anchor)
    const added = createPersistentPdfHighlight({ ...anchor, charRange: [30, 40], quote: 'second' })
    const storage: PdfHighlightStorage = {
      load: vi.fn().mockReturnValue(load),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => usePdfHighlights(storage))

    act(() => result.current.add(added))
    expect(result.current.highlights).toEqual([added])
    await act(async () => resolveLoad([existing]))

    await waitFor(() => expect(result.current.highlights).toEqual([existing, added]))
    expect(storage.save).toHaveBeenCalledWith([existing, added])
  })

  it('복원된 영구 형광펜을 제거하고 남은 목록을 저장한다', async () => {
    const existing = createPersistentPdfHighlight(anchor)
    const remaining = createPersistentPdfHighlight({ ...anchor, charRange: [30, 40], quote: 'second' })
    const storage: PdfHighlightStorage = {
      load: vi.fn().mockResolvedValue([existing, remaining]),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => usePdfHighlights(storage))

    await waitFor(() => expect(result.current.highlights).toEqual([existing, remaining]))
    act(() => result.current.remove(existing.id))

    expect(result.current.highlights).toEqual([remaining])
    await waitFor(() => expect(storage.save).toHaveBeenCalledWith([remaining]))
  })

  it('복원 중 제거한 형광펜을 늦게 도착한 저장 데이터에서 되살리지 않는다', async () => {
    let resolveLoad!: (value: readonly ReturnType<typeof createPersistentPdfHighlight>[]) => void
    const load = new Promise<readonly ReturnType<typeof createPersistentPdfHighlight>[]>((resolve) => {
      resolveLoad = resolve
    })
    const existing = createPersistentPdfHighlight(anchor)
    const storage: PdfHighlightStorage = {
      load: vi.fn().mockReturnValue(load),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => usePdfHighlights(storage))

    act(() => result.current.remove(existing.id))
    await act(async () => resolveLoad([existing]))

    await waitFor(() => expect(result.current.highlights).toEqual([]))
    expect(storage.save).toHaveBeenCalledWith([])
  })

  it('색·메모를 고치고 고친 목록을 저장한다', async () => {
    const existing = createPersistentPdfHighlight(anchor)
    const storage: PdfHighlightStorage = {
      load: vi.fn().mockResolvedValue([existing]),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => usePdfHighlights(storage))
    await waitFor(() => expect(result.current.highlights).toEqual([existing]))

    act(() => result.current.update(existing.id, { color: 'blue', note: '정의 참고' }))
    expect(result.current.highlights[0]).toMatchObject({ id: existing.id, color: 'blue', note: '정의 참고' })
    await waitFor(() => expect(storage.save).toHaveBeenLastCalledWith([expect.objectContaining({ note: '정의 참고' })]))

    act(() => result.current.update('없는-id', { note: 'x' }))
    expect(result.current.highlights).toHaveLength(1)
  })

  it('여러 개를 한 번에 더하고, 이미 있는 것은 건너뛴다', async () => {
    const existing = createPersistentPdfHighlight(anchor)
    const second = createPersistentPdfHighlight({ ...anchor, charRange: [30, 40], quote: 'second' })
    const storage: PdfHighlightStorage = {
      load: vi.fn().mockResolvedValue([existing]),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => usePdfHighlights(storage))
    await waitFor(() => expect(result.current.highlights).toEqual([existing]))
    let added = 0
    act(() => { added = result.current.addMany([existing, second]) })
    expect(added).toBe(1)
    expect(result.current.highlights).toEqual([existing, second])
    expect(storage.save).toHaveBeenCalledTimes(1)
  })

  it('바뀐 것이 없는 update 는 되돌리기 단계도 저장도 만들지 않는다', async () => {
    clearUndo()
    const existing = { ...createPersistentPdfHighlight(anchor), note: '메모' }
    const storage: PdfHighlightStorage = {
      load: vi.fn().mockResolvedValue([existing]),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => usePdfHighlights(storage))
    await waitFor(() => expect(result.current.highlights).toEqual([existing]))
    act(() => result.current.update(existing.id, { note: '메모' }))
    expect(canUndo()).toBe(false)
    expect(storage.save).not.toHaveBeenCalled()
    act(() => result.current.update(existing.id, { note: '고침' }))
    expect(canUndo()).toBe(true)
    clearUndo()
  })
})
