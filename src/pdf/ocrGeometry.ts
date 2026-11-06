import type { PdfExcerptCrop } from '../core/pdfExcerpt'
import { estimateTextHeightFromPixels } from './visualTextHeight'

export interface DetectedTextLine {
  readonly poly: readonly (readonly [number, number])[]
  readonly score: number
}

/** Convert detected line boxes in a cropped bitmap back to PDF page coordinates. */
export function detectedLineHeight(
  lines: readonly DetectedTextLine[],
  imageHeight: number,
  crop: PdfExcerptCrop,
  image?: Pick<ImageData, 'data' | 'width' | 'height'>,
): number | null {
  if (!Number.isFinite(imageHeight) || imageHeight <= 0) return null
  const heights = lines.flatMap(({ poly, score }) => {
    if (score < 0.35 || poly.length < 4) return []
    const ys = poly.map((point) => point[1]).filter(Number.isFinite)
    const xs = poly.map((point) => point[0]).filter(Number.isFinite)
    if (ys.length !== poly.length || xs.length !== poly.length) return []
    const height = Math.max(...ys) - Math.min(...ys)
    const width = Math.max(...xs) - Math.min(...xs)
    if (height < 3 || height > imageHeight * 0.75 || width < height * 1.2) return []
    if (image === undefined) return [height]
    const left = Math.max(0, Math.floor(Math.min(...xs)))
    const top = Math.max(0, Math.floor(Math.min(...ys)))
    const right = Math.min(image.width, Math.ceil(Math.max(...xs)))
    const bottom = Math.min(image.height, Math.ceil(Math.max(...ys)))
    const regionWidth = right - left
    const regionHeight = bottom - top
    if (regionWidth < 12 || regionHeight < 5) return []
    const region = new Uint8ClampedArray(regionWidth * regionHeight * 4)
    for (let row = 0; row < regionHeight; row += 1) {
      const source = ((top + row) * image.width + left) * 4
      region.set(image.data.subarray(source, source + regionWidth * 4), row * regionWidth * 4)
    }
    return [estimateTextHeightFromPixels(region, regionWidth, regionHeight) ?? height]
  }).sort((a, b) => a - b)
  if (heights.length === 0) return null
  const middle = Math.floor(heights.length / 2)
  const median = heights.length % 2 === 0
    ? ((heights[middle - 1] ?? 0) + (heights[middle] ?? 0)) / 2
    : heights[middle]!
  return Math.round(median * crop.h / imageHeight * 1000) / 1000
}
