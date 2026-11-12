// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { PdfBookmark } from '../../core/pdfBookmarks'
import type { VaultSearchRecord } from '../../core/vaultSearch'
import { emptyTabs, type PanesState } from '../tabs'
import { buildMcpAppDeps, type McpAppInput } from './appDeps'

vi.mock('../../bridge/pdf', async () => {
  const h = await import('./testPdf')
  h.setFakePdf('d1', ['The regulator shall start within 5 ms.'])
  return { ...(await vi.importActual<object>('../../bridge/pdf')), pageTextIndex: h.fakePageTextIndex }
})

const record = (id: string, extra: Partial<VaultSearchRecord> = {}): VaultSearchRecord => ({
  id, kind: 'pdf', storage: 'vault', path: `${id}.pdf`, folder: '', filename: `${id}.pdf`, displayName: id, extractedText: '', pages: [{ page: 0, text: 'text' }], missing: false, favorite: false, lastOpenedAt: null, addedAt: '2026-01-01', ...extra,
})

function input(overrides: Partial<McpAppInput> = {}) {
  const calls: string[] = []
  const panes: PanesState = { left: emptyTabs, right: emptyTabs, third: emptyTabs, fourth: emptyTabs }
  const bookmarks: PdfBookmark[] = []
  const base: McpAppInput = {
    vaultRoot: 'C:/vault',
    paneCount: 1,
    activePaneId: 'left',
    panes,
    docViews: {},
    shownLibrary: [{ docId: 'd1', title: '문서', pages: 3 }],
    openedDocs: [{ docId: 'd1', title: '문서', pageCount: 3, hasText: true }],
    searchRecords: [record('d1'), record('ref', { storage: 'reference' }), record('m1', { kind: 'markdown' })],
    docTitles: { d1: '문서' },
    highlights: [],
    bookmarks: {
      list: bookmarks,
      toggle: (docId, page, title) => { bookmarks.push({ id: `${docId}:${page}`, docId, page, title, createdAt: 'x' }); calls.push('toggle') },
      isBookmarked: (docId, page) => bookmarks.some((item) => item.docId === docId && item.page === page),
      addPin: (docId, page, y, title) => { const id = y <= 0 ? `${docId}:${page}` : `${docId}:${page}:${Math.round(y * 1000)}`; bookmarks.push({ id, docId, page, title, createdAt: 'x', y }); return id },
      updatePin: () => calls.push('updatePin'),
      movePin: (id) => id,
      remove: (id) => calls.push(`remove ${id}`),
    },
    translation: { settings: { enabled: true, executionMode: 'auto', externalProvider: 'google', targetLanguage: 'ko' }, selectedModel: 'm', translate: async (text) => ({ translatedText: `번역 ${text}` }) },
    themePreference: 'dark',
    language: 'ko',
    openAnyDocument: async () => { calls.push('openAny'); return null },
    markdownDocById: () => undefined,
    openInPane: (tab, pane) => calls.push(`openInPane ${tab.id} ${String(pane)}`),
    moveTab: (id, target) => calls.push(`moveTab ${id} ${target}`),
    setPaneCount: (count) => calls.push(`paneCount ${count}`),
    setActivePane: (pane) => calls.push(`active ${pane}`),
    setPaneRoute: (kind, pane) => calls.push(`route ${kind} ${pane}`),
    activateTabIn: (pane, id) => calls.push(`activate ${pane} ${id}`),
    closeTab: (tab) => calls.push(`close ${tab.id}`),
    requestPage: () => false,
    pendingPage: (docId, page) => calls.push(`pending ${docId} ${page}`),
    jump: (docId, page) => calls.push(`jump ${docId} ${page}`),
    pointAt: (anchor) => calls.push(`point ${anchor.quote}`),
    draftAnchor: (anchor) => calls.push(`draft ${anchor.quote}`),
    openMemoNote: (path, pane) => { calls.push(`note ${path} ${pane ?? 'beside'}`); return pane ?? 'right' },
    liveSelection: () => null,
    setFileFavorite: (id, favorite) => calls.push(`favorite ${id} ${String(favorite)}`),
    toolCopy: async (docId, op, suffix) => { calls.push(`tool ${docId} ${op.kind} ${suffix}`); return 'C:/vault/copy.pdf' },
    exportNote: async () => 'C:/vault/out.md',
    pdfToolBusy: () => false,
    ...overrides,
  }
  return { base, calls }
}

