// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openPdf, pageTextIndex, pickPdfFile } from '../bridge/pdf'
import {
  createMarkdownFile,
  createNote,
  listVaultTree,
  openVault,
  readLibrary,
  readMarkdown,
  readSession,
  recentVaults,
  writeSession,
  loadSessions,
  writeSessionNamed,
  readVaultTreeOrder,
  readVaultIndex,
  readVaultMetadata,
  readVaultSearchTextCache,
  writeVaultTreeOrder,
  writeVaultIndex,
  writeVaultSearchTextCache,
  writeVaultMetadata,
  attachPdfToLibrary,
  attachMarkdownReference,
} from '../bridge/vault'
import { useVault } from './useVault'
import { leaves, shapeOf } from '../core/layoutTree'
import { tabsOf } from './tabs'
import { setWindowModeForTest } from '../core/windowMode'

/** 지금 칸 차례(왼쪽 위부터 0)의 칸의 탭 줄 */
const paneTabs = (result: { current: ReturnType<typeof useVault> }, index: number) => tabsOf(result.current.panes, leaves(result.current.paneLayout)[index]!)
const paneIds = (result: { current: ReturnType<typeof useVault> }) => leaves(result.current.paneLayout)
import { CANVAS_ENABLED } from '../core/features'
import { useVaultWatcher } from './useVaultWatcher'
import { recognizePdfPageText } from '../pdf/pdfOcrText'
import {
  convertReferenceToCopy,
  copyVaultEntryPath,
  createVaultFolder,
  duplicateVaultEntry,
  moveVaultEntry,
  trashVaultEntry,
} from '../bridge/vaultFiles'

vi.mock('../bridge/pdf', () => ({
  invalidateDocument: vi.fn(),
  openPdf: vi.fn(),
  pageTextIndex: vi.fn(),
  pickPdfFile: vi.fn(),
}))

vi.mock('../bridge/vault', () => ({
  addToLibrary: vi.fn(),
  registerUnlistedVaultPdfs: vi.fn().mockResolvedValue([]),
  updateLibraryPageCount: vi.fn().mockResolvedValue(null),
  attachPdfToLibrary: vi.fn(),
  attachMarkdownReference: vi.fn(),
  createNote: vi.fn(),
  createMarkdownFile: vi.fn(),
  listVaultTree: vi.fn(),
  openVault: vi.fn(),
  readLibrary: vi.fn(),
  readMarkdown: vi.fn(),
  readSession: vi.fn(),
  loadSessions: vi.fn(),
  listSessionNames: vi.fn().mockResolvedValue([]),
  readSessionNamed: vi.fn(),
  writeSessionNamed: vi.fn(),
  writeSessionsMeta: vi.fn().mockResolvedValue(undefined),
  removeSessionNamed: vi.fn().mockResolvedValue(undefined),
  trashSessionNamed: vi.fn().mockResolvedValue(undefined),
  readVaultTreeOrder: vi.fn(),
  readVaultIndex: vi.fn(),
  readVaultMetadata: vi.fn(),
  readVaultSearchTextCache: vi.fn(),
  recentVaults: vi.fn(),
  relinkDocument: vi.fn(),
  writeSession: vi.fn(),
  writeVaultTreeOrder: vi.fn(),
  writeVaultIndex: vi.fn(),
  writeVaultMetadata: vi.fn(),
  writeVaultSearchTextCache: vi.fn(),
  subscribeVaultFile: vi.fn(() => () => undefined),
}))

vi.mock('./useVaultWatcher', () => ({ useVaultWatcher: vi.fn() }))
vi.mock('../pdf/pdfOcrText', () => ({ recognizePdfPageText: vi.fn() }))
vi.mock('../bridge/vaultFiles', () => ({
  convertReferenceToCopy: vi.fn(),
  copyVaultEntryPath: vi.fn(),
  createVaultFolder: vi.fn(),
  duplicateVaultEntry: vi.fn(),
  moveVaultEntry: vi.fn(),
  renameVaultEntry: vi.fn(),
  trashVaultEntry: vi.fn(),
}))

const goodEntry = {
  docId: 'goodgoodgood',
  path: 'C:/Specs/good.pdf',
  sha256: 'a'.repeat(64),
  size: 100,
  pages: 10,
  title: 'Stored title',
  addedAt: '2026-09-20T00:00:00.000Z',
}

const missingEntry = {
  ...goodEntry,
  docId: 'missing00000',
  path: 'C:/Specs/missing.pdf',
  sha256: 'b'.repeat(64),
  title: 'Missing',
}

// 세션은 이름 붙은 파일이지만, 이 파일의 시험은 한 세션(「기본」)의 내용만 본다: 읽기는 readSession 의 값을, 쓰기는 writeSession 을 거친다
beforeEach(() => {
  vi.mocked(loadSessions).mockImplementation(async () => ({ name: '기본', names: ['기본'], meta: { last: '기본', used: {} }, raw: await vi.mocked(readSession)({ root: 'C:/Vault' }) }))
  vi.mocked(writeSessionNamed).mockReset()
  vi.mocked(writeSessionNamed).mockImplementation(async (vault, _name, session) => vi.mocked(writeSession)(vault, session))
})

