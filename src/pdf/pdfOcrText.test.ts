import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recognizePdfPageLines, recognizePdfPageText } from './pdfOcrText'
import { pageImageUrl } from '../bridge/pdf'
import { recognizeImageLines, recognizeImageText } from './ocrTextDetector'

vi.mock('../bridge/pdf', () => ({ pageImageUrl: vi.fn() }))
vi.mock('./ocrTextDetector', () => ({ recognizeImageText: vi.fn(), recognizeImageLines: vi.fn() }))

describe('PDF 페이지 OCR', () => {
  beforeEach(() => {
    vi.mocked(pageImageUrl).mockReturnValue('iwae://localhost/page/doc/0?w=1800')
    vi.mocked(recognizeImageText).mockResolvedValue('recognized page')
  })

  it('선명한 페이지 이미지를 받아 OCR 검색 본문으로 변환한다', async () => {
    const pageBlob = new Blob(['png'], { type: 'image/png' })
    const fetchPage = vi.fn().mockResolvedValue({ ok: true, blob: async () => pageBlob })

    await expect(recognizePdfPageText('doc', 0, fetchPage)).resolves.toBe('recognized page')

    expect(pageImageUrl).toHaveBeenCalledWith('doc', 0, 1800)
    expect(fetchPage).toHaveBeenCalledWith('iwae://localhost/page/doc/0?w=1800')
    expect(recognizeImageText).toHaveBeenCalledWith(pageBlob)
  })

  it('페이지 렌더 응답 실패를 검색 인덱스 오류로 전달한다', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ ok: false, status: 500, blob: vi.fn() })

    await expect(recognizePdfPageText('doc', 0, fetchPage)).rejects.toThrow('500')
  })
})

describe('PDF 페이지 OCR 줄', () => {
  it('렌더 폭 1800px 기준으로 줄 상자를 페이지 points 로 바꾼다', async () => {
    vi.mocked(pageImageUrl).mockReturnValue('iwae://localhost/page/doc/2?w=1800')
    vi.mocked(recognizeImageLines).mockResolvedValue([
      { text: 'Scanned line', poly: [[180, 360], [900, 360], [900, 396], [180, 396]] },
    ])
    const fetchPage = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['png']) })
    const lines = await recognizePdfPageLines('doc', 2, 612, fetchPage)
    expect(lines).toEqual([{ text: 'Scanned line', x: 61.2, y: 122.4, w: 244.8, h: expect.closeTo(12.24, 5) }])
  })

  it('OCR 엔진이 없으면 오류로 알린다', async () => {
    vi.mocked(recognizeImageLines).mockResolvedValue(null)
    const fetchPage = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['png']) })
    await expect(recognizePdfPageLines('doc', 0, 612, fetchPage)).rejects.toThrow('OCR')
  })
})
