import { describe, expect, it } from 'vitest'
import {
  createVaultIndexEntry,
  isFlowVaultEntry,
  kindFromPath,
  migrateLibraryToIndex,
  moveIndexEntry,
  parseVaultIndex,
  reconcileLibraryPdfEntries,
  reconcileMissingVaultPdfs,
  reconcileVaultIndexFiles,
  renameDisplayName,
} from './vaultIndex'

const NOW = '2026-09-27T00:00:00.000Z'

describe('vault index', () => {
  it('keeps a stable id while path and display name change', () => {
    const entry = createVaultIndexEntry({
      id: 'doc-1',
      kind: 'pdf',
      storage: 'reference',
      path: 'C:\\docs\\a.pdf',
      addedAt: NOW,
    })

    const renamed = renameDisplayName({ version: 1, entries: [entry] }, 'doc-1', 'Protocol')
    const moved = moveIndexEntry(renamed, 'doc-1', 'C:\\docs\\b.pdf')

    expect(moved.entries[0]).toMatchObject({
      id: 'doc-1',
      path: 'C:/docs/b.pdf',
      displayName: 'Protocol',
    })
  })

  it('derives a display name and migrates a legacy library idempotently', () => {
    const legacyLibrary = {
      version: 1,
      documents: {
        'doc-1': {
          docId: 'doc-1',
          path: 'C:/docs/spec.pdf',
          sha256: 'a'.repeat(64),
          size: 4096,
          pages: 12,
          title: 'Specification',
          addedAt: NOW,
          attachmentPolicy: { kind: 'reference' },
        },
      },
    }

    const first = migrateLibraryToIndex(legacyLibrary, NOW)

    expect(first.entries[0]).toMatchObject({
      id: 'doc-1',
      storage: 'reference',
      displayName: 'Specification',
      contentHash: 'a'.repeat(64),
    })
    expect(migrateLibraryToIndex(first, NOW)).toEqual(first)
  })

  it('기존 PDF는 정책이 없으면 외부 참조로, 복사 정책이면 Vault 상대 경로로 이전한다', () => {
    const legacyLibrary = {
      version: 1,
      documents: {
        reference: {
          docId: 'reference', path: 'D:/Docs/spec.pdf', sha256: 'a'.repeat(64), size: 1,
          pages: 2, title: 'Reference', addedAt: NOW,
        },
        copied: {
          docId: 'copied', path: 'C:/Vault/Specs/copied.pdf', sha256: 'b'.repeat(64), size: 2,
          pages: 3, title: 'Copied', addedAt: NOW, folderPath: 'Specs',
          attachmentPolicy: { kind: 'copy-current-folder', folderPath: 'Specs' },
        },
      },
    }

    expect(migrateLibraryToIndex(legacyLibrary, NOW).entries).toMatchObject([
      { id: 'reference', storage: 'reference', path: 'D:/Docs/spec.pdf' },
      { id: 'copied', storage: 'vault', path: 'Specs/copied.pdf' },
    ])
  })

  it('이미 생성된 잘못된 PDF 인덱스 경로를 Library 정책으로 복구하고 누락 항목을 보충한다', () => {
    const broken = createVaultIndexEntry({
      id: 'copied', kind: 'pdf', storage: 'vault', path: 'C:/Vault/Specs/copied.pdf', addedAt: NOW,
    })
    const library = [
      {
        docId: 'copied', path: 'C:/Vault/Specs/copied.pdf', sha256: 'b'.repeat(64), size: 2,
        pages: 3, title: 'Copied', addedAt: NOW, folderPath: 'Specs',
        attachmentPolicy: { kind: 'copy-current-folder' as const, folderPath: 'Specs' },
      },
      {
        docId: 'reference', path: 'D:/Docs/spec.pdf', sha256: 'a'.repeat(64), size: 1,
        pages: 2, title: 'Reference', addedAt: NOW,
      },
    ]

    expect(reconcileLibraryPdfEntries({ version: 1, entries: [broken] }, library, NOW).entries)
      .toMatchObject([
        { id: 'copied', storage: 'vault', path: 'Specs/copied.pdf' },
        { id: 'reference', storage: 'reference', path: 'D:/Docs/spec.pdf' },
      ])
  })

  it('rejects duplicate ids and empty aliases', () => {
    const entry = createVaultIndexEntry({
      id: 'doc-1',
      kind: 'pdf',
      storage: 'vault',
      path: 'Specs/spec.pdf',
      addedAt: NOW,
    })

    expect(() => parseVaultIndex({ version: 1, entries: [entry, entry] })).toThrow('중복')
    expect(() => renameDisplayName({ version: 1, entries: [entry] }, 'doc-1', '   ')).toThrow('표시 이름')
  })

  it('adds canvas and markdown files once and preserves their ids across refreshes', () => {
    const tree = [
      { path: 'HTTP', isDirectory: true },
      { path: 'HTTP/OPTIONS.canvas', isDirectory: false },
      { path: 'HTTP/README.md', isDirectory: false },
      { path: 'HTTP/spec.pdf', isDirectory: false },
    ]
    let nextId = 0
    const first = reconcileVaultIndexFiles(
      { version: 1, entries: [] },
      tree,
      NOW,
      () => `file-${++nextId}`,
    )
    const second = reconcileVaultIndexFiles(first, tree, NOW, () => `file-${++nextId}`)

    expect(first.entries).toMatchObject([
      { id: 'file-1', kind: 'canvas', path: 'HTTP/OPTIONS.canvas', missing: false },
      { id: 'file-2', kind: 'markdown', path: 'HTTP/README.md', missing: false },
    ])
    expect(second).toEqual(first)
    expect(nextId).toBe(2)
  })

  it('marks indexed vault files missing without deleting their stable identity', () => {
    const entry = createVaultIndexEntry({
      id: 'note-1',
      kind: 'canvas',
      storage: 'vault',
      path: 'HTTP/OPTIONS.canvas',
      addedAt: NOW,
    })

    const reconciled = reconcileVaultIndexFiles(
      { version: 1, entries: [entry] },
      [],
      NOW,
      () => 'unused',
    )

    expect(reconciled.entries[0]).toMatchObject({ id: 'note-1', missing: true })
  })
})

