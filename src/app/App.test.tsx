// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { App } from './App'
import type { LibraryDoc, NotebookGroup } from '../bridge/fake'
import { pickPdfFile, openPdf, type PdfDocMeta } from '../bridge/pdf'
import type { Anchor } from '../core/anchor'
import type { VisiblePdfSourceReference } from '../core/workspaceSources'
import { PDF_EXCERPT_DRAG_MIME, serializePdfExcerptDrag, type PdfExcerptSelection } from '../core/pdfExcerpt'
import { SAMPLE_DOC_ID, SAMPLE_TITLE } from '../pdf/samplePage'
import { getOverlayTool, setOverlayTool } from '../pdf/overlayToolStore'
import { SelectionActions } from '../pdf/SelectionActions'
import { CANVAS_ENABLED, SPLIT_PANES_ENABLED } from '../core/features'
import { getAppPrefs, setAppPref } from './appPrefs'
import { getTranslatorWindow, reloadTranslatorWindow, updateTranslatorWindow } from './translatorPanelState'
import { announceAction } from './actionFeedback'
import * as windowBridge from '../bridge/window'
import { setWindowModeForTest } from '../core/windowMode'

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
  loadTranslationApiKey: vi.fn().mockResolvedValue(''),
  saveTranslationApiKey: vi.fn().mockResolvedValue(undefined),
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
  setPdfPasswordPrompt: vi.fn(),
  isPasswordProtectedDoc: vi.fn(() => false),
  pdfBlankPages: vi.fn(async () => []),
  exportPdfImages: vi.fn(async () => null),
}))

