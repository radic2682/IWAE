import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addToLibrary,
  isMissingPathError,
  attachMarkdownReference,
  attachPdfToLibrary,
  createNote,
  createMarkdownFile,
  listVaultTree,
  openVault,
  pickVaultFolder,
  readCanvas,
  readLibrary,
  readMarkdown,
  readPdfHighlights,
  readMarkdownHighlights,
  readPdfBookmarks,
  readBibliography,
  writeBibliography,
  readBlockPresets,
  readSession,
  loadSessions,
  listSessionNames,
  trashSessionNamed,
  writeSessionNamed,
  readSessionNamed,
  relinkDocument,
  registerUnlistedVaultPdfs,
  updateLibraryPageCount,
  writeSession,
  writeLibrary,
  writePdfHighlights,
  writeMarkdownHighlights,
  writePdfBookmarks,
  writeBlockPresets,
  writeCanvas,
  readVaultTreeOrder,
  readVaultIndex,
  readVaultMetadata,
  readVaultSearchTextCache,
  writeVaultIndex,
  writeVaultMetadata,
  writeVaultSearchTextCache,
  writeVaultTreeOrder,
  writeVaultRelativeText,
  forgetObservedFile,
  setSessionWriter,
  type VaultLibraryEntry,
} from './vault'
import { openPdf } from './pdf'
import { createPersistentPdfHighlight } from '../pdf/persistentHighlight'
import { createPersistentMarkdownHighlight } from '../core/markdownHighlight'
import { createPdfBookmark } from '../core/pdfBookmarks'
import { createUserBlockPreset } from '../core/blockPresets'
import { createDefaultTextBlockStyle } from '../core/canvasDocument'
import * as windowBridge from './window'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

const fsMocks = vi.hoisted(() => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readTextFile: vi.fn(),
  readDir: vi.fn(),
  writeTextFile: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  copyFile: vi.fn(),
  stat: vi.fn(),
}))

const dialogMocks = vi.hoisted(() => ({
  open: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-fs', () => fsMocks)
vi.mock('@tauri-apps/plugin-dialog', () => dialogMocks)
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('C:/AppData/IWAE'),
  dirname: vi.fn(async (path: string) => path.slice(0, path.lastIndexOf('/'))),
  join: vi.fn(async (...parts: string[]) => parts.join('/').replaceAll('//', '/')),
}))
vi.mock('./pdf', () => ({ openPdf: vi.fn() }))

afterEach(() => {
  vi.restoreAllMocks()
})

const vault = { root: 'C:/Vault' }
const entry: VaultLibraryEntry = {
  docId: '0123456789ab',
  path: 'C:/Specs/original.pdf',
  sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  size: 4096,
  pages: 12,
  title: 'Original',
  addedAt: '2026-09-20T00:00:00.000Z',
}

