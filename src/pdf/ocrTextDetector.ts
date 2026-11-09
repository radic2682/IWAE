import type { PdfExcerptSelection } from '../core/pdfExcerpt'
import { joinRecognizedText } from '../core/ocrRecognition'
import { ocrWasmBaseUrl } from '../core/ocrRuntimeAssets'
import { detectedLineHeight, type DetectedTextLine } from './ocrGeometry'
import { readSelectionImageData } from './visualTextHeight'
import { pageImageUrl } from '../bridge/pdf'

interface OcrResultItem {
  readonly poly: readonly (readonly [number, number])[]
  readonly text: string
  readonly score: number
}

interface OcrResult {
  readonly items: readonly OcrResultItem[]
}

interface OcrRuntime {
  predict(input: Blob | ImageData, params?: Record<string, unknown>): Promise<readonly OcrResult[]>
}

const assetBase = `${import.meta.env.BASE_URL}ocr/`
const wasmBase = ocrWasmBaseUrl(import.meta.env.BASE_URL)
const OCR_TIMEOUT_MS = 60_000
let runtimePromise: Promise<OcrRuntime> | null = null
let prewarmPromise: Promise<boolean> | null = null
let inferenceQueue: Promise<void> = Promise.resolve()
const results = new Map<string, Promise<number | null>>()

function timeout<T>(task: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), OCR_TIMEOUT_MS)
    void task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

function runtime(): Promise<OcrRuntime> {
  if (runtimePromise === null) {
    runtimePromise = import('@paddleocr/paddleocr-js')
      .then(({ PaddleOCR }) => PaddleOCR.create({
        worker: true,
        textDetectionModelName: 'PP-OCRv5_mobile_det',
        textRecognitionModelName: 'PP-OCRv6_tiny_rec',
        textDetectionModelAsset: { url: `${assetBase}PP-OCRv5_mobile_det_onnx_infer.tar` },
        textRecognitionModelAsset: { url: `${assetBase}PP-OCRv6_tiny_rec_onnx_infer.tar` },
        ortOptions: { backend: 'wasm', wasmPaths: wasmBase, numThreads: 1, simd: true },
      }) as Promise<OcrRuntime>)
      .catch((error: unknown) => {
        runtimePromise = null
        throw error
      })
  }
  return runtimePromise
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const task = inferenceQueue.then(operation)
  inferenceQueue = task.then(() => undefined, () => undefined)
  return task
}

async function predict(input: Blob | ImageData, params: Record<string, unknown>): Promise<OcrResult | null> {
  if (!(await prewarmPdfTextDetector())) return null
  return enqueue(async () => {
    try {
      const [result] = await timeout(
        (await runtime()).predict(input, params),
        'PDF OCR inference timed out',
      )
      return result ?? null
    } catch (error) {
      console.warn('PDF OCR failed:', error instanceof Error ? error.message : String(error))
      return null
    }
  })
}

/** Start model loading when an image-only PDF opens, without delaying selection. */
export function prewarmPdfTextDetector(): Promise<boolean> {
  if (prewarmPromise === null) {
    prewarmPromise = timeout(runtime(), 'PDF OCR initialization timed out')
      .then(() => true)
      .catch((error: unknown) => {
        console.warn('PDF OCR initialization failed:', error instanceof Error ? error.message : String(error))
        prewarmPromise = null
        return false
      })
  }
  return prewarmPromise
}

