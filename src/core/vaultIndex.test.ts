import { describe, expect, it } from 'vitest'
import {
  createVaultIndexEntry,
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
