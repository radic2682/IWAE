import { describe, expect, it } from 'vitest'
import {
  initialPageItems,
  isUnchanged,
  moveItems,
  pageMoves,
  remapAnchor,
  remapDocumentReferences,
  rotateItem,
  rotateRect,
} from './pdfPageEdit'
import type { Anchor } from './anchor'

describe('쪽 편집 계획', () => {
  it('처음 목록은 바뀐 것이 없다', () => {
    expect(isUnchanged(initialPageItems(3), 3)).toBe(true)
    expect(isUnchanged([...initialPageItems(3)].reverse(), 3)).toBe(false)
  })

  it('고른 쪽들을 다른 자리로 옮긴다', () => {
    expect(moveItems(['a', 'b', 'c', 'd'], [0], 3)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItems(['a', 'b', 'c', 'd'], [3], 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveItems(['a', 'b', 'c', 'd'], [1, 2], 4)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('돌리기는 0~270 안에서 돈다', () => {
    const item = initialPageItems(1)[0]!
    expect(rotateItem(item, 90).rotate).toBe(90)
    expect(rotateItem(item, -90).rotate).toBe(270)
    expect(rotateItem(rotateItem(rotateItem(rotateItem(item, 90), 90), 90), 90).rotate).toBe(0)
  })

  it('원본 쪽이 어디로 갔는지 안다(뺀 쪽은 없다)', () => {
    const items = moveItems(initialPageItems(3), [2], 0).filter((item) => item.page !== 1)
    const moves = pageMoves(items)
    expect(moves.get(2)).toEqual({ to: 0, rotate: 0 })
    expect(moves.get(0)).toEqual({ to: 1, rotate: 0 })
    expect(moves.has(1)).toBe(false)
  })
})

describe('상자 돌리기', () => {
  const size = [600, 800] as const
  const rect = { x: 10, y: 20, w: 100, h: 30 }
  it('네 번 90도 돌리면 제자리다', () => {
    let current = rect
    let currentSize: readonly [number, number] = size
    for (let i = 0; i < 4; i += 1) {
      current = rotateRect(current, 90, currentSize)
      currentSize = [currentSize[1], currentSize[0]]
    }
    expect(current).toEqual(rect)
  })
  it('180도는 맞은편 구석으로 간다', () => {
    expect(rotateRect(rect, 180, size)).toEqual({ x: 490, y: 750, w: 100, h: 30 })
  })
})

describe('출처 옮기기', () => {
  const anchor: Anchor = {
    docId: 'doc', page: 2, coordSpace: 'pdfium-page', rects: [{ x: 1, y: 2, w: 3, h: 4 }],
    charRange: [0, 4], quote: 'test', prefix: '', suffix: '',
  }
  const moves = pageMoves(moveItems(initialPageItems(3), [2], 0))

  it('형광펜 앵커를 새 쪽으로', () => {
    expect(remapAnchor(anchor, moves, [[600, 800], [600, 800], [600, 800]])?.page).toBe(0)
  })

  it('노트 JSON 안의 이 문서 출처만 옮긴다', () => {
    const note = { blocks: [{ source: { docId: 'doc', page: 2, rects: [] } }, { source: { docId: 'other', page: 2 } }] }
    const next = remapDocumentReferences(note, 'doc', moves, []) as typeof note
    expect(next.blocks[0]!.source.page).toBe(0)
    expect(next.blocks[1]!.source.page).toBe(2)
    expect(remapDocumentReferences({ a: 1 }, 'doc', moves, [])).toBeNull()
  })
})
