import type { TourPlacement } from './tours'

/** 화면 좌표의 네모 */
export interface TourRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export type TourSide = 'top' | 'bottom' | 'left' | 'right'

export interface CardPlacement {
  readonly left: number
  readonly top: number
  /** 카드가 목표의 어느 쪽에 놓였는가. null 이면 가운데(목표 없음) */
  readonly side: TourSide | null
  /** 위·아래에 놓였을 때 화살표의 카드 안 가로 위치, 좌·우에 놓였을 때 세로 위치(px) */
  readonly arrow: number
}

/** 창 가장자리와 카드 사이 */
export const TOUR_EDGE = 12
/** 목표 둘레의 여백(구멍이 목표보다 이만큼 크다) */
export const TOUR_HOLE_PAD = 6
/** 구멍과 카드 사이(화살표 자리) */
export const TOUR_GAP = 14
/** 화살표가 카드 모서리에서 떨어져야 하는 거리 */
const ARROW_EDGE = 18

/** 목표 네모를 정수 픽셀로 맞추고 둘레 여백을 더한 구멍 네모 */
export function holeRect(target: TourRect): TourRect {
  const left = Math.round(target.left) - TOUR_HOLE_PAD
  const top = Math.round(target.top) - TOUR_HOLE_PAD
  const right = Math.round(target.left + target.width) + TOUR_HOLE_PAD
  const bottom = Math.round(target.top + target.height) + TOUR_HOLE_PAD
  return { left, top, width: right - left, height: bottom - top }
}

/** 눈에 보이는 목표인가: 크기가 있고 창 안에 조금이라도 걸친다 */
export function rectVisible(rect: TourRect, viewport: { readonly width: number; readonly height: number }): boolean {
  return rect.width > 0 && rect.height > 0
    && rect.left < viewport.width && rect.top < viewport.height
    && rect.left + rect.width > 0 && rect.top + rect.height > 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * 카드 자리 정하기. 카드는 구멍을 절대 가리지 않는다.
 * auto: 아래 → 위 → 오른쪽 → 왼쪽 순으로 들어가는 첫 쪽. 정한 쪽이 있으면 그 쪽을 먼저 본다.
 * 어느 쪽에도 안 들어가면(아주 큰 목표) 남는 자리가 가장 넓은 쪽에 창 안으로 눌러 놓는다.
 */
export function placeCard(
  target: TourRect | null,
  card: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
  placement: TourPlacement = 'auto',
): CardPlacement {
  const maxLeft = Math.max(TOUR_EDGE, viewport.width - TOUR_EDGE - card.width)
  const maxTop = Math.max(TOUR_EDGE, viewport.height - TOUR_EDGE - card.height)
  if (target === null) {
    return { left: clamp(Math.round((viewport.width - card.width) / 2), TOUR_EDGE, maxLeft), top: clamp(Math.round((viewport.height - card.height) / 2), TOUR_EDGE, maxTop), side: null, arrow: 0 }
  }
  const hole = holeRect(target)
  const centerX = hole.left + hole.width / 2
  const centerY = hole.top + hole.height / 2
  const room: Record<TourSide, number> = {
    bottom: viewport.height - TOUR_EDGE - (hole.top + hole.height + TOUR_GAP),
    top: hole.top - TOUR_GAP - TOUR_EDGE,
    right: viewport.width - TOUR_EDGE - (hole.left + hole.width + TOUR_GAP),
    left: hole.left - TOUR_GAP - TOUR_EDGE,
  }
  const fits = (side: TourSide): boolean => (side === 'top' || side === 'bottom' ? room[side] >= card.height : room[side] >= card.width)
  const order: TourSide[] = ['bottom', 'top', 'right', 'left']
  const preferred = placement === 'auto' ? order : [placement, ...order.filter((side) => side !== placement)]
  const side = preferred.find(fits)
    ?? [...order].sort((a, b) => (room[b] - (b === 'top' || b === 'bottom' ? card.height : card.width)) - (room[a] - (a === 'top' || a === 'bottom' ? card.height : card.width)))[0]!
  if (side === 'bottom' || side === 'top') {
    const left = clamp(Math.round(centerX - card.width / 2), TOUR_EDGE, maxLeft)
    const top = side === 'bottom' ? hole.top + hole.height + TOUR_GAP : hole.top - TOUR_GAP - card.height
    return { left, top: clamp(top, TOUR_EDGE, maxTop), side, arrow: clamp(Math.round(centerX - left), ARROW_EDGE, Math.max(ARROW_EDGE, card.width - ARROW_EDGE)) }
  }
  const top = clamp(Math.round(centerY - card.height / 2), TOUR_EDGE, maxTop)
  const left = side === 'right' ? hole.left + hole.width + TOUR_GAP : hole.left - TOUR_GAP - card.width
  return { left: clamp(left, TOUR_EDGE, maxLeft), top, side, arrow: clamp(Math.round(centerY - top), ARROW_EDGE, Math.max(ARROW_EDGE, card.height - ARROW_EDGE)) }
}
