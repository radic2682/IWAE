// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { PdfExcerptSelection } from '../core/pdfExcerpt'
import { estimateSelectionTextHeight, estimateTextHeightFromPixels } from './visualTextHeight'

function image(width: number, height: number, bands: readonly (readonly [number, number])[]) {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255)
  for (const [top, bottom] of bands) {
    for (let y = top; y < bottom; y += 1) {
      for (let x = 20; x < 70; x += 1) {
        const offset = (y * width + x) * 4
        pixels[offset] = 25
        pixels[offset + 1] = 25
        pixels[offset + 2] = 25
      }
    }
  }
  return pixels
}

describe('visual PDF text height', () => {
  it('estimates ink-line height on an image-only selection', () => {
    expect(estimateTextHeightFromPixels(image(100, 60, [[10, 18], [30, 38]]), 100, 60)).toBe(8)
  })

  it('does not invent text height in a blank selection', () => {
    expect(estimateTextHeightFromPixels(image(100, 60, []), 100, 60)).toBeNull()
  })

  it('reads the selected crop from the rendered page image', () => {
    const pageImage = document.createElement('img')
    Object.defineProperties(pageImage, { complete: { value: true }, naturalWidth: { value: 100 }, naturalHeight: { value: 60 } })
    const context = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: image(100, 60, [[10, 18]]), width: 100, height: 60 })) } as unknown as CanvasRenderingContext2D
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const selection: PdfExcerptSelection = {
      mode: 'region',
      anchor: { docId: 'sample', page: 0, coordSpace: 'pdfium-page', rects: [{ x: 0, y: 0, w: 100, h: 60 }], charRange: [0, 0], quote: '', prefix: '', suffix: '' },
      crop: { x: 0, y: 0, w: 100, h: 60 },
      pageSize: [100, 60],
      glyphs: [],
    }
    try {
      expect(estimateSelectionTextHeight(selection, pageImage)).toBe(8)
      expect(context.drawImage).toHaveBeenCalledOnce()
    } finally {
      getContext.mockRestore()
    }
  })
})
