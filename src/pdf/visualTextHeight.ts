import type { PdfExcerptSelection } from '../core/pdfExcerpt'

/** Estimate the height of ink bands without recognizing the characters. */
export function estimateTextHeightFromPixels(pixels: Uint8ClampedArray, width: number, height: number): number | null {
  if (width < 12 || height < 5 || pixels.length < width * height * 4) return null
  const luminances: number[] = []
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 40))) {
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 80))) {
      const i = (y * width + x) * 4
      luminances.push((pixels[i]! * 0.2126) + (pixels[i + 1]! * 0.7152) + (pixels[i + 2]! * 0.0722))
    }
  }
  luminances.sort((a, b) => a - b)
  const background = luminances[Math.floor(luminances.length / 2)] ?? 255
  const minimumInk = Math.max(3, Math.ceil(width * 0.015))
  const activeRows: boolean[] = []
  for (let y = 0; y < height; y += 1) {
    let ink = 0
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      if (pixels[i + 3]! < 128) continue
      const luminance = (pixels[i]! * 0.2126) + (pixels[i + 1]! * 0.7152) + (pixels[i + 2]! * 0.0722)
      if (Math.abs(luminance - background) >= 38) ink += 1
    }
    activeRows.push(ink >= minimumInk)
  }
  const bands: number[] = []
  let start = -1
  for (let y = 0; y <= height; y += 1) {
    if (y < height && activeRows[y]) {
      if (start < 0) start = y
    } else if (start >= 0) {
      const bandHeight = y - start
      if (bandHeight >= 3 && bandHeight <= Math.min(120, height * 0.85)) bands.push(bandHeight)
      start = -1
    }
  }
  if (bands.length === 0) return null
  bands.sort((a, b) => a - b)
  return bands[Math.floor(bands.length / 2)] ?? null
}

export function readSelectionImageData(
  selection: PdfExcerptSelection,
  image: HTMLImageElement | null,
  maxWidth = 512,
  maxHeight = 320,
  maxUpscale = 1,
): ImageData | null {
  if (image === null || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return null
  const { crop, pageSize } = selection
  const sourceWidth = crop.w / pageSize[0] * image.naturalWidth
  const sourceHeight = crop.h / pageSize[1] * image.naturalHeight
  const scale = Math.min(maxUpscale, maxWidth / sourceWidth, maxHeight / sourceHeight)
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) return null
  try {
    context.drawImage(
      image,
      crop.x / pageSize[0] * image.naturalWidth,
      crop.y / pageSize[1] * image.naturalHeight,
      crop.w / pageSize[0] * image.naturalWidth,
      crop.h / pageSize[1] * image.naturalHeight,
      0, 0, width, height,
    )
    return context.getImageData(0, 0, width, height)
  } catch {
    return null
  }
}

export function estimateSelectionTextHeight(selection: PdfExcerptSelection, image: HTMLImageElement | null): number | null {
  const pixels = readSelectionImageData(selection, image)
  if (pixels === null) return null
  const bandHeight = estimateTextHeightFromPixels(pixels.data, pixels.width, pixels.height)
  return bandHeight === null ? null : Math.round(bandHeight * selection.crop.h / pixels.height * 1000) / 1000
}