vi.mock('../pdf/PdfPane', () => ({
  PdfPane: ({ docId, onAnchorCreated, onPersistentHighlightCreated, persistentHighlights = [], onPageChange, pageRequest, highlightAnchor, aiPointer, onAiPointerDismiss, sourceHighlights = [], onSendToCanvas, onTranslateSelection, onSendTranslatedSelection, onLinkNavigate, onExternalLink }: {
    docId: string
    onAnchorCreated?: (anchor: Anchor) => void
    onPersistentHighlightCreated?: (highlight: { id: string; anchor: Anchor }) => void
    persistentHighlights?: readonly { id: string; anchor: Anchor }[]
    onPageChange?: (page: number) => void
    pageRequest?: { page: number; nonce: number }
    highlightAnchor?: Anchor | null
    aiPointer?: { id: string; page: number; message?: string } | null
    onAiPointerDismiss?: () => void
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
      <output aria-label="AI 가리킴 쪽">{aiPointer?.page ?? -1}</output>
      <output aria-label="AI 가리킴 말">{aiPointer?.message ?? ''}</output>
      <button type="button" onClick={onAiPointerDismiss}>AI 가리킴 지우기</button>
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

// 이 테스트들은 로컬(Ollama) 번역을 다룬다. 처음 기본값(Google 번역) 대신 로컬로 시작한다
beforeEach(() => {
  localStorage.setItem('iwae:translation-settings:v1', JSON.stringify({ executionMode: 'auto' }))
  // 첫 실행 「접두키 고르기」 창은 따로 시험한다(PrefixKeyDialog.test.tsx). 여기서는 이미 물었다고 둔다
  setAppPref('prefixKeyAsked', true)
})

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

  it('처음에는 한 칸이 비어 있다', () => {
    const { container } = renderApp()
    expect(screen.getByText('문서를 열거나, 다른 칸의 탭을 끌어 오세요')).toBeDefined()
    // 빈 칸에는 조용한 명령 목록이 있다(한 칸뿐이라 「이 칸 닫기」 는 없다. 번역기 · 캔버스 줄도 없다)
    expect(screen.getByText('빈 칸')).toBeDefined()
    const quick = screen.getByRole('group', { name: '이 칸에 열기' })
    expect(within(quick).getAllByRole('button').map((button) => button.textContent)).toEqual(['PDF 열기', 'Markdown 열기'])
    expect(container.querySelectorAll('.pane-grid-cell')).toHaveLength(1)
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

  it.skipIf(!CANVAS_ENABLED)('캔버스는 문서 창 옆에 탭으로 열린다 — 문서가 없으면 그 창에 바로 연다', () => {
    renderApp()
    // 문서도 노트도 없는 처음: 빈 창에 캔버스 탭으로 열린다(안내 문구는 사라진다)
    fireEvent.click(screen.getByRole('button', { name: 'OPTIONS' }))
    expect(screen.getByRole('tab', { name: 'OPTIONS' })).toBeDefined()
    expect(screen.queryByText('문서를 열거나, 다른 칸의 탭을 끌어 오세요')).toBeNull()
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
    expect(screen.getAllByRole('group', { name: '열린 탭 없음' })[0]).toBeDefined()
    expect(screen.getByText('문서를 열거나, 다른 칸의 탭을 끌어 오세요')).toBeDefined()
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
    const notes = screen.getByRole('region', { name: '캔버스' })
    const markdown = within(documents).getByRole('button', { name: 'Markdown 테스트, Markdown' })

    expect(within(notes).queryByRole('button', { name: 'Markdown 테스트, Markdown' })).toBeNull()
    fireEvent.click(markdown)

    const leftPane = view.container.querySelector('.pane-grid-cell[data-pane-index="0"]')
    const rightPane = view.container.querySelector('.pane-grid-cell[data-pane-index="1"]')
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
    // jsdom 의 Range 에는 줄 사각형이 없다
    const original = Range.prototype.getClientRects
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList
    onTestFinished(() => { Range.prototype.getClientRects = original })
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
    fireEvent.click(screen.getByRole('button', { name: '노트에 넣기' }))

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
    expect(view.container.querySelector('.pane-grid-cell[data-pane-index="0"]')?.getAttribute('aria-hidden')).toBe('true')
    expect(view.container.querySelector('[data-source-trace]')).toBeNull()
    fireEvent.click(toggle)
    expect(view.container.querySelector('.pane-grid-cell[data-pane-index="0"]')?.hasAttribute('aria-hidden')).toBe(false)
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

  it('설정은 왼쪽 바 아래 톱니바퀴와 상단바 로고 메뉴에서 모달로 열리고 Escape로 닫힌다', async () => {
    const view = render(<App developmentPreview />)
    expect(screen.getAllByRole('button', { name: '설정' }).length).toBeGreaterThan(0)
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
    fireEvent.click(screen.getByRole('button', { name: '노트에 넣기' }))
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
    expect(screen.queryByRole('button', { name: '노트에 넣기' })).toBeNull()
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
      types: [PDF_EXCERPT_DRAG_MIME],
    }
    await waitFor(() => expect(view.container.querySelector('.react-flow')).not.toBeNull())
    const canvas = view.container.querySelector('.react-flow')
    expect(canvas).not.toBeNull()

    fireEvent.drop(canvas as Element, { clientX: 900, clientY: 420, dataTransfer })
    const sourceButton = view.container.querySelector('button[aria-label="IWAE PDF 텍스트 선택 테스트 2쪽 출처 열기"]')
    expect(sourceButton).not.toBeNull()
    const excerptNode = view.container.querySelector('.pdf-excerpt-node')
    expect(excerptNode).not.toBeNull()
    // 출처가 있는 블록을 누르면 같은 색 창에 가리키기 신호(place)가 가서 그 문서가 그 쪽으로 간다
    fireEvent.click(excerptNode as Element)
    expect(view.container.querySelector('[data-source-trace]')).toBeNull()
    await waitFor(() => expect(Number(screen.getByLabelText('페이지 이동 요청 nonce').textContent)).toBeGreaterThan(0))
    const afterPoint = Number(screen.getByLabelText('페이지 이동 요청 nonce').textContent)
    fireEvent.click(sourceButton as Element)

    expect(screen.getByLabelText('강조 앵커 페이지').textContent).toBe('1')
    expect(Number(screen.getByLabelText('페이지 이동 요청 nonce').textContent)).toBeGreaterThan(afterPoint)
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
    expect(screen.getAllByRole('group', { name: '열린 탭 없음' })[0]).toBeDefined()
    expect(screen.getAllByRole('button')).toHaveLength(before)
    expect(screen.getByText('문서를 열거나, 다른 칸의 탭을 끌어 오세요')).toBeDefined()
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

    expect(screen.getAllByRole('group', { name: '열린 탭 없음' })[0]).toBeDefined()
    expect(screen.getByText('문서를 열거나, 다른 칸의 탭을 끌어 오세요')).toBeDefined()
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

  it('라이브러리에서 항목을 열면 접힌다', async () => {
    const { container } = render(<App developmentPreview />)
    fireEvent.keyDown(document.body, { key: 'L', ctrlKey: true, shiftKey: true })
    expect(shellHas(container, 'shell-library-expanded')).toBe(true)
    const markdownRow = screen.getAllByRole('row').find((row) => row.textContent?.includes('Markdown 테스트'))
    if (markdownRow === undefined) throw new Error('Markdown 행을 찾지 못했다')
    fireEvent.doubleClick(markdownRow)
    expect(shellHas(container, 'shell-library-expanded')).toBe(false)
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

describe('App — 칸 나누기 트리', () => {
  const cells = (container: HTMLElement) => container.querySelectorAll('.pane-grid-cell')

  it('샘플 작업 공간은 문서 | 캔버스 두 칸이고, 칸마다 자기 탭 줄이 칸 안 맨 위에 있다', () => {
    const { container } = render(<App developmentPreview />)
    expect(cells(container)).toHaveLength(2)
    expect(container.querySelectorAll('.pane-grid-tabs')).toHaveLength(2)
    // 탭 줄은 상단바에 없다
    expect(container.querySelector('.topbar .topbar-panetab-zone')).toBeNull()
    expect(container.querySelectorAll('.pane-divider, .pane-tree-divider')).toHaveLength(1)
  })

  it('Ctrl+\ 는 칸을 늘리고(둘 → 셋) 한 번 더 누르면 한 칸으로 돌아온다', () => {
    const { container } = render(<App developmentPreview />)
    fireEvent.keyDown(document.body, { key: '\\', ctrlKey: true })
    expect(cells(container)).toHaveLength(3)
    fireEvent.keyDown(document.body, { key: '\\', ctrlKey: true })
    expect(cells(container)).toHaveLength(1)
  })

  it('Ctrl+1·Ctrl+2 는 칸 번호 0·1 의 칸을 만진 칸으로 삼는다', () => {
    const { container } = render(<App developmentPreview />)
    const active = () => [...container.querySelectorAll('.pane-focus-scope')].findIndex((scope) => scope.hasAttribute('data-pane-active'))
    fireEvent.keyDown(document.body, { key: '2', ctrlKey: true })
    expect(active()).toBe(1)
    fireEvent.keyDown(document.body, { key: '1', ctrlKey: true })
    expect(active()).toBe(0)
  })

  it('한 글자 도구 단축키(P)는 문서 칸을 만지고 있을 때만 편집 도구를 고르고, 노트 칸을 만지는 동안은 건드리지 않는다', () => {
    render(<App developmentPreview />)
    const key = (init: KeyboardEventInit) => { act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) }) }
    key({ key: '1', ctrlKey: true })
    setOverlayTool('text')
    key({ key: 'p' })
    expect(getOverlayTool()).toBe('pen')
    key({ key: '2', ctrlKey: true })
    setOverlayTool('text')
    key({ key: 'p' })
    expect(getOverlayTool()).toBe('text')
  })

  it('칸이 너무 작아 더 나눌 수 없으면 「칸이 너무 작습니다」를 알린다(크기를 잴 수 있을 때)', async () => {
    const rect = (width: number, height: number) => ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('pane-grid-cell') ? rect(300, 500) : rect(0, 0)
    })
    onTestFinished(() => spy.mockRestore())
    const { container } = render(<App developmentPreview />)
    fireEvent.keyDown(document.body, { key: '\\', ctrlKey: true })
    expect(await screen.findByText('칸이 너무 작습니다')).toBeDefined()
    expect(cells(container)).toHaveLength(2)
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
    fireEvent.click(screen.getByRole('menuitem', { name: '논문 정보…' }))
    const dialog = await screen.findByRole('dialog', { name: `논문 정보 — ${SAMPLE_TITLE}` })
    fireEvent.change(within(dialog).getByRole('textbox', { name: '저자 (한 줄에 한 명)' }), { target: { value: 'Ada Lovelace' } })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: '연도' }), { target: { value: '1843' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(screen.queryByRole('dialog', { name: `논문 정보 — ${SAMPLE_TITLE}` })).toBeNull()

    fireEvent.contextMenu(pdfButton)
    fireEvent.click(screen.getByRole('menuitem', { name: '인용 정보 복사 (BibTeX)' }))
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
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('이동하면 선택(강조) 표시가 아니라 AI 가리킴만 켜지고, 새 가리킴이 이전 것을 바꾸며, 지우기로 사라진다', async () => {
    render(<App developmentPreview />)
    await waitFor(() => expect(aiLocationHandlers.length).toBeGreaterThan(0))
    act(() => {
      aiLocationHandlers.at(-1)!({ id: 'loc1', docId: SAMPLE_DOC_ID, page: 3, charStart: 0, charEnd: 8, message: '정의가 여기 있습니다', receivedAt: '1' })
    })
    fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: '이동' }))
    await waitFor(() => expect(screen.getByLabelText('AI 가리킴 쪽').textContent).toBe('2'))
    expect(screen.getByLabelText('AI 가리킴 말').textContent).toBe('정의가 여기 있습니다')
    expect(screen.getByLabelText('강조 앵커 페이지').textContent).toBe('-1')
    // 저장되는 것(형광펜)은 늘지 않는다 — AI 가리킴은 상태에만 있다
    expect(screen.getByLabelText('영구 형광펜 수').textContent).toBe('0')
    act(() => {
      aiLocationHandlers.at(-1)!({ id: 'loc2', docId: SAMPLE_DOC_ID, page: 1, charStart: 0, charEnd: 5, message: '여기도', receivedAt: '2' })
    })
    fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: '이동' }))
    await waitFor(() => expect(screen.getByLabelText('AI 가리킴 쪽').textContent).toBe('0'))
    expect(screen.getByLabelText('AI 가리킴 말').textContent).toBe('여기도')
    fireEvent.click(screen.getByRole('button', { name: 'AI 가리킴 지우기' }))
    expect(screen.getByLabelText('AI 가리킴 쪽').textContent).toBe('-1')
  })
})

describe('App — PDF 도구', () => {
  it('왼쪽 바 메뉴로 도구 창을 열고, 모든 쪽에 글자가 있으면 OCR 하지 않고 알린다', async () => {
    render(<App developmentPreview />)
    const documents = screen.getByRole('region', { name: '문서' })
    const pdfButton = within(documents).getAllByRole('button').find((button) => button.textContent?.includes(SAMPLE_TITLE))!
    fireEvent.contextMenu(pdfButton)
    fireEvent.click(screen.getByRole('menuitem', { name: 'PDF 도구…' }))
    // 도구는 팝업이 아니라 왼쪽 바 「PDF 도구」 목록 안(그 줄 아래)으로 펼쳐진다. 메뉴가 그 탭을 열어 준다
    expect(screen.getByRole('radio', { name: 'PDF 도구' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(await screen.findByRole('button', { name: 'OCR (스캔 글자 인식)' }))
    const dialog = await screen.findByRole('region', { name: /PDF 도구 —/ })
    expect(dialog.closest('.pdf-tools-body')).not.toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'OCR 시작' }))
    expect((await within(dialog).findAllByText('이 PDF는 이미 모든 쪽에 글자가 있습니다')).length).toBeGreaterThan(0)
  })
})

describe('App — 칸 머리 · ⋯ 메뉴 · 크게 · 빈 칸', () => {
  const cells = (container: HTMLElement) => container.querySelectorAll('.pane-grid-cell')
  const openMenu = (index: number) => fireEvent.click(screen.getAllByRole('button', { name: '칸 메뉴' })[index]!)
  const pick = (name: RegExp) => fireEvent.click(screen.getByRole('menuitem', { name }))

  it('칸이 하나여도 칸 머리(색 점 · 번호 · ⋯)가 칸 맨 위에 있고 상단바에는 탭 줄이 없다', () => {
    const { container } = renderApp()
    const heads = container.querySelectorAll('.pane-head')
    expect(heads).toHaveLength(1)
    expect(heads[0]!.querySelector('.pane-channel-dot')).not.toBeNull()
    expect(heads[0]!.querySelector('.pane-head-number')?.textContent).toBe('0')
    expect(within(heads[0] as HTMLElement).getByRole('button', { name: '칸 메뉴' })).toBeDefined()
    expect(container.querySelector('.topbar .pane-tabs-menu')).toBeNull()
    expect(container.querySelector('.topbar .topbar-panetab-zone')).toBeNull()
  })

  it('칸이 여럿이면 칸마다 머리가 있고 번호는 왼쪽 위부터 0, 1 …', () => {
    const { container } = render(<App developmentPreview />)
    const heads = [...container.querySelectorAll('.pane-head')]
    expect(heads).toHaveLength(2)
    expect(heads.map((head) => head.querySelector('.pane-head-number')?.textContent)).toEqual(['0', '1'])
    expect(heads.every((head) => head.querySelector('.pane-channel-dot') !== null)).toBe(true)
    // 머리는 카드 안 맨 위에 있다
    expect(container.querySelectorAll('.pane-card')).toHaveLength(2)
  })

  it('⋯ 메뉴: 오른쪽으로 나누기 / 아래로 나누기가 새 빈 칸을 만든다(키 힌트가 보인다)', () => {
    const { container } = render(<App developmentPreview />)
    openMenu(0)
    const menu = screen.getByRole('menu', { name: '칸 메뉴' })
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      '오른쪽으로 나누기Ctrl+B %', '아래로 나누기Ctrl+B "', '크게Ctrl+B z', '새 화면으로 떼기Ctrl+B !', '띄우기float-pane', '칸 자리 바꾸기Ctrl+B { }', '색 바꾸기파랑', '칸 닫기Ctrl+B x',
    ])
    pick(/오른쪽으로 나누기/u)
    expect(cells(container)).toHaveLength(3)
    // 새 칸은 비어 있고 빠른 단추를 보인다
    expect(screen.getByRole('group', { name: '이 칸에 열기' })).toBeDefined()
    openMenu(0)
    pick(/아래로 나누기/u)
    expect(cells(container)).toHaveLength(4)
    expect(container.querySelectorAll('.pane-tree-divider')).toHaveLength(3)
  })

  it('⋯ 메뉴의 칸 닫기는 그 칸을 빼고 남은 칸이 자리를 채우며 탭은 잃지 않는다', () => {
    const { container } = render(<App developmentPreview />)
    openMenu(0)
    pick(/오른쪽으로 나누기/u)
    expect(cells(container)).toHaveLength(3)
    const emptyIndex = [...container.querySelectorAll('.pane-head')].findIndex((head) => head.querySelector('.pane-tabs-empty-row') !== null)
    openMenu(emptyIndex)
    pick(/칸 닫기/u)
    expect(cells(container)).toHaveLength(2)
    expect(screen.getByRole('tab', { name: SAMPLE_TITLE })).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Evidence Map — Sample Research Note' })).toBeDefined()
  })

  it('칸이 하나뿐이면 칸 닫기 · 새 화면으로 떼기 · 칸 자리 바꾸기 · 크게는 쓸 수 없다', () => {
    renderApp()
    openMenu(0)
    for (const name of [/칸 닫기/u, /새 화면으로 떼기/u, /띄우기/u, /칸 자리 바꾸기/u, /크게/u]) {
      expect((screen.getByRole('menuitem', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('크게: 그 칸만 화면에 남고 머리에 「Z」가 붙는다. 다시 누르면 되돌린다', () => {
    const { container } = render(<App developmentPreview />)
    openMenu(0)
    pick(/크게/u)
    expect(container.querySelectorAll('.pane-zoom-hidden')).toHaveLength(1)
    expect((cells(container)[0] as HTMLElement).classList.contains('pane-zoom-hidden')).toBe(false)
    const mark = screen.getByRole('button', { name: '크기 되돌리기' })
    expect(mark.textContent).toBe('Z')
    fireEvent.click(mark)
    expect(container.querySelectorAll('.pane-zoom-hidden')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: '크기 되돌리기' })).toBeNull()
  })

  it('칸 자리 바꾸기: 두 칸의 자리가 맞바뀌고 탭은 칸을 따라간다', () => {
    const { container } = render(<App developmentPreview />)
    const order = () => [...container.querySelectorAll('.pane-head')].map((head) => head.querySelector('[role="tab"]')?.textContent)
    const before = order()
    openMenu(0)
    pick(/칸 자리 바꾸기/u)
    expect(order()).toEqual([before[1], before[0]])
  })

  it('새 화면으로 떼기: 그 칸이 새 화면이 되어 그리로 가고, 원래 화면은 한 칸 줄어 있다', () => {
    const { container } = render(<App developmentPreview />)
    openMenu(1)
    pick(/새 화면으로 떼기/u)
    expect(screen.getAllByRole('tab', { name: /^\d/u }).map((tab) => tab.textContent)).toEqual(['0읽기', '1화면 1'])
    expect(cells(container)).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: /읽기/u }))
    expect(cells(container)).toHaveLength(1)
    expect(screen.getByRole('tab', { name: SAMPLE_TITLE })).toBeDefined()
  })

  it('빈 칸의 빠른 단추: PDF 는 파일 선택을, MD 는 라이브러리를 연다. 번역기 · 캔버스 단추는 없다', async () => {
    vi.mocked(pickPdfFile).mockResolvedValue(null)
    const { container } = renderApp()
    const quick = screen.getByRole('group', { name: '이 칸에 열기' })
    expect(within(quick).queryByRole('button', { name: /번역기|캔버스/u })).toBeNull()
    fireEvent.click(within(quick).getByRole('button', { name: /^PDF 열기/u }))
    await waitFor(() => expect(pickPdfFile).toHaveBeenCalled())
    fireEvent.click(within(quick).getByRole('button', { name: /^Markdown 열기/u }))
    expect(container.querySelector('.shell-library-expanded')).not.toBeNull()
  })
})

describe('App — 화면 탭 · 알림(아래 상태 줄은 없다)', () => {
  const cells = (container: HTMLElement) => container.querySelectorAll('.pane-grid-cell')
  const screenTabs = () => screen.getAllByRole('tab', { name: /^\d/u }).map((tab) => tab.textContent)
  const newScreen = async (name: RegExp) => {
    fireEvent.click(screen.getByRole('button', { name: '새 화면' }))
    fireEvent.click(within(screen.getByRole('menu', { name: '새 화면' })).getByRole('menuitem', { name }))
  }

  it('처음에는 「0 읽기」 화면 하나뿐이다', () => {
    render(<App developmentPreview />)
    expect(screenTabs()).toEqual(['0읽기'])
  })

  it('＋ 에서 빈 화면을 만들면 그 화면으로 가고, 이전 화면은 내려가(unmount) 있다가 돌아가면 다시 열린다', async () => {
    const { container } = render(<App developmentPreview />)
    expect(screen.getByRole('button', { name: '테스트 스크롤 보고' })).toBeDefined()
    await newScreen(/빈 화면/u)
    expect(screenTabs()).toEqual(['0읽기', '1화면 1'])
    expect(cells(container)).toHaveLength(1)
    // 숨은 화면의 PDF 보기는 마운트되어 있지 않다
    expect(screen.queryByRole('button', { name: '테스트 스크롤 보고' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /읽기/u }))
    expect(screenTabs()).toEqual(['0읽기', '1화면 1'])
    expect(cells(container)).toHaveLength(2)
    expect(screen.getByRole('button', { name: '테스트 스크롤 보고' })).toBeDefined()
  })

  it('새 화면의 칸은 그 화면에만 속한다: 다른 화면에서 연 문서가 앞 화면에 끼어들지 않는다', async () => {
    const { container } = render(<App developmentPreview />)
    await newScreen(/빈 화면/u)
    fireEvent.click(within(screen.getByRole('region', { name: '문서' })).getAllByRole('button').find((button) => button.textContent?.includes(SAMPLE_TITLE))!)
    expect(screen.getByRole('tab', { name: SAMPLE_TITLE })).toBeDefined()
    expect(cells(container)).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: /읽기/u }))
    // 앞 화면은 처음 그대로(문서 | 캔버스 두 칸, 문서 탭은 하나)
    expect(cells(container)).toHaveLength(2)
    expect(screen.getAllByRole('tab', { name: SAMPLE_TITLE })).toHaveLength(1)
  })

  it('「읽기」 템플릿으로 새 화면을 만들면 보던 문서가 문서 칸에 놓이고 노트 칸이 붙는다', async () => {
    const { container } = render(<App developmentPreview />)
    await newScreen(/^읽기/u)
    await waitFor(() => expect(screenTabs()).toEqual(['0읽기', '1읽기']))
    expect(cells(container)).toHaveLength(2)
    expect(screen.getAllByRole('tab', { name: SAMPLE_TITLE }).length).toBeGreaterThan(0)
  })

  it('이름 바꾸기(두 번 누르기)와 순서 바꾸기(Alt+→)', async () => {
    render(<App developmentPreview />)
    await newScreen(/빈 화면/u)
    fireEvent.doubleClick(screen.getByRole('tab', { name: /화면 1/u }))
    const input = screen.getByRole('textbox', { name: '화면 이름' })
    fireEvent.change(input, { target: { value: '메모' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screenTabs()).toEqual(['0읽기', '1메모'])
    fireEvent.keyDown(screen.getByRole('tab', { name: /읽기/u }), { key: 'ArrowRight', altKey: true })
    expect(screenTabs()).toEqual(['0메모', '1읽기'])
  })

  it('아래 상태 줄은 없다: 화면은 맨 위 줄 화면 탭으로만 보이고, 키와 명령 목록은 명령 팔레트로 연다', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    render(<App developmentPreview />)
    expect(document.querySelector('.status-bar')).toBeNull()
    expect(screen.queryByRole('contentinfo')).toBeNull()
    expect(screenTabs()).toEqual(['0읽기'])
    await newScreen(/빈 화면/u)
    expect(screenTabs()).toEqual(['0읽기', '1화면 1'])
    // 「?」 단추가 없어졌으므로 키 목록은 명령 팔레트(「키와 명령 보기」)와 접두키 ? 로 연다
    expect(screen.queryByRole('button', { name: '키와 명령 보기' })).toBeNull()
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'k', code: 'KeyK', ctrlKey: true })) })
    const palette = screen.getByRole('dialog', { name: '명령 팔레트' })
    fireEvent.change(within(palette).getByRole('combobox', { name: '명령 찾기' }), { target: { value: '키와 명령' } })
    fireEvent.click(within(palette).getByRole('option', { name: /키와 명령 보기/u }))
    const sheet = await screen.findByRole('dialog', { name: '키와 명령' })
    // 접두키가 모두 되므로 「다음 단계」 표시는 없다
    expect(within(sheet).queryAllByText('다음 단계')).toHaveLength(0)
    // 명령은 띄어쓰기에서만 꺾이게 낱말마다 나뉘어 있다 — 칸 전체 글로 찾는다
    expect([...sheet.querySelectorAll('.keys-help-command')].some((cell) => cell.textContent === 'split-window -h / -v')).toBe(true)
  })

  it('로고 메뉴에서 「명령 팔레트」(단축키 표시)와 「키와 명령 보기」를 마우스로 열 수 있다', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    render(<App developmentPreview />)
    fireEvent.click(screen.getByRole('button', { name: 'IWAE 메뉴' }))
    const palette = screen.getByRole('menuitem', { name: /^명령 팔레트/u })
    expect(palette.textContent).toContain('Ctrl+K')
    fireEvent.click(palette)
    expect(screen.getByRole('dialog', { name: '명령 팔레트' })).toBeDefined()
    fireEvent.keyDown(screen.getByRole('combobox', { name: '명령 찾기' }), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'IWAE 메뉴' }))
    const help = screen.getByRole('menuitem', { name: /^키와 명령 보기/u })
    expect(help.textContent).toMatch(/\?$/u)
    fireEvent.click(help)
    expect(await screen.findByRole('dialog', { name: '키와 명령' })).toBeDefined()
  })

  it('짧은 알림은 오른쪽 아래 알림 줄기의 토스트로 뜬다(아래 상태 줄이 받지 않는다)', () => {
    render(<App developmentPreview />)
    act(() => announceAction('저장했습니다'))
    expect(document.querySelector('.notice-toast')?.textContent).toContain('저장했습니다')
    expect(document.querySelector('.notice-stack')?.contains(document.querySelector('.notice-toast'))).toBe(true)
    expect(document.querySelector('.notice-stack-raised')).toBeNull()
  })

  it('설정의 「아래 상태 줄」 토글은 없어졌다', () => {
    setAppPref('prefixKeyAsked', true)
    expect(Object.keys(getAppPrefs())).not.toContain('statusBar')
  })
})

