import { describe, expect, it } from 'vitest'
import type { VaultTreeNode } from './vaultTree'
import type { VaultSearchRecord } from './vaultSearch'
import { collectLibraryItems, filterLibraryItems, libraryFolders, selectRange, sortLibraryItems } from './libraryItems'

const tree: VaultTreeNode[] = [
  { id: 'folder:논문', kind: 'folder', name: '논문', path: '논문', children: [
    { id: 'pdf:d1', kind: 'pdf', name: '나 논문', folderPath: '논문', doc: { docId: 'd1', title: '나 논문', pages: 2, folderPath: '논문' } },
    { id: 'folder:논문/하위', kind: 'folder', name: '하위', path: '논문/하위', children: [
      { id: 'markdown:논문/하위/메모.md', kind: 'markdown', name: '메모', path: '논문/하위/메모.md', storage: 'vault', indexId: 'm1' },
    ] },
  ] },
  { id: 'note:가 노트.iwae', kind: 'note', name: '가 노트', path: '가 노트.iwae' },
]

const record = (over: Partial<VaultSearchRecord>): VaultSearchRecord => ({
  id: 'x', kind: 'pdf', storage: 'vault', path: '', folder: '', filename: '', displayName: '',
  extractedText: '', pages: [], missing: false, favorite: false, lastOpenedAt: null, addedAt: '2026-01-01T00:00:00Z', ...over,
})
const records = [
  record({ id: 'd1', kind: 'pdf', storage: 'reference', favorite: true, lastOpenedAt: '2026-09-01T00:00:00Z' }),
  record({ id: 'm1', kind: 'markdown', path: '논문/하위/메모.md', lastOpenedAt: '2026-09-03T00:00:00Z' }),
  record({ id: 'n1', kind: 'canvas', path: '가 노트.iwae' }),
]

describe('libraryItems', () => {
  const items = collectLibraryItems(tree, records)

  it('flattens files with folder, storage, and record ids', () => {
    expect(items.map((i) => [i.id, i.kind, i.folder, i.storage])).toEqual([
      ['d1', 'pdf', '논문', 'reference'],
      ['m1', 'markdown', '논문/하위', 'vault'],
      ['n1', 'note', '', 'vault'],
    ])
  })

  it('keeps only folders in the collection tree', () => {
    const folders = libraryFolders(tree)
    expect(folders.map((f) => f.path)).toEqual(['논문'])
    expect(folders[0]?.children.map((c) => c.id)).toEqual(['folder:논문/하위'])
  })

  it('filters by collection and query; folder includes descendants', () => {
    expect(filterLibraryItems(items, { kind: 'favorites' }, '').map((i) => i.id)).toEqual(['d1'])
    expect(filterLibraryItems(items, { kind: 'folder', path: '논문' }, '').map((i) => i.id)).toEqual(['d1', 'm1'])
    expect(filterLibraryItems(items, { kind: 'folder', path: '' }, '').map((i) => i.id)).toEqual(['d1', 'm1', 'n1'])
    expect(filterLibraryItems(items, { kind: 'recent' }, '').map((i) => i.id)).toEqual(['m1', 'd1'])
    expect(filterLibraryItems(items, { kind: 'all' }, '메모').map((i) => i.id)).toEqual(['m1'])
  })

  it('sorts by Korean name and reverses', () => {
    expect(sortLibraryItems(items, 'name', 'asc').map((i) => i.name)).toEqual(['가 노트', '나 논문', '메모'])
    expect(sortLibraryItems(items, 'name', 'desc').map((i) => i.name)).toEqual(['메모', '나 논문', '가 노트'])
  })

  it('sorts by kind with name as the tie-break', () => {
    expect(sortLibraryItems(items, 'kind', 'asc').map((i) => i.kind)).toEqual(['pdf', 'markdown', 'note'])
  })

  it('selects an inclusive range in either direction', () => {
    expect(selectRange(['a', 'b', 'c', 'd'], 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(selectRange(['a', 'b', 'c', 'd'], 'c', 'a')).toEqual(['a', 'b', 'c'])
    expect(selectRange(['a', 'b'], 'zz', 'b')).toEqual(['b'])
  })
})

describe('libraryItems — 서지 정보', () => {
  const bib = {
    d1: { title: 'T', authors: ['Ada Lovelace', 'Charles Babbage'], year: 1843, source: 'manual' as const, updatedAt: 'x' },
  }
  const items = collectLibraryItems(tree, records, bib)

  it('carries the first author and year for PDFs', () => {
    const pdf = items.find((item) => item.id === 'd1')
    expect(pdf).toMatchObject({ authors: 'Ada Lovelace 외 1명', year: 1843 })
    expect(items.find((item) => item.id === 'm1')).toMatchObject({ authors: '', year: null })
  })

  it('sorts by author and year with empty values last', () => {
    expect(sortLibraryItems(items, 'year', 'asc').map((item) => item.id)[0]).toBe('d1')
    expect(sortLibraryItems(items, 'author', 'asc').map((item) => item.id)[0]).toBe('d1')
  })
})
