// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, fireEvent, waitFor, act } from '@testing-library/react'
import type { Anchor } from '../core/anchor'
import type { VisiblePdfSourceReference } from '../core/workspaceSources'
import type { PdfSearchMatch } from '../core/pdfSearch'
import { setHighlightTool } from './highlightToolStore'
import { PdfPane, pageFitZoom } from './PdfPane'
import { resetMemoStore, setMemoBarVisible } from './memoStore'
import { MemoNoteContext, type MemoNoteApi } from './memoNoteContext'
import type { ReactNode } from 'react'

vi.mock('../bridge/pdf', async (importOriginal) => {
  const original = await importOriginal<typeof import('../bridge/pdf')>()
  return {
    ...original,
    pageTextIndex: vi.fn().mockResolvedValue({
      text: 'A',
      chars: [{ c: 'A', x: 10, y: 10, w: 10, h: 10 }],
    }),
    pdfPageLinks: vi.fn(async (_docId: string, page: number) => page === 0
      ? [
          { rect: { x: 40, y: 100, w: 100, h: 14 }, target: { kind: 'page', page: 4, y: 300 } },
          { rect: { x: 40, y: 140, w: 100, h: 14 }, target: { kind: 'uri', uri: 'https://example.com' } },
        ]
      : []),
  }
})

/**
 * 이 파일의 핵심 단언은 하나다 — **보이지 않는 페이지의 `<img>` 는 DOM 에
 * 없다.** 1,000쪽을 다 얹으면 문서를 여는 것만으로 1,000개의 요청이 걸리고
 * 메모리가 페이지 수에 비례해 늘어난다. 그것이 M4 완료 기준에 적힌 항목이라
 * 브라우저 없이 확인할 수 있는 모양으로 여기 못박는다.
 *
 * bridge 의 `pageImageUrl` 은 목으로 갈지 않고 진짜를 쓴다. 그 함수는
 * Tauri 를 만지지 않는 순수 문자열 조립이라 jsdom 에서 안전하고, 목으로
 * 바꾸면 "PdfPane 이 만드는 src 가 실제로 어떤 모양인가"를 확인할 길이
 * 사라진다 — 목이 실제 구현과 다르게 적히면 테스트만 통과한다.
 * Tauri 를 실제로 부르는 pickPdfFile·openPdf 는 여기서 쓰지 않는다.
 */

const PAGE_COUNT = 1000
const VIEWPORT_WIDTH = 800
const VIEWPORT_HEIGHT = 600

/** A4 비슷한 세로 페이지(points). 1,000쪽 전부 같은 크기다. */
function uniformSizes(count: number): readonly (readonly [number, number])[] {
  return Array.from({ length: count }, (): readonly [number, number] => [612, 792])
}

/**
 * jsdom 에는 레이아웃이 없어서 clientWidth/clientHeight 가 언제나 0 이다.
 * 프로토타입에 값을 덮어써서 "폭 800, 높이 600 인 패널"을 만든다 —
 * PdfPane 의 측정 경로(useLayoutEffect → clientWidth)는 그대로 돌고,
 * 숫자만 테스트가 정한다.
 */
function setViewport(width: number, height: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => width,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => height,
  })
}

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
})

function mount(
  options: {
    hasText?: boolean
    pageCount?: number
    onAnchorCreated?: (anchor: Anchor | null) => void
    onPersistentHighlightCreated?: (highlight: { id: string; anchor: Anchor; color: string }) => void
    onPersistentHighlightRemoved?: (highlightId: string) => void
    persistentHighlights?: readonly { id: string; anchor: Anchor; color: string }[]
    interactionMode?: 'hand' | 'text' | 'lasso' | 'highlight'
    pageRequest?: { page: number; nonce: number }
    sourceHighlights?: readonly VisiblePdfSourceReference[]
    searchMatches?: readonly PdfSearchMatch[]
    activeSearchMatchId?: string | null
    onInteractionModeChange?: (mode: 'hand' | 'text' | 'lasso' | 'highlight' | 'box' | 'edit') => void
    onHighlightColorChange?: (color: string) => void
    onLinkNavigate?: (page: number) => void
    onExternalLink?: (uri: string) => void
    onPersistentHighlightUpdated?: (id: string, patch: { color?: string; note?: string }) => void
    spread?: 'single' | 'double' | 'triple'
    continuous?: boolean
    rotation?: 0 | 90 | 180 | 270
    invert?: boolean
    onlyOpenNotes?: boolean
    noteApi?: MemoNoteApi
  } = {},
) {
  setViewport(VIEWPORT_WIDTH, VIEWPORT_HEIGHT)
  const view = render(
    <PdfPane
      docId="0123456789ab"
      pageSizes={uniformSizes(options.pageCount ?? PAGE_COUNT)}
      hasText={options.hasText ?? true}
      onAnchorCreated={options.onAnchorCreated}
      onPersistentHighlightCreated={options.onPersistentHighlightCreated}
      onPersistentHighlightRemoved={options.onPersistentHighlightRemoved}
      persistentHighlights={options.persistentHighlights}
      interactionMode={options.interactionMode}
      pageRequest={options.pageRequest}
      sourceHighlights={options.sourceHighlights}
      searchMatches={options.searchMatches}
      activeSearchMatchId={options.activeSearchMatchId}
      onInteractionModeChange={options.onInteractionModeChange}
      onHighlightColorChange={options.onHighlightColorChange}
      onLinkNavigate={options.onLinkNavigate}
      onExternalLink={options.onExternalLink}
      onPersistentHighlightUpdated={options.onPersistentHighlightUpdated}
      spread={options.spread}
      continuous={options.continuous}
      rotation={options.rotation}
      invert={options.invert}
      onlyOpenNotes={options.onlyOpenNotes}
    />,
    options.noteApi === undefined ? undefined : {
      wrapper: ({ children }: { children: ReactNode }) => <MemoNoteContext.Provider value={options.noteApi!}>{children}</MemoNoteContext.Provider>,
    },
  )
  const scroller = view.container.querySelector('.pdf-pane')
  if (scroller === null) throw new Error('.pdf-pane 이 없다')
  return { ...view, scroller }
}

