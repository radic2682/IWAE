// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { App } from './App'
import type { LibraryDoc, NotebookGroup } from '../bridge/fake'
import { pickPdfFile, openPdf, type PdfDocMeta } from '../bridge/pdf'
import type { Anchor } from '../core/anchor'
import type { VisiblePdfSourceReference } from '../core/workspaceSources'
import { PDF_EXCERPT_DRAG_MIME, serializePdfExcerptDrag, type PdfExcerptSelection } from '../core/pdfExcerpt'
import { SAMPLE_DOC_ID, SAMPLE_TITLE } from '../pdf/samplePage'
import { SelectionActions } from '../pdf/SelectionActions'
import { CANVAS_ENABLED, SPLIT_PANES_ENABLED } from '../core/features'

const fileDropMocks = vi.hoisted(() => ({
  listen: vi.fn(),
  unlisten: vi.fn(),
  dropListener: undefined as ((paths: readonly string[]) => void) | undefined,
  activeListener: undefined as ((active: boolean) => void) | undefined,
}))

const evidenceMocks = vi.hoisted(() => ({
  build: vi.fn(async () => '<html>근거 묶음</html>'),
  save: vi.fn(async (name: string) => name),
}))

vi.mock('./exportEvidence', () => ({
  buildEvidenceHtml: evidenceMocks.build,
  createCanvasRasterizer: () => ({ page: async () => ({ page: null, crops: {} }) }),
  saveHtmlFile: evidenceMocks.save,
}))

vi.mock('../bridge/fileDrop', () => ({
  listenForDocumentDrop: vi.fn(async (listener, onActiveChange) => {
    fileDropMocks.listen(listener, onActiveChange)
    fileDropMocks.dropListener = listener
    fileDropMocks.activeListener = onActiveChange
    return fileDropMocks.unlisten
  }),
}))

const translationMocks = vi.hoisted(() => ({
  translate: vi.fn().mockResolvedValue({
    translatedText: '테스트 번역',
    model: 'translategemma:4b',
    elapsedMs: 12,
  }),
}))

vi.mock('../bridge/translation', () => ({
  createOllamaTranslationProvider: () => ({
    status: vi.fn().mockResolvedValue({ available: true, version: 'test', deviceKey: 'test-device' }),
    listModels: vi.fn().mockResolvedValue([{ name: 'translategemma:4b', digest: 'test', size: 1 }]),
    pullModel: vi.fn().mockResolvedValue(undefined),
    benchmark: vi.fn().mockResolvedValue({
      model: { name: 'translategemma:4b', digest: 'test', size: 1 },
      elapsedMs: 10,
      success: true,
    }),
    translate: translationMocks.translate,
  }),
}))

/**
 * PDF bridge 는 목으로 간다. 여기서 확인하려는 것은 "누르면 대화상자를
 * 거쳐 탭이 열리는가"라는 배선이지 Tauri 가 아니고, 진짜를 쓰면 이
 * 테스트가 Rust 런타임을 요구하게 된다(스펙 §9.1 이 금지한다).
 *
 * pageImageUrl 만 진짜에 가깝게 남겨 둔다 — PdfPane 이 렌더되면서 부르는데,
 * 여기서 확인할 것은 URL 의 모양이 아니라 탭이 열렸는지이므로 짧게 둔다.
 * URL 모양은 bridge/pdf.test.ts 가 진짜 구현으로 못박는다.
 */
const aiLocationHandlers = vi.hoisted(() => [] as ((location: unknown) => void)[])
vi.mock('../bridge/ai', () => ({
  aiSetVault: vi.fn(async () => undefined),
  ragIndex: vi.fn(async () => undefined),
  ragStatus: vi.fn(async () => null),
  aiSettingsGet: vi.fn(async () => null),
  aiApiStatus: vi.fn(async () => null),
  listenRagProgress: vi.fn(async () => () => undefined),
  listenAiLocation: vi.fn(async (handler: (location: unknown) => void) => {
    aiLocationHandlers.push(handler)
    return () => undefined
  }),
}))

vi.mock('../bridge/pdf', () => ({
  pickPdfFile: vi.fn(),
  openPdf: vi.fn(),
  pageImageUrl: (docId: string, page: number, width: number) =>
    `iwae://localhost/page/${docId}/${page}?w=${width}`,
  pdfOutline: vi.fn(async () => [
    { title: 'From Evidence to Insight', page: 0, depth: 0 },
    { title: 'Review Checklist', page: 5, depth: 0 },
  ]),
  pdfPageLinks: vi.fn(async () => []),
  pdfMetadata: vi.fn(async () => ({})),
  pdfAnnotations: vi.fn(async () => [
    { page: 0, kind: 'highlight', rects: [{ x: 0, y: 0, w: 100, h: 20 }], color: [30, 200, 60], contents: '가져온 메모' },
    { page: 0, kind: 'underline', rects: [{ x: 500, y: 700, w: 5, h: 5 }], color: null, contents: null },
  ]),
  pageTextIndex: vi.fn(async () => ({
    text: 'Imported text',
    chars: [...'Imported text'].map((c, i) => ({ c, x: i * 7, y: 4, w: 7, h: 12 })),
  })),
  exportAnnotatedPdf: vi.fn(async () => null),
}))

