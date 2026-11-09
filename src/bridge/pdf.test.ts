// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { pageImageUrl, pickPdfFile, openPdf, pageTextIndex, TEXT_INDEX_CACHE_PAGES } from './pdf'
import { MIN_RENDER_WIDTH, MAX_RENDER_WIDTH } from '../pdf/renderWidth'
import { SAMPLE_DOC_ID } from '../pdf/samplePage'

/**
 * 이 파일이 막는 고장은 하나다 — `convertFileSrc` 로 URL 을 만들면 인자
 * 전체가 `encodeURIComponent` 를 거쳐 `/` 가 `%2F` 가 되고, 조각 하나짜리
 * 경로가 되어 Rust 쪽이 **모든** 페이지에 400 을 돌려준다. 화면에는 빈
 * 페이지만 보이고 원인은 어디에도 안 적힌다.
 *
 * 그래서 여기서 확인하는 것은 "페이지가 보인다"가 아니라 URL 의 모양이다.
 */

const DOC = '0123456789ab'

function setUserAgent(agent: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: agent, configurable: true })
}

const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WebView2'
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'userAgent')
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
  vi.restoreAllMocks()
})

describe('pageImageUrl — 플랫폼별 바탕', () => {
  it('Windows 에서는 http://iwae.localhost 다', () => {
    setUserAgent(WINDOWS_UA)
    expect(pageImageUrl(DOC, 0, 800)).toBe('http://iwae.localhost/page/0123456789ab/0?w=800')
  })

  it('그 밖에서는 iwae://localhost 다', () => {
    setUserAgent(MAC_UA)
    expect(pageImageUrl(DOC, 0, 800)).toBe('iwae://localhost/page/0123456789ab/0?w=800')
  })
})

describe('pageImageUrl — 조각이 살아 있어야 한다', () => {
  it('퍼센트 인코딩이 없다 — convertFileSrc 를 쓰면 여기가 깨진다', () => {
    setUserAgent(WINDOWS_UA)
    const url = pageImageUrl(DOC, 42, 1200)
    expect(url).not.toContain('%2F')
    expect(url).not.toContain('%3F')
    expect(url).not.toContain('%3D')
  })

  it('경로가 page/<docId>/<page> 세 조각이고 질의 문자열이 따로 붙는다', () => {
    setUserAgent(WINDOWS_UA)
    // URL 로 다시 파싱해서 본다. 문자열 비교만 하면 "우연히 같은 글자"를
    // 통과시킬 수 있지만, 파서가 조각을 셋으로 나눠 준다면 Rust 의
    // parse_page_uri 도 같은 셋으로 나눈다.
    const parsed = new URL(pageImageUrl(DOC, 42, 1200))
    expect(parsed.pathname.split('/').filter((s) => s !== '')).toEqual(['page', DOC, '42'])
    expect(parsed.searchParams.get('w')).toBe('1200')
  })

  it('첫 페이지는 0 이다 — 0-기반이 Rust·pageSizes 와 같아야 한다', () => {
    setUserAgent(MAC_UA)
    expect(pageImageUrl(DOC, 0, 400)).toContain('/0?w=')
    expect(pageImageUrl(DOC, 1016, 400)).toContain('/1016?w=')
  })

  it('음수·소수 페이지는 정수 0-기반으로 바로잡는다', () => {
    setUserAgent(MAC_UA)
    expect(pageImageUrl(DOC, -3, 400)).toContain('/0?w=')
    expect(pageImageUrl(DOC, 7.9, 400)).toContain('/7?w=')
  })

  it('폭은 Rust 가 받는 범위로 잘려 나간다', () => {
    setUserAgent(MAC_UA)
    expect(pageImageUrl(DOC, 0, 999_999)).toContain(`?w=${MAX_RENDER_WIDTH}`)
    expect(pageImageUrl(DOC, 0, 0)).toContain(`?w=${MIN_RENDER_WIDTH}`)
  })
})

describe('Tauri 밖에서의 행동', () => {
  /**
   * window.test.ts 와 같은 성질을 PDF 쪽에서도 지킨다(스펙 §9.1):
   * Tauri 가 없어도 `npm run dev` 와 `npm test` 가 살아 있어야 한다.
   * 여기서는 __TAURI_INTERNALS__ 를 넣지 않으므로 항상 "밖"이다.
   */
  it('pickPdfFile 은 null 이다 — 고를 파일이 없는 것이지 오류가 아니다', async () => {
    await expect(pickPdfFile()).resolves.toBeNull()
  })

  it('openPdf 는 시끄럽게 실패한다 — 가짜 메타를 지어내면 빈 페이지가 뜬다', async () => {
    await expect(openPdf('C:/spec.pdf')).rejects.toThrow(/데스크톱/)
  })

  it('개발 PDF 는 PDFium 이 미리 렌더한 PNG 를 보여준다', () => {
    expect(pageImageUrl(SAMPLE_DOC_ID, 0, 800)).toBe('/dev-pdf/page-1.png')
    expect(pageImageUrl(SAMPLE_DOC_ID, 1, 1200)).toBe('/dev-pdf/page-2.png')
  })

  it('개발 PDF 도 실제 글자 상자를 돌려줘 웹에서 선택할 수 있다', async () => {
    await expect(pageTextIndex(SAMPLE_DOC_ID, 0)).resolves.toMatchObject({
      text: expect.stringContaining('From Evidence'),
      chars: expect.arrayContaining([
        expect.objectContaining({ c: 'I', x: expect.any(Number), y: expect.any(Number) }),
      ]),
    })
  })
})

