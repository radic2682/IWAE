// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { parsePageSpec, safeOutputName } from './pdfTools'
import { fakeApp, makeEnv } from './testHarness'

vi.mock('../../bridge/pdf', async () => {
  const h = await import('./testPdf')
  return { ...(await vi.importActual<object>('../../bridge/pdf')), pageTextIndex: h.fakePageTextIndex }
})

describe('parsePageSpec', () => {
  it('범위와 낱쪽을 정렬·중복 제거한다', () => {
    expect(parsePageSpec('3, 1-2,2', 5)).toEqual([1, 2, 3])
  })
  it('형식이 틀리거나 범위 밖이면 던진다', () => {
    for (const bad of ['', 'a', '0', '2-1', '1-9', '1;2']) expect(() => parsePageSpec(bad, 5)).toThrow()
  })
})

describe('safeOutputName', () => {
  it('경로 글자와 점만인 이름을 거른다', () => {
    expect(safeOutputName('../a/b.pdf')).toBe('.. a b')
    expect(safeOutputName('..')).toBeUndefined()
    expect(safeOutputName('x'.repeat(200))).toHaveLength(80)
    expect(safeOutputName(3)).toBeUndefined()
  })
})

describe('MCP PDF 도구', () => {
  it('항상 새 파일 도구를 부르고 결과를 돌려준다', async () => {
    const runPdfTool = vi.fn(async () => ({ path: 'C:/vault/out.pdf', docId: 'n1', pageCount: 2 }))
    const app = fakeApp({ runPdfTool, docs: [{ docId: 'd1', title: 'D', kind: 'pdf', folder: '', favorite: false, pageCount: 5, lastOpenedAt: null, addedAt: null, pagesWithText: null, scanned: null, ocr: null }] })
    const env = makeEnv({ app, pdfs: { d1: ['1', '2', '3', '4', '5'] } })
    const extracted = await env.call('pdf_extract_pages', { doc_id: 'd1', pages: '1-2', output_name: 'part' })
    expect(extracted).toMatchObject({ doc_id: 'n1', path: 'C:/vault/out.pdf', page_count: 2 })
    expect(runPdfTool).toHaveBeenCalledWith('d1', { kind: 'extract', pages: '1,2', outputName: 'part' })
    await env.call('pdf_add_page_numbers', { doc_id: 'd1', position: 'top-left', start_at: 3 })
    expect(runPdfTool).toHaveBeenLastCalledWith('d1', { kind: 'pageNumbers', position: 'top-left', startAt: 3 })
    await expect(env.call('pdf_extract_pages', { doc_id: 'd1', pages: '9' })).rejects.toThrow(/범위/u)
    await expect(env.call('pdf_add_page_numbers', { doc_id: 'd1', position: 'middle' })).rejects.toThrow(/position/u)
    await expect(env.call('pdf_extract_pages', { doc_id: 'x', pages: '1' })).rejects.toThrow(/doc_id not found/u)
  })
})