describe('vault library', () => {
  beforeEach(() => {
    fsMocks.exists.mockReset()
    fsMocks.mkdir.mockReset()
    fsMocks.readTextFile.mockReset()
    fsMocks.readDir.mockReset()
    fsMocks.writeTextFile.mockReset()
    fsMocks.rename.mockReset()
    fsMocks.remove.mockReset()
    fsMocks.copyFile.mockReset()
    dialogMocks.open.mockReset()
    vi.mocked(openPdf).mockReset()
    invoke.mockReset()
    fsMocks.exists.mockResolvedValue(true)
  })

  it('vault 루트가 실제 폴더면 .iwae 디렉터리를 준비한다', async () => {
    await expect(openVault('C:/Vault')).resolves.toEqual(vault)
    expect(fsMocks.mkdir).toHaveBeenCalledWith('C:/Vault/.iwae', { recursive: true })
  })

  it('Google Drive 같은 동기화 폴더의 모든 하위 경로를 Vault 범위에 포함한다', async () => {
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(true)
    dialogMocks.open.mockResolvedValue('H:/Drive/IWAE')

    await expect(pickVaultFolder()).resolves.toBe('H:/Drive/IWAE')
    expect(dialogMocks.open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      recursive: true,
    })
  })

  it('library.json이 아직 없으면 빈 목록으로 시작한다', async () => {
    fsMocks.exists.mockResolvedValue(false)
    await expect(readLibrary(vault)).resolves.toEqual([])
    expect(fsMocks.readTextFile).not.toHaveBeenCalled()
  })

  it('index.json이 없으면 library.json을 안정 ID 인덱스로 마이그레이션한다', async () => {
    fsMocks.exists.mockImplementation(async (path: string) => (
      path.endsWith('library.json') && !path.includes('/history/migrations/')
    ))
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({
      version: 1,
      documents: { [entry.docId]: entry },
    }))

    await expect(readVaultIndex(vault)).resolves.toMatchObject({
      version: 1,
      entries: [{ id: entry.docId, displayName: entry.title }],
    })
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      'C:/Vault/.iwae/index.json',
      expect.stringContaining(`"id": "${entry.docId}"`),
    )
    expect(fsMocks.mkdir).toHaveBeenCalledWith(
      'C:/Vault/.iwae/history/migrations/v1',
      { recursive: true },
    )
    expect(fsMocks.copyFile).toHaveBeenCalledWith(
      'C:/Vault/.iwae/library.json',
      'C:/Vault/.iwae/history/migrations/v1/library.json',
    )
  })

  it('손상된 index.json을 진단 사본으로 보존하고 library.json에서 다시 만든다', async () => {
    fsMocks.readTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith('index.json')) return '{broken'
      return JSON.stringify({ version: 1, documents: { [entry.docId]: entry } })
    })

    await expect(readVaultIndex(vault)).resolves.toMatchObject({
      entries: [{ id: entry.docId, displayName: entry.title }],
    })
    expect(fsMocks.mkdir).toHaveBeenCalledWith(
      'C:/Vault/.iwae/conflicts/diagnostics',
      { recursive: true },
    )
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      expect.stringMatching(/C:\/Vault\/\.iwae\/conflicts\/diagnostics\/index-\d+\.json/u),
      '{broken',
    )
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      'C:/Vault/.iwae/index.json',
      expect.stringContaining(`"id": "${entry.docId}"`),
    )
  })

  it('versioned index를 결정적인 JSON으로 쓴다', async () => {
    await writeVaultIndex(vault, {
      version: 1,
      entries: [{
        id: entry.docId,
        kind: 'pdf',
        storage: 'reference',
        path: entry.path,
        displayName: 'Alias',
        contentHash: entry.sha256,
        size: entry.size,
        modifiedAt: null,
        addedAt: entry.addedAt,
        missing: false,
      }],
    })

    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      'C:/Vault/.iwae/index.json',
      expect.stringContaining('"displayName": "Alias"'),
    )
  })

  it('외부 Markdown을 복사하지 않고 안정 ID의 reference 항목으로 등록한다', async () => {
    const sourcePath = 'C:/External/Design.Markdown'
    fsMocks.readTextFile.mockImplementation(async (path: string) => (
      path.endsWith('index.json')
        ? JSON.stringify({ version: 1, entries: [] })
        : '# Design\n'
    ))
    fsMocks.stat.mockResolvedValue({ size: 9, mtime: new Date('2026-09-30T00:00:00.000Z') })

    const attached = await attachMarkdownReference(vault, sourcePath)

    expect(attached).toMatchObject({
      kind: 'markdown',
      storage: 'reference',
      path: sourcePath,
      displayName: 'Design.Markdown',
      size: 9,
      modifiedAt: '2026-09-30T00:00:00.000Z',
      missing: false,
    })
    expect(attached.id).toMatch(/^[0-9a-f-]{36}$/u)
    expect(attached.contentHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(fsMocks.copyFile).not.toHaveBeenCalled()
    expect(fsMocks.writeTextFile).not.toHaveBeenCalledWith(sourcePath, expect.anything())
  })

  it('외부 Markdown stat 메타데이터를 읽지 못해도 본문 해시로 등록한다', async () => {
    const sourcePath = 'C:/External/Design.md'
    fsMocks.readTextFile.mockImplementation(async (path: string) => (
      path.endsWith('index.json')
        ? JSON.stringify({ version: 1, entries: [] })
        : '# Design\n'
    ))
    fsMocks.stat.mockRejectedValue(new Error('metadata unavailable'))

    await expect(attachMarkdownReference(vault, sourcePath)).resolves.toMatchObject({
      path: sourcePath,
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      size: null,
      modifiedAt: null,
    })
  })

  it('정규화된 외부 Markdown 경로가 이미 있으면 중복 등록하지 않는다', async () => {
    const existing = {
      id: '8cc94e6f-13da-4fd3-87a8-4e61bcb82239',
      kind: 'markdown' as const,
      storage: 'reference' as const,
      path: 'C:/External/Design.md',
      displayName: 'Design.md',
      contentHash: null,
      size: null,
      modifiedAt: null,
      addedAt: '2026-09-30T00:00:00.000Z',
      missing: false,
    }
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({ version: 1, entries: [existing] }))

    await expect(attachMarkdownReference(vault, 'c:\\external\\design.MD')).resolves.toEqual(existing)
    expect(fsMocks.stat).not.toHaveBeenCalled()
  })

  it('reference Markdown은 인덱스의 안정 ID로만 외부 절대경로를 읽는다', async () => {
    const reference = {
      id: '8cc94e6f-13da-4fd3-87a8-4e61bcb82239',
      kind: 'markdown' as const,
      storage: 'reference' as const,
      path: 'C:/External/Design.md',
      displayName: 'Design.md',
      contentHash: null,
      size: null,
      modifiedAt: null,
      addedAt: '2026-09-30T00:00:00.000Z',
      missing: false,
    }
    fsMocks.readTextFile.mockImplementation(async (path: string) => (
      path.endsWith('index.json')
        ? JSON.stringify({ version: 1, entries: [reference] })
        : '# External\n'
    ))

    await expect(readMarkdown(vault, reference.id)).resolves.toBe('# External\n')
    expect(fsMocks.readTextFile).toHaveBeenCalledWith(reference.path)
    await expect(readMarkdown(vault, 'C:/External/Design.md')).rejects.toThrow('경로')
  })

  it('데스크톱에서는 index.json을 저널 원자 쓰기로 저장한다', async () => {
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(true)
    invoke.mockResolvedValue({ contentHash: 'hash', size: 10, modifiedAt: 1 })

    await writeVaultIndex(vault, { version: 1, entries: [] })

    expect(invoke).toHaveBeenCalledWith('atomic_write_text', {
      request: expect.objectContaining({
        targetPath: 'C:/Vault/.iwae/index.json',
        journalRoot: 'C:/Vault/.iwae/journal',
        historyRoot: 'C:/Vault/.iwae/history',
        fileId: 'metadata:index.json',
      }),
    })
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled()
  })

  it('Vault 전역 Markdown 테마 메타데이터를 읽고 쓴다', async () => {
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({ version: 1, markdownTheme: 'github' }))

    await expect(readVaultMetadata(vault)).resolves.toMatchObject({ markdownTheme: 'github' })
    await writeVaultMetadata(vault, { version: 1, markdownTheme: 'paper', fileActivity: {}, itemIcons: {} })

    expect(fsMocks.readTextFile).toHaveBeenCalledWith('C:/Vault/.iwae/metadata.json')
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      'C:/Vault/.iwae/metadata.json',
      `${JSON.stringify({ version: 1, markdownTheme: 'paper', fileActivity: {}, itemIcons: {} }, null, 2)}\n`,
    )
  })

  it('재생성 가능한 검색 본문 캐시를 읽고 .iwae/cache에 쓴다', async () => {
    const cache = {
      version: 2 as const,
      documents: {
        [entry.docId]: {
          contentHash: entry.sha256,
          pages: [{ page: 0, text: 'HTTP searchable body' }],
          complete: true,
        },
      },
    }
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify(cache))

    await expect(readVaultSearchTextCache(vault)).resolves.toEqual(cache)
    await writeVaultSearchTextCache(vault, cache)

    expect(fsMocks.readTextFile).toHaveBeenCalledWith('C:/Vault/.iwae/cache/search-text.json')
    // 다시 만들 수 있는 캐시라 들여쓰지 않고 쓴다
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      'C:/Vault/.iwae/cache/search-text.json',
      JSON.stringify(cache),
    )
  })

  it('검색 본문 캐시가 없거나 손상되면 빈 캐시로 복구한다', async () => {
    fsMocks.exists.mockResolvedValueOnce(false)
    await expect(readVaultSearchTextCache(vault)).resolves.toEqual({ version: 2, documents: {} })

    fsMocks.exists.mockResolvedValue(true)
    fsMocks.readTextFile.mockResolvedValue('{broken')
    await expect(readVaultSearchTextCache(vault)).resolves.toEqual({ version: 2, documents: {} })
  })

  it('library.json을 버전과 docId 키를 가진 안정적인 레지스트리로 쓴다', async () => {
    await writeLibrary(vault, [entry])

    expect(fsMocks.writeTextFile).toHaveBeenCalledTimes(1)
    const written = fsMocks.writeTextFile.mock.calls[0]?.[1]
    expect(written).toBe(`${JSON.stringify({
      version: 1,
      documents: { [entry.docId]: entry },
    }, null, 2)}\n`)
  })

  it('같은 SHA-256 문서를 다시 추가하면 기존 항목을 돌려주고 쓰지 않는다', async () => {
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({
      version: 1,
      documents: { [entry.docId]: entry },
    }))
    vi.mocked(openPdf).mockResolvedValue({
      docId: entry.docId,
      sha256: entry.sha256,
      size: entry.size,
      title: 'Renamed copy',
      pageCount: entry.pages,
      pageSizes: [[612, 792]],
      hasText: true,
    })

    await expect(addToLibrary(vault, {
      path: 'D:/Copies/renamed.pdf',
      title: 'Renamed copy',
      pages: 12,
    })).resolves.toEqual(entry)
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled()
  })

  it.each([
    ['reference', { kind: 'reference' as const }, 'C:/Specs/source.pdf', undefined],
    ['copy-current-folder', { kind: 'copy-current-folder' as const, folderPath: 'Specs' }, 'C:/Vault/Specs/source.pdf', 'Specs'],
    ['copy-another-folder', { kind: 'copy-another-folder' as const, folderPath: 'Archive/PDF' }, 'C:/Vault/Archive/PDF/source.pdf', 'Archive/PDF'],
  ])('%s PDF 첨부 정책을 payload와 저장 항목에 보존한다', async (_name, policy, expectedPath, folderPath) => {
    fsMocks.exists.mockResolvedValue(false)
    vi.mocked(openPdf).mockResolvedValue({
      docId: 'newdocument1',
      sha256: 'c'.repeat(64),
      size: 300,
      title: 'Source',
      pageCount: 3,
      pageSizes: [[612, 792]],
      hasText: true,
    })

    const result = await attachPdfToLibrary(vault, {
      sourcePath: 'C:/Specs/source.pdf',
      title: 'Source',
      pages: 3,
      policy,
    })

    expect(result).toMatchObject({ path: expectedPath, folderPath, attachmentPolicy: policy })
    if (policy.kind === 'reference') {
      expect(fsMocks.copyFile).not.toHaveBeenCalled()
    } else {
      expect(fsMocks.copyFile).toHaveBeenCalledWith('C:/Specs/source.pdf', expectedPath)
    }
  })

  it('트리 형제 순서를 별도 메타데이터로 읽고 쓴다', async () => {
    fsMocks.exists.mockResolvedValue(true)
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({
      version: 1,
      parents: { Specs: ['pdf:b', 'pdf:a'] },
    }))
    await expect(readVaultTreeOrder(vault)).resolves.toEqual({ Specs: ['pdf:b', 'pdf:a'] })

    await writeVaultTreeOrder(vault, { Specs: ['pdf:a', 'pdf:b'] })
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      'C:/Vault/.iwae/tree-order.json',
      `${JSON.stringify({ version: 1, parents: { Specs: ['pdf:a', 'pdf:b'] } }, null, 2)}\n`,
    )
  })

  it('PDF 복사 대상은 vault 내부의 상대 폴더만 허용한다', async () => {
    fsMocks.exists.mockResolvedValue(false)
    vi.mocked(openPdf).mockResolvedValue({
      docId: 'newdocument1',
      sha256: 'c'.repeat(64),
      size: 300,
      title: 'Source',
      pageCount: 3,
      pageSizes: [[612, 792]],
      hasText: true,
    })

    await expect(attachPdfToLibrary(vault, {
      sourcePath: 'C:/Specs/source.pdf',
      title: 'Source',
      pages: 3,
      policy: { kind: 'copy-another-folder', folderPath: 'D:/Outside' },
    })).rejects.toThrow('폴더 경로')
    expect(openPdf).not.toHaveBeenCalled()
    expect(fsMocks.copyFile).not.toHaveBeenCalled()
  })
})