vi.mock('../pdf/PdfPane', () => ({
  PdfPane: ({ docId, onAnchorCreated, onPersistentHighlightCreated, persistentHighlights = [], onPageChange, pageRequest, highlightAnchor, sourceHighlights = [], onSendToCanvas, onTranslateSelection, onSendTranslatedSelection, onLinkNavigate, onExternalLink }: {
    docId: string
    onAnchorCreated?: (anchor: Anchor) => void
    onPersistentHighlightCreated?: (highlight: { id: string; anchor: Anchor }) => void
    persistentHighlights?: readonly { id: string; anchor: Anchor }[]
    onPageChange?: (page: number) => void
    pageRequest?: { page: number; nonce: number }
    highlightAnchor?: Anchor | null
    sourceHighlights?: readonly VisiblePdfSourceReference[]
    onSendToCanvas?: (selection: PdfExcerptSelection) => void
    onTranslateSelection?: (selection: PdfExcerptSelection) => Promise<{ text: string; targetLanguage: string; model: string } | null>
    onSendTranslatedSelection?: (selection: PdfExcerptSelection, translation: { text: string; targetLanguage: string; model: string }) => void
    onLinkNavigate?: (page: number) => void
    onExternalLink?: (uri: string) => void
  }) => (
    <div data-pdf-pane={docId}>
      <button type="button" onClick={() => onLinkNavigate?.(4)}>테스트 링크 이동</button>
      <button type="button" onClick={() => onExternalLink?.('https://example.com/paper')}>테스트 외부 링크</button>
      {sourceHighlights.map((source) => <div key={source.blockId} data-pdf-source-target={source.blockId} />)}
      <button
        type="button"
        onClick={() =>
          onAnchorCreated?.({
            docId: '5511aa99cc33',
            page: 0,
            coordSpace: 'pdfium-page',
            rects: [{ x: 0, y: 0, w: 1, h: 1 }],
            charRange: [0, 1],
            quote: 'A',
            prefix: '',
            suffix: '',
          })
        }
      >
        테스트 선택
      </button>
      <button type="button" onClick={() => onPageChange?.(2)}>테스트 스크롤 보고</button>
      <button
        type="button"
        onClick={() => onPersistentHighlightCreated?.({
          id: `${docId}:0:0:4`,
          anchor: {
            docId,
            page: 0,
            coordSpace: 'pdfium-page',
            rects: [{ x: 10, y: 20, w: 80, h: 20 }],
            charRange: [0, 4],
            quote: 'mark',
            prefix: '',
            suffix: '',
          },
        })}
      >
        테스트 형광펜
      </button>
      <button
        type="button"
        onClick={() => onSendToCanvas?.({
          mode: 'text',
          anchor: {
            docId,
            page: 0,
            coordSpace: 'pdfium-page',
            rects: [{ x: 10, y: 20, w: 80, h: 20 }],
            charRange: [0, 4],
            quote: 'test',
            prefix: '',
            suffix: '',
          },
          pageSize: [612, 792],
          crop: { x: 6, y: 16, w: 88, h: 28 },
          glyphs: [{ c: 'test', x: 10, y: 20, w: 80, h: 20 }],
        })}
      >
        테스트 노트 전송
      </button>
      <SelectionActions
        selection={{
          mode: 'text',
          anchor: {
            docId,
            page: 0,
            coordSpace: 'pdfium-page',
            rects: [{ x: 10, y: 20, w: 80, h: 20 }],
            charRange: [0, 4],
            quote: 'test',
            prefix: '',
            suffix: '',
          },
          pageSize: [612, 792],
          crop: { x: 6, y: 16, w: 88, h: 28 },
          glyphs: [{ c: 'test', x: 10, y: 20, w: 80, h: 20 }],
        }}
        onCopy={vi.fn()}
        onTranslate={onTranslateSelection}
        onSendTranslationToCanvas={onSendTranslatedSelection}
      />
      <output aria-label="페이지 이동 요청 nonce">{pageRequest?.nonce ?? -1}</output>
      <output aria-label="페이지 이동 요청 쪽">{pageRequest?.page ?? -1}</output>
      <output aria-label="강조 앵커 페이지">{highlightAnchor?.page ?? -1}</output>
      <output aria-label="영구 형광펜 수">{persistentHighlights.length}</output>
    </div>
  ),
}))

/**
 * 픽스처를 주입해서 bridge 의 내용물과 배선 테스트를 떼어 놓는다.
 * loadLibrary 가 실제 vault 를 읽을 때 거기 담길 문서는
 * 사용자의 것이지 우리 것이 아니다 — 그때 이 파일이 깨지면 안 된다.
 * 제목을 긴 스펙 이름으로 둔 이유는 그대로다: 짧은 더미로는 탭 제목이
 * 잘리는 경로를 밟지 않는다.
 */
const library: LibraryDoc[] = [
  { docId: 'doc-spec', title: 'HTTP Semantics Guide v1.1', pages: 1017 },
  { docId: 'doc-book', title: 'Rust Programming Handbook', pages: 758 },
  { docId: 'doc-guide', title: 'Team Onboarding Guide (Rev C)', pages: 84 },
]

const notebooks: NotebookGroup[] = [
  {
    name: 'HTTP',
    notes: [
      { path: 'HTTP/OPTIONS.canvas', title: 'OPTIONS' },
      { path: 'HTTP/HEADERS.canvas', title: 'HEADERS' },
    ],
  },
]

function renderApp() {
  return render(<App library={library} notebooks={notebooks} />)
}