/** 지금 DOM 에 있는 페이지 번호들(0-기반). src 의 마지막 경로 조각에서 읽는다. */
function renderedPages(container: HTMLElement): number[] {
  // 쪽마다 본 그림 하나(밑에 잠깐 깔리는 미리보기는 세지 않는다)
  return Array.from(container.querySelectorAll('img.pdf-page-full')).map((img) => {
    const match = /\/page\/[0-9a-f]{12}\/(\d+)\?/.exec(img.getAttribute('src') ?? '')
    return match === null ? Number.NaN : Number(match[1])
  })
}

/** jsdom 은 scrollTop 을 저장하지 않는다(레이아웃이 없다). 직접 심는다. */
function scrollTo(scroller: Element, top: number) {
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: top })
  fireEvent.scroll(scroller)
}

describe('PdfPane — 보이는 페이지만 DOM 에 있다', () => {
  it('형광펜 지우개(도구줄의 색 판과 같이 쓰는 상태)를 켜면 형광펜을 눌러 지운다', async () => {
    const anchor: Anchor = {
      docId: '0123456789ab', page: 0, coordSpace: 'pdfium-page',
      rects: [{ x: 10, y: 10, w: 10, h: 10 }], charRange: [0, 1], quote: 'A', prefix: '', suffix: '',
    }
    const onPersistentHighlightRemoved = vi.fn()
    setHighlightTool({ erase: true })
    try {
      const { container } = mount({
        pageCount: 3,
        interactionMode: 'highlight',
        persistentHighlights: [{ id: 'visible-highlight', anchor, color: 'yellow' }],
        onPersistentHighlightRemoved,
      })
      await waitFor(() => expect(container.querySelector('.selection-layer[data-page="0"]')).not.toBeNull())
      const layer = container.querySelector('.selection-layer[data-page="0"]')!
      fireEvent.pointerDown(layer, { button: 0, clientX: 15, clientY: 15, pointerId: 1 })
      fireEvent.pointerUp(layer, { button: 0, clientX: 15, clientY: 15, pointerId: 1 })
      expect(onPersistentHighlightRemoved).toHaveBeenCalledWith('visible-highlight')
    } finally {
      setHighlightTool({ erase: false })
    }
  })

  it('1,000쪽 문서에서도 <img> 는 한 줌이다', () => {
    const { container } = mount()
    const images = container.querySelectorAll('img')
    // 페이지 하나가 뷰포트보다 높으므로 보이는 것은 한두 장, overscan 을
    // 더해도 네댓 장이다. 숫자를 느슨하게 잡되 페이지 수와는 무관해야 한다.
    expect(images.length).toBeGreaterThan(0)
    expect(images.length).toBeLessThan(10)
    expect(images.length).toBeLessThan(PAGE_COUNT / 10)
  })

  it('처음에는 문서의 첫머리가 보인다', () => {
    const { container } = mount()
    expect(renderedPages(container)).toContain(0)
  })

  it('스크롤하면 DOM 에 있는 페이지가 바뀐다', async () => {
    const { container, scroller } = mount()
    const before = renderedPages(container)
    expect(before).toContain(0)

    // 한 쪽 높이가 (800 - 24) * 792/612 ≈ 1004px 이므로 500,000px 은
    // 문서의 한가운데쯤이다.
    scrollTo(scroller, 500_000)

    // 스크롤은 프레임 단위로 합쳐진다(rAF). 그래서 기다려야 한다 —
    // 이 기다림 자체가 "이벤트마다 요청하지 않는다"의 증거이기도 하다.
    await waitFor(() => {
      expect(renderedPages(container)).not.toContain(0)
    })

    const after = renderedPages(container)
    expect(after.length).toBeLessThan(10)
    expect(Math.min(...after)).toBeGreaterThan(400)
    // 지나쳐 온 페이지들은 남지 않는다. 쌓이면 스크롤할수록 DOM 이 커진다.
    expect(after.some((page) => before.includes(page))).toBe(false)
  })

  it('끝까지 내려도 마지막 페이지를 넘어서 요청하지 않는다', async () => {
    // 없는 페이지는 404 이고 화면엔 빈 줄로만 보인다.
    const { container, scroller } = mount()
    scrollTo(scroller, 10_000_000)
    await waitFor(() => {
      expect(renderedPages(container)).toContain(PAGE_COUNT - 1)
    })
    expect(Math.max(...renderedPages(container))).toBe(PAGE_COUNT - 1)
  })
})