describe('vault session and notes', () => {
  beforeEach(() => {
    fsMocks.exists.mockReset()
    fsMocks.mkdir.mockReset()
    fsMocks.readTextFile.mockReset()
    fsMocks.readDir.mockReset()
    fsMocks.writeTextFile.mockReset()
    fsMocks.rename.mockReset()
    fsMocks.remove.mockReset()
    fsMocks.exists.mockResolvedValue(true)
  })

  it('session.json이 없으면 복원할 값이 없다고 돌려준다', async () => {
    fsMocks.exists.mockResolvedValue(false)
    await expect(readSession(vault)).resolves.toBeNull()
  })

  it('session.json을 pretty JSON으로 쓴다', async () => {
    const session = {
      pdfTabIds: ['doc-a'],
      noteTabIds: [],
      activePdfTabId: 'doc-a',
      activeNoteTabId: null,
      sidebarCollapsed: false,
      sidebarPx: 280,
      leftFrac: 0.5,
    }
    await writeSession(vault, session)
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      'C:/Vault/.iwae/session.json',
      `${JSON.stringify(session, null, 2)}\n`,
    )
  })

  describe('이름 붙은 세션', () => {
    const legacy = { pdfTabIds: ['doc-a'], noteTabIds: [], activePdfTabId: 'doc-a', activeNoteTabId: null, sidebarCollapsed: false, sidebarPx: 280, leftFrac: 0.5 }
    /** 디스크 모양: 경로 → 내용, 폴더 경로 → 항목들 */
    const disk = (files: Record<string, string>, dirs: Record<string, { name: string; isFile?: boolean; isDirectory?: boolean }[]> = {}) => {
      fsMocks.exists.mockImplementation(async (path: string) => path in files || path in dirs)
      fsMocks.readTextFile.mockImplementation(async (path: string) => files[path] ?? '')
      fsMocks.readDir.mockImplementation(async (path: string) => dirs[path] ?? [])
    }
    const writes = () => Object.fromEntries(fsMocks.writeTextFile.mock.calls.map(([path, text]) => [path, text]))

    it('sessions 폴더가 없으면 session.json 이 「기본」 세션이 된다(session.json 은 그대로 둔다)', async () => {
      disk({ 'C:/Vault/.iwae/session.json': JSON.stringify(legacy) })
      const loaded = await loadSessions(vault, '기본')
      expect(loaded.name).toBe('기본')
      expect(loaded.names).toEqual(['기본'])
      expect(loaded.raw).toEqual(legacy)
      const written = writes()
      expect(JSON.parse(written['C:/Vault/.iwae/sessions/기본.json'] as string)).toEqual(legacy)
      expect(JSON.parse(written['C:/Vault/.iwae/sessions/_last.json'] as string).last).toBe('기본')
      expect(fsMocks.mkdir).toHaveBeenCalledWith('C:/Vault/.iwae/sessions', { recursive: true })
      expect(Object.keys(written)).not.toContain('C:/Vault/.iwae/session.json')
      expect(fsMocks.remove).not.toHaveBeenCalled()
    })

    it('세션도 session.json 도 없으면 빈 목록과 기본 이름을 돌려주고 아무것도 쓰지 않는다', async () => {
      disk({})
      const loaded = await loadSessions(vault, '기본')
      expect(loaded).toMatchObject({ name: '기본', names: [], raw: null })
      expect(fsMocks.writeTextFile).not.toHaveBeenCalled()
    })

    it('있는 세션은 이름만 읽고(_last.json · 하위 폴더는 뺀다) 마지막으로 쓴 세션을 연다', async () => {
      disk({
        'C:/Vault/.iwae/sessions/_last.json': JSON.stringify({ last: '발표', used: { 발표: 5 } }),
        'C:/Vault/.iwae/sessions/발표.json': JSON.stringify(legacy),
      }, {
        'C:/Vault/.iwae/sessions': [
          { name: '논문.json', isFile: true }, { name: '발표.json', isFile: true }, { name: '_last.json', isFile: true }, { name: '.trash', isDirectory: true },
        ],
      })
      const loaded = await loadSessions(vault, '기본')
      expect(loaded.names).toEqual(['논문', '발표'])
      expect(loaded.name).toBe('발표')
      expect(loaded.raw).toEqual(legacy)
      expect(loaded.meta.used).toEqual({ 발표: 5 })
      expect(fsMocks.writeTextFile).not.toHaveBeenCalled()
    })

    it('마지막으로 쓴 세션 파일이 없어졌으면 첫 세션을 연다', async () => {
      disk({ 'C:/Vault/.iwae/sessions/_last.json': JSON.stringify({ last: '없는', used: {} }), 'C:/Vault/.iwae/sessions/논문.json': JSON.stringify(legacy) }, {
        'C:/Vault/.iwae/sessions': [{ name: '논문.json', isFile: true }],
      })
      expect((await loadSessions(vault, '기본')).name).toBe('논문')
    })

    it('메인 창이 아니면 옮기지도 쓰지도 않고 session.json 을 그대로 읽는다', async () => {
      disk({ 'C:/Vault/.iwae/session.json': JSON.stringify(legacy) })
      setSessionWriter(false)
      try {
        const loaded = await loadSessions(vault, '기본')
        expect(loaded.raw).toEqual(legacy)
        await writeSessionNamed(vault, '논문', legacy as never)
        expect(fsMocks.writeTextFile).not.toHaveBeenCalled()
      } finally {
        setSessionWriter(true)
      }
    })

    it('세션 하나를 .iwae/sessions/<이름>.json 에 pretty JSON 으로 쓴다', async () => {
      await writeSessionNamed(vault, '논문 3장', legacy as never)
      expect(fsMocks.writeTextFile).toHaveBeenCalledWith('C:/Vault/.iwae/sessions/논문 3장.json', `${JSON.stringify(legacy, null, 2)}\n`)
    })

    it('깨진 세션 파일은 null 로 읽는다', async () => {
      disk({ 'C:/Vault/.iwae/sessions/논문.json': '{깨짐' })
      await expect(readSessionNamed(vault, '논문')).resolves.toBeNull()
    })

    it('지우기는 파일을 .trash 폴더로 옮긴다(세션 목록에는 더 나오지 않는다)', async () => {
      disk({ 'C:/Vault/.iwae/sessions/논문.json': '{}' })
      await trashSessionNamed(vault, '논문')
      expect(fsMocks.rename).toHaveBeenCalledWith('C:/Vault/.iwae/sessions/논문.json', expect.stringMatching(/^C:\/Vault\/\.iwae\/sessions\/\.trash\/논문-\d+\.json$/u))
      expect(fsMocks.mkdir).toHaveBeenCalledWith('C:/Vault/.iwae/sessions/.trash', { recursive: true })
    })

    it('목록 읽기가 실패하면 빈 목록이다', async () => {
      fsMocks.exists.mockRejectedValue(new Error('boom'))
      await expect(listSessionNames(vault)).resolves.toEqual([])
    })
  })

  it('PDF 형광펜을 .iwae/highlights.json에 저장하고 복원한다', async () => {
    const highlight = createPersistentPdfHighlight({
      docId: entry.docId,
      page: 1,
      coordSpace: 'pdfium-page',
      rects: [{ x: 10, y: 20, w: 80, h: 12 }],
      charRange: [5, 12],
      quote: 'persist',
      prefix: '',
      suffix: '',
    })
    await writePdfHighlights(vault, [highlight])
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      'C:/Vault/.iwae/highlights.json',
      `${JSON.stringify({ version: 1, highlights: [highlight] }, null, 2)}\n`,
    )

    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({ version: 1, highlights: [highlight] }))
    await expect(readPdfHighlights(vault)).resolves.toEqual([highlight])
  })

  it('Markdown 형광펜을 .iwae/markdown-highlights.json에 저장하고 복원한다', async () => {
    const highlight = createPersistentMarkdownHighlight('md-1', 'hash-1', {
      path: 'docs/guide.md',
      title: 'Guide',
      quote: 'persist',
      prefix: '',
      suffix: '',
      startOffset: 5,
      endOffset: 12,
      format: 'paragraph',
    })
    await writeMarkdownHighlights(vault, [highlight])
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      'C:/Vault/.iwae/markdown-highlights.json',
      `${JSON.stringify({ version: 1, highlights: [highlight] }, null, 2)}\n`,
    )

    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({ version: 1, highlights: [highlight] }))
    await expect(readMarkdownHighlights(vault)).resolves.toEqual([highlight])
  })

  it('PDF 책갈피를 .iwae/bookmarks.json에 저장하고 복원한다', async () => {
    const bookmark = createPdfBookmark(entry.docId, 4, '검토 위치', new Date('2026-09-20T00:00:00.000Z'))
    await writePdfBookmarks(vault, [bookmark])
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      'C:/Vault/.iwae/bookmarks.json',
      `${JSON.stringify({ version: 1, bookmarks: [bookmark] }, null, 2)}\n`,
    )

    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({ version: 1, bookmarks: [bookmark] }))
    await expect(readPdfBookmarks(vault)).resolves.toEqual([bookmark])
  })

  it('서지 정보를 .iwae/bibliography.json에 저장하고 복원한다', async () => {
    const file = { version: 1 as const, entries: { [entry.docId]: { title: 'T', authors: ['A'], source: 'manual' as const, updatedAt: 'x' } } }
    await writeBibliography(vault, file)
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith('C:/Vault/.iwae/bibliography.json', `${JSON.stringify(file, null, 2)}\n`)

    fsMocks.exists.mockResolvedValue(true)
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify(file))
    await expect(readBibliography(vault)).resolves.toEqual(file)
    fsMocks.exists.mockResolvedValue(false)
    await expect(readBibliography(vault)).resolves.toEqual({ version: 1, entries: {} })
  })

  it('vault 디렉터리를 재귀 목록으로 바꾸되 예약 폴더는 내려가지 않는다', async () => {
    fsMocks.readDir.mockImplementation(async (path: string) => {
      if (path === 'C:/Vault') {
        return [
          { name: '.iwae', isDirectory: true },
          { name: 'HTTP', isDirectory: true },
        ]
      }
      if (path === 'C:/Vault/HTTP') {
        return [{ name: 'OPTIONS.canvas', isDirectory: false }]
      }
      return []
    })

    await expect(listVaultTree(vault)).resolves.toEqual([
      { path: 'HTTP', isDirectory: true },
      { path: 'HTTP/OPTIONS.canvas', isDirectory: false },
    ])
    expect(fsMocks.readDir).not.toHaveBeenCalledWith('C:/Vault/.iwae')
  })

  it('Markdown 파일을 만들고 같은 이름이 있으면 번호를 붙인다', async () => {
    fsMocks.exists.mockImplementation(async (path: string) => path === 'C:/Vault/주석/논문 주석.md')
    await expect(createMarkdownFile(vault, '주석', '논문 주석', '# 내용\n')).resolves.toBe('주석/논문 주석 (2).md')
    expect(fsMocks.mkdir).toHaveBeenCalledWith('C:/Vault/주석', { recursive: true })
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith('C:/Vault/주석/논문 주석 (2).md', '# 내용\n')
  })

  it('Markdown 파일 이름의 경로 문자를 거절한다', async () => {
    await expect(createMarkdownFile(vault, '../밖', 'x', '')).rejects.toThrow('경로 문자')
    await expect(createMarkdownFile(vault, '주석', 'a/b', '')).rejects.toThrow('경로 문자')
  })

  it('새 노트를 빈 JSON Canvas 문서로 만든다', async () => {
    fsMocks.exists.mockResolvedValue(false)
    await expect(createNote(vault, 'HTTP', 'OPTIONS')).resolves.toBe('HTTP/OPTIONS.canvas')
    expect(fsMocks.mkdir).toHaveBeenCalledWith('C:/Vault/HTTP', { recursive: true })
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      'C:/Vault/HTTP/OPTIONS.canvas',
      '{\n  "edges": [],\n  "nodes": [],\n  "version": 2,\n  "viewport": {\n    "x": 0,\n    "y": 0,\n    "zoom": 1\n  }\n}\n',
    )
  })

  it('캔버스를 읽고 임시 파일을 거쳐 원자적으로 저장한다', async () => {
    const document = {
      version: 1 as const,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify(document))

    await expect(readCanvas(vault, 'HTTP/OPTIONS.canvas')).resolves.toMatchObject({ version: 2 })
    await writeCanvas(vault, 'HTTP/OPTIONS.canvas', document)

    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      'C:/Vault/HTTP/OPTIONS.canvas.tmp',
      expect.stringContaining('"version": 2'),
    )
    expect(fsMocks.rename).toHaveBeenCalledWith(
      'C:/Vault/HTTP/OPTIONS.canvas.tmp',
      'C:/Vault/HTTP/OPTIONS.canvas',
    )
  })

  it('데스크톱 캔버스 저장은 마지막으로 읽은 내용의 해시를 충돌 검사에 사용한다', async () => {
    const document = {
      version: 1 as const,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(true)
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify(document))
    invoke.mockResolvedValue({ contentHash: 'next-hash', size: 100, modifiedAt: 1 })

    await readCanvas(vault, 'HTTP/OPTIONS.canvas')
    await writeCanvas(vault, 'HTTP/OPTIONS.canvas', document)

    expect(invoke).toHaveBeenCalledWith('atomic_write_text', {
      request: expect.objectContaining({
        targetPath: 'C:/Vault/HTTP/OPTIONS.canvas',
        expectedHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    })
  })

  it('앱이 옮기거나 지운 파일은 잊어서, 같은 이름으로 새로 쓸 때 충돌로 보지 않는다', async () => {
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(true)
    invoke.mockResolvedValue({ contentHash: 'written-hash', size: 35, modifiedAt: 1 })
    const expectedHashes = () => invoke.mock.calls
      .filter(([command]) => command === 'atomic_write_text')
      .map(([, args]) => (args as { request: { expectedHash: string | null } }).request.expectedHash)

    // 병합하지 않는 파일(캔버스 등)은 마지막으로 쓴 해시와 비교한다
    await writeVaultRelativeText(vault, 'Notes/새 노트.canvas', '{}')
    await writeVaultRelativeText(vault, 'Notes/새 노트.canvas', '{"a":1}')
    // 노트를 휴지통으로 옮긴 뒤(앱이 한 일) 같은 이름으로 다시 만든다
    forgetObservedFile('C:/Vault/Notes/새 노트.canvas')
    await writeVaultRelativeText(vault, 'Notes/새 노트.canvas', '{}')

    expect(expectedHashes().slice(-3)).toEqual([null, 'written-hash', null])
  })

  it('메모 노트는 저장 직전에 디스크를 읽어 그 해시를 기대값으로 보낸다(다른 창이 먼저 고쳐도 합쳐서 쓴다)', async () => {
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(true)
    fsMocks.exists.mockResolvedValue(true)
    fsMocks.readTextFile.mockResolvedValue('{"blocks":[{"id":"remote"}]}')
    invoke.mockResolvedValue({ contentHash: 'written-hash', size: 35, modifiedAt: 1 })

    await writeVaultRelativeText(vault, '노트/새 노트.iwnote', '{"blocks":[{"id":"remote"}]}')
    const calls = invoke.mock.calls.filter(([command]) => command === 'atomic_write_text')
    // 디스크와 같은 내용이라 쓸 것이 없다
    expect(calls).toHaveLength(0)
  })

  it('session.json 은 메인 창이 아니면 쓰지 않는다', async () => {
    vi.spyOn(windowBridge, 'isDesktop').mockReturnValue(true)
    invoke.mockResolvedValue({ contentHash: 'h', size: 1, modifiedAt: 1 })
    setSessionWriter(false)
    try {
      await writeSession(vault, { version: 1, pdfTabIds: [], noteTabIds: [], activePdfTabId: null, activeNoteTabId: null, sidebarCollapsed: false, sidebarPx: 280, leftFrac: 0.5 } as never)
      expect(invoke.mock.calls.filter(([command]) => command === 'atomic_write_text')).toHaveLength(0)
    } finally {
      setSessionWriter(true)
    }
    await writeSession(vault, { version: 1, pdfTabIds: [], noteTabIds: [], activePdfTabId: null, activeNoteTabId: null, sidebarCollapsed: false, sidebarPx: 280, leftFrac: 0.5 } as never)
    expect(invoke.mock.calls.filter(([command]) => command === 'atomic_write_text')).toHaveLength(1)
  })

  it('Markdown은 vault 안의 .md 파일만 읽고 쓰기 API를 노출하지 않는다', async () => {
    fsMocks.readTextFile.mockResolvedValue('# Read only')

    await expect(readMarkdown(vault, 'Notes/README.md')).resolves.toBe('# Read only')
    expect(fsMocks.readTextFile).toHaveBeenCalledWith('C:/Vault/Notes/README.md')
    await expect(readMarkdown(vault, '../README.md')).rejects.toThrow('경로')
    await expect(readMarkdown(vault, 'Notes/README.canvas')).rejects.toThrow('Markdown')
  })

  it('.markdown 확장자 문서도 vault 안에서 읽고 외부 참조로 가져올 수 있다', async () => {
    fsMocks.readTextFile.mockResolvedValue('# Long extension')
    await expect(readMarkdown(vault, 'Notes/Guide.markdown')).resolves.toBe('# Long extension')
    expect(fsMocks.readTextFile).toHaveBeenCalledWith('C:/Vault/Notes/Guide.markdown')
    await expect(readMarkdown(vault, 'Notes/Guide.MARKDOWN')).resolves.toBe('# Long extension')
    await expect(readMarkdown(vault, 'Notes/Guide.mdx')).rejects.toThrow('Markdown')
    // 가져오기(참조 등록)
    fsMocks.readTextFile.mockImplementation(async (path: string) => (
      path.endsWith('index.json') ? JSON.stringify({ version: 1, entries: [] }) : '# Long extension\n'
    ))
    await expect(attachMarkdownReference(vault, 'C:/External/Guide.markdown')).resolves.toMatchObject({ kind: 'markdown', path: 'C:/External/Guide.markdown' })
  })

  it('사용자 블록 프리셋을 Vault의 .iwae 설정으로 읽고 쓴다', async () => {
    const preset = createUserBlockPreset('preset-1', {
      kind: 'rectangle',
      width: 260,
      height: 120,
      style: { ...createDefaultTextBlockStyle(), background: 'transparent', borderColor: '#ef4444' },
    }, [])
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({ version: 1, presets: [preset] }))

    await expect(readBlockPresets(vault)).resolves.toEqual([preset])
    await writeBlockPresets(vault, [preset])

    expect(fsMocks.readTextFile).toHaveBeenCalledWith('C:/Vault/.iwae/block-presets.json')
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      'C:/Vault/.iwae/block-presets.json',
      expect.stringContaining('preset-1'),
    )
  })

  it('캔버스 경로 이탈을 막고 교체 실패 시 임시 파일을 정리한다', async () => {
    const document = {
      version: 1 as const,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    await expect(readCanvas(vault, '../escape.canvas')).rejects.toThrow('경로')
    fsMocks.rename.mockRejectedValue(new Error('locked'))
    await expect(writeCanvas(vault, 'HTTP/OPTIONS.canvas', document)).rejects.toThrow('locked')
    expect(fsMocks.remove).toHaveBeenCalledWith('C:/Vault/HTTP/OPTIONS.canvas.tmp')
  })

  it('새 노트 이름으로 vault 밖을 가리킬 수 없다', async () => {
    await expect(createNote(vault, '../escape', 'note')).rejects.toThrow('이름')
    await expect(createNote(vault, 'HTTP', '../note')).rejects.toThrow('이름')
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled()
  })
})

