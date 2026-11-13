import { describe, expect, it } from 'vitest'
import { CARD_CROP_MAX_HEIGHT, CARD_CROP_MAX_WIDTH, cardCropMaxWidth, PDF_CROP_NATURAL_SCALE } from './regionCropSize'

describe('메모 카드의 영역 그림 크기 상한', () => {
  it('넓은 영역도 카드 상한 폭을 넘지 않는다', () => {
    expect(cardCropMaxWidth({ w: 500, h: 200 }, PDF_CROP_NATURAL_SCALE)).toBe(CARD_CROP_MAX_WIDTH)
  })

  it('작은 영역은 원래 크기의 배수까지만 커진다', () => {
    expect(cardCropMaxWidth({ w: 100, h: 40 }, PDF_CROP_NATURAL_SCALE)).toBe(150)
  })

  it('세로로 긴 그림은 높이 상한에 맞춰 폭을 줄인다', () => {
    const width = cardCropMaxWidth({ w: 300, h: 600 }, PDF_CROP_NATURAL_SCALE)
    expect(width).toBe(CARD_CROP_MAX_HEIGHT / 2)
    expect((width * 600) / 300).toBeLessThanOrEqual(CARD_CROP_MAX_HEIGHT)
  })

  it('크기가 없는 영역은 기본 상한', () => {
    expect(cardCropMaxWidth({ w: 0, h: 10 }, 1)).toBe(CARD_CROP_MAX_WIDTH)
  })
})