describe('PdfPane — 스크롤 상자', () => {
  it('전체 높이만큼의 빈 상자 하나가 스크롤 막대를 만든다', () => {
    const { container } = mount()
    const spacer = container.querySelector('.pdf-spacer')
    const height = Number.parseFloat(spacer?.getAttribute('style')?.match(/height:\s*([\d.]+)px/)?.[1] ?? '0')
    // 1,000쪽 × 약 1004px + 간격 999개. 정확한 값이 아니라 자릿수를 본다 —
    // 여기가 0 이면 스크롤할 곳이 없고, 페이지 하나 크기면 계산이 끊긴 것이다.
    expect(height).toBeGreaterThan(900_000)
    expect(height).toBeLessThan(1_100_000)
  })

  it('페이지가 없으면 아무 <img> 도 만들지 않는다', () => {
    const { container } = mount({ pageCount: 0 })
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })

  it('문서 높이가 줄어 scrollTop 상태가 범위를 넘더라도 커스텀 손잡이는 뷰포트를 벗어나지 않는다', async () => {
    const { container, scroller } = mount({ pageCount: 2 })
    await act(async () => {
      scrollTo(scroller, 10_000)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })

    const thumb = container.querySelector('.pdf-scrollbar span')
    if (thumb === null) throw new Error('커스텀 스크롤 손잡이가 없다')
    const style = thumb.getAttribute('style') ?? ''
    const height = Number.parseFloat(style.match(/height:\s*([\d.]+)px/)?.[1] ?? '0')
    const top = Number.parseFloat(style.match(/translateY\(([\d.]+)px\)/)?.[1] ?? '0')

    expect(top + height).toBeLessThanOrEqual(VIEWPORT_HEIGHT)
  })
})

describe('PdfPane — 요청 URL', () => {
  it('src 는 조각이 살아 있는 iwae 주소다', () => {
    const { container } = mount()
    const src = container.querySelector('img')?.getAttribute('src') ?? ''
    // convertFileSrc 를 쓰면 여기가 %2F 범벅의 조각 하나짜리 경로가 된다.
    expect(src).not.toContain('%2F')
    expect(src).toMatch(/\/page\/0123456789ab\/\d+\?w=\d+$/)
  })

  it('본 그림은 기기 픽셀 폭 그대로다 — 브라우저가 늘리거나 줄이지 않아 가장 또렷하다', () => {
    const { container } = mount()
    // 내용 폭 800 - 24 = 776, jsdom 의 devicePixelRatio 는 1 → 776px 그대로 요청한다.
    expect(container.querySelector('img.pdf-page-full')?.getAttribute('src')).toContain('?w=776')
  })

  it('같은 화면 안의 페이지들은 모두 같은 폭을 쓴다', () => {
    // 폭이 페이지마다 다르면 캐시가 조각나고 페이지마다 다른 해상도로 보인다.
    const { container } = mount()
    const widths = new Set(
      Array.from(container.querySelectorAll('img.pdf-page-full')).map(
        (img) => /w=(\d+)$/.exec(img.getAttribute('src') ?? '')?.[1],
      ),
    )
    expect(widths.size).toBe(1)
  })
})

describe('PdfPane — 스캔본 표시', () => {
  it('hasText 가 false 면 조용히 표시한다', () => {
    const { container } = mount({ hasText: false })
    expect(container.querySelector('.pdf-scan')).not.toBeNull()
  })

  it('텍스트가 있으면 아무것도 덧붙이지 않는다', () => {
    const { container } = mount({ hasText: true })
    expect(container.querySelector('.pdf-scan')).toBeNull()
  })

  it('텍스트 레이어가 없는 스캔본에도 영역 선택 레이어를 제공한다', async () => {
    const { container } = mount({ hasText: false })
    await Promise.resolve()
    expect(container.querySelector('.selection-layer')?.getAttribute('style')).toContain('crosshair')
  })
})