describe('useVault — 시작 복원', () => {
  beforeEach(() => {
    // 예전 세션은 배치 id 를 localStorage 에 따로 적었다. 대부분의 시험은 좌우 둘로 쓰던 사람의 세션이다
    localStorage.clear()
    localStorage.setItem('iwae:pane-layout:v1', 'cols2')
    setWindowModeForTest(null)
    vi.mocked(recentVaults).mockReset()
    vi.mocked(openVault).mockReset()
    vi.mocked(readLibrary).mockReset()
    vi.mocked(readMarkdown).mockReset()
    vi.mocked(listVaultTree).mockReset()
    vi.mocked(readSession).mockReset()
    vi.mocked(writeSession).mockReset()
    vi.mocked(readVaultTreeOrder).mockReset()
    vi.mocked(readVaultIndex).mockReset()
    vi.mocked(readVaultMetadata).mockReset()
    vi.mocked(readVaultSearchTextCache).mockReset()
    vi.mocked(writeVaultTreeOrder).mockReset()
    vi.mocked(writeVaultIndex).mockReset()
    vi.mocked(writeVaultSearchTextCache).mockReset()
    vi.mocked(writeVaultMetadata).mockReset()
    vi.mocked(attachPdfToLibrary).mockReset()
    vi.mocked(attachMarkdownReference).mockReset()
    vi.mocked(openPdf).mockReset()
    vi.mocked(pageTextIndex).mockReset()
    vi.mocked(pickPdfFile).mockReset()
    vi.mocked(recognizePdfPageText).mockReset()
    vi.mocked(convertReferenceToCopy).mockReset()
    vi.mocked(copyVaultEntryPath).mockReset()
    vi.mocked(createVaultFolder).mockReset()
    vi.mocked(duplicateVaultEntry).mockReset()
    vi.mocked(moveVaultEntry).mockReset()
    vi.mocked(trashVaultEntry).mockReset()

    vi.mocked(readMarkdown).mockResolvedValue('# Indexed Markdown\nHTTP content negotiation')
    vi.mocked(writeSession).mockResolvedValue(undefined)

    vi.mocked(recentVaults).mockResolvedValue(['C:/Vault'])
    vi.mocked(openVault).mockResolvedValue({ root: 'C:/Vault' })
    vi.mocked(readLibrary).mockResolvedValue([goodEntry, missingEntry])
    vi.mocked(listVaultTree).mockResolvedValue([
      { path: 'HTTP', isDirectory: true },
      { path: 'HTTP/OPTIONS.canvas', isDirectory: false },
      { path: 'HTTP/README.md', isDirectory: false },
    ])
    vi.mocked(readSession).mockResolvedValue({
      pdfTabIds: [missingEntry.docId, goodEntry.docId],
      noteTabIds: ['HTTP/OPTIONS.canvas'],
      activePdfTabId: goodEntry.docId,
      activeNoteTabId: 'HTTP/OPTIONS.canvas',
      sidebarCollapsed: true,
      sidebarPx: 310,
      leftFrac: 0.4,
    })
    vi.mocked(readVaultTreeOrder).mockResolvedValue({
      '': ['folder:HTTP', `pdf:${goodEntry.docId}`, `pdf:${missingEntry.docId}`],
      HTTP: ['note:HTTP/OPTIONS.canvas'],
    })
    vi.mocked(readVaultIndex).mockResolvedValue({
      version: 1,
      entries: [
        {
          id: goodEntry.docId,
          kind: 'pdf',
          storage: 'reference',
          path: goodEntry.path,
          displayName: goodEntry.title,
          contentHash: goodEntry.sha256,
          size: goodEntry.size,
          modifiedAt: null,
          addedAt: goodEntry.addedAt,
          missing: false,
        },
      ],
    })
    vi.mocked(readVaultMetadata).mockResolvedValue({ version: 1, markdownTheme: 'light', fileActivity: {}, itemIcons: {} })
    vi.mocked(readVaultSearchTextCache).mockResolvedValue({ version: 2, documents: {} })
    vi.mocked(writeVaultSearchTextCache).mockResolvedValue(undefined)
    vi.mocked(writeVaultMetadata).mockResolvedValue(undefined)
    vi.mocked(pageTextIndex).mockImplementation(async (_docId, page) => ({
      text: `HTTP indexed PDF page ${page + 1}`,
      chars: [],
    }))
    vi.mocked(recognizePdfPageText).mockResolvedValue('')
    vi.mocked(createVaultFolder).mockResolvedValue('HTTP/Protocol')
    vi.mocked(duplicateVaultEntry).mockResolvedValue({
      id: 'copy-pdf', kind: 'pdf', storage: 'vault', path: 'Copies/good copy.pdf',
      displayName: 'good copy', contentHash: goodEntry.sha256, size: goodEntry.size,
      modifiedAt: null, addedAt: '2026-09-27T00:00:00.000Z', missing: false,
    })
    vi.mocked(moveVaultEntry).mockResolvedValue({
      id: goodEntry.docId, kind: 'pdf', storage: 'vault', path: 'Archive/good.pdf',
      displayName: goodEntry.title, contentHash: goodEntry.sha256, size: goodEntry.size,
      modifiedAt: null, addedAt: goodEntry.addedAt, missing: false,
    })
    vi.mocked(convertReferenceToCopy).mockResolvedValue({
      id: goodEntry.docId, kind: 'pdf', storage: 'vault', path: 'Imported/good.pdf',
      displayName: goodEntry.title, contentHash: goodEntry.sha256, size: goodEntry.size,
      modifiedAt: null, addedAt: goodEntry.addedAt, missing: false,
    })
    vi.mocked(copyVaultEntryPath).mockResolvedValue('C:/Specs/good.pdf')
    vi.mocked(openPdf).mockImplementation(async (path) => {
      if (path === missingEntry.path) throw new Error('파일 없음')
      return {
        docId: goodEntry.docId,
        sha256: goodEntry.sha256,
        size: goodEntry.size,
        title: 'Current title',
        pageCount: goodEntry.pages,
        pageSizes: [[612, 792]],
        hasText: true,
      }
    })
  })

  it.skipIf(!CANVAS_ENABLED)('살아 있는 탭과 레이아웃을 복원하고 사라진 PDF만 건너뛴다', async () => {
    const { result } = renderHook(() => useVault())

    await waitFor(() => {
      expect(result.current.initializing).toBe(false)
    })

    expect(result.current.vault).toEqual({ root: 'C:/Vault' })
    expect(paneTabs(result, 0)).toEqual({
      // 탭 제목은 사이드바와 같은 Vault 표시 이름이다(파일 안 제목이 아니라).
      tabs: [{ id: goodEntry.docId, title: 'Stored title', kind: 'pdf' }],
      activeId: goodEntry.docId,
    })
    expect(paneTabs(result, 1)).toEqual({
      tabs: [{ id: 'HTTP/OPTIONS.canvas', title: 'OPTIONS', kind: 'canvas' }],
      activeId: 'HTTP/OPTIONS.canvas',
    })
    expect(result.current.missingDocIds).toEqual([missingEntry.docId])
    expect(result.current.sidebarCollapsed).toBe(true)
    expect(result.current.layout).toEqual({ sidebarPx: 310, leftFrac: 0.4 })
    expect(result.current.tree).toMatchObject([
      {
        id: 'folder:HTTP',
        children: [
          { id: 'note:HTTP/OPTIONS.canvas' },
          { kind: 'markdown', path: 'HTTP/README.md', storage: 'vault' },
        ],
      },
      { id: `pdf:${goodEntry.docId}` },
      { id: `pdf:${missingEntry.docId}` },
    ])
    expect(useVaultWatcher).toHaveBeenLastCalledWith(expect.objectContaining({
      vaultPath: 'C:/Vault',
      index: expect.arrayContaining([
        expect.objectContaining({ id: goodEntry.docId }),
        expect.objectContaining({ kind: 'canvas', path: 'HTTP/OPTIONS.canvas' }),
        expect.objectContaining({ kind: 'markdown', path: 'HTTP/README.md' }),
      ]),
    }))
    expect(writeVaultIndex).toHaveBeenCalledWith(
      { root: 'C:/Vault' },
      expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({ kind: 'canvas', path: 'HTTP/OPTIONS.canvas' }),
        ]),
      }),
    )
  })

  it.skipIf(CANVAS_ENABLED)('캔버스가 꺼져 있으면 세션의 캔버스 탭은 조용히 건너뛰고 나머지(문서 탭)는 그대로 되살린다', async () => {
    vi.mocked(readSession).mockResolvedValue({
      pdfTabIds: [goodEntry.docId],
      noteTabIds: ['HTTP/OPTIONS.canvas'],
      activePdfTabId: goodEntry.docId,
      activeNoteTabId: 'HTTP/OPTIONS.canvas',
      sidebarCollapsed: false,
      sidebarPx: 310,
      leftFrac: 0.5,
      panes: { left: ['HTTP/OPTIONS.canvas'], right: [goodEntry.docId], activeLeft: 'HTTP/OPTIONS.canvas', activeRight: goodEntry.docId },
    })
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    expect(result.current.error).toBeNull()
    const all = [0, 1].flatMap((index) => paneTabs(result, index).tabs.map((tab) => [tab.id, tab.kind]))
    expect(all).toEqual([[goodEntry.docId, 'pdf']])
    expect(all.some(([, kind]) => kind === 'canvas')).toBe(false)
  })

  it.skipIf(!CANVAS_ENABLED)('캔버스 탭을 세션 파일의 창 배치대로 되살린다(오른쪽 칸의 캔버스가 문서 칸으로 합쳐지지 않는다)', async () => {
    vi.mocked(readSession).mockResolvedValue({
      pdfTabIds: [goodEntry.docId],
      noteTabIds: ['HTTP/OPTIONS.canvas'],
      activePdfTabId: goodEntry.docId,
      activeNoteTabId: 'HTTP/OPTIONS.canvas',
      sidebarCollapsed: false,
      sidebarPx: 310,
      leftFrac: 0.5,
      panes: { left: ['HTTP/OPTIONS.canvas'], right: [goodEntry.docId], activeLeft: 'HTTP/OPTIONS.canvas', activeRight: goodEntry.docId },
    })
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    expect(paneTabs(result, 0).tabs.map((tab) => [tab.id, tab.kind])).toEqual([['HTTP/OPTIONS.canvas', 'canvas']])
    expect(paneTabs(result, 1).tabs.map((tab) => [tab.id, tab.kind])).toEqual([[goodEntry.docId, 'pdf']])
  })

  it('새 캔버스: createCanvasNote 는 만들기만 하고, addNote 는 openCanvas 가 있으면 그 길로(없으면 캔버스 패널에) 연다', async () => {
    vi.mocked(createNote).mockResolvedValue('HTTP/새 캔버스.canvas')
    const openCanvas = vi.fn()
    const { result } = renderHook(() => useVault({ openCanvas }))
    await waitFor(() => expect(result.current.initializing).toBe(false))
    const before = paneTabs(result, 1).tabs.map((tab) => tab.id)

    let created: { path: string; title: string } | undefined
    await act(async () => { created = await result.current.createCanvasNote('HTTP', '새 캔버스') })
    expect(created).toEqual({ path: 'HTTP/새 캔버스.canvas', title: '새 캔버스' })
    expect(openCanvas).not.toHaveBeenCalled()
    expect(paneTabs(result, 1).tabs.map((tab) => tab.id)).toEqual(before)

    await act(async () => { await result.current.addNote('HTTP', '새 캔버스') })
    expect(openCanvas).toHaveBeenCalledWith({ path: 'HTTP/새 캔버스.canvas', title: '새 캔버스' })
    expect(paneTabs(result, 1).tabs.map((tab) => tab.id)).toEqual(before)
  })

  it('새 캔버스: openCanvas 가 없으면 예전처럼 캔버스 패널에 탭으로 연다', async () => {
    vi.mocked(createNote).mockResolvedValue('HTTP/둘.canvas')
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    await act(async () => { await result.current.addNote('HTTP', '둘') })
    expect(paneTabs(result, 1).tabs.map((tab) => tab.id)).toContain('HTTP/둘.canvas')
  })

  it('캔버스 편집 상태를 안정 ID의 watcher dirty 집합에 연결한다', async () => {
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    const watcherCall = vi.mocked(useVaultWatcher).mock.calls.at(-1)?.[0]
    const canvasId = watcherCall?.index.find((entry) => entry.path === 'HTTP/OPTIONS.canvas')?.id
    expect(canvasId).toBeDefined()

    act(() => result.current.setFileDirty('HTTP/OPTIONS.canvas', true))
    expect(vi.mocked(useVaultWatcher).mock.calls.at(-1)?.[0].dirtyIds).toContain(canvasId)

    act(() => result.current.setFileDirty('HTTP/OPTIONS.canvas', false))
    expect(vi.mocked(useVaultWatcher).mock.calls.at(-1)?.[0].dirtyIds).not.toContain(canvasId)
  })

  it('탭으로 연 메모 노트는 저장된 패널 자리와 활성 탭 그대로 복원한다(이름은 경로에서 따 둔다)', async () => {
    vi.mocked(readSession).mockResolvedValue({
      pdfTabIds: [],
      noteTabIds: [],
      memoNoteTabIds: ['노트/전원.iwnote', '노트/회의/점검.iwnote'],
      activePdfTabId: null,
      activeNoteTabId: null,
      sidebarCollapsed: false,
      sidebarPx: 280,
      leftFrac: 0.5,
      panes: { left: ['노트/회의/점검.iwnote'], right: ['노트/전원.iwnote'], activeLeft: '노트/회의/점검.iwnote', activeRight: '노트/전원.iwnote' },
    })

    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))

    expect(paneTabs(result, 0)).toEqual({ tabs: [{ id: '노트/회의/점검.iwnote', title: '점검', kind: 'memoNote' }], activeId: '노트/회의/점검.iwnote' })
    expect(paneTabs(result, 1)).toEqual({ tabs: [{ id: '노트/전원.iwnote', title: '전원', kind: 'memoNote' }], activeId: '노트/전원.iwnote' })
  })

  it('창마다 색 채널과 미리보기 탭 표시를 세션에서 되살린다', async () => {
    vi.mocked(readSession).mockResolvedValue({
      pdfTabIds: [],
      noteTabIds: [],
      memoNoteTabIds: ['노트/전원.iwnote', '노트/회의/점검.iwnote'],
      previewTabIds: ['노트/회의/점검.iwnote'],
      paneChannels: { left: 'green', right: null, third: 'blue', fourth: 'orange' },
      activePdfTabId: null,
      activeNoteTabId: null,
      sidebarCollapsed: false,
      sidebarPx: 280,
      leftFrac: 0.5,
      panes: { left: ['노트/회의/점검.iwnote'], right: ['노트/전원.iwnote'], activeLeft: '노트/회의/점검.iwnote', activeRight: '노트/전원.iwnote' },
    })

    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))

    // 예전 세션의 칸 이름별 색은 칸 차례대로 새 칸 id 에 이어진다(left → 0번, right → 1번)
    const [first, second] = paneIds(result)
    expect(result.current.channels).toEqual({ [first!]: 'green', [second!]: null })
    expect(paneTabs(result, 0).tabs[0]!.preview).toBe(true)
    expect(paneTabs(result, 1).tabs[0]!.preview).toBeUndefined()
  })

  it('예전 세션(채널 없음)은 모든 창이 파랑이고, 채널을 바꾸면 세션에 저장한다', async () => {
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    const [first, second] = paneIds(result)
    expect(result.current.channels).toEqual({ [first!]: 'blue', [second!]: 'blue' })

    act(() => result.current.setChannels((current) => ({ ...current, [second!]: 'orange' })))
    await waitFor(() => expect(vi.mocked(writeSession)).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ paneState: expect.objectContaining({ [second!]: expect.objectContaining({ channel: 'orange' }) }) }),
    ))
  })

  it('이전 세션의 노트 쪽 Markdown 탭도 문서 탭으로 옮겨 복원한다', async () => {
    vi.mocked(readSession).mockResolvedValue({
      pdfTabIds: [],
      noteTabIds: ['HTTP/README.md'],
      activePdfTabId: null,
      activeNoteTabId: 'HTTP/README.md',
      sidebarCollapsed: false,
      sidebarPx: 280,
      leftFrac: 0.5,
    })
    vi.mocked(readMarkdown).mockResolvedValue('# Restored')

    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))

    expect(paneTabs(result, 0)).toEqual({
      tabs: [{ id: 'HTTP/README.md', title: 'README', kind: 'markdown' }],
      activeId: 'HTTP/README.md',
    })
    expect(paneTabs(result, 1)).toEqual({
      tabs: [],
      activeId: null,
    })
    expect(result.current.markdownSources).toEqual({ 'HTTP/README.md': '# Restored' })
  })

  it('외부 Markdown reference 탭을 안정 ID로 다시 읽어 복원한다', async () => {
    const external = {
      id: '8cc94e6f-13da-4fd3-87a8-4e61bcb82239',
      kind: 'markdown' as const,
      storage: 'reference' as const,
      path: 'C:/External/Architecture.markdown',
      displayName: 'Architecture',
      contentHash: 'c'.repeat(64),
      size: 32,
      modifiedAt: null,
      addedAt: '2026-09-30T00:00:00.000Z',
      missing: false,
    }
    vi.mocked(readSession).mockResolvedValue({
      pdfTabIds: [external.path],
      noteTabIds: [],
      activePdfTabId: external.path,
      activeNoteTabId: null,
      sidebarCollapsed: false,
      sidebarPx: 280,
      leftFrac: 0.5,
    })
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [external] })
    vi.mocked(readMarkdown).mockResolvedValue('# External')

    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))

    expect(readMarkdown).toHaveBeenCalledWith({ root: 'C:/Vault' }, external.id)
    expect(paneTabs(result, 0)).toEqual({
      tabs: [{ id: external.path, title: external.displayName, kind: 'markdown' }],
      activeId: external.path,
    })
    expect(result.current.markdownSources).toEqual({ [external.path]: '# External' })
  })

  it('재정렬 상태를 즉시 반영하고 안정 ID 순서를 vault에 저장한다', async () => {
    vi.mocked(readVaultTreeOrder).mockResolvedValue({ '': [`pdf:${missingEntry.docId}`, `pdf:${goodEntry.docId}`, 'folder:HTTP'] })
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))

    await act(async () => {
      await result.current.reorderTreeNode({
        parentPath: '',
        nodeId: `pdf:${goodEntry.docId}`,
        targetNodeId: `pdf:${missingEntry.docId}`,
        position: 'before',
      })
    })

    expect(result.current.tree.map((node) => node.id)).toEqual([
      `pdf:${goodEntry.docId}`,
      `pdf:${missingEntry.docId}`,
      'folder:HTTP',
    ])
    expect(writeVaultTreeOrder).toHaveBeenCalledWith(
      { root: 'C:/Vault' },
      expect.objectContaining({
        '': [`pdf:${goodEntry.docId}`, `pdf:${missingEntry.docId}`, 'folder:HTTP'],
      }),
    )
  })

  it('여러 항목을 한 폴더에 놓으면 차례대로 옮기고 순서를 한 번에 저장한다', async () => {
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    vi.mocked(moveVaultEntry).mockClear()
    vi.mocked(writeVaultTreeOrder).mockClear().mockResolvedValue(undefined)

    await act(async () => {
      await result.current.placeTreeNodes(
        [{ nodeId: `pdf:${missingEntry.docId}`, fromParent: '' }, { nodeId: `pdf:${goodEntry.docId}`, fromParent: '' }],
        { toParent: 'HTTP', targetNodeId: null, position: 'inside' },
      )
    })

    expect(vi.mocked(moveVaultEntry).mock.calls.map((call) => call[1])).toEqual([missingEntry.docId, goodEntry.docId])
    expect(writeVaultTreeOrder).toHaveBeenCalledTimes(1)
    const saved = vi.mocked(writeVaultTreeOrder).mock.calls[0]![1] as Record<string, string[]>
    expect(saved.HTTP!.slice(-2)).toEqual([`pdf:${missingEntry.docId}`, `pdf:${goodEntry.docId}`])
    expect(saved['']).not.toContain(`pdf:${goodEntry.docId}`)
  })

  it('선택한 PDF 첨부 정책 payload를 bridge에 그대로 전달한다', async () => {
    const policy = { kind: 'copy-another-folder' as const, folderPath: 'Archive/PDF' }
    vi.mocked(pickPdfFile).mockResolvedValue('C:/Specs/source.pdf')
    vi.mocked(openPdf).mockImplementation(async (path) => path === goodEntry.path
      ? {
          docId: goodEntry.docId,
          sha256: goodEntry.sha256,
          size: goodEntry.size,
          title: goodEntry.title,
          pageCount: goodEntry.pages,
          pageSizes: [[612, 792]],
          hasText: true,
        }
      : {
          docId: 'attached0001',
          sha256: 'd'.repeat(64),
          size: 200,
          title: 'Source',
          pageCount: 3,
          pageSizes: [[612, 792]],
          hasText: true,
        })
    vi.mocked(attachPdfToLibrary).mockResolvedValue({
      ...goodEntry,
      docId: 'attached0001',
      path: 'C:/Vault/Archive/PDF/source.pdf',
      title: 'Source',
      pages: 3,
      folderPath: 'Archive/PDF',
      attachmentPolicy: policy,
    })
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))

    await act(async () => {
      await result.current.addDocument(policy)
    })

    expect(attachPdfToLibrary).toHaveBeenCalledWith(
      { root: 'C:/Vault' },
      {
        sourcePath: 'C:/Specs/source.pdf',
        title: 'Source',
        pages: 3,
        policy,
      },
    )
  })

  it.skipIf(!CANVAS_ENABLED)('Markdown을 읽어 왼쪽 문서 탭에 열고 원문을 별도 읽기 상태로 보관한다', async () => {
    vi.mocked(readMarkdown).mockResolvedValue('# HTTP')
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))

    await act(async () => {
      await result.current.openMarkdown({
        id: 'markdown:HTTP/README.md',
        kind: 'markdown',
        name: 'README',
        path: 'HTTP/README.md',
        storage: 'vault',
        indexId: 'HTTP/README.md',
      })
    })

    expect(readMarkdown).toHaveBeenCalledWith({ root: 'C:/Vault' }, 'HTTP/README.md')
    expect(result.current.markdownSources).toEqual({ 'HTTP/README.md': '# HTTP' })
    expect(paneTabs(result, 0)).toEqual({
      tabs: [
        { id: goodEntry.docId, title: 'Stored title', kind: 'pdf' },
        { id: 'HTTP/README.md', title: 'README', kind: 'markdown' },
      ],
      activeId: 'HTTP/README.md',
    })
    expect(paneTabs(result, 1)).toEqual({
      tabs: [{ id: 'HTTP/OPTIONS.canvas', title: 'OPTIONS', kind: 'canvas' }],
      activeId: 'HTTP/OPTIONS.canvas',
    })
  })

  it('드롭한 PDF와 Markdown을 독립적으로 가져오고 마지막에 한 번만 트리를 새로 읽는다', async () => {
    const attachedPdf = {
      ...goodEntry,
      docId: 'dropped-pdf',
      path: 'C:/External/drop.pdf',
      sha256: 'd'.repeat(64),
      title: 'drop',
      pages: 2,
      attachmentPolicy: { kind: 'reference' as const },
    }
    const attachedMarkdown = {
      id: '8cc94e6f-13da-4fd3-87a8-4e61bcb82239',
      kind: 'markdown' as const,
      storage: 'reference' as const,
      path: 'C:/External/notes.md',
      displayName: 'notes.md',
      contentHash: 'e'.repeat(64),
      size: 20,
      modifiedAt: null,
      addedAt: '2026-09-30T00:00:00.000Z',
      missing: false,
    }
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    vi.mocked(readLibrary).mockClear()
    vi.mocked(listVaultTree).mockClear()
    vi.mocked(readVaultIndex).mockClear()
    vi.mocked(openPdf).mockImplementation(async (path) => {
      if (path === 'C:/External/broken.pdf') throw new Error('broken')
      return {
        docId: attachedPdf.docId,
        sha256: attachedPdf.sha256,
        size: attachedPdf.size,
        title: attachedPdf.title,
        pageCount: attachedPdf.pages,
        pageSizes: [[612, 792]],
        hasText: true,
      }
    })
    vi.mocked(attachPdfToLibrary).mockResolvedValue(attachedPdf)
    vi.mocked(attachMarkdownReference).mockResolvedValue(attachedMarkdown)
    vi.mocked(readLibrary).mockResolvedValue([goodEntry, attachedPdf])
    vi.mocked(readVaultIndex).mockResolvedValue({ version: 1, entries: [attachedMarkdown] })

    let summary: Awaited<ReturnType<typeof result.current.importDroppedDocuments>> | undefined
    await act(async () => {
      summary = await result.current.importDroppedDocuments([
        'C:/External/drop.pdf',
        'C:/External/notes.md',
        'C:/External/broken.pdf',
        'C:/External/image.png',
      ])
    })

    expect(summary).toEqual({ imported: 2, rejected: 1, failed: 1 })
    expect(attachPdfToLibrary).toHaveBeenCalledOnce()
    expect(attachMarkdownReference).toHaveBeenCalledOnce()
    expect(readLibrary).toHaveBeenCalledOnce()
    expect(listVaultTree).toHaveBeenCalledOnce()
    expect(readVaultIndex).toHaveBeenCalledOnce()
    expect(result.current.tree).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `markdown:${attachedMarkdown.id}` }),
    ]))
  })

  it('열지 않은 Markdown 본문도 Vault 검색 레코드에 백그라운드로 넣는다', async () => {
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    await waitFor(() => {
      const record = result.current.searchRecords.find((candidate) => candidate.path === 'HTTP/README.md')
      expect(record?.extractedText).toContain('content negotiation')
    })
    expect(readMarkdown).toHaveBeenCalledWith({ root: 'C:/Vault' }, 'HTTP/README.md')
  })

  it('해시가 일치하는 PDF 본문 캐시는 즉시 검색 레코드에 복원한다', async () => {
    vi.mocked(readVaultSearchTextCache).mockResolvedValue({
      version: 2,
      documents: {
        [goodEntry.docId]: {
          contentHash: goodEntry.sha256,
          pages: [{ page: 0, text: 'cached protocol capabilities' }],
          complete: true,
        },
      },
    })
    const { result } = renderHook(() => useVault())

    await waitFor(() => expect(result.current.initializing).toBe(false))
    await waitFor(() => {
      expect(result.current.searchRecords.find((record) => record.id === goodEntry.docId)?.extractedText)
        .toBe('cached protocol capabilities')
    })
    expect(pageTextIndex).not.toHaveBeenCalled()
  })

  it('캐시가 없는 PDF 본문은 백그라운드로 추출해 검색과 캐시에 반영한다', async () => {
    const { result } = renderHook(() => useVault())

    await waitFor(() => expect(result.current.initializing).toBe(false))
    await waitFor(() => {
      expect(result.current.searchRecords.find((record) => record.id === goodEntry.docId)?.extractedText)
        .toContain('HTTP indexed PDF page 10')
    })
    expect(pageTextIndex).toHaveBeenCalledTimes(goodEntry.pages)
    expect(result.current.searchIndexProgress).toEqual({ indexed: 2, total: 2 })
    expect(writeVaultSearchTextCache).toHaveBeenCalledWith(
      { root: 'C:/Vault' },
      expect.objectContaining({
        documents: expect.objectContaining({
          [goodEntry.docId]: expect.objectContaining({
            contentHash: goodEntry.sha256,
            pages: expect.arrayContaining([
              expect.objectContaining({ page: 9, text: expect.stringContaining('HTTP indexed PDF page 10') }),
            ]),
          }),
        }),
      }),
    )
  })

  it('스캔 PDF OCR이 실패한 빈 결과는 성공 캐시로 고정하지 않는다', async () => {
    vi.mocked(openPdf).mockResolvedValue({
      docId: goodEntry.docId,
      sha256: goodEntry.sha256,
      size: goodEntry.size,
      title: goodEntry.title,
      pageCount: 2,
      pageSizes: [[612, 792], [612, 792]],
      hasText: false,
    })
    vi.mocked(recognizePdfPageText).mockRejectedValue(new Error('OCR unavailable'))

    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    await waitFor(() => expect(recognizePdfPageText).toHaveBeenCalled())

    expect(writeVaultSearchTextCache).not.toHaveBeenCalled()
  })

  it('파일 즐겨찾기와 마지막 연 시각을 검색 메타데이터에 저장한다', async () => {
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))

    act(() => result.current.setFileFavorite(goodEntry.docId, true))
    await act(async () => {
      await result.current.openDocument({
        docId: goodEntry.docId,
        title: goodEntry.title,
        pages: goodEntry.pages,
      })
    })

    await waitFor(() => {
      expect(result.current.searchRecords.find((record) => record.id === goodEntry.docId)).toMatchObject({
        favorite: true,
        lastOpenedAt: expect.any(String),
      })
    })
    await waitFor(() => expect(writeVaultMetadata).toHaveBeenCalled())
  })

  it('항목 이모지를 상태에 반영하고 메타데이터에 저장하며 지울 수 있다', async () => {
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    vi.mocked(writeVaultMetadata).mockClear()

    act(() => result.current.setItemIcon(goodEntry.docId, '📕'))
    expect(result.current.itemIcons).toEqual({ [goodEntry.docId]: '📕' })
    await waitFor(() => expect(writeVaultMetadata).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ itemIcons: { [goodEntry.docId]: '📕' } }),
    ))

    act(() => result.current.setItemIcon(goodEntry.docId, null))
    expect(result.current.itemIcons).toEqual({})
  })

  it('읽던 쪽은 화면 상태에 바로 반영하고 저장은 몰아서 한 번만 한다', async () => {
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    vi.mocked(writeVaultMetadata).mockClear()
    vi.useFakeTimers()
    try {
      act(() => result.current.recordReadingPosition(goodEntry.docId, 5))
      act(() => result.current.recordReadingPosition(goodEntry.docId, 6))
      act(() => result.current.recordReadingPosition(goodEntry.docId, 7))
      expect(result.current.readingPositions[goodEntry.docId]).toBe(7)
      expect(writeVaultMetadata).not.toHaveBeenCalled()
      await act(async () => {
        vi.advanceTimersByTime(1500)
      })
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(writeVaultMetadata).toHaveBeenCalledTimes(1))
    expect(vi.mocked(writeVaultMetadata).mock.calls[0]?.[1].fileActivity[goodEntry.docId]?.lastPage).toBe(7)
  })

  it('Markdown 파일을 Vault에 만들고 트리를 다시 읽는다', async () => {
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    vi.mocked(createMarkdownFile).mockResolvedValue('주석/논문 주석.md')
    vi.mocked(listVaultTree).mockClear()

    let saved = ''
    await act(async () => {
      saved = await result.current.saveMarkdownFile('주석', '논문 주석', '# 내용')
    })
    expect(saved).toBe('주석/논문 주석.md')
    expect(createMarkdownFile).toHaveBeenCalledWith(expect.objectContaining({ root: expect.any(String) }), '주석', '논문 주석', '# 내용')
    expect(listVaultTree).toHaveBeenCalled()
  })

  it('파일 관리 작업을 stable id로 실행하고 Vault 트리를 다시 읽는다', async () => {
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    vi.mocked(listVaultTree).mockClear()

    await act(async () => {
      await result.current.createFolder('HTTP', 'Protocol')
      await result.current.moveEntry(goodEntry.docId, 'Archive')
      await result.current.duplicateEntry(goodEntry.docId, 'Copies')
      await result.current.convertEntryToCopy(goodEntry.docId, 'Imported')
    })

    expect(createVaultFolder).toHaveBeenCalledWith({ root: 'C:/Vault' }, 'HTTP', 'Protocol')
    expect(moveVaultEntry).toHaveBeenCalledWith({ root: 'C:/Vault' }, goodEntry.docId, 'Archive')
    expect(duplicateVaultEntry).toHaveBeenCalledWith({ root: 'C:/Vault' }, goodEntry.docId, 'Copies')
    expect(convertReferenceToCopy).toHaveBeenCalledWith({ root: 'C:/Vault' }, goodEntry.docId, 'Imported')
    expect(listVaultTree).toHaveBeenCalledTimes(4)
    await expect(result.current.copyEntryPath(goodEntry.docId)).resolves.toBe('C:/Specs/good.pdf')
  })
})

