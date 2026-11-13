import { describe, expect, it } from 'vitest'
import { holeRect, placeCard, rectVisible, TOUR_EDGE, TOUR_GAP, TOUR_HOLE_PAD } from './tourPlacement'

const viewport = { width: 1000, height: 700 }
const card = { width: 320, height: 160 }

function overlaps(a: { left: number; top: number; width: number; height: number }, b: { left: number; top: number; width: number; height: number }): boolean {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top
}

describe('holeRect', () => {
  it('정수로 맞추고 여백을 더한다', () => {
    expect(holeRect({ left: 10.4, top: 20.6, width: 100.2, height: 30.2 })).toEqual({
      left: 10 - TOUR_HOLE_PAD, top: 21 - TOUR_HOLE_PAD, width: 101 + 2 * TOUR_HOLE_PAD, height: 30 + 2 * TOUR_HOLE_PAD,
    })
  })
})

describe('rectVisible', () => {
  it('크기가 없거나 창 밖이면 보이지 않는다', () => {
    expect(rectVisible({ left: 10, top: 10, width: 0, height: 20 }, viewport)).toBe(false)
    expect(rectVisible({ left: 1200, top: 10, width: 50, height: 20 }, viewport)).toBe(false)
    expect(rectVisible({ left: -80, top: 10, width: 50, height: 20 }, viewport)).toBe(false)
    expect(rectVisible({ left: 10, top: 10, width: 50, height: 20 }, viewport)).toBe(true)
  })
})

describe('placeCard', () => {
  it('목표가 없으면 가운데', () => {
    const place = placeCard(null, card, viewport)
    expect(place.side).toBeNull()
    expect(place.left).toBe(340)
    expect(place.top).toBe(270)
  })

  it('auto: 아래에 들어가면 아래, 구멍과 틈을 두고 화살표는 목표 가운데를 가리킨다', () => {
    const target = { left: 400, top: 40, width: 100, height: 30 }
    const place = placeCard(target, card, viewport)
    expect(place.side).toBe('bottom')
    expect(place.top).toBe(holeRect(target).top + holeRect(target).height + TOUR_GAP)
    expect(place.left + place.arrow).toBe(450)
  })

  it('auto: 아래가 모자라면 위, 그것도 모자라면 오른쪽, 그다음 왼쪽', () => {
    expect(placeCard({ left: 400, top: 600, width: 100, height: 40 }, card, viewport).side).toBe('top')
    expect(placeCard({ left: 100, top: 20, width: 100, height: 660 }, card, viewport).side).toBe('right')
    expect(placeCard({ left: 800, top: 20, width: 190, height: 660 }, card, viewport).side).toBe('left')
  })

  it('정한 쪽이 들어가면 그 쪽을 쓴다', () => {
    expect(placeCard({ left: 100, top: 300, width: 100, height: 40 }, card, viewport, 'right').side).toBe('right')
  })

  it('창 가장자리에서 12px 안쪽을 지키고 구멍을 가리지 않는다', () => {
    for (const target of [
      { left: 0, top: 0, width: 40, height: 30 },
      { left: 960, top: 0, width: 40, height: 30 },
      { left: 0, top: 670, width: 40, height: 30 },
      { left: 100, top: 20, width: 100, height: 660 },
    ]) {
      const place = placeCard(target, card, viewport)
      expect(place.left).toBeGreaterThanOrEqual(TOUR_EDGE)
      expect(place.top).toBeGreaterThanOrEqual(TOUR_EDGE)
      expect(place.left + card.width).toBeLessThanOrEqual(viewport.width - TOUR_EDGE)
      expect(place.top + card.height).toBeLessThanOrEqual(viewport.height - TOUR_EDGE)
      expect(overlaps({ left: place.left, top: place.top, ...card }, holeRect(target))).toBe(false)
    }
  })

  it('좁은 창(900폭)에서도 카드가 창 안에 있다', () => {
    const narrow = { width: 900, height: 600 }
    const place = placeCard({ left: 700, top: 10, width: 180, height: 30 }, card, narrow)
    expect(place.left + card.width).toBeLessThanOrEqual(narrow.width - TOUR_EDGE)
  })
})
