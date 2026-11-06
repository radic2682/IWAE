// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Anchor } from '../core/anchor'
import type { CanvasSourceReference } from '../core/workspaceSources'
import { useWorkspaceSources } from './useWorkspaceSources'

function anchor(docId: string, page: number): Anchor {
  return {
    docId,
    page,
    coordSpace: 'pdfium-page',
    rects: [{ x: 10, y: 20, w: 40, h: 12 }],
    charRange: [0, 4],
    quote: 'test',
    prefix: '',
    suffix: '',
  }
}

const references: readonly CanvasSourceReference[] = [
  { blockId: 'current', anchor: anchor('doc-a', 1), relation: 'excerpt' },
  { blockId: 'other-page', anchor: anchor('doc-a', 4), relation: 'excerpt' },
  { blockId: 'other-doc', anchor: anchor('doc-b', 1), relation: 'translation' },
]

describe('useWorkspaceSources', () => {
  it('노트가 보낸 출처와 상호작용 상태를 현재 페이지 규칙으로 계산한다', () => {
    const { result } = renderHook(() => useWorkspaceSources({
      scopeId: 'note-a',
      activeDocId: 'doc-a',
      currentPage: 1,
    }))

    act(() => result.current.setSourceState({
      references,
      selectedIds: new Set(['other-page']),
      hoveredId: 'other-doc',
    }))

    expect(result.current.references).toEqual(references)
    expect(result.current.visibleSources.map(({ blockId }) => blockId)).toEqual([
      'current',
      'other-page',
      'other-doc',
    ])
  })

  it('노트 범위가 바뀌면 이전 노트의 출처를 비운다', () => {
    const { result, rerender } = renderHook(
      ({ scopeId }) => useWorkspaceSources({ scopeId, activeDocId: 'doc-a', currentPage: 1 }),
      { initialProps: { scopeId: 'note-a' } },
    )
    act(() => result.current.setSourceState({
      references,
      selectedIds: new Set(),
      hoveredId: null,
    }))

    rerender({ scopeId: 'note-b' })

    expect(result.current.references).toEqual([])
    expect(result.current.visibleSources).toEqual([])
  })

  it('선택과 호버 setter가 참조 목록을 바꾸지 않는다', () => {
    const { result } = renderHook(() => useWorkspaceSources({
      scopeId: 'note-a',
      activeDocId: 'doc-a',
      currentPage: 1,
    }))
    act(() => result.current.setReferences(references))
    act(() => result.current.setSelectedSourceIds(new Set(['other-page'])))
    act(() => result.current.setHoveredSourceId('other-doc'))

    expect(result.current.references).toEqual(references)
    expect(result.current.visibleSources.map(({ blockId }) => blockId)).toEqual([
      'current',
      'other-page',
      'other-doc',
    ])
  })
})