describe('relinkDocument', () => {
  beforeEach(() => {
    fsMocks.exists.mockReset()
    fsMocks.readTextFile.mockReset()
    fsMocks.writeTextFile.mockReset()
    vi.mocked(openPdf).mockReset()
    fsMocks.exists.mockResolvedValue(true)
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({
      version: 1,
      documents: { [entry.docId]: entry },
    }))
  })

  it('고른 파일의 docId가 같으면 경로만 바꾼다', async () => {
    vi.mocked(openPdf).mockResolvedValue({
      docId: entry.docId,
      sha256: entry.sha256,
      size: entry.size,
      title: 'Moved',
      pageCount: entry.pages,
      pageSizes: [[612, 792]],
      hasText: true,
    })

    await expect(relinkDocument(vault, entry.docId, 'D:/Moved/original.pdf')).resolves.toEqual({
      ...entry,
      path: 'D:/Moved/original.pdf',
    })
    const written = fsMocks.writeTextFile.mock.calls[0]?.[1]
    expect(written).toContain('D:/Moved/original.pdf')
  })

  it('다른 문서를 고르면 레지스트리를 바꾸지 않는다', async () => {
    vi.mocked(openPdf).mockResolvedValue({
      docId: 'ffffffffffff',
      sha256: 'f'.repeat(64),
      size: 2048,
      title: 'Different',
      pageCount: 2,
      pageSizes: [[612, 792]],
      hasText: true,
    })

    await expect(relinkDocument(vault, entry.docId, 'D:/Different.pdf')).rejects.toThrow(
      '같은 문서가 아닙니다',
    )
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled()
  })
})

