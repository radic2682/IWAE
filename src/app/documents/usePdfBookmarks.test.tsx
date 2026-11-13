// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPdfBookmark } from '../../core/pdfBookmarks'
import { createBrowserPdfBookmarkStorage, usePdfBookmarks, type PdfBookmarkStorage } from './usePdfBookmarks'

describe('usePdfBookmarks', () => {
  beforeEach(() => localStorage.clear())

  it('현재 페이지 책갈피를 토글하고 즉시 저장한다', async () => {
    const storage: PdfBookmarkStorage = {
      load: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => usePdfBookmarks(storage))
    await waitFor(() => expect(storage.load).toHaveBeenCalled())

    act(() => result.current.toggle('doc-a', 2, '3쪽'))
    await waitFor(() => expect(result.current.isBookmarked('doc-a', 2)).toBe(true))
    expect(storage.save).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'doc-a:2' })])

    act(() => result.current.toggle('doc-a', 2, '3쪽'))
    await waitFor(() => expect(result.current.isBookmarked('doc-a', 2)).toBe(false))
    expect(storage.save).toHaveBeenLastCalledWith([])
  })

  it('브라우저 저장소에서 책갈피를 왕복한다', async () => {
    const storage = createBrowserPdfBookmarkStorage(localStorage)
    const bookmark = createPdfBookmark('doc-a', 3, '4쪽')
    await storage.save([bookmark])
    await expect(storage.load()).resolves.toEqual([bookmark])
  })

  it('복원 중 토글한 책갈피를 저장된 항목과 병합한다', async () => {
    let resolveLoad!: (value: readonly ReturnType<typeof createPdfBookmark>[]) => void
    const load = new Promise<readonly ReturnType<typeof createPdfBookmark>[]>((resolve) => { resolveLoad = resolve })
    const existing = createPdfBookmark('doc-a', 1, '2쪽')
    const storage: PdfBookmarkStorage = {
      load: vi.fn().mockReturnValue(load),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => usePdfBookmarks(storage))

    act(() => result.current.toggle('doc-a', 4, '5쪽'))
    expect(result.current.isBookmarked('doc-a', 4)).toBe(true)
    await act(async () => resolveLoad([existing]))

    await waitFor(() => expect(result.current.bookmarks).toHaveLength(2))
    expect(storage.save).toHaveBeenCalledWith(expect.arrayContaining([
      existing,
      expect.objectContaining({ id: 'doc-a:4' }),
    ]))
  })
})