describe('reconcileMissingVaultPdfs', () => {
  const entry = (id: string, path: string) => ({
    id, kind: 'pdf' as const, storage: 'vault' as const, path, displayName: id, contentHash: 'h', size: 1, modifiedAt: null, addedAt: 'a', missing: false,
  })
  const legacy = (docId: string) => ({ docId, path: `C:/v/${docId}.pdf`, sha256: 'h', size: 1, pages: 1, title: docId, addedAt: 'a' })

  it('drops vanished PDFs without user data and keeps (flags) those with data', () => {
    const index = { version: 1 as const, entries: [entry('a', 'a.pdf'), entry('b', 'b.pdf'), entry('c', 'c.pdf')] }
    const result = reconcileMissingVaultPdfs(
      index,
      [legacy('a'), legacy('b'), legacy('c')],
      [{ path: 'a.pdf', isDirectory: false }],
      (docId) => docId === 'c',
    )
    expect(result.library.map((item) => item.docId)).toEqual(['a', 'c'])
    expect(result.index.entries.map((item) => [item.id, item.missing])).toEqual([['a', false], ['c', true]])
    expect(result.absentDocIds).toEqual(['c'])
  })
})

describe('kindFromPath · text documents', () => {
  it('txt·html·xml 은 예전처럼 other 로 남는다(색인 파일에 새 종류를 적지 않는다)', () => {
    expect(kindFromPath('a.PDF')).toBe('pdf')
    expect(kindFromPath('a.md')).toBe('markdown')
    expect(kindFromPath('a.Markdown')).toBe('markdown')
    for (const name of ['a.txt', 'a.text', 'a.log', 'a.html', 'a.HTM', 'a.xhtml', 'a.xml']) expect(kindFromPath(name)).toBe('other')
    expect(kindFromPath('a.canvas')).toBe('canvas')
    expect(kindFromPath('a.PNG')).toBe('image')
    expect(kindFromPath('notes/cmd')).toBe('other')
    expect(kindFromPath('a.docx')).toBe('other')
  })

  it('isFlowVaultEntry: markdown, 또는 other 인데 경로가 txt·html·xml', () => {
    expect(isFlowVaultEntry({ kind: 'markdown', path: 'a.md' })).toBe(true)
    for (const path of ['a.txt', 'b/c.HTML', 'd.xml', 'e.log']) expect(isFlowVaultEntry({ kind: 'other', path })).toBe(true)
    expect(isFlowVaultEntry({ kind: 'other', path: 'a.png' })).toBe(false)
    expect(isFlowVaultEntry({ kind: 'other', path: 'noext' })).toBe(false)
    expect(isFlowVaultEntry({ kind: 'pdf', path: 'a.pdf' })).toBe(false)
    expect(isFlowVaultEntry({ kind: 'canvas', path: 'a.canvas' })).toBe(false)
    expect(isFlowVaultEntry({ kind: 'image', path: 'a.xml' })).toBe(false)
  })

  it("색인은 'text' 종류를 만들지도 받지도 않는다(예전 버전과 같다)", () => {
    expect(() => parseVaultIndex({ version: 1, entries: [{ id: 't', kind: 'text', storage: 'vault', path: 'a.txt', displayName: 'a', contentHash: null, size: null, modifiedAt: null, addedAt: NOW, missing: false }] })).toThrow()
  })

  it('txt 항목은 other 로 쓰이고 읽히며, 표시 이름은 확장자를 뗀다', () => {
    const entry = createVaultIndexEntry({ id: 't1', kind: kindFromPath('Logs/run.log'), storage: 'vault', path: 'Logs/run.log', addedAt: NOW })
    expect(entry.displayName).toBe('run')
    const round = parseVaultIndex(JSON.parse(JSON.stringify({ version: 1, entries: [entry] })))
    expect(round.entries[0]?.kind).toBe('other')
  })

  it('목록 훑기는 txt·html·xml 파일을 other 로 올리고 기존 항목은 그대로 둔다', () => {
    const tree = [
      { path: 'N/a.txt', isDirectory: false },
      { path: 'N/b.html', isDirectory: false },
      { path: 'N/c.xml', isDirectory: false },
    ]
    const old = createVaultIndexEntry({ id: 'old', kind: 'other', storage: 'vault', path: 'N/a.txt', addedAt: NOW })
    let n = 0
    const next = reconcileVaultIndexFiles({ version: 1, entries: [old] }, tree, NOW, () => `id-${++n}`)
    expect(next.entries.map((entry) => [entry.path, entry.kind, entry.id])).toEqual([
      ['N/a.txt', 'other', 'old'],
      ['N/b.html', 'other', 'id-1'],
      ['N/c.xml', 'other', 'id-2'],
    ])
  })
})