describe('App — 껍데기 배선', () => {
  beforeEach(() => {
    fileDropMocks.listen.mockClear()
    fileDropMocks.unlisten.mockClear()
    fileDropMocks.dropListener = undefined
    fileDropMocks.activeListener = undefined
  })

  it('native 문서 드롭을 한 번 구독하고 해제하며 드래그 상태를 사이드바에 표시한다', async () => {
    const view = renderApp()
    await waitFor(() => expect(fileDropMocks.listen).toHaveBeenCalledOnce())

    fileDropMocks.activeListener?.(true)
    expect(await screen.findByText('놓으면 Vault 에 복사 · 줄 사이에 놓으면 그 자리, 폴더 위면 그 폴더 안')).toBeDefined()
    fileDropMocks.dropListener?.(['C:/External/drop.pdf'])
    expect((await screen.findByRole('alert')).textContent).toContain('Vault를 열어')

    view.unmount()
    expect(fileDropMocks.unlisten).toHaveBeenCalledOnce()
  })

  it('처음에는 양쪽 패널이 비어 있다', () => {
    renderApp()
    expect(screen.getByText('사이드바에서 PDF 문서를 여세요')).toBeDefined()
    expect(screen.getAllByText('탭을 여기로 끌어 오거나 사이드바에서 문서를 여세요').length).toBeGreaterThan(0)
  })

  it('사이드바의 문서를 누르면 왼쪽 상단에 현재 문서명이 나온다', () => {
    renderApp()
    // fireEvent 는 dispatch 를 act() 로 감싸 React 가 상태 변화를 커밋한
    // 뒤에 돌려준다. 여기서부터는 클릭 뒤 다시 그려진 DOM(탭 등장, 안내
    // 문구 사라짐)을 확인해야 하므로 커밋을 기다려야 한다 — 네이티브
    // .click() 은 이 커밋을 기다리지 않아 클릭 직후 단언이 아직 갱신
    // 전의 DOM을 보게 된다.
    fireEvent.click(screen.getByRole('button', { name: /^HTTP Semantics Guide v1\.1$/ }))
    expect(screen.getByRole('tab', { name: 'HTTP Semantics Guide v1.1' })).toBeDefined()
  })

  it.skipIf(!CANVAS_ENABLED)('노트는 오른쪽 패널에 열린다 — 패널 역할은 고정이다', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'OPTIONS' }))
    const noteTitle = screen.getByRole('tab', { name: 'OPTIONS' })
    // 왼쪽 패널은 여전히 비어 있어야 한다
    expect(screen.getByText('사이드바에서 PDF 문서를 여세요')).toBeDefined()
    expect(noteTitle).toBeDefined()
  })

  it('같은 문서를 두 번 눌러도 탭은 하나다', () => {
    renderApp()
    const item = screen.getByRole('button', { name: /^Rust Programming Handbook$/ })
    fireEvent.click(item)
    fireEvent.click(item)
    fireEvent.click(screen.getAllByRole('button', { name: /탭 목록/ })[0]!)
    expect(screen.getAllByRole('menuitem', { name: 'Rust Programming Handbook' })).toHaveLength(1)
  })

  it('탭을 닫으면 사라지고, 마지막이면 안내 문구가 돌아온다', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: /^Team Onboarding Guide \(Rev C\)$/ }))
    fireEvent.click(screen.getAllByRole('button', { name: /탭 목록/ })[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Team Onboarding Guide (Rev C) 목록에서 닫기' }))
    expect(screen.getAllByText('열린 탭 없음')[0]).toBeDefined()
    expect(screen.getByText('사이드바에서 PDF 문서를 여세요')).toBeDefined()
  })
})