describe('buildMcpAppDeps', () => {
  it('docs 는 쓸 때 한 번만 계산하고 PDF·Markdown 만 담는다', () => {
    const { base } = input()
    const app = buildMcpAppDeps(base)
    expect(app.docs.map((doc) => doc.docId)).toEqual(['d1', 'ref', 'm1'])
    expect(app.docs[0]).toMatchObject({ kind: 'pdf', pageCount: 3, scanned: false, ocr: 'done' })
    expect(app.docs).toBe(app.docs)
  })

  it('openDocument: 처음 여는 PDF 는 고른 패널에 탭으로 놓고, 모자란 단은 늘린다', async () => {
    const { base, calls } = input()
    const app = buildMcpAppDeps(base)
    const opened = await app.openDocument('d1', { pane: 'right', page: 2 })
    expect(opened).toEqual({ pane: 'right', page: 2 })
    expect(calls).toEqual(['paneCount 2', 'openAny', 'openInPane d1 right', 'active right', 'route doc right', 'activate right d1', 'pending d1 2'])
    await expect(app.openDocument('nope', {})).rejects.toThrow(/doc_id not found/u)
  })

  it('openNote: 창을 정하지 않으면 문서 옆(앱이 정한 창)에, 정하면 그 창의 탭으로 연다 — 노트 바는 없다', () => {
    const { base, calls } = input()
    const app = buildMcpAppDeps(base)
    expect(app.openNote('노트/A.iwnote')).toEqual({ pane: 'right' })
    expect(app.openNote('노트/A.iwnote', 'active')).toEqual({ pane: 'right' })
    expect(app.openNote('노트/B.iwnote', 'third')).toEqual({ pane: 'third' })
    expect(calls).toEqual(['note 노트/A.iwnote beside', 'note 노트/A.iwnote beside', 'paneCount 3', 'note 노트/B.iwnote third'])
  })

  it('runPdfTool: 쪽 범위를 0부터로 바꾸고, Vault 밖(참조) 문서와 쪽 일부 번호 매기기는 거절한다', async () => {
    const { base, calls } = input()
    const app = buildMcpAppDeps(base)
    expect(await app.runPdfTool('d1', { kind: 'extract', pages: '1-2' })).toEqual({ path: 'C:/vault/copy.pdf', docId: null, pageCount: 2 })
    expect(calls).toContain('tool d1 extract (p.1-2)')
    await expect(app.runPdfTool('ref', { kind: 'extract', pages: '1' })).rejects.toThrow(/outside the Vault/u)
    await expect(app.runPdfTool('d1', { kind: 'pageNumbers', pages: '1' })).rejects.toThrow(/only some pages/u)
    await expect(app.runPdfTool('d1', { kind: 'extract', pages: '9' })).rejects.toThrow(/pages could not be read/u)
  })

  it('책갈피: y 가 없으면 쪽 책갈피(이미 있으면 그대로), 있으면 핀, 되살리기는 핀으로 다시 단다', () => {
    const { base, calls } = input()
    const app = buildMcpAppDeps(base)
    expect(app.addBookmark('d1', 0, '처음', {})).toBe('d1:0')
    expect(app.addBookmark('d1', 0, '처음', {})).toBe('d1:0')
    expect(calls.filter((call) => call === 'toggle')).toHaveLength(1)
    expect(app.addBookmark('d1', 1, '핀', { y: 0.5, emoji: '⭐' })).toBe('d1:1:500')
    app.restoreBookmarks([{ id: 'd1:2', docId: 'd1', page: 2, title: '복원', createdAt: 'x' }])
    expect(base.bookmarks.list.some((item) => item.id === 'd1:2')).toBe(true)
  })

  it('goto: 칠한 형광펜이 있으면 그 자리에, 없으면 글을 찾아 AI 가리킴을 그린다(선택 표시는 건드리지 않는다)', async () => {
    const { base, calls } = input({
      highlights: [{ id: 'h1', color: 'yellow', anchor: { docId: 'd1', page: 0, coordSpace: 'pdfium-page', rects: [], charRange: [0, 5], quote: 'The regulator', prefix: '', suffix: '' } }],
    })
    const app = buildMcpAppDeps(base)
    expect(await app.goto({ docId: 'd1', page: 1, quote: 'the regulator', flash: true })).toEqual({ flashed: true })
    expect(calls).toContain('point The regulator')
    expect(await app.goto({ docId: 'd1', page: 1, quote: 'within 5 ms', flash: true })).toEqual({ flashed: true })
    expect(calls).toContain('point within 5 ms')
    expect(calls.some((call) => call.startsWith('draft'))).toBe(false)
    expect(await app.goto({ docId: 'd1', page: 1, quote: 'not on the page', flash: true })).toEqual({ flashed: false })
    expect(await app.goto({ docId: 'd1', page: 1, flash: false })).toEqual({ flashed: false })
  })

  it('번역은 실행 방식과 준비 여부를 알리고, 닫기는 없는 탭을 거절한다', async () => {
    const { base } = input()
    const app = buildMcpAppDeps(base)
    expect(app.translation).toMatchObject({ enabled: true, executionMode: 'auto', ready: true })
    expect(await app.translation.translate('hi')).toBe('번역 hi')
    expect(app.closeTab('nope')).toBe(false)
    expect(app.settings()).toEqual({ language: 'ko', theme: 'dark' })
  })
})