describe('pageTextIndex — 페이지별 캐시', () => {
  it('같은 문서·페이지는 invoke 를 한 번만 호출한다', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const invoke = vi.fn().mockResolvedValue({
      text: 'A',
      chars: [{ c: 'A', x: 0, y: 0, w: 1, h: 1 }],
    })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))

    await expect(pageTextIndex('cachetest001', 3)).resolves.toMatchObject({ text: 'A' })
    await expect(pageTextIndex('cachetest001', 3)).resolves.toMatchObject({ text: 'A' })

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('pdf_page_text', { docId: 'cachetest001', page: 3 })
  })

  it('쪽 글자는 최근에 쓴 것만 정해진 수까지 들고 있는다(큰 PDF 를 검색해도 메모리가 계속 늘지 않게)', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const invoke = vi.fn().mockResolvedValue({ text: 'A', chars: [] })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))

    await pageTextIndex('lru-doc', 0)
    for (let page = 1; page <= TEXT_INDEX_CACHE_PAGES; page += 1) {
      await pageTextIndex('lru-doc', page)
      // 0 쪽은 계속 쓰니 남는다
      if (page === TEXT_INDEX_CACHE_PAGES - 1) await pageTextIndex('lru-doc', 0)
    }
    expect(invoke).toHaveBeenCalledTimes(TEXT_INDEX_CACHE_PAGES + 1)
    await pageTextIndex('lru-doc', 0)
    expect(invoke).toHaveBeenCalledTimes(TEXT_INDEX_CACHE_PAGES + 1)
    // 가장 오래 안 쓴 1 쪽은 밀려나 다시 읽는다
    await pageTextIndex('lru-doc', 1)
    expect(invoke).toHaveBeenCalledTimes(TEXT_INDEX_CACHE_PAGES + 2)
  })
})

describe('링크·정보·주석 이음매', () => {
  it('페이지 링크는 문서·페이지마다 한 번만 읽는다', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const links = [{ rect: { x: 1, y: 2, w: 3, h: 4 }, target: { kind: 'page', page: 1, y: null } }]
    const invoke = vi.fn().mockResolvedValue(links)
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))
    const { pdfPageLinks } = await import('./pdf')

    await expect(pdfPageLinks('linkcache001', 0)).resolves.toEqual(links)
    await expect(pdfPageLinks('linkcache001', 0)).resolves.toEqual(links)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('pdf_page_links', { docId: 'linkcache001', page: 0 })
  })

  it('정보·주석·내보내기는 각자의 명령을 부른다', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const invoke = vi.fn().mockResolvedValue(null)
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))
    const { pdfMetadata, pdfAnnotations, exportAnnotatedPdf } = await import('./pdf')

    await pdfMetadata('metadoc00001')
    await pdfAnnotations('metadoc00001')
    await exportAnnotatedPdf('metadoc00001', [{ page: 0, rects: [], color: [255, 230, 0], note: null }], '논문 주석')
    expect(invoke).toHaveBeenCalledWith('pdf_metadata', { docId: 'metadoc00001' })
    expect(invoke).toHaveBeenCalledWith('pdf_annotations', { docId: 'metadoc00001' })
    expect(invoke).toHaveBeenCalledWith('pdf_export_annotated', {
      docId: 'metadoc00001',
      highlights: [{ page: 0, rects: [], color: [255, 230, 0], note: null }],
      suggestedName: '논문 주석',
    })
  })

  it('브라우저 미리보기 샘플 문서는 링크·주석 없이 빈 값을 준다', async () => {
    const { pdfPageLinks, pdfMetadata, pdfAnnotations } = await import('./pdf')
    await expect(pdfPageLinks(SAMPLE_DOC_ID, 0)).resolves.toEqual([])
    await expect(pdfAnnotations(SAMPLE_DOC_ID)).resolves.toEqual([])
    await expect(pdfMetadata(SAMPLE_DOC_ID)).resolves.toEqual({})
  })
})

describe('검색 가능한 PDF 이음매', () => {
  it('OCR 줄을 Rust 로 넘긴다', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
    const invoke = vi.fn().mockResolvedValue({ path: 'C:/out.pdf', written: 3, skipped: 0 })
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))
    const { exportSearchablePdf } = await import('./pdf')
    const pages = [{ page: 0, lines: [{ text: 'x', x: 1, y: 2, w: 3, h: 4 }] }]
    await expect(exportSearchablePdf('docsearch001', pages, '스캔 (검색 가능)')).resolves.toEqual({ path: 'C:/out.pdf', written: 3, skipped: 0 })
    expect(invoke).toHaveBeenCalledWith('pdf_export_searchable', { docId: 'docsearch001', pages, suggestedName: '스캔 (검색 가능)' })
  })
})