describe('App — 접두키 · 명령줄 · 명령 팔레트', () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })
  const cells = (container: HTMLElement) => container.querySelectorAll('.pane-grid-cell')
  const screenTabs = () => screen.getAllByRole('tab', { name: /^\d/u }).map((tab) => tab.textContent)
  const press = (init: KeyboardEventInit) => { act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) }) }
  const prefix = () => press({ key: 'b', code: 'KeyB', ctrlKey: true })
  const after = (init: KeyboardEventInit) => { prefix(); press(init) }
  /** 접두키 대기 칩의 글(없으면 undefined) */
  const chipText = () => document.querySelector('.prefix-chip')?.textContent ?? undefined
  /** 가장 최근의 짧은 알림(토스트) */
  const statusMessage = () => { const texts = [...document.querySelectorAll('.notice-toast')].map((toast) => toast.textContent); return texts.length === 0 ? undefined : texts.join(' | ') }
  // 「:」 명령줄은 명령 팔레트가 「:」 로 채워져 열린 것이다(아래 상태 줄은 없다)
  const commandInput = () => screen.getByRole('combobox', { name: '명령 찾기' }) as HTMLInputElement
  const runLine = async (line: string) => {
    after({ key: ':', code: 'Semicolon', shiftKey: true })
    fireEvent.change(commandInput(), { target: { value: `:${line}` } })
    fireEvent.keyDown(commandInput(), { key: 'Enter' })
  }

  it('Ctrl+B(기본 접두키)로 작은 칩 「Ctrl+B …」 이 켜지고 Esc 로 그만두면 사라진다(대기 중에만 있다)', () => {
    render(<App developmentPreview />)
    expect(chipText()).toBeUndefined()
    prefix()
    expect(chipText()).toBe('Ctrl+B …')
    press({ key: 'Escape', code: 'Escape' })
    expect(chipText()).toBeUndefined()
  })

  it('칩은 눌리는 단추가 아니다: 입력기가 접두키를 먹으면 명령 팔레트에 「:」 로 시작해 같은 명령을 친다', () => {
    render(<App developmentPreview />)
    prefix()
    const chip = document.querySelector('.prefix-chip') as HTMLElement
    expect(chip.tagName).toBe('DIV')
    expect(screen.queryByRole('button', { name: '접두키' })).toBeNull()
    press({ key: 'Escape', code: 'Escape' })
  })

  it('% 와 " 는 좌우 · 위아래로 나누고, 한글 입력 상태(code)에서도 같다', async () => {
    const { container } = render(<App developmentPreview />)
    const before = cells(container).length
    after({ key: '%', code: 'Digit5', shiftKey: true })
    await waitFor(() => expect(cells(container)).toHaveLength(before + 1))
    after({ key: '"', code: 'Quote', shiftKey: true })
    await waitFor(() => expect(cells(container)).toHaveLength(before + 2))
  })

  it('z(ㅋ) 는 이 칸만 크게, 한 번 더 누르면 되돌린다. x 는 칸을 닫는다', async () => {
    const { container } = render(<App developmentPreview />)
    const before = cells(container).length
    after({ key: '%', code: 'Digit5', shiftKey: true })
    await waitFor(() => expect(cells(container)).toHaveLength(before + 1))
    after({ key: 'ㅋ', code: 'KeyZ' })
    await waitFor(() => expect(screen.queryByRole('button', { name: '크기 되돌리기' })).not.toBeNull())
    after({ key: 'ㅋ', code: 'KeyZ' })
    await waitFor(() => expect(screen.queryByRole('button', { name: '크기 되돌리기' })).toBeNull())
    after({ key: 'x', code: 'KeyX' })
    await waitFor(() => expect(cells(container)).toHaveLength(before))
  })

  it('c · , · n · p · l · 0-9 · & 는 화면을 만들고 이름을 묻고 오가고 닫는다', async () => {
    render(<App developmentPreview />)
    after({ key: 'c', code: 'KeyC' })
    await waitFor(() => expect(screenTabs()).toEqual(['0읽기', '1화면 1']))
    // , 는 이름 바꾸기 명령을 미리 채워 명령 팔레트를 연다(「:」 가 앞에 붙는다)
    after({ key: ',', code: 'Comma' })
    expect(commandInput().value).toBe(':rename-window 화면 1')
    fireEvent.change(commandInput(), { target: { value: ':rename-window 메모' } })
    fireEvent.keyDown(commandInput(), { key: 'Enter' })
    await waitFor(() => expect(screenTabs()).toEqual(['0읽기', '1메모']))
    after({ key: '0', code: 'Digit0' })
    await waitFor(() => expect(screenTabs()).toEqual(['0읽기', '1메모']))
    after({ key: 'n', code: 'KeyN' })
    await waitFor(() => expect(screenTabs()).toEqual(['0읽기', '1메모']))
    after({ key: 'p', code: 'KeyP' })
    await waitFor(() => expect(screenTabs()).toEqual(['0읽기', '1메모']))
    after({ key: 'l', code: 'KeyL' })
    await waitFor(() => expect(screenTabs()).toEqual(['0읽기', '1메모']))
    // & : 확인 줄 → n 은 그만둔다, y 는 닫는다
    after({ key: '&', code: 'Digit7', shiftKey: true })
    expect(chipText()).toBe('화면을 닫을까요? y/n')
    press({ key: 'n', code: 'KeyN' })
    expect(chipText()).toBeUndefined()
    expect(screenTabs()).toEqual(['0읽기', '1메모'])
    after({ key: '&', code: 'Digit7', shiftKey: true })
    press({ key: 'y', code: 'KeyY' })
    await waitFor(() => expect(screenTabs()).toEqual(['0읽기']))
  })

  it('! 는 칸을 새 화면으로 떼고, { } 는 자리를 바꾸고, Space 는 배치를 돌린다', async () => {
    const { container } = render(<App developmentPreview />)
    after({ key: '%', code: 'Digit5', shiftKey: true })
    await waitFor(() => expect(cells(container).length).toBeGreaterThan(2))
    after({ key: '{', code: 'BracketLeft', shiftKey: true })
    after({ key: '}', code: 'BracketRight', shiftKey: true })
    after({ key: ' ', code: 'Space' })
    await waitFor(() => expect(statusMessage()).toContain('배치: 나란히'))
    after({ key: '!', code: 'Digit1', shiftKey: true })
    await waitFor(() => expect(screenTabs()).toHaveLength(2))
    expect(cells(container).length).toBeGreaterThan(0)
  })

  it('q 는 칸 번호를 겹쳐 보이고, 숫자 키가 그 칸으로 간다', async () => {
    const { container } = render(<App developmentPreview />)
    after({ key: '%', code: 'Digit5', shiftKey: true })
    await waitFor(() => expect(cells(container).length).toBeGreaterThan(2))
    after({ key: 'q', code: 'KeyQ' })
    expect(screen.getByTestId('pane-numbers')).toBeDefined()
    press({ key: '0', code: 'Digit0' })
    await waitFor(() => expect(screen.queryByTestId('pane-numbers')).toBeNull())
    const first = container.querySelectorAll('.pane-focus-scope')[0]?.getAttribute('data-pane-id')
    await waitFor(() => expect(container.querySelector('.pane-focus-scope[data-pane-active]')?.getAttribute('data-pane-id')).toBe(first))
  })

  it('f 는 떠 있는 칸이 없으면 알리고, d 는 마지막 앱 창이라 「앱을 닫을까요?」를 묻고, s 는 세션 메뉴, ? 는 키 목록, 모르는 키는 안내', async () => {
    render(<App developmentPreview />)
    after({ key: 'f', code: 'KeyF' })
    await waitFor(() => expect(statusMessage()).toContain('떠 있는 칸이 없습니다'))
    after({ key: 'd', code: 'KeyD' })
    await waitFor(() => expect(chipText()).toBe('앱을 닫을까요? y/n'))
    // n(또는 y 가 아닌 키)이면 그만둔다
    press({ key: 'n', code: 'KeyN' })
    await waitFor(() => expect(chipText()).toBeUndefined())
    after({ key: 's', code: 'KeyS' })
    await waitFor(() => expect(screen.getByRole('menu', { name: '세션' })).toBeDefined())
    press({ key: 'Escape', code: 'Escape' })
    after({ key: '/', code: 'Slash', shiftKey: true })
    await waitFor(() => expect(screen.getByRole('dialog', { name: '키와 명령' })).toBeDefined())
    fireEvent.keyDown(screen.getByRole('dialog', { name: '키와 명령' }), { key: 'Escape' })
    after({ key: 'j', code: 'KeyJ' })
    expect(statusMessage()).toContain('모르는 키: j — ? 로 목록')
  })

  it('세션 명령: Vault 가 없으면 알리고(바꾸기 · 만들기), 하나뿐인 세션은 지우지 않으며, 세션 이름은 맨 위 줄에 보인다', async () => {
    render(<App developmentPreview />)
    expect(screen.getByRole('button', { name: '기본' })).toBeDefined()
    await runLine('switch-client -t 없는세션')
    await waitFor(() => expect(statusMessage()).toContain('Vault 를 연 뒤에 쓸 수 있습니다'))
    await runLine('kill-session')
    await waitFor(() => expect(statusMessage()).toContain('마지막 세션은 지울 수 없습니다'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await runLine('new-session 둘째')
    await waitFor(() => expect(statusMessage()).toContain('Vault 를 연 뒤에 쓸 수 있습니다'))
    await runLine('list-sessions')
    await waitFor(() => expect(screen.getByRole('menu', { name: '세션' })).toBeDefined())
  })

  it('세션 메뉴는 이름을 받는 동작과 켜진 「앱 창으로 띄우기」를 보인다', async () => {
    render(<App developmentPreview />)
    fireEvent.click(screen.getByRole('button', { name: '기본' }))
    const menu = await screen.findByRole('menu', { name: '세션' })
    expect(within(menu).getByRole('menuitem', { name: /새 세션/u })).toBeDefined()
    expect((within(menu).getByRole('menuitem', { name: /앱 창으로 띄우기/u }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('앱 창 명령: Vault 가 없으면 new-client 는 알리고, detach 는 마지막 앱 창이라 앱을 닫을지 칩으로 묻는다', async () => {
    render(<App developmentPreview />)
    await runLine('new-client')
    await waitFor(() => expect(statusMessage()).toContain('Vault 를 연 뒤에 쓸 수 있습니다'))
    await runLine('detach')
    await waitFor(() => expect(chipText()).toBe('앱을 닫을까요? y/n'))
    press({ key: 'Escape', code: 'Escape' })
  })

  it('마지막 앱 창의 detach 확인에 y 를 누르면 앱을 닫는 길(창 닫기)로 간다', async () => {
    const close = vi.spyOn(windowBridge, 'closeWindow').mockImplementation(() => undefined)
    render(<App developmentPreview />)
    await runLine('detach')
    await waitFor(() => expect(chipText()).toBe('앱을 닫을까요? y/n'))
    expect(close).not.toHaveBeenCalled()
    press({ key: 'y', code: 'KeyY' })
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    close.mockRestore()
  })

  it('세션에 붙은 새 앱 창에는 맨 위 줄에 「앱 창 B」 라벨이 있고, 세션 메뉴가 열린다', async () => {
    setWindowModeForTest({ role: 'extra', docId: null, page: null, zoom: null, vaultRoot: null, session: '기본', screen: null, client: 'B' })
    try {
      render(<App developmentPreview />)
      expect(document.querySelector('.topbar-client-label')?.textContent).toBe('앱 창 B')
      expect((screen.getByRole('button', { name: '기본' }) as HTMLButtonElement).disabled).toBe(false)
    } finally {
      setWindowModeForTest(null)
    }
  })

  it('메인 창에는 「앱 창 B」 라벨이 없다', async () => {
    render(<App developmentPreview />)
    expect(document.querySelector('.topbar-client-label')).toBeNull()
    expect(document.querySelector('.status-bar')).toBeNull()
  })

  it('명령줄(팔레트): Enter 로 실행하고 `;` 로 잇고, 오류는 토스트로 보이며, 기록(↑)이 남는다', async () => {
    const { container } = render(<App developmentPreview />)
    const before = cells(container).length
    await runLine('split-window -h ; new-window -n 둘 ; rename-window 셋')
    await waitFor(() => expect(screenTabs()).toEqual(['0읽기', '1셋']))
    fireEvent.click(screen.getByRole('tab', { name: /읽기/u }))
    await waitFor(() => expect(cells(container)).toHaveLength(before + 1))
    await runLine('모르는명령')
    await waitFor(() => expect(statusMessage()).toContain('모르는 명령: 모르는명령 — ? 로 목록'))
    await runLine('next')
    after({ key: ':', code: 'Semicolon', shiftKey: true })
    fireEvent.keyDown(commandInput(), { key: 'ArrowUp' })
    expect(commandInput().value).toBe(':next')
    fireEvent.keyDown(commandInput(), { key: 'Escape' })
    expect(screen.queryByRole('combobox', { name: '명령 찾기' })).toBeNull()
  })

  it('명령줄 select-pane · swap-pane · select-layout · break-pane · join-pane', async () => {
    const { container } = render(<App developmentPreview />)
    await runLine('split-window -h')
    await waitFor(() => expect(cells(container).length).toBeGreaterThan(2))
    await runLine('select-layout main-vertical ; select-pane -L ; swap-pane -D')
    await runLine('break-pane')
    await waitFor(() => expect(screenTabs()).toHaveLength(2))
    await runLine('select-window -t 0 ; join-pane -s 1')
    await waitFor(() => expect(screenTabs()).toHaveLength(1))
  })

  it('Ctrl+K · Ctrl+Shift+P 가 명령 팔레트를 연다. 맨 위 줄의 「⌘ 명령」 단추는 없다', () => {
    render(<App developmentPreview />)
    expect(screen.queryByRole('button', { name: /명령 팔레트/u })).toBeNull()
    expect(document.querySelector('.topbar')?.textContent).not.toContain('명령')
    press({ key: 'k', code: 'KeyK', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: '명령 팔레트' })).toBeDefined()
    press({ key: 'Escape', code: 'Escape' })
    cleanupPalette()
    press({ key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true })
    expect(screen.getByRole('dialog', { name: '명령 팔레트' })).toBeDefined()
  })

  const cleanupPalette = () => { const field = screen.queryByRole('combobox', { name: '명령 찾기' }); if (field !== null) fireEvent.keyDown(field, { key: 'Escape' }) }

  it('명령 팔레트에 「:」 로 시작해 쓰면 같은 실행기로 간다', async () => {
    const { container } = render(<App developmentPreview />)
    const before = cells(container).length
    press({ key: 'k', code: 'KeyK', ctrlKey: true })
    const input = screen.getByRole('combobox', { name: '명령 찾기' })
    fireEvent.change(input, { target: { value: ':split-window -h' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(cells(container)).toHaveLength(before + 1))
  })

  it('`:` 는 명령 팔레트를 「:」 로 채워서 연다(명령줄은 이 길 하나뿐이다)', async () => {
    render(<App developmentPreview />)
    after({ key: ':', code: 'Semicolon', shiftKey: true })
    const input = await screen.findByRole('combobox', { name: '명령 찾기' })
    expect((input as HTMLInputElement).value).toBe(':')
    expect(document.querySelector('.status-bar-command')).toBeNull()
  })

  it('글 쓰는 칸(입력칸) 안에서도 접두키가 먹고, 다음 키는 입력칸에 들어가지 않는다', async () => {
    const { container } = render(<App developmentPreview />)
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    const before = cells(container).length
    const send = (init: KeyboardEventInit) => { act(() => { field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) }) }
    let reached = 0
    field.addEventListener('keydown', () => { reached += 1 })
    send({ key: 'b', code: 'KeyB', ctrlKey: true })
    send({ key: '%', code: 'Digit5', shiftKey: true })
    await waitFor(() => expect(cells(container)).toHaveLength(before + 1))
    expect(reached).toBe(0)
    field.remove()
  })
})

describe('App — 떠 있는 칸', () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); localStorage.removeItem('iwae:translator-panel:migrated:v1'); localStorage.removeItem('iwae:translator-panel:v1'); localStorage.removeItem('iwae:translator-window:v1'); reloadTranslatorWindow() })
  const floats = (container: HTMLElement) => container.querySelectorAll<HTMLElement>('.pane-float')
  const treeCells = (container: HTMLElement) => container.querySelectorAll('.pane-grid-cell:not(.pane-float)')
  const openMenu = (index: number) => fireEvent.click(screen.getAllByRole('button', { name: '칸 메뉴' })[index]!)
  const pick = (name: RegExp) => fireEvent.click(screen.getByRole('menuitem', { name }))
  const press = (init: KeyboardEventInit) => { act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) }) }
  const after = (init: KeyboardEventInit) => { press({ key: 'b', code: 'KeyB', ctrlKey: true }); press(init) }
  const statusMessage = () => { const texts = [...document.querySelectorAll('.notice-toast')].map((toast) => toast.textContent); return texts.length === 0 ? undefined : texts.join(' | ') }
  const runLine = async (line: string) => {
    after({ key: ':', code: 'Semicolon', shiftKey: true })
    const input = screen.getByRole('combobox', { name: '명령 찾기' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: `:${line}` } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // 팔레트는 닫힌 뒤(setTimeout 0)에 명령을 실행한다: 다음 명령 전에 끝나게 잠깐 기다린다
    await act(async () => { await new Promise((resolve) => { window.setTimeout(resolve, 25) }) })
  }
  const NOTE_TAB = 'Evidence Map — Sample Research Note'

  it('⋯ 「띄우기」: 칸이 트리에서 빠져 떠 있는 칸이 되고(탭 그대로), 머리에 ▁ ⇲ × 단추가 있다', async () => {
    const { container } = render(<App developmentPreview />)
    expect(treeCells(container)).toHaveLength(2)
    openMenu(1)
    pick(/띄우기/u)
    await waitFor(() => expect(floats(container)).toHaveLength(1))
    expect(treeCells(container)).toHaveLength(1)
    const card = floats(container)[0]!
    expect(within(card).getByRole('tab', { name: NOTE_TAB })).toBeDefined()
    for (const name of ['접기', '칸으로 넣기', '떠 있는 칸 닫기']) expect(within(card).getByRole('button', { name })).toBeDefined()
    expect(within(card).getByRole('separator', { name: '떠 있는 칸 크기 바꾸기' })).toBeDefined()
    // 떠 있는 칸은 칸 번호를 받지 않는다
    expect(card.querySelector('.pane-head-number')).toBeNull()
  })

  it('▁ 접기는 머리만 남기고, 펼치기로 되돌린다', async () => {
    const { container } = render(<App developmentPreview />)
    openMenu(1)
    pick(/띄우기/u)
    await waitFor(() => expect(floats(container)).toHaveLength(1))
    const card = () => floats(container)[0]!
    fireEvent.click(within(card()).getByRole('button', { name: '접기' }))
    expect(card().hasAttribute('data-collapsed')).toBe(true)
    expect(card().querySelector('.pane-float-body')?.hasAttribute('hidden')).toBe(true)
    expect(within(card()).queryByRole('separator', { name: '떠 있는 칸 크기 바꾸기' })).toBeNull()
    fireEvent.click(within(card()).getByRole('button', { name: '펼치기' }))
    expect(card().hasAttribute('data-collapsed')).toBe(false)
  })

  it('⇲ 칸으로 넣기: 떠 있는 칸이 트리로 돌아가 칸이 다시 둘이 된다', async () => {
    const { container } = render(<App developmentPreview />)
    openMenu(1)
    pick(/띄우기/u)
    await waitFor(() => expect(floats(container)).toHaveLength(1))
    fireEvent.click(within(floats(container)[0]!).getByRole('button', { name: '칸으로 넣기' }))
    await waitFor(() => expect(floats(container)).toHaveLength(0))
    expect(treeCells(container)).toHaveLength(2)
    expect(screen.getByRole('tab', { name: NOTE_TAB })).toBeDefined()
  })

  it('× 닫기: 문서 탭은 칸에 합쳐져 잃지 않는다', async () => {
    const { container } = render(<App developmentPreview />)
    openMenu(1)
    pick(/띄우기/u)
    await waitFor(() => expect(floats(container)).toHaveLength(1))
    fireEvent.click(within(floats(container)[0]!).getByRole('button', { name: '떠 있는 칸 닫기' }))
    await waitFor(() => expect(floats(container)).toHaveLength(0))
    expect(treeCells(container)).toHaveLength(1)
    expect(screen.getByRole('tab', { name: NOTE_TAB })).toBeDefined()
  })

  it('접두키 f: 떠 있는 칸을 모두 숨기고(그리지 않는다) 다시 누르면 보인다', async () => {
    const { container } = render(<App developmentPreview />)
    openMenu(1)
    pick(/띄우기/u)
    await waitFor(() => expect(floats(container)).toHaveLength(1))
    after({ key: 'f', code: 'KeyF' })
    await waitFor(() => expect(floats(container)).toHaveLength(0))
    expect(statusMessage()).toContain('떠 있는 칸을 숨겼습니다')
    after({ key: 'f', code: 'KeyF' })
    await waitFor(() => expect(floats(container)).toHaveLength(1))
  })

  it('떠 있는 칸의 마지막 탭을 닫으면 그 칸도 닫힌다(탭을 끌어 내도 같다)', async () => {
    const { container } = render(<App developmentPreview />)
    openMenu(1)
    pick(/띄우기/u)
    await waitFor(() => expect(floats(container)).toHaveLength(1))
    // 가운데 클릭 = 탭 닫기
    const tab = within(floats(container)[0]!).getByRole('tab', { name: NOTE_TAB })
    fireEvent(tab, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))
    await waitFor(() => expect(floats(container)).toHaveLength(0))
  })

  it('접두키 w 는 번역기 창을 연다(떠 있는 칸이 아니다). 한 번 더 눌러도 새로 만들지 않고 창은 하나다', async () => {
    const { container } = render(<App developmentPreview />)
    expect(document.querySelector('.translator-window')).toBeNull()
    after({ key: 'w', code: 'KeyW' })
    await waitFor(() => expect(document.querySelector('.translator-window')).not.toBeNull())
    expect(floats(container)).toHaveLength(0)
    expect(treeCells(container)).toHaveLength(2)
    expect(within(document.querySelector('.translator-window') as HTMLElement).getByRole('region', { name: '번역기' })).toBeDefined()
    after({ key: 'w', code: 'KeyW' })
    await new Promise((resolve) => { window.setTimeout(resolve, 60) })
    expect(document.querySelectorAll('.translator-window')).toHaveLength(1)
  })

  it('접두키 w 로 열면 번역기의 입력칸에 포커스가 간다', async () => {
    render(<App developmentPreview />)
    after({ key: 'w', code: 'KeyW' })
    await waitFor(() => expect(document.querySelector('.translator-window')).not.toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('번역할 글')))
  })

  it('번역을 꺼 둔 설정이면 접두키 w · display-popup(이름 없음)은 창을 열지 않고 짧게 알린다', async () => {
    localStorage.setItem('iwae:translation-settings:v1', JSON.stringify({ executionMode: 'auto', enabled: false }))
    render(<App developmentPreview />)
    after({ key: 'w', code: 'KeyW' })
    await waitFor(() => expect(statusMessage()).toContain('번역이 꺼져 있습니다'))
    expect(document.querySelector('.translator-window')).toBeNull()
    expect(getTranslatorWindow().open).toBe(false)
  })

  it('번역기 창은 어느 칸 · 탭에도 속하지 않는다: 칸을 옮기고 닫아도 그대로 떠 있다', async () => {
    const { container } = render(<App developmentPreview />)
    act(() => { updateTranslatorWindow({ open: true }) })
    const windowEl = () => document.querySelector('.translator-window') as HTMLElement
    expect(windowEl().parentElement).toBe(document.body)
    expect(container.querySelector('.pane-grid-cell .translator-window')).toBeNull()
    expect(screen.queryByRole('tab', { name: '번역기' })).toBeNull()
    openMenu(1)
    pick(/띄우기/u)
    await waitFor(() => expect(floats(container)).toHaveLength(1))
    expect(windowEl()).not.toBeNull()
    fireEvent.click(within(windowEl()).getByRole('button', { name: '번역기 닫기' }))
    expect(document.querySelector('.translator-window')).toBeNull()
  })

  it('display-popup 이름: 열 곳을 찾아 열고, 못 찾았거나 이미 열려 있으면 빈 떠 있는 칸을 남기지 않는다', async () => {
    const { container } = render(<App developmentPreview />)
    // 이미 열려 있는 노트는 그 자리에서 활성화되고(탭은 한 곳에만), 빈 떠 있는 칸은 남지 않는다
    await runLine('display-popup Evidence-Linked')
    await waitFor(() => expect(statusMessage()).toContain('열었습니다'))
    await new Promise((resolve) => { window.setTimeout(resolve, 80) })
    expect(floats(container)).toHaveLength(0)
    await runLine('display-popup 없는이름없는이름')
    await waitFor(() => expect(statusMessage()).toContain('찾을 수 없습니다'))
    await new Promise((resolve) => { window.setTimeout(resolve, 80) })
    expect(floats(container)).toHaveLength(0)
    expect(treeCells(container)).toHaveLength(2)
  })

  it('명령: float-pane · embed-pane · toggle-floating 이 되고, 칸이 하나뿐이면 float-pane 은 막는다', async () => {
    const { container } = render(<App developmentPreview />)
    await runLine('float-pane')
    await waitFor(() => expect(floats(container)).toHaveLength(1))
    await runLine('float-pane')
    await waitFor(() => expect(statusMessage()).toContain('이미 떠 있는 칸입니다'))
    await runLine('toggle-floating ; toggle-floating')
    await waitFor(() => expect(floats(container)).toHaveLength(1))
    await runLine('embed-pane')
    await waitFor(() => expect(floats(container)).toHaveLength(0))
    expect(treeCells(container)).toHaveLength(2)
    await runLine('select-pane -t 0 ; kill-pane')
    await waitFor(() => expect(treeCells(container)).toHaveLength(1))
    await runLine('float-pane')
    await waitFor(() => expect(statusMessage()).toContain('칸이 하나뿐이라 띄울 수 없습니다'))
  })

  it('select-pane -n 이 보이는 떠 있는 칸까지 돌고, 칸 번호(q)에는 떠 있는 칸이 없다', async () => {
    const { container } = render(<App developmentPreview />)
    await runLine('float-pane')
    await waitFor(() => expect(floats(container)).toHaveLength(1))
    const floatActive = () => container.querySelector('.pane-float .pane-focus-scope[data-pane-active]') !== null
    await waitFor(() => expect(floatActive()).toBe(true))
    await runLine('select-pane -n')
    await waitFor(() => expect(floatActive()).toBe(false))
    await runLine('select-pane -n')
    await waitFor(() => expect(floatActive()).toBe(true))
    // 칸 번호 겹침은 나누기 트리의 칸만 센다(떠 있는 칸은 번호가 없다)
    after({ key: 'q', code: 'KeyQ' })
    expect(screen.getByTestId('pane-numbers')).toBeDefined()
    expect(container.querySelector('.pane-float .pane-head-number')).toBeNull()
    press({ key: 'Escape', code: 'Escape' })
  })

  it('문서 종류별로 저장하던 예전 번역기 값은 한 번 번역기 창(열림 · 크기)으로 옮긴다', async () => {
    localStorage.setItem('iwae:translator-panel:v1', JSON.stringify({ pdf: { open: true, x: 100, y: 50, w: 360, h: 300 }, markdown: { open: false } }))
    const { container } = render(<App developmentPreview />)
    await waitFor(() => expect(document.querySelector('.translator-window')).not.toBeNull())
    expect(floats(container)).toHaveLength(0)
    expect((document.querySelector('.translator-window') as HTMLElement).style.width).toBe('360px')
    expect(localStorage.getItem('iwae:translator-panel:v1')).toBeNull()
    expect(localStorage.getItem('iwae:translator-panel:migrated:v1')).toBe('1')
  })

  it('옮겼다고 적힌 뒤에는 예전 값이 있어도 다시 옮기지 않는다', async () => {
    localStorage.setItem('iwae:translator-panel:migrated:v1', '1')
    localStorage.setItem('iwae:translator-panel:v1', JSON.stringify({ pdf: { open: true } }))
    const { container } = render(<App developmentPreview />)
    await new Promise((resolve) => { window.setTimeout(resolve, 60) })
    expect(floats(container)).toHaveLength(0)
    expect(document.querySelector('.translator-window')).toBeNull()
  })
})