describe('useVault — 칸 나누기 트리 복원', () => {
  beforeEach(() => {
    localStorage.clear()
    setWindowModeForTest(null)
    vi.mocked(readSession).mockReset()
  })

  const baseSession = {
    pdfTabIds: [] as string[],
    noteTabIds: [] as string[],
    memoNoteTabIds: ['노트/A.iwnote', '노트/B.iwnote', '노트/C.iwnote'],
    activePdfTabId: null,
    activeNoteTabId: null,
    sidebarCollapsed: false,
    sidebarPx: 280,
    leftFrac: 0.5,
  }

  it('새 세션(layout·paneState)은 트리·칸 id·칸마다 탭·색을 그대로 되살린다', async () => {
    const layout = { kind: 'split', id: 's1', dir: 'v', ratio: 0.3, a: { kind: 'pane', paneId: 'top' }, b: { kind: 'split', id: 's2', dir: 'h', ratio: 0.6, a: { kind: 'pane', paneId: 'bl' }, b: { kind: 'pane', paneId: 'br' } } }
    vi.mocked(readSession).mockResolvedValue({
      ...baseSession,
      layout,
      paneState: {
        top: { tabIds: ['노트/A.iwnote'], activeId: '노트/A.iwnote', channel: 'green' },
        bl: { tabIds: ['노트/B.iwnote'], activeId: '노트/B.iwnote', channel: null },
        br: { tabIds: ['노트/C.iwnote'], activeId: '노트/C.iwnote', channel: 'orange' },
      },
    } as never)
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    expect(result.current.paneLayout).toEqual(layout)
    expect(paneIds(result)).toEqual(['top', 'bl', 'br'])
    expect(result.current.panes.top!.tabs[0]!.id).toBe('노트/A.iwnote')
    expect(result.current.panes.bl!.tabs[0]!.id).toBe('노트/B.iwnote')
    expect(result.current.channels).toEqual({ top: 'green', bl: null, br: 'orange' })
  })

  it('예전 배치 id 가 cols3 이고 세션에 칸 이름별 탭이 있으면 같은 모양의 트리로 옮겨 칸마다 되살린다', async () => {
    localStorage.setItem('iwae:pane-layout:v1', 'cols3')
    vi.mocked(readSession).mockResolvedValue({
      ...baseSession,
      panes: { left: ['노트/A.iwnote'], right: ['노트/B.iwnote'], third: ['노트/C.iwnote'], activeLeft: '노트/A.iwnote', activeRight: '노트/B.iwnote', activeThird: '노트/C.iwnote' },
    } as never)
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    expect(shapeOf(result.current.paneLayout)).toBe('h(P,h(P,P))')
    expect([0, 1, 2].map((index) => paneTabs(result, index).tabs[0]!.id)).toEqual(['노트/A.iwnote', '노트/B.iwnote', '노트/C.iwnote'])
  })

  it('배치 id 가 없으면 한 칸이고, 모든 탭이 그 칸에 모인다', async () => {
    vi.mocked(readSession).mockResolvedValue({ ...baseSession, panes: { left: ['노트/A.iwnote'], right: ['노트/B.iwnote'], activeLeft: '노트/A.iwnote', activeRight: '노트/B.iwnote' } } as never)
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    expect(shapeOf(result.current.paneLayout)).toBe('P')
    // 칸 이름에 적히지 않은 노트(C)도 같은 칸에 모인다
    expect(paneTabs(result, 0).tabs.map((tab) => tab.id)).toEqual(['노트/A.iwnote', '노트/B.iwnote', '노트/C.iwnote'])
  })

  it('떼어 낸 창은 저장된 배치와 상관없이 한 칸이다', async () => {
    setWindowModeForTest({ role: 'detached', docId: goodEntry.docId, page: 1, zoom: null, vaultRoot: null })
    localStorage.setItem('iwae:pane-layout:v1', 'grid4')
    vi.mocked(readSession).mockResolvedValue({ ...baseSession, layout: { kind: 'split', id: 's', dir: 'h', ratio: 0.5, a: { kind: 'pane', paneId: 'a' }, b: { kind: 'pane', paneId: 'b' } }, paneState: {} } as never)
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    expect(shapeOf(result.current.paneLayout)).toBe('P')
    setWindowModeForTest(null)
  })

  it('openInPane 은 없어진 칸을 가리키면 첫 칸에 연다', async () => {
    vi.mocked(readSession).mockResolvedValue({ ...baseSession, memoNoteTabIds: [] } as never)
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    act(() => result.current.openInPane({ id: 'x', title: 'x', kind: 'memoNote' }, 'gone'))
    expect(paneTabs(result, 0).tabs.map((tab) => tab.id)).toEqual(['x'])
    expect(result.current.panes.gone).toBeUndefined()
  })

  it('칸 상태를 바꾸면 트리·칸 상태·색이 함께 세션에 저장된다', async () => {
    vi.mocked(readSession).mockResolvedValue({ ...baseSession, memoNoteTabIds: [] } as never)
    vi.mocked(writeSession).mockReset()
    vi.mocked(writeSession).mockResolvedValue(undefined)
    const { result } = renderHook(() => useVault())
    await waitFor(() => expect(result.current.initializing).toBe(false))
    act(() => result.current.setPaneLayout((root) => ({ kind: 'split', id: 'sx', dir: 'h', ratio: 0.4, a: root, b: { kind: 'pane', paneId: 'newer' } })))
    act(() => result.current.setPanes((current) => ({ ...current, newer: { tabs: [], activeId: null } })))
    await waitFor(() => expect(vi.mocked(writeSession)).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ layout: expect.objectContaining({ kind: 'split', ratio: 0.4 }), paneState: expect.objectContaining({ newer: expect.anything() }) }),
    ))
  })
})