describe('App — bridge 로부터의 읽기', () => {
  /**
   * 픽스처를 안 주면 bridge 로 읽는다. 비동기 경계가 실제로 이어져
   * 있는지 확인하는 유일한 자리다 — 나머지 테스트는 주입으로 이 경로를
   * 건너뛴다. 목록의 내용이 아니라 "결국 항목이 그려진다"만 본다.
   */
  it('props 가 없고 최근 vault도 없으면 첫 실행 안내(언어)부터 보이고, 건너뛰면 폴더 선택 화면이다', async () => {
    localStorage.removeItem('iwae:onboarded:v1')
    render(<App developmentPreview={false} />)
    expect(await screen.findByRole('radio', { name: '한국어' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
    expect(screen.getByRole('heading', { name: '시작하기' })).toBeDefined()
    expect(screen.getByRole('button', { name: /내 폴더 열기/ })).toBeDefined()
  })

  it('개발 미리보기에서는 vault 선택 없이 샘플 PDF와 노트를 연다', () => {
    render(<App developmentPreview />)

    expect(screen.queryByRole('heading', { name: 'Vault 열기' })).toBeNull()
    expect(screen.getByRole('tab', { name: SAMPLE_TITLE })).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Evidence Map — Sample Research Note' })).toBeDefined()
  })

  it.skipIf(!CANVAS_ENABLED)('개발 Markdown은 문서 목록에서 열리고 왼쪽 읽기 패널에 표시된다', () => {
    const view = render(<App developmentPreview />)
    const documents = screen.getByRole('region', { name: '문서' })
    const notes = screen.getByRole('region', { name: '노트' })
    const markdown = within(documents).getByRole('button', { name: 'Markdown 테스트, Markdown' })

    expect(within(notes).queryByRole('button', { name: 'Markdown 테스트, Markdown' })).toBeNull()
    fireEvent.click(markdown)

    const leftPane = view.container.querySelector('.pane-left')
    const rightPane = view.container.querySelector('.pane-right')
    if (!(leftPane instanceof HTMLElement) || !(rightPane instanceof HTMLElement)) throw new Error('패널을 찾지 못했다')
    expect(within(leftPane).getByRole('article', { name: 'Markdown 테스트' })).toBeDefined()
    expect(within(rightPane).queryByRole('article', { name: 'Markdown 테스트' })).toBeNull()
  })

  it('불러올 수 없는 문서는 사이드바에서 다시 연결하라고 안내하고 마일스톤 문구를 노출하지 않는다', () => {
    const { container } = renderApp()
    fireEvent.click(screen.getByRole('button', { name: /^HTTP Semantics Guide v1\.1$/ }))

    expect(screen.getByText(/사이드바에서 문서를 다시 연결/)).toBeDefined()
    expect(container.textContent).not.toMatch(/M2|M3|React Flow 가 들어온다/u)
  })

  it.skipIf(!CANVAS_ENABLED)('Markdown 선택 번역문을 확인한 뒤 원문 캡처와 번역 블록을 만든다', async () => {
    const view = render(<App developmentPreview />)
    const documents = screen.getByRole('region', { name: '문서' })
    fireEvent.click(within(documents).getByRole('button', { name: 'Markdown 테스트, Markdown' }))
    const article = screen.getByRole('article', { name: 'Markdown 테스트' })
    const heading = within(article).getByRole('heading', { name: 'IWAE Markdown 테스트' })
    const range = document.createRange()
    range.selectNodeContents(heading)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    fireEvent.mouseUp(article)

    const translate = await screen.findByRole('button', { name: '번역' })
    fireEvent.click(translate)
    expect((await screen.findByLabelText('Markdown 번역 결과')).textContent).toContain('테스트 번역')
    fireEvent.click(screen.getByRole('button', { name: '번역과 함께 블록 추가' }))

    await waitFor(() => {
      expect(view.container.querySelector('.react-flow__node-markdownExcerpt')).not.toBeNull()
      expect(view.container.querySelector('.react-flow__node-translation')).not.toBeNull()
    })
  })

  it('Ctrl+F로 왼쪽 바의 PDF 검색을 열고 입력에 포커스한다', async () => {
    render(<App developmentPreview />)

    fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true })

    // 왼쪽 바가 「PDF 검색」 보기로 바뀌고 그 칸에 붙은 검색 입력으로 간다
    const search = await screen.findByRole('searchbox', { name: 'PDF 검색' })
    await waitFor(() => expect(document.activeElement).toBe(search))
  })

  it.skipIf(!CANVAS_ENABLED)('노트를 전체 화면으로 펼쳤다가 분할 보기로 복원한다', async () => {
    const view = render(<App developmentPreview />)
    fireEvent.click(screen.getByRole('button', { name: '테스트 노트 전송' }))
    await waitFor(() => expect(view.container.querySelector('.pdf-excerpt-node')).not.toBeNull())
    fireEvent.click(view.container.querySelector('.pdf-excerpt-node') as Element)
    expect(view.container.querySelector('[data-source-trace]')).toBeNull()
    const toggle = await screen.findByRole('button', { name: '노트 전체 화면' })
    fireEvent.click(toggle)
    expect(view.container.querySelector('.pane-left')?.getAttribute('aria-hidden')).toBe('true')
    expect(view.container.querySelector('[data-source-trace]')).toBeNull()
    fireEvent.click(toggle)
    expect(view.container.querySelector('.pane-left')?.getAttribute('aria-hidden')).toBe('false')
  })

  it.skipIf(!CANVAS_ENABLED)('노트를 근거와 함께 HTML 한 파일로 내보낸다', async () => {
    const view = render(<App developmentPreview />)
    fireEvent.click(screen.getByRole('button', { name: '테스트 노트 전송' }))
    await waitFor(() => expect(view.container.querySelector('.pdf-excerpt-node')).not.toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: '근거와 함께 내보내기' }))
    await waitFor(() => expect(evidenceMocks.save).toHaveBeenCalled())
    const [options] = evidenceMocks.build.mock.calls.at(-1) as unknown as [{ title: string, document: { nodes: { type?: string }[] }, docs: Record<string, { title?: string }> }]
    expect(options.document.nodes.some((node) => node.type === 'pdfExcerpt')).toBe(true)
    expect(options.docs[SAMPLE_DOC_ID]?.title).toBe(SAMPLE_TITLE)
    expect(evidenceMocks.save).toHaveBeenCalledWith(`${options.title} 근거.html`, '<html>근거 묶음</html>')
  })

  it.skipIf(!CANVAS_ENABLED)('PDF 선택 작업에서 노트로 보내면 현재 노트에 발췌 블록을 만든다', async () => {
    const view = render(<App developmentPreview />)
    fireEvent.click(screen.getByRole('button', { name: '테스트 노트 전송' }))
    await waitFor(() => {
      expect(view.container.querySelector('.react-flow__node-pdfExcerpt')).not.toBeNull()
    })
  })

  it('설정은 상단바 로고 메뉴에서 모달로 열리고 Escape로 닫힌다', async () => {
    const view = render(<App developmentPreview />)
    expect(screen.queryByRole('button', { name: '설정' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'IWAE 메뉴' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^설정/ }))
    const dialog = await screen.findByRole('dialog', { name: '설정' })
    expect(screen.getByRole('heading', { name: '화면 테마' })).toBeDefined()
    // 기본은 웨일 어두운 테마
    expect((screen.getByRole('radio', { name: '다크' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: '번역' }))
    expect(screen.getByRole('heading', { name: '로컬 번역' })).toBeDefined()
    expect(view.container.querySelector('.sidebar')?.contains(dialog)).toBe(false)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '설정' })).toBeNull()
  })

  it.skipIf(!CANVAS_ENABLED)('PDF 선택 번역문을 먼저 보여주고 확인 버튼으로 원문·번역 블록을 만든다', async () => {
    const view = render(<App developmentPreview />)
    await waitFor(() => expect(view.container.querySelectorAll('.react-flow__node-translation')).toHaveLength(1))
    const initialTranslationCount = view.container.querySelectorAll('.react-flow__node-translation').length
    await waitFor(() => expect(screen.getByRole('button', { name: '번역' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '번역' }))
    expect((await screen.findByLabelText('번역 결과')).textContent).toBe('테스트 번역')
    expect(view.container.querySelectorAll('.react-flow__node-translation')).toHaveLength(initialTranslationCount)
    fireEvent.click(screen.getByRole('button', { name: '번역과 함께 블록 추가' }))
    await waitFor(() => {
      expect(translationMocks.translate).toHaveBeenCalledWith('http://127.0.0.1:11434', expect.objectContaining({ text: 'test' }))
      expect(view.container.querySelector('.react-flow__node-pdfExcerpt')).not.toBeNull()
      expect(view.container.querySelectorAll('.react-flow__node-translation')).toHaveLength(initialTranslationCount + 1)
    })
    expect(screen.queryByText('번역이 완료되었습니다.')).toBeNull()
  })

  it('열린 노트가 없어도 PDF 선택 번역은 사용할 수 있다', async () => {
    render(<App developmentPreview />)
    fireEvent.click(screen.getByRole('button', { name: 'Evidence Map — Sample Research Note 닫기' }))
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Evidence Map — Sample Research Note' })).toBeNull())

    const translate = screen.getByRole('button', { name: '번역' })
    await waitFor(() => expect(translate.hasAttribute('disabled')).toBe(false))
    fireEvent.click(translate)

    expect((await screen.findByLabelText('번역 결과')).textContent).toBe('테스트 번역')
    expect(screen.queryByRole('button', { name: '번역과 함께 블록 추가' })).toBeNull()
  })

  it('PDF 선택 번역 실패를 선택 작업에 표시한다', async () => {
    translationMocks.translate.mockRejectedValueOnce(new Error('Ollama connection refused'))
    render(<App developmentPreview />)
    await waitFor(() => expect(screen.getByRole('button', { name: '번역' }).hasAttribute('disabled')).toBe(false))

    fireEvent.click(screen.getByRole('button', { name: '번역' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Ollama connection refused')
    expect(screen.getByRole('button', { name: '번역 다시 시도' })).toBeDefined()
  })

  it.skipIf(!CANVAS_ENABLED)('노트 블록 우클릭 번역은 로컬 번역기를 호출한다', async () => {
    const view = render(<App developmentPreview />)
    await waitFor(() => expect(view.container.querySelector('.react-flow__node-textBlock')).not.toBeNull())
    const titleNode = view.container.querySelector('.react-flow__node-textBlock')
    fireEvent.contextMenu(titleNode as Element, { clientX: 900, clientY: 240 })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: '번역 블록 만들기' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('menuitem', { name: '번역 블록 만들기' }))

    await waitFor(() => {
      expect(translationMocks.translate).toHaveBeenCalledWith(
        'http://127.0.0.1:11434',
        expect.objectContaining({ text: 'Evidence Map — From Source to Insight' }),
      )
      expect(view.container.querySelector('.react-flow__node-translation')).not.toBeNull()
    })
  })

  it('PDF 형광펜을 만들면 저장 상태에 추가해 다시 렌더한다', async () => {
    localStorage.clear()
    render(<App developmentPreview />)
    await waitFor(() => expect(screen.getByLabelText('영구 형광펜 수').textContent).toBe('0'))
    fireEvent.click(screen.getByRole('button', { name: '테스트 형광펜' }))

    await waitFor(() => expect(screen.getByLabelText('영구 형광펜 수').textContent).toBe('1'))
    expect(localStorage.getItem('iwae:pdf-highlights:v1')).toContain('mark')
  })

  it.skipIf(!CANVAS_ENABLED)('발췌 블록의 출처를 누르면 원본 PDF 페이지와 anchor를 연다', async () => {
    const view = render(<App developmentPreview />)
    const anchor: Anchor = {
      docId: SAMPLE_DOC_ID,
      page: 1,
      coordSpace: 'pdfium-page',
      rects: [{ x: 40, y: 80, w: 180, h: 20 }],
      charRange: [0, 11],
      quote: 'source jump',
      prefix: '',
      suffix: '',
    }
    const serialized = serializePdfExcerptDrag({
      sourceTitle: 'IWAE PDF 텍스트 선택 테스트',
      selection: {
        mode: 'text',
        anchor,
        pageSize: [612, 792],
        crop: { x: 36, y: 76, w: 188, h: 28 },
        glyphs: [{ c: anchor.quote, x: 40, y: 80, w: 180, h: 20 }],
      },
    })
    const dataTransfer = {
      getData: (type: string) => type === PDF_EXCERPT_DRAG_MIME ? serialized : '',
      dropEffect: 'none',
    }
    await waitFor(() => expect(view.container.querySelector('.react-flow')).not.toBeNull())
    const canvas = view.container.querySelector('.react-flow')
    expect(canvas).not.toBeNull()

    fireEvent.drop(canvas as Element, { clientX: 900, clientY: 420, dataTransfer })
    const sourceButton = view.container.querySelector('button[aria-label="IWAE PDF 텍스트 선택 테스트 2쪽 출처 열기"]')
    expect(sourceButton).not.toBeNull()
    const excerptNode = view.container.querySelector('.pdf-excerpt-node')
    expect(excerptNode).not.toBeNull()
    fireEvent.click(excerptNode as Element)
    expect(view.container.querySelector('[data-source-trace]')).toBeNull()
    expect(screen.getByLabelText('페이지 이동 요청 nonce').textContent).toBe('0')
    fireEvent.click(sourceButton as Element)

    expect(screen.getByLabelText('강조 앵커 페이지').textContent).toBe('1')
    expect(screen.getByLabelText('페이지 이동 요청 nonce').textContent).toBe('1')
  })
})

describe('App — 문서 추가', () => {
  const meta: PdfDocMeta = {
    docId: '5511aa99cc33',
    sha256: '5'.repeat(64),
    size: 1024,
    title: 'Compilers Textbook 5.0',
    pageCount: 1299,
    pageSizes: [[612, 792]],
    hasText: true,
  }

  beforeEach(() => {
    vi.mocked(pickPdfFile).mockReset()
    vi.mocked(openPdf).mockReset()
  })

  const addDocumentByReference = () => {
    fireEvent.click(screen.getByRole('button', { name: '문서 추가' }))
    fireEvent.click(screen.getByRole('button', { name: /원본 위치 참조/ }))
  }

  it('버튼을 누르면 파일 대화상자를 연다', async () => {
    vi.mocked(pickPdfFile).mockResolvedValue(null)
    renderApp()
    addDocumentByReference()
    await waitFor(() => {
      expect(pickPdfFile).toHaveBeenCalledTimes(1)
    })
  })

  it('고른 파일이 열리고 왼쪽 패널에 탭이 된다', async () => {
    vi.mocked(pickPdfFile).mockResolvedValue('C:/specs/compilers5.pdf')
    vi.mocked(openPdf).mockResolvedValue(meta)
    renderApp()

    addDocumentByReference()

    expect(
      await screen.findByRole('tab', { name: 'Compilers Textbook 5.0' }),
    ).toBeDefined()
    expect(openPdf).toHaveBeenCalledWith('C:/specs/compilers5.pdf')
    // 라이브러리 목록에도 들어간다 — 탭을 닫아도 다시 열 수 있어야 한다.
    // 이름 전체로 골라낸다: 앞부분만 맞추면 탭의 닫기 버튼("… 닫기")까지 걸려 둘이 나온다.
    expect(
      screen.getByRole('button', { name: /^Compilers Textbook 5\.0$/ }),
    ).toBeDefined()
  })

  it('PdfPane 이 만든 앵커를 원문 강조 상태로 보존한다', async () => {
    vi.mocked(pickPdfFile).mockResolvedValue('C:/specs/compilers5.pdf')
    vi.mocked(openPdf).mockResolvedValue(meta)
    renderApp()

    addDocumentByReference()
    fireEvent.click(await screen.findByRole('button', { name: '테스트 선택' }))

    expect(screen.getByLabelText('강조 앵커 페이지').textContent).toBe('0')
  })

  it('PdfPane의 스크롤 보고는 새 페이지 이동 요청을 만들지 않는다', async () => {
    vi.mocked(pickPdfFile).mockResolvedValue('C:/specs/compilers5.pdf')
    vi.mocked(openPdf).mockResolvedValue(meta)
    renderApp()

    addDocumentByReference()
    await screen.findByRole('tab', { name: 'Compilers Textbook 5.0' })
    const nonceBeforeScroll = screen.getByLabelText('페이지 이동 요청 nonce').textContent

    fireEvent.click(screen.getByRole('button', { name: '테스트 스크롤 보고' }))

    expect(screen.getByLabelText('페이지 이동 요청 nonce').textContent).toBe(nonceBeforeScroll)
    expect((screen.getByRole('textbox', { name: '페이지' }) as HTMLInputElement).value).toBe('2')
  })

  it('다른 PDF를 열면 이전 문서의 페이지 이동 요청을 이어받지 않고 1쪽에서 시작한다', async () => {
    vi.mocked(pickPdfFile).mockResolvedValue('C:/specs/compilers5.pdf')
    vi.mocked(openPdf).mockResolvedValue(meta)
    render(<App developmentPreview />)

    const pageInput = screen.getByRole('textbox', { name: '페이지' })
    fireEvent.change(pageInput, { target: { value: '5' } })
    fireEvent.blur(pageInput)
    expect(screen.getByLabelText('페이지 이동 요청 쪽').textContent).toBe('5')

    addDocumentByReference()
    await screen.findByRole('tab', { name: 'Compilers Textbook 5.0' })

    await waitFor(() => {
      expect(screen.getByLabelText('페이지 이동 요청 쪽').textContent).toBe('1')
    })
  })

  it('취소하면(null) 아무것도 바뀌지 않는다', async () => {
    vi.mocked(pickPdfFile).mockResolvedValue(null)
    renderApp()
    const before = screen.getAllByRole('button').length

    addDocumentByReference()
    await waitFor(() => {
      expect(pickPdfFile).toHaveBeenCalled()
    })

    expect(openPdf).not.toHaveBeenCalled()
    expect(screen.getAllByText('열린 탭 없음')[0]).toBeDefined()
    expect(screen.getAllByRole('button')).toHaveLength(before)
    expect(screen.getByText('사이드바에서 PDF 문서를 여세요')).toBeDefined()
  })

  it('같은 문서를 두 번 추가해도 목록과 탭은 하나다', async () => {
    vi.mocked(pickPdfFile).mockResolvedValue('C:/specs/compilers5.pdf')
    vi.mocked(openPdf).mockResolvedValue(meta)
    renderApp()

    addDocumentByReference()
    await screen.findByRole('tab', { name: 'Compilers Textbook 5.0' })
    addDocumentByReference()
    await waitFor(() => {
      expect(openPdf).toHaveBeenCalledTimes(2)
    })

    fireEvent.click(screen.getAllByRole('button', { name: /탭 목록/ })[0]!)
    expect(screen.getAllByRole('menuitem', { name: 'Compilers Textbook 5.0' })).toHaveLength(1)
    expect(
      screen.getAllByRole('button', { name: /^Compilers Textbook 5\.0$/ }),
    ).toHaveLength(1)
  })

  it('열지 못한 파일이 앱을 무너뜨리지 않는다', async () => {
    vi.mocked(pickPdfFile).mockResolvedValue('C:/broken.pdf')
    vi.mocked(openPdf).mockRejectedValue(new Error('PDF 가 아닙니다'))
    renderApp()

    addDocumentByReference()
    expect((await screen.findByRole('alert')).textContent).toContain('PDF 가 아닙니다')

    expect(screen.getAllByText('열린 탭 없음')[0]).toBeDefined()
    expect(screen.getByText('사이드바에서 PDF 문서를 여세요')).toBeDefined()
  })
})

describe('App — 사이드바 접기', () => {
  it('접기 버튼이 사이드바를 감추고, 다시 누르면 되돌린다', async () => {
    // 버튼이 상단바에 있는 이유가 여기서 드러난다: 접은 뒤에도 같은
    // 버튼이 화면에 남아 있어야 다시 펼 수 있다. 사이드바 안에 뒀다면
    // 접는 순간 사라져서 이 테스트의 두 번째 클릭이 불가능하다.
    renderApp()
    expect(await screen.findByRole('button', { name: /^HTTP Semantics Guide v1\.1$/ })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '사이드바 접기' }))
    expect(screen.queryByRole('button', { name: /Semantics/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '사이드바 펼치기' }))
    expect(screen.getByRole('button', { name: /^HTTP Semantics Guide v1\.1$/ })).toBeDefined()
  })
})