describe('PdfPane — 텍스트 선택 배선', () => {
  it('형광펜 모드의 생성 콜백을 선택 레이어에서 위로 올린다', async () => {
    const onAnchorCreated = vi.fn()
    const onPersistentHighlightCreated = vi.fn()
    const { container } = mount({
      pageCount: 3,
      interactionMode: 'highlight',
      onAnchorCreated,
      onPersistentHighlightCreated,
    })

    await waitFor(() => {
      expect(container.querySelector('.selection-layer[data-page="0"]')).not.toBeNull()
    })
    const layer = container.querySelector('.selection-layer[data-page="0"]')
    if (layer === null) throw new Error('첫 페이지 선택 레이어가 없다')
    fireEvent.pointerDown(layer, { clientX: 15, clientY: 15, pointerId: 1 })
    fireEvent.pointerMove(layer, { clientX: 18, clientY: 18, pointerId: 1 })
    fireEvent.pointerUp(layer, { clientX: 18, clientY: 18, pointerId: 1 })

    expect(onPersistentHighlightCreated).toHaveBeenCalledTimes(1)
    expect(onPersistentHighlightCreated.mock.calls[0]?.[0]).toMatchObject({
      id: expect.any(String),
      anchor: { page: 0, quote: 'A' },
    })
    expect(onAnchorCreated).not.toHaveBeenCalled()
  })

  it('전달된 영구 형광펜을 문서와 페이지별로 렌더한다', async () => {
    const pageZero: Anchor = {
      docId: '0123456789ab', page: 0, coordSpace: 'pdfium-page',
      rects: [{ x: 10, y: 10, w: 10, h: 10 }], charRange: [0, 1], quote: 'A', prefix: '', suffix: '',
    }
    const otherDocument: Anchor = { ...pageZero, docId: 'ffffffffffff' }
    const { container } = mount({
      pageCount: 3,
      persistentHighlights: [
        { id: 'visible-highlight', anchor: pageZero, color: 'green' },
        { id: 'other-document-highlight', anchor: otherDocument, color: 'yellow' },
      ],
    })

    await waitFor(() => {
      expect(container.querySelector('[data-persistent-highlight="visible-highlight"]')).not.toBeNull()
    })
    expect(container.querySelector('[data-persistent-highlight="other-document-highlight"]')).toBeNull()
  })

  it('같은 페이지에 연결된 여러 블록의 원문 표시를 모두 전달한다', async () => {
    const anchor: Anchor = {
      docId: '0123456789ab',
      page: 0,
      coordSpace: 'pdfium-page',
      rects: [{ x: 10, y: 10, w: 10, h: 10 }],
      charRange: [0, 1],
      quote: 'A',
      prefix: '',
      suffix: '',
    }
    const sourceHighlights: readonly VisiblePdfSourceReference[] = [
      { blockId: 'block-a', anchor, relation: 'excerpt', selected: false, hovered: false, visibleOnCurrentPage: true },
      { blockId: 'block-b', anchor: { ...anchor, rects: [{ x: 30, y: 10, w: 10, h: 10 }] }, relation: 'translation', selected: true, hovered: false, visibleOnCurrentPage: true },
    ]
    const { container } = mount({ pageCount: 3, sourceHighlights })

    await waitFor(() => {
      expect(container.querySelector('[data-pdf-source-target="block-a"]')).not.toBeNull()
      expect(container.querySelector('[data-pdf-source-target="block-b"]')).not.toBeNull()
    })
  })

  it('검색 결과와 출처 표시를 같은 페이지에서 함께 렌더한다', async () => {
    const anchor: Anchor = {
      docId: '0123456789ab', page: 0, coordSpace: 'pdfium-page',
      rects: [{ x: 10, y: 10, w: 10, h: 10 }], charRange: [0, 1], quote: 'A', prefix: '', suffix: '',
    }
    const sourceHighlights: readonly VisiblePdfSourceReference[] = [
      { blockId: 'block-a', anchor, relation: 'excerpt', selected: false, hovered: false, visibleOnCurrentPage: true },
    ]
    const searchMatches: readonly PdfSearchMatch[] = [
      { id: 'match-a', docId: anchor.docId, page: 0, start: 0, end: 1, quote: 'A', before: '', after: '', rects: [{ x: 30, y: 10, w: 10, h: 10 }] },
    ]
    const { container } = mount({ pageCount: 3, sourceHighlights, searchMatches, activeSearchMatchId: 'match-a' })
    await waitFor(() => {
      expect(container.querySelector('.selection-source-highlight')).not.toBeNull()
      expect(container.querySelector('.selection-search-highlight-active')).not.toBeNull()
    })
  })

  it('텍스트 페이지에 선택 레이어를 얹고 만든 앵커를 위로 올린다', async () => {
    const onAnchorCreated = vi.fn()
    const { container } = mount({ pageCount: 3, onAnchorCreated })

    await waitFor(() => {
      expect(container.querySelector('.selection-layer[data-page="0"]')).not.toBeNull()
    })

    const layer = container.querySelector('.selection-layer[data-page="0"]')
    if (layer === null) throw new Error('첫 페이지 선택 레이어가 없다')
    fireEvent.pointerDown(layer, { clientX: 15, clientY: 15, pointerId: 1 })
    fireEvent.pointerMove(layer, { clientX: 18, clientY: 18, pointerId: 1 })
    fireEvent.pointerUp(layer, { clientX: 18, clientY: 18, pointerId: 1 })

    expect(onAnchorCreated).toHaveBeenCalledTimes(1)
    expect(onAnchorCreated.mock.calls[0]?.[0]).toMatchObject({ page: 0, quote: 'A' })
  })

  it('페이지가 DOM 에서 빠졌다 돌아와도 만든 하이라이트를 복원한다', async () => {
    const { container, scroller } = mount({ pageCount: 100 })
    await waitFor(() => {
      expect(container.querySelector('.selection-layer[data-page="0"]')).not.toBeNull()
    })

    const firstLayer = container.querySelector('.selection-layer[data-page="0"]')
    if (firstLayer === null) throw new Error('첫 페이지 선택 레이어가 없다')
    fireEvent.pointerDown(firstLayer, { clientX: 15, clientY: 15, pointerId: 1 })
    fireEvent.pointerMove(firstLayer, { clientX: 18, clientY: 18, pointerId: 1 })
    fireEvent.pointerUp(firstLayer, { clientX: 18, clientY: 18, pointerId: 1 })

    scrollTo(scroller, 50_000)
    await waitFor(() => {
      expect(container.querySelector('.selection-layer[data-page="0"]')).toBeNull()
    })

    scrollTo(scroller, 0)
    await waitFor(() => {
      expect(
        container.querySelectorAll('.selection-mark-layer[data-page="0"] .selection-highlight'),
      ).toHaveLength(1)
    })
  })

  it('선택을 해제한 뒤 페이지가 DOM에서 빠졌다 돌아와도 선택이 되살아나지 않는다', async () => {
    const { container, scroller } = mount({ pageCount: 100 })
    await waitFor(() => {
      expect(container.querySelector('.selection-layer[data-page="0"]')).not.toBeNull()
    })

    const firstLayer = container.querySelector('.selection-layer[data-page="0"]')
    if (firstLayer === null) throw new Error('첫 페이지 선택 레이어가 없다')
    fireEvent.pointerDown(firstLayer, { clientX: 15, clientY: 15, pointerId: 1 })
    fireEvent.pointerMove(firstLayer, { clientX: 18, clientY: 18, pointerId: 1 })
    fireEvent.pointerUp(firstLayer, { clientX: 18, clientY: 18, pointerId: 1 })
    fireEvent.pointerDown(firstLayer, { clientX: 80, clientY: 80, pointerId: 2 })
    fireEvent.pointerUp(firstLayer, { clientX: 80, clientY: 80, pointerId: 2 })

    scrollTo(scroller, 50_000)
    await waitFor(() => {
      expect(container.querySelector('.selection-layer[data-page="0"]')).toBeNull()
    })
    scrollTo(scroller, 0)
    await waitFor(() => {
      expect(container.querySelector('.selection-layer[data-page="0"]')).not.toBeNull()
    })

    expect(container.querySelector('.selection-mark-layer[data-page="0"] .selection-highlight')).toBeNull()
  })
})

