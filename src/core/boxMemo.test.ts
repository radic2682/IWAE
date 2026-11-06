import { describe, expect, it } from 'vitest'
import { BOX_DEFAULT_WIDTH, boxConnector, clampBox, parseMemoBox, placeBoxMemo } from './boxMemo'

const page: readonly [number, number] = [612, 792]

describe('박스 메모 자리(자동)', () => {
  it('오른쪽 여백이 비어 있으면 그곳에, 고른 글 높이에 놓는다', () => {
    const box = placeBoxMemo(page, [{ x: 72, y: 200, w: 200, h: 12 }], [{ x: 72, y: 190, w: 300, h: 40 }])
    expect(box.x).toBe(612 - BOX_DEFAULT_WIDTH - 8)
    expect(box.y).toBe(200)
  })

  it('오른쪽에 글이 가득하면 왼쪽 여백을 고른다', () => {
    const rightText = { x: 420, y: 180, w: 160, h: 120 }
    const box = placeBoxMemo(page, [{ x: 200, y: 200, w: 100, h: 12 }], [rightText])
    expect(box.x).toBe(8)
  })

  it('양쪽이 막혀 있으면 덜 덮는 자리로 가되, 고른 글은 덮지 않는다', () => {
    const selection = [{ x: 100, y: 300, w: 400, h: 12 }]
    const wall = [{ x: 0, y: 250, w: 612, h: 120 }]
    const box = placeBoxMemo(page, selection, wall)
    const covers = box.x < 500 && box.x + box.w > 100 && box.y < 312 && box.y + 70 > 300
    expect(covers).toBe(false)
  })

  it('쪽 밖으로 나가지 않는다', () => {
    const box = placeBoxMemo(page, [{ x: 10, y: 780, w: 30, h: 10 }], [])
    expect(box.y + 70).toBeLessThanOrEqual(792 + 70)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(clampBox({ x: 900, y: -5, w: 1000 }, page)).toEqual({ x: 612 - 420 > 0 ? 612 - 420 : 0, y: 0, w: 420 })
  })
})

describe('박스 연결선', () => {
  it('박스가 오른쪽이면 박스 왼쪽 가장자리 머리줄로 잇는다', () => {
    const line = boxConnector({ x: 200, y: 300 }, { x: 400, y: 280, w: 170 }, 60)
    expect(line.to).toEqual({ x: 400, y: 294 })
  })
  it('박스가 왼쪽이면 오른쪽 가장자리로, 아래면 위 가장자리로 잇는다', () => {
    expect(boxConnector({ x: 500, y: 300 }, { x: 8, y: 280, w: 170 }, 60).to.x).toBe(178)
    expect(boxConnector({ x: 100, y: 300 }, { x: 80, y: 340, w: 170 }, 60).to.y).toBe(340)
  })
})

describe('박스 읽기', () => {
  it('나쁜 값은 버리고 너비는 범위로 자른다', () => {
    expect(parseMemoBox({ x: 1, y: 2, w: 10 })).toEqual({ x: 1, y: 2, w: 90 })
    expect(parseMemoBox({ x: 'a', y: 2, w: 100 })).toBeUndefined()
    expect(parseMemoBox(null)).toBeUndefined()
  })
})