describe('App — 라이브러리 모드와 문서 전체 화면', () => {
  const shellHas = (container: HTMLElement, className: string) =>
    container.querySelector('.shell')?.classList.contains(className) ?? false

  it('버튼과 Escape 로 라이브러리를 펼치고 접는다', async () => {
    const { container } = render(<App developmentPreview />)
    fireEvent.click(screen.getByRole('button', { name: '라이브러리 펼치기' }))
    expect(shellHas(container, 'shell-library-expanded')).toBe(true)
    expect(screen.getByRole('grid', { name: '항목 목록' })).toBeDefined()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(shellHas(container, 'shell-library-expanded')).toBe(false)
  })

  it('라이브러리에서 항목을 열면 접히고, 문서 전체 화면으로 전환된다', async () => {
    const { container } = render(<App developmentPreview />)
    fireEvent.keyDown(document.body, { key: 'L', ctrlKey: true, shiftKey: true })
    expect(shellHas(container, 'shell-library-expanded')).toBe(true)
    const markdownRow = screen.getAllByRole('row').find((row) => row.textContent?.includes('Markdown 테스트'))
    if (markdownRow === undefined) throw new Error('Markdown 행을 찾지 못했다')
    fireEvent.doubleClick(markdownRow)
    expect(shellHas(container, 'shell-library-expanded')).toBe(false)
    fireEvent.click(await screen.findByRole('button', { name: '문서 전체 화면' }))
    expect(shellHas(container, 'shell-reader-focused')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '분할 화면으로' }))
    expect(shellHas(container, 'shell-reader-focused')).toBe(false)
  })

  it('문서 전체 화면에서 라이브러리를 펼치면 분할 화면으로 돌아간 뒤 펼친다', async () => {
    const { container } = render(<App developmentPreview />)
    fireEvent.click(await screen.findByRole('button', { name: '문서 전체 화면' }))
    expect(shellHas(container, 'shell-reader-focused')).toBe(true)
    fireEvent.keyDown(document.body, { key: 'L', ctrlKey: true, shiftKey: true })
    expect(shellHas(container, 'shell-reader-focused')).toBe(false)
    expect(shellHas(container, 'shell-library-expanded')).toBe(true)
  })

  it('이모지 선택창의 Escape 는 선택창만 닫고 라이브러리는 그대로 둔다', async () => {
    const { container } = render(<App developmentPreview />)
    fireEvent.keyDown(document.body, { key: 'L', ctrlKey: true, shiftKey: true })
    fireEvent.contextMenu(screen.getAllByRole('row')[1]!)
    fireEvent.click(screen.getByRole('menuitem', { name: '이모지 설정…' }))
    const dialog = await screen.findByRole('dialog', { name: '이모지 선택' }, { timeout: 5_000 })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '이모지 선택' })).toBeNull()
    expect(shellHas(container, 'shell-library-expanded')).toBe(true)
  })

  it('라이브러리에서 고른 이모지가 좁은 사이드바 트리에도 보인다', async () => {
    render(<App developmentPreview />)
    fireEvent.keyDown(document.body, { key: 'L', ctrlKey: true, shiftKey: true })
    const pdfRow = screen.getAllByRole('row').find((row) => row.textContent?.includes('PDF'))
    if (pdfRow === undefined) throw new Error('PDF 행을 찾지 못했다')
    fireEvent.contextMenu(pdfRow)
    fireEvent.click(screen.getByRole('menuitem', { name: '이모지 설정…' }))
    const dialog = await screen.findByRole('dialog', { name: '이모지 선택' }, { timeout: 5_000 })
    fireEvent.click((await within(dialog).findAllByRole('button', { name: '활짝 웃는 얼굴' }, { timeout: 5_000 }))[0]!)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    const documents = screen.getByRole('region', { name: '문서' })
    expect(within(documents).getByText('😀')).toBeDefined()
  })
})

