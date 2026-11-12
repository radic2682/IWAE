// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { PdfBookmark } from '../../core/pdfBookmarks'
import type { VaultSearchRecord } from '../../core/vaultSearch'
import { layoutForCount, layoutForLegacyId, leaves } from '../../core/layoutTree'
import { emptyTabs, type PanesState } from '../tabs'
import type { Screen } from '../screens'
import { buildMcpAppDeps, paneIndexOfRef, type McpAppInput } from './appDeps'

vi.mock('../../bridge/pdf', async () => {
  const h = await import('./testPdf')
  h.setFakePdf('d1', ['The regulator shall start within 5 ms.'])
  return { ...(await vi.importActual<object>('../../bridge/pdf')), pageTextIndex: h.fakePageTextIndex }
})

const record = (id: string, extra: Partial<VaultSearchRecord> = {}): VaultSearchRecord => ({
  id, kind: 'pdf', storage: 'vault', path: `${id}.pdf`, folder: '', filename: `${id}.pdf`, displayName: id, extractedText: '', pages: [{ page: 0, text: 'text' }], missing: false, favorite: false, lastOpenedAt: null, addedAt: '2026-01-01', ...extra,
})

/** 칸 id p0…p(n-1) 를 좌우 한 줄(또는 예전 4칸 격자)로 놓은 상태 */
function workspace(count: number): { layout: McpAppInput['layout']; panes: PanesState; names: string[] } {
  const names = Array.from({ length: count }, (_, index) => `p${index}`)
  return { layout: layoutForCount(count, names), panes: Object.fromEntries(names.map((name) => [name, emptyTabs])), names }
}

function input(overrides: Partial<McpAppInput> = {}, paneTotal = 1) {
  const calls: string[] = []
  const { layout, panes } = workspace(paneTotal)
  const bookmarks: PdfBookmark[] = []
  const base: McpAppInput = {
    vaultRoot: 'C:/vault',
    paneCount: paneTotal,
    layout,
    channels: { p0: 'blue', p1: 'green' },
    growPanes: (count) => { calls.push(`grow ${count}`); return workspace(count).names },
    activePaneId: 'p0',
    panes,
    screens: [{ id: 'w1', name: '읽기', layout, panes, channels: { p0: 'blue', p1: 'green' }, zoomed: null, floats: [] }],
    activeScreenId: 'w1',
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
    setPaneCount: (count) => { calls.push(`paneCount ${count}`); return workspace(count).names },
    setActivePane: (pane) => calls.push(`active ${pane}`),
    setPaneRoute: (kind, pane) => calls.push(`route ${kind} ${pane}`),
    activateTabIn: (pane, id) => calls.push(`activate ${pane} ${id}`),
    closeTab: (tab) => calls.push(`close ${tab.id}`),
    requestPage: () => false,
    pendingPage: (docId, page) => calls.push(`pending ${docId} ${page}`),
    jump: (docId, page) => calls.push(`jump ${docId} ${page}`),
    pointAt: (anchor) => calls.push(`point ${anchor.quote}`),
    draftAnchor: (anchor) => calls.push(`draft ${anchor.quote}`),
    openMemoNote: (path, pane) => { calls.push(`note ${path} ${pane ?? 'beside'}`); return pane ?? 'p1' },
    liveSelection: () => null,
    setFileFavorite: (id, favorite) => calls.push(`favorite ${id} ${String(favorite)}`),
    toolCopy: async (docId, op, suffix) => { calls.push(`tool ${docId} ${op.kind} ${suffix}`); return 'C:/vault/copy.pdf' },
    exportNote: async () => 'C:/vault/out.md',
    pdfToolBusy: () => false,
    workspaceCommand: async (command) => { calls.push(`command ${command}`); return { ok: true, message: '', state: { active_screen: 0, active_pane: 0, screens: [] } } },
    clients: () => [],
    session: async () => ({ name: '기본', sessions: [] }),
    ...overrides,
  }
  return { base, calls }
}

