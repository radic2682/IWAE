// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createPersistentMarkdownHighlight } from '../core/markdownHighlight'
import { useMarkdownHighlights, type MarkdownHighlightStorage } from './useMarkdownHighlights'

const selection = {
  path: 'docs/guide.md', title: 'Guide', quote: 'text', prefix: '', suffix: '',
  startOffset: 0, endOffset: 4, format: 'paragraph' as const,
}

describe('useMarkdownHighlights', () => {
  it('불러온 항목에 추가·삭제를 반영하고 저장한다', async () => {
    const initial = createPersistentMarkdownHighlight('file-1', 'hash-1', selection)
    const added = createPersistentMarkdownHighlight('file-1', 'hash-1', { ...selection, startOffset: 10, endOffset: 14 })
    const storage: MarkdownHighlightStorage = {
      load: vi.fn().mockResolvedValue([initial]),
      save: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => useMarkdownHighlights(storage))
    await waitFor(() => expect(result.current.highlights).toEqual([initial]))

    act(() => result.current.add(added))
    await waitFor(() => expect(storage.save).toHaveBeenLastCalledWith([initial, added]))
    act(() => result.current.remove(initial.id))
    await waitFor(() => expect(storage.save).toHaveBeenLastCalledWith([added]))
  })
})
