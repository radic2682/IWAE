import { pageImageUrl } from '../bridge/pdf'
import { isClearlyUpright, pickOrientation, QUARTERS, readStats, type Quarter } from '../core/ocrOrientation'
import { recognizeImageDataItems } from './ocrTextDetector'

/** 방향을 가릴 때 쓰는 렌더 폭(px). 글자 방향만 보면 되므로 OCR 용(1800)보다 작게 */
const ORIENTATION_RENDER_WIDTH = 900

/** 그림을 시계 방향으로 `angle` 도 돌린 ImageData */
function rotatedImageData(bitmap: ImageBitmap, angle: Quarter): ImageData | null {
  const sideways = angle === 90 || angle === 270
  const width = sideways ? bitmap.height : bitmap.width
  const height = sideways ? bitmap.width : bitmap.height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) return null
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.translate(width / 2, height / 2)
  context.rotate((angle * Math.PI) / 180)
  context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  return context.getImageData(0, 0, width, height)
}

/**
 * 스캔 쪽 한 장의 방향을 가려, 똑바로 세우려면 시계 방향으로 얼마나 돌려야 하는지 돌려준다.
 * 0도가 또렷하게 읽히면 나머지 각도는 읽지 않는다. OCR 엔진을 쓸 수 없으면 null.
 */
export async function detectPageRotation(docId: string, page: number): Promise<Quarter | null> {
  const response = await fetch(pageImageUrl(docId, page, ORIENTATION_RENDER_WIDTH))
  if (!response.ok) return null
  const bitmap = await createImageBitmap(await response.blob())
  try {
    const scores: Partial<Record<Quarter, number>> = {}
    for (const angle of QUARTERS) {
      const data = rotatedImageData(bitmap, angle)
      if (data === null) return null
      const items = await recognizeImageDataItems(data)
      if (items === null) return null
      const stats = readStats(items)
      scores[angle] = stats.score
      if (angle === 0 && isClearlyUpright(stats)) return 0
    }
    return pickOrientation(scores)
  } finally {
    bitmap.close()
  }
}
