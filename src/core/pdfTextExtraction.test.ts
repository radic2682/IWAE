import { describe, expect, it, vi } from 'vitest'
import { extractPdfDocumentPages, extractPdfDocumentText } from './pdfTextExtraction'

describe('PDF 본문 백그라운드 추출', () => {
  it('완료 순서와 관계없이 페이지 번호와 본문을 원래 순서로 반환한다', async () => {
    const pages = await extractPdfDocumentPages(3, async (page) => {
      await new Promise((resolve) => setTimeout(resolve, page === 0 ? 12 : 1))
      return { text: `page-${page}`, chars: [] }
    }, 3)

    expect(pages).toEqual([
      { page: 0, text: 'page-0' },
      { page: 1, text: 'page-1' },
      { page: 2, text: 'page-2' },
    ])
  })

  it('동시 작업 수를 제한하면서 페이지 순서대로 본문을 합친다', async () => {
    let active = 0
    let peak = 0
    const loadPage = vi.fn(async (page: number) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, page === 0 ? 10 : 1))
      active -= 1
      return { text: `page-${page}`, chars: [] }
    })

    await expect(extractPdfDocumentText(5, loadPage, 2)).resolves.toBe(
      'page-0\n\npage-1\n\npage-2\n\npage-3\n\npage-4',
    )
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('개별 페이지 실패는 격리하고 읽은 페이지 본문은 유지한다', async () => {
    const loadPage = vi.fn(async (page: number) => {
      if (page === 1) throw new Error('damaged page')
      return { text: `page-${page}`, chars: [] }
    })

    await expect(extractPdfDocumentText(3, loadPage, 2)).resolves.toBe('page-0\n\npage-2')
  })

  it('텍스트 레이어가 빈 페이지만 OCR 결과로 보완한다', async () => {
    const loadPage = vi.fn(async (page: number) => ({
      text: page === 0 ? 'embedded text' : '',
      chars: [],
    }))
    const loadOcrPage = vi.fn(async (page: number) => `ocr-${page}`)

    await expect(extractPdfDocumentText(2, loadPage, 2, loadOcrPage)).resolves.toBe(
      'embedded text\n\nocr-1',
    )
    expect(loadOcrPage).toHaveBeenCalledTimes(1)
    expect(loadOcrPage).toHaveBeenCalledWith(1)
  })

  it('OCR 실패는 다른 페이지의 검색 본문을 버리지 않는다', async () => {
    const loadPage = vi.fn(async () => ({ text: '', chars: [] }))
    const loadOcrPage = vi.fn(async (page: number) => {
      if (page === 0) throw new Error('ocr unavailable')
      return `ocr-${page}`
    })

    await expect(extractPdfDocumentText(2, loadPage, 1, loadOcrPage)).resolves.toBe('ocr-1')
  })
})