describe('PdfPane — 보기 맞춤', () => {
  it('첫 페이지는 작업영역 위쪽에서 12px 띄운다', () => {
    const { container } = mount({ pageCount: 12 })
    expect(container.querySelector('.pdf-page-slot')?.getAttribute('style')).toContain('top: 12px')
  })

  it('첫 페이지로 이동해도 위쪽 여백을 스크롤로 먹지 않는다', () => {
    const { scroller } = mount({ pageCount: 12, pageRequest: { page: 1, nonce: 1 } })
    expect(scroller.scrollTop).toBe(0)
  })

  it('페이지 맞춤은 현재 페이지 전체가 보이는 배율을 돌려준다', () => {
    expect(pageFitZoom([612, 792], { width: 800, height: 600 })).toBe(58)
  })

  it('Ctrl + 휠로 배율을 10%씩 조절한다', () => {
    setViewport(VIEWPORT_WIDTH, VIEWPORT_HEIGHT)
    const onZoomChange = vi.fn()
    const { container } = render(
      <PdfPane docId="0123456789ab" pageSizes={uniformSizes(12)} hasText zoomPercent={100} onZoomChange={onZoomChange} />,
    )

    const scroller = container.querySelector('.pdf-pane')
    if (scroller === null) throw new Error('.pdf-pane 이 없다')
    fireEvent.wheel(scroller, { ctrlKey: true, deltaY: -100 })
    fireEvent.wheel(scroller, { ctrlKey: true, deltaY: 100 })

    expect(onZoomChange).toHaveBeenNthCalledWith(1, 110)
    expect(onZoomChange).toHaveBeenNthCalledWith(2, 90)
  })
})

describe('PdfPane — 링크', () => {
  it('보이는 페이지의 링크를 그리고, 누르면 쪽 이동이나 외부 링크 확인으로 넘긴다', async () => {
    const onLinkNavigate = vi.fn()
    const onExternalLink = vi.fn()
    const { findByRole, getByRole } = mount({ pageCount: 3, onLinkNavigate, onExternalLink })
    fireEvent.click(await findByRole('link', { name: '5쪽으로 이동' }))
    expect(onLinkNavigate).toHaveBeenCalledWith(5)
    fireEvent.click(getByRole('link', { name: '외부 링크 example.com' }))
    expect(onExternalLink).toHaveBeenCalledWith('https://example.com')
  })

  it('형광펜·영역 캡처 모드에서는 링크를 그리지 않는다', async () => {
    const { queryByRole, findAllByRole } = mount({ pageCount: 3, interactionMode: 'highlight', onLinkNavigate: vi.fn() })
    await findAllByRole('img')
    await waitFor(() => expect(queryByRole('link', { name: '5쪽으로 이동' })).toBeNull())
  })
})

