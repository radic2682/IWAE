// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.hoisted(() => vi.fn())

vi.mock('@paddleocr/paddleocr-js', () => ({ PaddleOCR: { create } }))

describe('ocrTextDetector', () => {
  beforeEach(() => {
    vi.resetModules()
    create.mockReset()
  })

  it('SDK 공식 worker 모드로 한 번만 초기화한다', async () => {
    create.mockResolvedValue({ predict: vi.fn() })
    const { prewarmPdfTextDetector } = await import('./ocrTextDetector')

    await expect(prewarmPdfTextDetector()).resolves.toBe(true)
    await expect(prewarmPdfTextDetector()).resolves.toBe(true)
    expect(create).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      worker: true,
      textDetectionModelName: 'PP-OCRv5_mobile_det',
      textRecognitionModelName: 'PP-OCRv6_tiny_rec',
    }))
  })

  it('worker 결과를 점수 기준으로 정제해 검색 본문으로 돌려준다', async () => {
    const predict = vi.fn().mockResolvedValue([{
      items: [
        { poly: [[0, 0], [10, 0], [10, 4], [0, 4]], text: ' first ', score: 0.9 },
        { poly: [[0, 5], [10, 5], [10, 9], [0, 9]], text: 'ignored', score: 0.1 },
        { poly: [[0, 10], [10, 10], [10, 14], [0, 14]], text: 'second', score: 0.8 },
      ],
    }])
    create.mockResolvedValue({ predict })
    const { recognizeImageText } = await import('./ocrTextDetector')
    const image = new Blob(['png'], { type: 'image/png' })

    await expect(recognizeImageText(image)).resolves.toBe('first\nsecond')
    expect(predict).toHaveBeenCalledWith(image, expect.objectContaining({
      textDetLimitSideLen: 1600,
      textDetLimitType: 'max',
    }))
  })
})