describe('buildMcpAppDeps', () => {
  it('screens: 모든 화면을 번호·이름·보는 화면 표시·칸들로 알리고, 보는 화면의 칸은 panes 와 같다', () => {
    const { base } = input({}, 2)
    const other: Screen = {
      id: 'w2',
      name: '비교',
      layout: { kind: 'pane', paneId: 'q0' },
      panes: { q0: { tabs: [{ id: 'd1', title: '문서', kind: 'pdf' }], activeId: 'd1' } },
      channels: { q0: 'orange' },
      zoomed: null,
      floats: [],
    }
    const app = buildMcpAppDeps({ ...base, screens: [...base.screens, other] })
    expect(app.screens.map((screen) => [screen.index, screen.name, screen.active])).toEqual([[0, '읽기', true], [1, '비교', false]])
    expect(app.screens[0]!.panes).toEqual(app.panes)
    expect(app.screens[1]!.panes).toEqual([{ index: 0, id: 'q0', tabs: [{ id: 'd1', title: '문서', kind: 'pdf' }], activeId: 'd1', channel: 'orange' }])
  })

  it('docs 는 쓸 때 한 번만 계산하고 PDF·Markdown 만 담는다', () => {
    const { base } = input()
    const app = buildMcpAppDeps(base)
    expect(app.docs.map((doc) => doc.docId)).toEqual(['d1', 'ref', 'm1'])
    expect(app.docs[0]).toMatchObject({ kind: 'pdf', pageCount: 3, scanned: false, ocr: 'done' })
    expect(app.docs).toBe(app.docs)
  })

  it('openDocument: 처음 여는 PDF 는 고른 패널에 탭으로 놓고, 아직 없는 칸 번호는 칸을 늘려 만든다', async () => {
    const { base, calls } = input()
    const app = buildMcpAppDeps(base)
    const opened = await app.openDocument('d1', { pane: 'right', page: 2 })
    expect(opened).toEqual({ pane: 'p1', page: 2 })
    expect(calls).toEqual(['grow 2', 'openAny', 'openInPane d1 p1', 'active p1', 'route doc p1', 'activate p1 d1', 'pending d1 2'])
    await expect(app.openDocument('nope', {})).rejects.toThrow(/doc_id not found/u)
  })

  it('openNote: 창을 정하지 않으면 문서 옆(앱이 정한 창)에, 정하면 그 창의 탭으로 연다 — 노트 바는 없다', () => {
    const { base, calls } = input()
    const app = buildMcpAppDeps(base)
    expect(app.openNote('노트/A.iwnote')).toEqual({ pane: 'p1' })
    expect(app.openNote('노트/A.iwnote', 'active')).toEqual({ pane: 'p1' })
    expect(app.openNote('노트/B.iwnote', 'third')).toEqual({ pane: 'p2' })
    expect(calls).toEqual(['note 노트/A.iwnote beside', 'note 노트/A.iwnote beside', 'grow 3', 'note 노트/B.iwnote p2'])
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

describe('칸 이름 → 칸 번호(MCP 가 받는 이름)', () => {
  it('left·right·third·fourth 는 칸 번호 0–3, 숫자 문자열은 0–7, 그 밖은 이름이 아니다', () => {
    expect(['left', 'right', 'third', 'fourth'].map(paneIndexOfRef)).toEqual([0, 1, 2, 3])
    expect(['0', '1', '7'].map(paneIndexOfRef)).toEqual([0, 1, 7])
    expect(paneIndexOfRef('8')).toBeNull()
    expect(paneIndexOfRef('-1')).toBeNull()
    expect(paneIndexOfRef('active')).toBeNull()
    expect(paneIndexOfRef('p3')).toBeNull()
  })

  it('있는 칸이면 늘리지 않고 칸 번호 차례의 칸 id 로 연다(예전 이름과 숫자가 같은 칸)', async () => {
    const { base, calls } = input({}, 4)
    const app = buildMcpAppDeps(base)
    for (const [ref, id] of [['left', 'p0'], ['right', 'p1'], ['third', 'p2'], ['fourth', 'p3'], ['0', 'p0'], ['3', 'p3'], ['p2', 'p2']] as const) {
      expect((await app.openDocument('d1', { pane: ref, activate: false })).pane, ref).toBe(id)
    }
    expect(calls.filter((call) => call.startsWith('grow'))).toEqual([])
  })

  it('active 는 지금 만진 칸, other 는 칸 차례의 다음 칸이다', async () => {
    const { base } = input({ activePaneId: 'p2' }, 3)
    const app = buildMcpAppDeps(base)
    expect((await app.openDocument('d1', { pane: 'active', activate: false })).pane).toBe('p2')
    expect((await app.openDocument('d1', { pane: 'other', activate: false })).pane).toBe('p0')
    expect((await app.openDocument('d1', { activate: false })).pane).toBe('p2')
  })

  it('칸 번호 7 은 여덟 칸까지 늘려 만들고, 만들 수 없으면 오류', async () => {
    const { base, calls } = input()
    const app = buildMcpAppDeps(base)
    expect((await app.openDocument('d1', { pane: '7', activate: false })).pane).toBe('p7')
    expect(calls).toContain('grow 8')
    const stuck = input({ growPanes: () => ['p0'] })
    await expect(buildMcpAppDeps(stuck.base).openDocument('d1', { pane: '3' })).rejects.toThrow(/could not be created/u)
    await expect(buildMcpAppDeps(input().base).openDocument('d1', { pane: 'sideways' })).rejects.toThrow(/unknown pane/u)
  })

  it('panes 는 칸 번호 차례로 { index, id, tabs, channel } 를 내고 layout 에 트리를 싣는다', () => {
    const { base } = input({
      panes: { p0: { tabs: [{ id: 'd1', title: 'T', kind: 'pdf' }], activeId: 'd1' }, p1: emptyTabs },
      layout: layoutForLegacyId('cols2', ['p0', 'p1']),
    }, 2)
    const app = buildMcpAppDeps(base)
    expect(app.panes).toEqual([
      { index: 0, id: 'p0', tabs: [{ id: 'd1', title: 'T', kind: 'pdf' }], activeId: 'd1', channel: 'blue' },
      { index: 1, id: 'p1', tabs: [], activeId: null, channel: 'green' },
    ])
    expect(leaves(app.layout)).toEqual(['p0', 'p1'])
  })

  it('setLayout 은 칸 수를 바꾸고 만질 칸 번호를 돌려준다', () => {
    const { base, calls } = input()
    const app = buildMcpAppDeps(base)
    expect(app.setLayout(3, 2)).toEqual({ paneCount: 3, activePane: 2 })
    expect(calls).toEqual(['paneCount 3', 'active p2'])
    // 칸 수보다 큰 번호는 마지막 칸으로
    expect(app.setLayout(2, 5)).toEqual({ paneCount: 2, activePane: 1 })
    // focus 를 안 주면 지금 만진 칸(있으면)
    expect(app.setLayout(2)).toEqual({ paneCount: 2, activePane: 0 })
  })
})