describe('PdfPane — 형광펜 메모', () => {
  it('한 장 ↔ 두·세 장으로 바꿔도 보던 쪽의 같은 자리를 그대로 보인다', () => {
    setViewport(VIEWPORT_WIDTH, VIEWPORT_HEIGHT)
    const pane = (spread: 'single' | 'double' | 'triple') => (
      <PdfPane docId="0123456789ab" pageSizes={uniformSizes(12)} hasText spread={spread} />
    )
    const view = render(pane('single'))
    const scroller = view.container.querySelector('.pdf-pane') as HTMLElement
    act(() => {
      scroller.scrollTop = 5000
      fireEvent.scroll(scroller)
    })
    view.rerender(pane('double'))
    // 두 장이면 쪽 폭·높이가 반이고 줄 수도 반이라 같은 자리는 1/4 쯤 위에 있다(예전에는 숫자 그대로 남아 엉뚱한 쪽으로 갔다)
    const doubled = scroller.scrollTop
    expect(doubled).toBeGreaterThan(500)
    expect(doubled).toBeLessThan(1200)
    act(() => { fireEvent.scroll(scroller) })
    view.rerender(pane('triple'))
    expect(scroller.scrollTop).toBeLessThan(doubled)
    act(() => { fireEvent.scroll(scroller) })
    view.rerender(pane('single'))
    expect(Math.abs(scroller.scrollTop - 5000)).toBeLessThan(40)
  })

  it('넘겨 보기(연속 끔)는 요청한 쪽 하나만 그리고, 두 장 보기면 그 쌍을 그린다', async () => {
    const { container } = mount({ pageCount: 6, continuous: false, pageRequest: { page: 3, nonce: 1 } })
    await waitFor(() => expect(renderedPages(container)).toEqual([2]))
    const spread = mount({ pageCount: 6, continuous: false, spread: 'double', pageRequest: { page: 3, nonce: 1 } })
    await waitFor(() => expect(renderedPages(spread.container).sort()).toEqual([2, 3]))
  })

  it('메모 바는 맨 위 줄 단추(공유 상태)로 닫았다 열고, 메모만 보기로 바꾸면 PDF 자리에 같은 노트 블록이 넓게 나온다', async () => {
    window.localStorage.removeItem('iwae:pdf-memo-column:v1')
    resetMemoStore()
    const highlight = {
      id: '0123456789ab:0:0:1',
      color: 'yellow' as const,
      note: '펄스 폭으로 구분',
      anchor: {
        docId: '0123456789ab', page: 0, coordSpace: 'pdfium-page' as const,
        rects: [{ x: 10, y: 10, w: 100, h: 12 }], charRange: [0, 1] as const, quote: 'Tstrpw', prefix: '', suffix: '',
      },
    }
    const { container, findByRole } = mount({ pageCount: 2, persistentHighlights: [highlight], onPersistentHighlightUpdated: vi.fn() })
    expect(await findByRole('button', { name: '노트 검색' })).toBeTruthy()
    act(() => setMemoBarVisible(false))
    // 닫는 동안(전환) 바는 서서히 사라지도록 잠깐 남아 있다가 지워진다
    expect(container.querySelector('.pdf-memo-bar')?.classList.contains('note-bar-exiting')).toBe(true)
    await waitFor(() => expect(container.querySelector('.pdf-memo-card')).toBeNull())
    act(() => setMemoBarVisible(true))
    await waitFor(() => expect(container.querySelector('.pdf-memo-card')).not.toBeNull())
    fireEvent.click(await findByRole('button', { name: '메모만 보기' }))
    await waitFor(() => expect(container.querySelector('.pdf-memo-bar-body.note-wide .pdf-memo-card')).not.toBeNull())
    expect(container.querySelector('.pdf-memo-bar-wide')).not.toBeNull()
    // 원문은 펼쳐 보인다
    expect(container.querySelector('.pdf-memo-bar-wide .pdf-memo-card-quote')?.textContent).toContain('Tstrpw')
    fireEvent.click(await findByRole('button', { name: '문서와 같이 보기' }))
    expect(container.querySelector('.pdf-memo-bar-wide')).toBeNull()
  })

  it('형광펜을 클릭하면 오른쪽 메모 카드가 글쓰기로 열리고 고친 메모를 올려 보낸다', async () => {
    const onPersistentHighlightUpdated = vi.fn()
    const onPersistentHighlightRemoved = vi.fn()
    const highlight = {
      id: '0123456789ab:0:0:1',
      color: 'yellow' as const,
      anchor: {
        docId: '0123456789ab', page: 0, coordSpace: 'pdfium-page' as const,
        rects: [{ x: 0, y: 0, w: 612, h: 792 }], charRange: [0, 1] as const, quote: 'A', prefix: '', suffix: '',
      },
    }
    const { container, findByRole } = mount({
      pageCount: 2,
      persistentHighlights: [highlight],
      onPersistentHighlightUpdated,
      onPersistentHighlightRemoved,
    })
    const layer = await waitFor(() => {
      const found = container.querySelector('[data-testid="selection-layer"]')
      if (found === null) throw new Error('선택 레이어가 아직 없다')
      return found
    })
    fireEvent.pointerDown(layer, { button: 0, clientX: 30, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(layer, { button: 0, clientX: 30, clientY: 30, pointerId: 1 })

    const box = await findByRole('textbox', { name: '메모' })
    expect(box.closest('.pdf-memo-card')).not.toBeNull()
    box.textContent = '중요'
    fireEvent.input(box)
    fireEvent.blur(box)
    expect(onPersistentHighlightUpdated).toHaveBeenCalledWith(highlight.id, { note: '중요', noteHtml: '' })
    // 다시 눌러 카드를 열고 지운다
    fireEvent.pointerDown(layer, { button: 0, clientX: 30, clientY: 30, pointerId: 2 })
    fireEvent.pointerUp(layer, { button: 0, clientX: 30, clientY: 30, pointerId: 2 })
    fireEvent.contextMenu(container.querySelector('.pdf-memo-card-flow')!)
    fireEvent.click(await findByRole('menuitem', { name: '형광펜과 메모 지우기' }))
    expect(onPersistentHighlightRemoved).toHaveBeenCalledWith(highlight.id)
  })
})

describe('PdfPane — 손 도구·노트 닫기', () => {
  const noteApi = (overrides: Partial<MemoNoteApi> = {}): MemoNoteApi => ({
    entries: [{ path: '노트/A.iwnote', title: 'A' }],
    openPath: '노트/A.iwnote',
    openTitle: 'A',
    openNote: { version: 1, blocks: [] },
    open: vi.fn(),
    close: vi.fn(),
    closed: false,
    create: vi.fn().mockResolvedValue('노트/새 노트.iwnote'),
    updateOpen: vi.fn(),
    notesOf: () => [],
    ...overrides,
  })

  it('손 도구로 빈 곳을 잡고 끌면 화면이 따라 움직인다', () => {
    const { scroller } = mount({ interactionMode: 'hand', pageCount: 3 })
    expect(scroller.classList.contains('pdf-pane-hand')).toBe(true)
    let top = 400
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value } })
    Object.defineProperty(scroller, 'scrollLeft', { configurable: true, get: () => 0, set: () => {} })
    fireEvent.pointerDown(scroller, { button: 0, clientX: 300, clientY: 500, pointerId: 7 })
    fireEvent.pointerMove(scroller, { clientX: 300, clientY: 380, pointerId: 7 })
    expect(top).toBe(520)
    fireEvent.pointerUp(scroller, { clientX: 300, clientY: 380, pointerId: 7 })
    fireEvent.pointerMove(scroller, { clientX: 300, clientY: 200, pointerId: 7 })
    expect(top).toBe(520)
    expect(document.body.classList.contains('pdf-panning')).toBe(false)
  })

  it('텍스트 도구에서는 빈 곳을 끌어도 화면을 옮기지 않는다', () => {
    const { scroller } = mount({ interactionMode: 'text', pageCount: 3 })
    let top = 400
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value } })
    fireEvent.pointerDown(scroller, { button: 0, clientX: 300, clientY: 500, pointerId: 7 })
    fireEvent.pointerMove(scroller, { clientX: 300, clientY: 380, pointerId: 7 })
    expect(top).toBe(400)
  })

  it('「노트 닫기」는 열린 노트를 닫아 오른쪽 바를 비운다', async () => {
    resetMemoStore()
    const api = noteApi()
    const { findByRole } = mount({ pageCount: 2, onPersistentHighlightUpdated: vi.fn(), noteApi: api })
    fireEvent.click(await findByRole('button', { name: '노트 닫기' }))
    expect(api.close).toHaveBeenCalledTimes(1)
  })

  it('노트를 닫아 두었으면 글을 골라도 새 노트를 저절로 만들지 않는다', async () => {
    resetMemoStore()
    const api = noteApi({ openPath: null, openTitle: null, openNote: null, closed: true })
    const { container, queryByRole } = mount({ pageCount: 2, onPersistentHighlightUpdated: vi.fn(), noteApi: api })
    expect(queryByRole('button', { name: '노트 닫기' })).toBeNull()
    const layer = await waitFor(() => {
      const found = container.querySelector('[data-testid="selection-layer"]')
      if (found === null) throw new Error('선택 레이어가 아직 없다')
      return found
    })
    fireEvent.pointerDown(layer, { button: 0, clientX: 30, clientY: 30, pointerId: 1 })
    fireEvent.pointerMove(layer, { clientX: 200, clientY: 34, pointerId: 1 })
    fireEvent.pointerUp(layer, { button: 0, clientX: 200, clientY: 34, pointerId: 1 })
    expect(queryByRole('toolbar', { name: 'PDF 선택 작업' })).not.toBeNull()
    expect(api.create).not.toHaveBeenCalled()
  })

  it('노트를 닫지 않았는데 열린 노트가 없으면 글을 고를 때 새 노트를 만든다(예전 그대로)', async () => {
    resetMemoStore()
    const api = noteApi({ openPath: null, openTitle: null, openNote: null, closed: false })
    const { container } = mount({ pageCount: 2, onPersistentHighlightUpdated: vi.fn(), noteApi: api })
    const layer = await waitFor(() => {
      const found = container.querySelector('[data-testid="selection-layer"]')
      if (found === null) throw new Error('선택 레이어가 아직 없다')
      return found
    })
    fireEvent.pointerDown(layer, { button: 0, clientX: 30, clientY: 30, pointerId: 1 })
    fireEvent.pointerMove(layer, { clientX: 200, clientY: 34, pointerId: 1 })
    fireEvent.pointerUp(layer, { button: 0, clientX: 200, clientY: 34, pointerId: 1 })
    expect(api.create).toHaveBeenCalledTimes(1)
  })
})