describe('App — 점프 기록', () => {
  it('목차로 점프한 뒤 뒤로·앞으로·Alt+← 로 오간다', async () => {
    render(<App developmentPreview />)
    const pageInput = () => screen.getByRole('textbox', { name: '페이지' }) as HTMLInputElement
    fireEvent.click(screen.getByRole('radio', { name: '목록' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Review Checklist 6쪽' }))
    await waitFor(() => expect(pageInput().value).toBe('6'))

    fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    await waitFor(() => expect(pageInput().value).toBe('1'))
    fireEvent.click(screen.getByRole('button', { name: '앞으로' }))
    await waitFor(() => expect(pageInput().value).toBe('6'))
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true })
    await waitFor(() => expect(pageInput().value).toBe('1'))
  })
})

describe('App — PDF 링크', () => {
  it('문서 안 링크는 점프 기록에 남고, 외부 링크는 확인을 거친다', async () => {
    render(<App developmentPreview />)
    const pageInput = () => screen.getByRole('textbox', { name: '페이지' }) as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: '테스트 링크 이동' }))
    await waitFor(() => expect(pageInput().value).toBe('4'))
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    await waitFor(() => expect(pageInput().value).toBe('1'))

    fireEvent.click(screen.getByRole('button', { name: '테스트 외부 링크' }))
    const dialog = screen.getByRole('alertdialog', { name: '외부 링크 열기' })
    expect(within(dialog).getByText('example.com')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }))
    expect(screen.queryByRole('alertdialog', { name: '외부 링크 열기' })).toBeNull()
  })
})

