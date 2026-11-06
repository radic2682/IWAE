import { describe, expect, it } from 'vitest'
import { ocrItemsToLines } from './ocrLines'

describe('ocrItemsToLines', () => {
  it('turns OCR polygons in image pixels into page-point boxes', () => {
    const lines = ocrItemsToLines([
      { text: ' Dynamic address ', poly: [[100, 200], [500, 196], [502, 236], [102, 240]] },
      { text: '', poly: [[0, 0], [10, 0], [10, 10], [0, 10]] },
      { text: '빈 상자', poly: [[5, 5], [5, 5], [5, 5], [5, 5]] },
    ], 0.5)
    expect(lines).toEqual([{ text: 'Dynamic address', x: 50, y: 98, w: 201, h: 22 }])
  })
})
