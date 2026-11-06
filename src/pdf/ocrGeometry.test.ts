import { describe, expect, it } from 'vitest'
import { detectedLineHeight } from './ocrGeometry'

describe('detectedLineHeight', () => {
  it('uses the median detected line height in PDF coordinates', () => {
    const line = (top: number, bottom: number) => ({
      poly: [[5, top], [100, top], [100, bottom], [5, bottom]] as const,
      score: 0.9,
    })
    expect(detectedLineHeight([line(5, 16), line(25, 37), line(45, 70)], 100, { x: 0, y: 0, w: 100, h: 50 })).toBe(6)
  })

  it('ignores weak or non-text-like boxes', () => {
    expect(detectedLineHeight([
      { poly: [[0, 0], [100, 0], [100, 5], [0, 5]], score: 0.1 },
      { poly: [[0, 0], [10, 0], [10, 40], [0, 40]], score: 0.9 },
    ], 100, { x: 0, y: 0, w: 100, h: 100 })).toBeNull()
  })

  it('measures ink inside a detected line instead of using its padded box', () => {
    const width = 100
    const height = 30
    const data = new Uint8ClampedArray(width * height * 4).fill(255)
    for (let y = 9; y < 15; y += 1) {
      for (let x = 10; x < 90; x += 1) {
        const offset = (y * width + x) * 4
        data[offset] = 0
        data[offset + 1] = 0
        data[offset + 2] = 0
      }
    }
    expect(detectedLineHeight([
      { poly: [[5, 5], [95, 5], [95, 21], [5, 21]], score: 0.95 },
    ], height, { x: 0, y: 0, w: 100, h: 30 }, { data, width, height })).toBe(6)
  })
})
