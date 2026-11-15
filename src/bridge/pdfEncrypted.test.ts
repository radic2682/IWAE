// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { editPdfPages, isPasswordProtectedDoc, openPdf, runPdfTool, setPdfPasswordPrompt, type PdfDocMeta } from './pdf'

function meta(docId: string, encrypted: boolean): PdfDocMeta {
  return { docId, sha256: docId, size: 1, title: docId, pageCount: 2, pageSizes: [[612, 792], [612, 792]], hasText: true, encrypted }
}

beforeEach(() => {
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  invoke.mockReset()
})

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  setPdfPasswordPrompt(null)
})

describe('암호가 걸린 PDF 표시', () => {
  it('소유자 암호만 있어 암호 없이 열리는 PDF 도 암호가 걸린 문서로 안다', async () => {
    invoke.mockResolvedValueOnce(meta('aaaaaaaaaaaa', true))
    await openPdf('C:/owner-only.pdf')
    expect(isPasswordProtectedDoc('aaaaaaaaaaaa')).toBe(true)
  })

  it('암호 없는 PDF 는 암호가 걸린 문서가 아니다', async () => {
    invoke.mockResolvedValueOnce(meta('bbbbbbbbbbbb', false))
    await openPdf('C:/plain.pdf')
    expect(isPasswordProtectedDoc('bbbbbbbbbbbb')).toBe(false)
  })

  it('암호 PDF 를 쪽 편집하라는 요청이 거절되면 Rust 의 문구를 그대로 던진다(화면의 「저장하지 못했습니다」 줄에 뜬다)', async () => {
    invoke.mockRejectedValueOnce('암호가 걸린 PDF 는 쪽 편집을 할 수 없습니다.')
    await expect(editPdfPages('aaaaaaaaaaaa', 'C:/a.pdf', 'C:/b.pdf', [{ page: 0, rotate: 0 }])).rejects.toBe('암호가 걸린 PDF 는 쪽 편집을 할 수 없습니다.')
  })
})

describe('다른 PDF 의 암호', () => {
  it('끼울 쪽의 PDF 가 암호 PDF 면 편집 전에 암호를 묻고, 푼 뒤에 편집한다', async () => {
    const asked: string[] = []
    setPdfPasswordPrompt(async ({ path }) => {
      asked.push(path)
      return 'secret'
    })
    invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === 'pdf_check_source') {
        if (args.password === undefined) throw new Error('IWAE_PDF_PASSWORD_REQUIRED: 암호로 보호된 PDF 입니다: other.pdf')
        return undefined
      }
      if (command === 'pdf_edit_pages') return meta('dddddddddddd', false)
      throw new Error(`unexpected ${command}`)
    })

    await editPdfPages('dddddddddddd', 'C:/host.pdf', 'C:/backup.pdf', [
      { page: 0, rotate: 0 },
      { source: 'C:/other.pdf', page: 0, rotate: 0 },
    ])

    expect(asked).toEqual(['C:/other.pdf'])
    const order = invoke.mock.calls.map((call) => call[0])
    expect(order.at(-1)).toBe('pdf_edit_pages')
    expect(order).not.toContain('pdf_open')
    expect(order.indexOf('pdf_check_source')).toBeLessThan(order.indexOf('pdf_edit_pages'))
  })

  it('합칠 PDF 의 암호를 취소하면 합치지 않는다', async () => {
    setPdfPasswordPrompt(async () => null)
    invoke.mockRejectedValue(new Error('IWAE_PDF_PASSWORD_REQUIRED: 암호로 보호된 PDF 입니다: other.pdf'))
    await expect(runPdfTool('dddddddddddd', { kind: 'merge', sources: ['C:/other.pdf'] }, { kind: 'newFile', path: 'C:/out.pdf' })).rejects.toMatchObject({ name: 'PdfPasswordError' })
    expect(invoke.mock.calls.some((call) => call[0] === 'pdf_tool')).toBe(false)
  })

  it('합칠 PDF 를 확인할 때 문서 캐시에 올리지 않고(pdf_open 없이) 틀린 암호는 다시 묻는다', async () => {
    const seen: boolean[] = []
    setPdfPasswordPrompt(async ({ wrong }) => {
      seen.push(wrong)
      return wrong ? 'good' : 'bad'
    })
    invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === 'pdf_check_source') {
        if (args.path !== 'C:/locked.pdf') return undefined
        if (args.password === undefined) throw new Error('IWAE_PDF_PASSWORD_REQUIRED: x')
        if (args.password === 'bad') throw new Error('IWAE_PDF_PASSWORD_WRONG: x')
        return undefined
      }
      if (command === 'pdf_tool') return null
      throw new Error(`unexpected ${command}`)
    })
    const sources = Array.from({ length: 20 }, (_, i) => (i === 0 ? 'C:/locked.pdf' : `C:/s${i}.pdf`))
    await runPdfTool('host', { kind: 'merge', sources: [...sources, 'C:/s1.pdf'] }, { kind: 'newFile', path: 'C:/out.pdf' })
    expect(seen).toEqual([false, true])
    expect(invoke.mock.calls.some((call) => call[0] === 'pdf_open')).toBe(false)
    expect(invoke.mock.calls.filter((call) => call[0] === 'pdf_check_source' && call[1].password === undefined)).toHaveLength(20)
  })

  it('쪽 편집에 다른 PDF 가 없으면 따로 열지 않는다', async () => {
    invoke.mockResolvedValue(meta('dddddddddddd', false))
    await editPdfPages('dddddddddddd', 'C:/host.pdf', 'C:/backup.pdf', [{ page: 1, rotate: 90 }])
    expect(invoke.mock.calls.map((call) => call[0])).toEqual(['pdf_edit_pages'])
  })
})