describe('App — 읽던 위치', () => {
  it('다른 문서를 보고 돌아오면 마지막으로 보던 쪽에서 다시 시작한다', async () => {
    render(<App developmentPreview />)
    const pageInput = () => screen.getByRole('textbox', { name: '페이지' }) as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: '테스트 스크롤 보고' }))
    await waitFor(() => expect(pageInput().value).toBe('2'))

    const documents = screen.getByRole('region', { name: '문서' })
    fireEvent.click(within(documents).getByRole('button', { name: 'Markdown 테스트, Markdown' }))
    await waitFor(() => expect(document.querySelector('.markdown-pane')).not.toBeNull())

    fireEvent.click(screen.getByRole('tab', { name: SAMPLE_TITLE }))
    await waitFor(() => expect(pageInput().value).toBe('2'))
  })
})

describe('App — 한 패널', () => {
  it.skipIf(SPLIT_PANES_ENABLED)('좌우 2단 없이 한 패널만 쓰고, 1단↔2단 단추가 없다', () => {
    const view = render(<App developmentPreview />)
    expect(screen.queryByRole('button', { name: '1단 보기로' })).toBeNull()
    expect(screen.queryByRole('button', { name: '2단 보기로' })).toBeNull()
    expect(view.container.querySelector('.app-single-pane')).not.toBeNull()
    expect(screen.queryByRole('menuitem', { name: /패널로 옮기기/u })).toBeNull()
  })
})

