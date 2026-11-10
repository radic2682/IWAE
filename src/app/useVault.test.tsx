// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openPdf, pageTextIndex, pickPdfFile } from '../bridge/pdf'
import {
  createMarkdownFile,
  listVaultTree,
  openVault,
  readLibrary,
  readMarkdown,
  readSession,
  recentVaults,
  writeSession,
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

describe('useVault — 시작 복원', () => {
  beforeEach(() => {
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
    expect(result.current.pdfTabs).toEqual({
      // 탭 제목은 사이드바와 같은 Vault 표시 이름이다(파일 안 제목이 아니라).
      tabs: [{ id: goodEntry.docId, title: 'Stored title', kind: 'pdf' }],
      activeId: goodEntry.docId,
    })
    expect(result.current.noteTabs).toEqual({
      tabs: [{ id: 'HTTP/OPTIONS.canvas', title: 'OPTIONS', kind: 'note' }],
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

    expect(result.current.pdfTabs).toEqual({
      tabs: [{ id: 'HTTP/README.md', title: 'README', kind: 'markdown' }],
      activeId: 'HTTP/README.md',
    })
    expect(result.current.noteTabs).toEqual({
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
    expect(result.current.pdfTabs).toEqual({
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
    expect(result.current.pdfTabs).toEqual({
      tabs: [
        { id: goodEntry.docId, title: 'Stored title', kind: 'pdf' },
        { id: 'HTTP/README.md', title: 'README', kind: 'markdown' },
      ],
      activeId: 'HTTP/README.md',
    })
    expect(result.current.noteTabs).toEqual({
      tabs: [{ id: 'HTTP/OPTIONS.canvas', title: 'OPTIONS', kind: 'note' }],
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