describe('registerUnlistedVaultPdfs with a password-protected PDF', () => {
  const identity = { docId: 'lockeddoc001', sha256: 'e'.repeat(64), size: 2048 }

  beforeEach(() => {
    fsMocks.exists.mockReset()
    fsMocks.mkdir.mockReset()
    fsMocks.readTextFile.mockReset()
    fsMocks.readDir.mockReset()
    fsMocks.writeTextFile.mockReset()
    vi.mocked(openPdf).mockReset()
    invoke.mockReset()
    fsMocks.exists.mockResolvedValue(false)
    fsMocks.readDir.mockResolvedValue([{ name: 'locked-copy.pdf', isDirectory: false }])
    invoke.mockResolvedValue(identity)
  })

  it('암호 PDF 도 쪽 수 0 으로 등록해 목록에 올린다', async () => {
    const lockedError = new Error('password required')
    lockedError.name = 'PdfPasswordError'
    vi.mocked(openPdf).mockRejectedValue(lockedError)

    await expect(registerUnlistedVaultPdfs({ root: 'C:/LockedVault' })).resolves.toEqual(['locked-copy.pdf'])

    const library = fsMocks.writeTextFile.mock.calls
      .map((call) => String(call[1]))
      .find((text) => text.includes('"documents"'))
    expect(library).toBeDefined()
    const doc = (JSON.parse(library!) as { documents: Record<string, VaultLibraryEntry> }).documents[identity.docId]
    expect(doc).toMatchObject({ docId: identity.docId, sha256: identity.sha256, size: identity.size, pages: 0, title: 'locked-copy' })
  })

  it('암호 말고 다른 이유로 못 연 PDF 는 등록하지 않는다', async () => {
    vi.mocked(openPdf).mockRejectedValue(new Error('broken file'))
    await expect(registerUnlistedVaultPdfs({ root: 'C:/BrokenVault' })).resolves.toEqual([])
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled()
  })

  it('열고 난 뒤 실제 쪽 수로 고친다', async () => {
    fsMocks.exists.mockResolvedValue(true)
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify({ version: 1, documents: { [entry.docId]: { ...entry, pages: 0 } } }))
    const updated = await updateLibraryPageCount(vault, entry.docId, 7)
    expect(updated?.find((item) => item.docId === entry.docId)?.pages).toBe(7)
    await expect(updateLibraryPageCount(vault, entry.docId, 0)).resolves.toBeNull()
  })
})