describe('App — PDF 보기 옵션', () => {
  it('두 장·넘겨 보기와 배경(야간)을 이 PC에 기억한다', () => {
    localStorage.removeItem('iwae:pdf-view')
    render(<App developmentPreview />)
    fireEvent.click(screen.getByRole('button', { name: '두 장 보기' }))
    fireEvent.click(screen.getByRole('button', { name: '연속 보기' }))
    fireEvent.click(screen.getByRole('button', { name: '배경 모드' }))
    fireEvent.click(screen.getByRole('radio', { name: '야간' }))
    expect(JSON.parse(localStorage.getItem('iwae:pdf-view') ?? '{}')).toEqual({ spread: 'double', continuous: false, invert: true, tone: 'none' })
    fireEvent.click(screen.getByRole('button', { name: '시계 방향으로 회전' }))
    expect(screen.getByText('90°')).toBeDefined()
  })
})

describe('App — PDF 화면 나누기', () => {
  it('위 줄에서 배치를 고르면 같은 PDF 를 여러 칸으로 보고, 누른 칸이 막대가 다루는 칸이 된다', () => {
    const view = render(<App developmentPreview />)
    expect(view.container.querySelectorAll('.pdf-split-cell')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '화면 나누기' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /위 둘 · 아래 하나/ }))
    const cells = view.container.querySelectorAll<HTMLElement>('.pdf-split-cell')
    expect(cells).toHaveLength(3)
    expect(view.container.querySelectorAll('.pdf-split-divider')).toHaveLength(2)
    // 처음엔 첫 칸, 셋째 칸을 누르면 그 칸이 고른 칸
    expect(cells[0]!.classList.contains('pdf-split-cell-focused')).toBe(true)
    fireEvent.pointerDown(cells[2]!)
    expect(view.container.querySelectorAll<HTMLElement>('.pdf-split-cell')[2]!.classList.contains('pdf-split-cell-focused')).toBe(true)
    // 칸마다 같은 PDF 하나
    expect(view.container.querySelectorAll('.pdf-split-cell [data-pdf-pane]')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: '화면 나누기' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '한 화면' }))
    expect(view.container.querySelectorAll('.pdf-split-cell')).toHaveLength(1)
  })
})

describe('App — 서지 정보', () => {
  it('PDF 메뉴에서 서지 정보를 고치고 BibTeX으로 복사한다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<App developmentPreview />)
    const documents = screen.getByRole('region', { name: '문서' })
    const pdfButton = within(documents).getAllByRole('button').find((button) => button.textContent?.includes(SAMPLE_TITLE))!
    fireEvent.contextMenu(pdfButton)
    fireEvent.click(screen.getByRole('menuitem', { name: '서지 정보…' }))
    const dialog = await screen.findByRole('dialog', { name: `서지 정보 — ${SAMPLE_TITLE}` })
    fireEvent.change(within(dialog).getByRole('textbox', { name: '저자 (한 줄에 한 명)' }), { target: { value: 'Ada Lovelace' } })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: '연도' }), { target: { value: '1843' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(screen.queryByRole('dialog', { name: `서지 정보 — ${SAMPLE_TITLE}` })).toBeNull()

    fireEvent.contextMenu(pdfButton)
    fireEvent.click(screen.getByRole('menuitem', { name: 'BibTeX 복사' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('author = {Ada Lovelace}')))
    expect(writeText.mock.calls[0]?.[0]).toContain('year = {1843}')
  })
})

describe('App — 바깥 AI가 보낸 위치', () => {
  it('알림 카드를 띄우고, 이동을 누르면 그 쪽으로 가며 카드가 닫힌다', async () => {
    render(<App developmentPreview />)
    await waitFor(() => expect(aiLocationHandlers.length).toBeGreaterThan(0))
    act(() => {
      aiLocationHandlers.at(-1)!({ id: 'loc1', docId: SAMPLE_DOC_ID, page: 3, charStart: 0, charEnd: 8, message: '정의가 여기 있습니다', receivedAt: '1' })
    })
    const card = await screen.findByRole('alert')
    expect(within(card).getByText(SAMPLE_TITLE)).toBeDefined()
    fireEvent.click(within(card).getByRole('button', { name: '이동' }))
    await waitFor(() => expect((screen.getByRole('textbox', { name: '페이지' }) as HTMLInputElement).value).toBe('3'))
    expect(screen.queryByText('정의가 여기 있습니다')).toBeNull()
  })
})

describe('App — 검색 가능한 PDF 사본', () => {
  it('모든 쪽에 이미 글자가 있으면 사본을 만들지 않고 알린다', async () => {
    render(<App developmentPreview />)
    const documents = screen.getByRole('region', { name: '문서' })
    const pdfButton = within(documents).getAllByRole('button').find((button) => button.textContent?.includes(SAMPLE_TITLE))!
    fireEvent.contextMenu(pdfButton)
    fireEvent.click(screen.getByRole('menuitem', { name: '검색 가능한 PDF 사본 만들기' }))
    expect(await screen.findByText('이 PDF는 이미 모든 쪽에 글자가 있습니다')).toBeDefined()
  })
})
