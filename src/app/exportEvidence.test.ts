// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildEvidenceHtml, saveHtmlFile, type EvidenceRasterizer } from './exportEvidence'
import type { CanvasDocumentV2, CanvasBlockData, TextBlockStyle } from '../core/canvasDocument'
import type { Anchor } from '../core/anchor'

const style = { level: 'paragraph', fontSize: 16, bold: false, italic: false, underline: false, strike: false, code: false, align: 'left', list: 'none', color: '', highlight: '', background: '', borderColor: '' } as TextBlockStyle

function excerpt(id: string, docId: string, page: number, quote: string, y: number) {
  const anchor: Anchor = { docId, page, coordSpace: 'pdfium-page', rects: [{ x: 10, y: 20, w: 50, h: 10 }], charRange: [0, 1], quote, prefix: '', suffix: '' }
  return {
    id, type: 'pdfExcerpt', position: { x: 0, y },
    data: { block: {
      kind: 'pdfExcerpt', width: 200, height: 60, style,
      excerpt: { id, type: 'pdfExcerpt', x: 0, y: 0, width: 200, height: 60, text: quote, sourceTitle: '논문',
        selection: { mode: 'text', anchor, pageSize: [612, 792], crop: { x: 10, y: 20, w: 50, h: 10 }, glyphs: [] },
        iwae: { kind: 'pdf-excerpt', anchor } },
      source: { relation: 'excerpt', anchor },
    } as unknown as CanvasBlockData },
  }
}

const document: CanvasDocumentV2 = {
  version: 2,
  viewport: { x: 0, y: 0, zoom: 1 },
  edges: [],
  nodes: [
    { id: 't', type: 'note', position: { x: 0, y: 0 }, data: { block: { kind: 'title', text: '정리', width: 200, height: 40, style } } },
    excerpt('a', 'doc1', 3, '첫 인용', 100),
    excerpt('b', 'doc1', 3, '같은 쪽 두 번째', 200),
  ],
}

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('buildEvidenceHtml', () => {
  it('fetches each cited page once and cuts its crops from the same render', async () => {
    const rasterizer: EvidenceRasterizer = {
      page: vi.fn<EvidenceRasterizer['page']>(async (_url, _size, crops) => ({
        page: 'data:image/jpeg;base64,PAGE',
        crops: Object.fromEntries(Object.entries(crops).map(([id, crop]) => [id, `data:image/png;base64,CROP${crop.y}`])),
      })),
    }
    const html = await buildEvidenceHtml({
      title: '노트',
      document,
      docs: { doc1: { title: '논문 제목', authors: ['A'], year: 2020 } },
      rasterizer,
      imageUrl: (docId, page, width) => `img://${docId}/${page}?w=${width}`,
      now: new Date('2026-10-02T00:00:00Z'),
    })
    expect(rasterizer.page).toHaveBeenCalledTimes(1)
    expect(rasterizer.page).toHaveBeenCalledWith(
      'img://doc1/3?w=1600',
      [612, 792],
      { a: { x: 10, y: 20, w: 50, h: 10 }, b: { x: 10, y: 20, w: 50, h: 10 } },
      [{ x: 10, y: 20, w: 50, h: 10 }, { x: 10, y: 20, w: 50, h: 10 }],
    )
    expect(html).toContain('data:image/jpeg;base64,PAGE')
    expect(html).toContain('data:image/png;base64,CROP20')
    expect(html).toContain('논문 제목')
  })

  it('keeps going when a page fails to load', async () => {
    const rasterizer: EvidenceRasterizer = {
      page: vi.fn(async () => { throw new Error('missing') }),
    }
    const html = await buildEvidenceHtml({ title: '노트', document, docs: {}, rasterizer, imageUrl: () => 'x', now: new Date() })
    expect(html).toContain('원본 쪽을 불러오지 못했습니다')
    expect(html).toContain('첫 인용')
  })
})

describe('saveHtmlFile', () => {
  it('downloads in the browser preview', async () => {
    const createObjectURL = vi.fn(() => 'blob:x')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    await expect(saveHtmlFile('노트 근거.html', '<html></html>')).resolves.toBe('노트 근거.html')
    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
  })

  it('asks where to save on the desktop and writes the file', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const save = vi.fn().mockResolvedValue('C:/Users/me/노트 근거.html')
    const writeTextFile = vi.fn().mockResolvedValue(undefined)
    vi.doMock('@tauri-apps/plugin-dialog', () => ({ save }))
    vi.doMock('@tauri-apps/plugin-fs', () => ({ writeTextFile }))
    const { saveHtmlFile: desktopSave } = await import('./exportEvidence')
    await expect(desktopSave('노트 근거.html', '<html></html>')).resolves.toBe('C:/Users/me/노트 근거.html')
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: '노트 근거.html' }))
    expect(writeTextFile).toHaveBeenCalledWith('C:/Users/me/노트 근거.html', '<html></html>')

    save.mockResolvedValue(null)
    await expect(desktopSave('x.html', 'y')).resolves.toBeNull()
  })
})