describe('registerUnlistedVaultPdfs with PDFs moved inside the Vault', () => {
  const sha = 'a'.repeat(64)
  const libraryJson = 'C:/Vault/.iwae/library.json'
  const indexJson = 'C:/Vault/.iwae/index.json'
  const registered: VaultLibraryEntry = {
    docId: 'aaaaaaaaaaaa',
    path: 'C:/Vault/01_Spec/spec.pdf',
    sha256: sha,
    size: 2048,
    pages: 5,
    title: 'spec',
    addedAt: '2026-09-20T00:00:00.000Z',
    folderPath: '01_Spec',
    attachmentPolicy: { kind: 'copy-current-folder', folderPath: '01_Spec' },
  }
  let files: Map<string, string>
  let specInFolder: boolean
  let rootFiles: string[]

  const libraryNow = () => (JSON.parse(files.get(libraryJson) ?? '{"documents":{}}') as { documents: Record<string, VaultLibraryEntry> }).documents
  const indexNow = () => (JSON.parse(files.get(indexJson) ?? '{"entries":[]}') as { entries: { id: string; path: string; displayName: string; missing: boolean }[] }).entries

  beforeEach(() => {
    for (const mock of Object.values(fsMocks)) mock.mockReset()
    vi.mocked(openPdf).mockReset()
    invoke.mockReset()
    files = new Map([
      [libraryJson, JSON.stringify({ version: 1, documents: { [registered.docId]: registered } })],
      [indexJson, JSON.stringify({ version: 1, entries: [{ id: registered.docId, kind: 'pdf', storage: 'vault', path: '01_Spec/spec.pdf', displayName: 'spec', contentHash: sha, size: 2048, modifiedAt: null, addedAt: registered.addedAt, missing: false }] })],
    ])
    rootFiles = []
    specInFolder = false
    fsMocks.exists.mockImplementation(async (path: string) => files.has(path))
    fsMocks.readTextFile.mockImplementation(async (path: string) => files.get(path) ?? '')
    fsMocks.writeTextFile.mockImplementation(async (path: string, text: string) => { files.set(path, text) })
    fsMocks.rename.mockImplementation(async (from: string, to: string) => { files.set(to, files.get(from) ?? ''); files.delete(from) })
    fsMocks.remove.mockResolvedValue(undefined)
    fsMocks.readDir.mockImplementation(async (path: string) => {
      if (path === 'C:/Vault') return [...rootFiles.map((name) => ({ name, isDirectory: false })), ...(specInFolder ? [{ name: '01_Spec', isDirectory: true }] : [])]
      if (path === 'C:/Vault/01_Spec') return specInFolder ? [{ name: 'spec.pdf', isDirectory: false }] : []
      return []
    })
    invoke.mockResolvedValue({ docId: registered.docId, sha256: sha, size: 2048 })
  })

  it('폴더 안 PDF 를 탐색기로 Vault 맨 위로 옮기면 새 문서가 아니라 그 문서를 새 자리로 잇는다', async () => {
    rootFiles = ['spec-moved.pdf']
    await expect(registerUnlistedVaultPdfs(vault)).resolves.toEqual(['spec-moved.pdf'])

    expect(Object.keys(libraryNow())).toEqual([registered.docId])
    expect(libraryNow()[registered.docId]).toMatchObject({
      path: 'C:/Vault/spec-moved.pdf',
      folderPath: '',
      title: 'spec-moved',
      pages: 5,
      attachmentPolicy: { kind: 'copy-current-folder', folderPath: '' },
    })
    expect(indexNow()).toEqual([expect.objectContaining({ id: registered.docId, path: 'spec-moved.pdf', displayName: 'spec-moved', missing: false })])
    expect(openPdf).not.toHaveBeenCalled()
  })

  it('이름을 따로 붙인 문서는 옮겨도 그 이름을 지킨다', async () => {
    files.set(libraryJson, JSON.stringify({ version: 1, documents: { [registered.docId]: { ...registered, title: '내 이름' } } }))
    rootFiles = ['spec.pdf']
    await registerUnlistedVaultPdfs(vault)
    expect(libraryNow()[registered.docId]).toMatchObject({ path: 'C:/Vault/spec.pdf', folderPath: '', title: '내 이름' })
  })

  it('원본 파일이 그대로 있는 같은 내용의 사본은 등록하지 않는다(같은 문서 ID 가 겹친다)', async () => {
    specInFolder = true
    rootFiles = ['copy of spec.pdf']
    await expect(registerUnlistedVaultPdfs(vault)).resolves.toEqual([])
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled()
  })

  it('이전에 사본이라 건너뛴 파일도 원본이 사라지면 다음 새로고침에서 그 문서를 이어받는다', async () => {
    specInFolder = true
    rootFiles = ['copy of spec.pdf']
    await registerUnlistedVaultPdfs(vault)
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled()

    // 원본(01_Spec/spec.pdf)을 지운다
    specInFolder = false
    await expect(registerUnlistedVaultPdfs(vault)).resolves.toEqual(['copy of spec.pdf'])
    expect(libraryNow()[registered.docId]).toMatchObject({ path: 'C:/Vault/copy of spec.pdf', folderPath: '' })
  })
})

describe('isMissingPathError', () => {
  it('os error 2 · 3 와 「없음」 글을 없는 경로로 본다', () => {
    expect(isMissingPathError(new Error('The system cannot find the file specified. (os error 2)'))).toBe(true)
    expect(isMissingPathError('경로를 찾을 수 없습니다. (os error 3)')).toBe(true)
    expect(isMissingPathError('os error 3')).toBe(true)
    expect(isMissingPathError(new Error('No such file or directory'))).toBe(true)
  })

  it('os error 2 로 시작하는 다른 번호(21 · 32 · 5)는 없는 경로가 아니다', () => {
    expect(isMissingPathError(new Error('os error 21'))).toBe(false)
    expect(isMissingPathError(new Error('os error 32'))).toBe(false)
    expect(isMissingPathError(new Error('Access is denied. (os error 5)'))).toBe(false)
  })
})