describe('PdfPane — 보기 옵션', () => {
  const slots = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('.pdf-page-slot'))

  it('두 쪽 보기에서는 1·2쪽이 같은 줄에 나란히(1쪽이 왼쪽) 놓인다', () => {
    const { container } = mount({ pageCount: 4, spread: 'double' })
    const [first, second, third] = slots(container)
    expect(first?.style.top).toBe(second?.style.top)
    expect(Number.parseFloat(first!.style.left)).toBeLessThan(Number.parseFloat(second!.style.left))
    expect(third?.style.left).toBe(first?.style.left)
    expect(third?.style.top).not.toBe(first?.style.top)
  })

  it('반전은 페이지 그림에만 거는 표시를 붙인다', () => {
    const { container } = mount({ pageCount: 2, invert: true })
    expect(container.querySelector('.pdf-pane')?.classList.contains('pdf-pane-inverted')).toBe(true)
  })

  it('90도 돌리면 칸의 가로세로가 바뀌고 선택·링크는 쉰다', async () => {
    const plain = mount({ pageCount: 1 })
    const plainSlot = slots(plain.container)[0]!
    const plainRatio = Number.parseFloat(plainSlot.style.width) / Number.parseFloat(plainSlot.style.height)
    plain.unmount()

    const rotated = mount({ pageCount: 1, rotation: 90, onLinkNavigate: vi.fn() })
    const slot = slots(rotated.container)[0]!
    const ratio = Number.parseFloat(slot.style.width) / Number.parseFloat(slot.style.height)
    expect(plainRatio).toBeLessThan(1)
    expect(ratio).toBeGreaterThan(1)
    expect(slot.classList.contains('pdf-page-rotated')).toBe(true)
    expect(slot.querySelector<HTMLElement>('.pdf-page-rotator')?.style.transform).toBe('rotate(90deg)')
    await waitFor(() => expect(rotated.queryByRole('link')).toBeNull())
  })
})