/** Refine a provisional pixel estimate asynchronously; never block a drag gesture. */
export function detectSelectionTextHeight(selection: PdfExcerptSelection, image: HTMLImageElement | null): Promise<number | null> {
  if (image === null || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return Promise.resolve(null)
  const { crop, anchor } = selection
  const key = `${anchor.docId}:${anchor.page}:${crop.x.toFixed(1)}:${crop.y.toFixed(1)}:${crop.w.toFixed(1)}:${crop.h.toFixed(1)}:${image.naturalWidth}:${image.naturalHeight}`
  const cached = results.get(key)
  if (cached !== undefined) return cached
  const task = (async () => {
    const imageData = readSelectionImageData(selection, image, 768, 512, 2)
    if (imageData === null) return null
    const result = await predict(imageData, {
      textDetLimitSideLen: 640,
      textDetLimitType: 'max',
      textDetMaxSideLimit: 640,
      textRecScoreThresh: 0.35,
    })
    if (result === null) return null
    const lines: DetectedTextLine[] = result.items.map(({ poly, score }) => ({ poly, score }))
    return detectedLineHeight(lines, imageData.height, crop, imageData)
  })()
  results.set(key, task)
  if (results.size > 100) results.delete(results.keys().next().value!)
  return task
}

/**
 * 고른 영역(스캔 쪽처럼 글자 층이 없는 곳)의 글자를 이 PC 에서 읽는다. 화면에 그린 쪽 그림을 잘라
 * 키워서(최대 3배) 읽으므로 따로 렌더하지 않는다. 못 읽으면 null.
 */
export async function recognizeSelectionText(selection: PdfExcerptSelection, image: HTMLImageElement | null): Promise<string | null> {
  // 쪽은 타일로 그려 <img> 가 없을 때가 많다: 그때는 쪽을 넉넉한 해상도로 따로 받아 잘라 읽는다
  const imageData = readSelectionImageData(selection, image, 1600, 1600, 3) ?? await renderedSelectionImageData(selection)
  if (imageData === null) return null
  return predict(imageData, {
    textDetLimitSideLen: 1600,
    textDetLimitType: 'max',
    textDetMaxSideLimit: 1800,
    textRecScoreThresh: 0.35,
  }).then((result) => {
    const text = result === null ? '' : joinRecognizedText(result.items).trim()
    return text === '' ? null : text
  })
}

/** 고른 영역만 쪽 그림에서 잘라 ImageData 로(쪽 폭 기준 약 3배, 최대 2400px 로 렌더) */
async function renderedSelectionImageData(selection: PdfExcerptSelection): Promise<ImageData | null> {
  const { crop, pageSize, anchor } = selection
  if (pageSize[0] <= 0 || pageSize[1] <= 0 || crop.w <= 0 || crop.h <= 0) return null
  const width = Math.min(2400, Math.round(pageSize[0] * 3))
  try {
    const response = await fetch(pageImageUrl(anchor.docId, anchor.page, width))
    if (!response.ok) return null
    const bitmap = await createImageBitmap(await response.blob())
    const scale = bitmap.width / pageSize[0]
    const w = Math.max(1, Math.round(crop.w * scale))
    const h = Math.max(1, Math.round(crop.h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) return null
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, w, h)
    context.drawImage(bitmap, crop.x * scale, crop.y * scale, crop.w * scale, crop.h * scale, 0, 0, w, h)
    bitmap.close()
    return context.getImageData(0, 0, w, h)
  } catch {
    return null
  }
}

export function recognizeImageText(image: Blob): Promise<string | null> {
  return predict(image, {
    textDetLimitSideLen: 1600,
    textDetLimitType: 'max',
    textDetMaxSideLimit: 1800,
    textRecScoreThresh: 0.35,
  }).then((result) => result === null ? null : joinRecognizedText(result.items))
}

/** OCR 줄마다의 글자와 꼭짓점(그림 픽셀). 검색 가능한 PDF 를 만들 때 쓴다 */
export function recognizeImageLines(image: Blob): Promise<readonly { text: string; poly: readonly (readonly [number, number])[] }[] | null> {
  return predict(image, {
    textDetLimitSideLen: 1600,
    textDetLimitType: 'max',
    textDetMaxSideLimit: 1800,
    textRecScoreThresh: 0.35,
  }).then((result) => result === null ? null : result.items.map(({ text, poly }) => ({ text, poly })))
}