describe('PdfPane — 열린 노트 표시만 보기', () => {
  const make = (id: string, x: number) => ({
    id,
    color: 'yellow' as const,
    note: id,
    anchor: {
      docId: '0123456789ab', page: 0, coordSpace: 'pdfium-page' as const,
      rects: [{ x, y: 0, w: 100, h: 100 }], charRange: [x, x + 1] as const, quote: id, prefix: '', suffix: '',
    },
  })
  const open = make('open-note', 0)
  const closed = make('closed-note', 200)
  const loose = make('no-note', 400)
  const owners: Record<string, string[]> = { 'open-note': ['노트/A.iwnote'], 'closed-note': ['노트/Z.iwnote'] }
  const api = (): MemoNoteApi => ({
    entries: [{ path: '노트/A.iwnote', title: 'A' }, { path: '노트/Z.iwnote', title: 'Z' }],
    openPath: '노트/A.iwnote',
    openPaths: ['노트/A.iwnote'],
    openTitle: 'A',
    openNote: { version: 1, blocks: [] },
    open: vi.fn(),
    closeTab: vi.fn(),
    moveTab: vi.fn(),
    create: vi.fn().mockResolvedValue(null),
    updateOpen: vi.fn(),
    notesOf: (id) => owners[id] ?? [],
  })
  const drawn = async (container: HTMLElement) => {
    await waitFor(() => { if (container.querySelector('[data-testid="selection-layer"]') === null) throw new Error('선택 레이어가 아직 없다') })
    return [...container.querySelectorAll('.selection-persistent-highlight')]
  }

  it('켜면 열린 노트에 없는 형광펜(다른 노트·노트 없음)은 그려지지 않는다', async () => {
    resetMemoStore()
    const { container } = mount({ pageCount: 1, persistentHighlights: [open, closed, loose], noteApi: api(), onlyOpenNotes: true })
    const marks = await drawn(container)
    expect(marks.length).toBe(1)
  })

  it('끄면 모두 그려진다', async () => {
    resetMemoStore()
    const { container } = mount({ pageCount: 1, persistentHighlights: [open, closed, loose], noteApi: api(), onlyOpenNotes: false })
    expect((await drawn(container)).length).toBe(3)
  })
})
