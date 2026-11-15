import { describe, expect, it } from 'vitest'
import {
  MAX_MISSING_INDEX_ENTRIES,
  createVaultIndexEntry,
  parseVaultIndexLenient,
  reconcileMissingVaultPdfs,
  reconcileVaultIndexFiles,
  type VaultIndexEntry,
} from './vaultIndex'

const entry = (id: string, path: string, extra: Partial<VaultIndexEntry> = {}): VaultIndexEntry => ({
  ...createVaultIndexEntry({ id, kind: 'markdown', storage: 'vault', path, addedAt: '2026-01-01T00:00:00.000Z' }),
  ...extra,
})

describe('index: file names that differ only in Unicode form or case keep their id', () => {
  it('matches a decomposed (NFD) file name to an entry saved with the composed (NFC) name and adopts the on-disk spelling', () => {
    const nfc = '노트/한글 메모.md'
    const nfd = nfc.normalize('NFD')
    expect(nfd).not.toBe(nfc)
    const index = { version: 1 as const, entries: [entry('keep-me', nfc, { missing: true })] }
    const next = reconcileVaultIndexFiles(index, [{ path: nfd, isDirectory: false }], '2026-02-01T00:00:00.000Z', () => 'new-id')
    expect(next.entries).toHaveLength(1)
    expect(next.entries[0]).toMatchObject({ id: 'keep-me', missing: false, path: nfd })
  })

  it('does not drop a PDF that has user data because its name is spelled in the other Unicode form', () => {
    const nfc = '논문/한글.pdf'
    const pdf = entry('p1', nfc, { kind: 'pdf' })
    const result = reconcileMissingVaultPdfs({ version: 1, entries: [pdf] }, [], [{ path: nfc.normalize('NFD'), isDirectory: false }], () => false)
    expect(result.index.entries.map((item) => item.id)).toEqual(['p1'])
    expect(result.absentDocIds).toEqual([])
  })
})

describe('index: files that went missing', () => {
  it('keeps entries of files that are missing (the drive may come back) while under the cap', () => {
    const index = { version: 1 as const, entries: [entry('a', 'a.md'), entry('b', 'b.md')] }
    const next = reconcileVaultIndexFiles(index, [], '2026-02-01T00:00:00.000Z', () => 'x')
    expect(next.entries.map((item) => [item.id, item.missing])).toEqual([['a', true], ['b', true]])
  })

  it('caps the number of missing entries, dropping the oldest first, and clears leftover atomic-write temp entries', () => {
    const many = Array.from({ length: MAX_MISSING_INDEX_ENTRIES + 3 }, (_, n) => entry(`m${n}`, `gone/${n}.md`, { addedAt: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}.${String(Math.floor(n / 60)).padStart(3, '0')}Z` }))
    const junk = entry('junk', '.iwae-abc.tmp', { kind: 'other' })
    const next = reconcileVaultIndexFiles({ version: 1, entries: [...many, junk] }, [], '2026-02-01T00:00:00.000Z', () => 'x')
    expect(next.entries.filter((item) => item.missing)).toHaveLength(MAX_MISSING_INDEX_ENTRIES)
    expect(next.entries.some((item) => item.id === 'junk')).toBe(false)
  })
})

describe('parseVaultIndexLenient', () => {
  it('reads what it can from a newer or partly unknown index', () => {
    const parsed = parseVaultIndexLenient({ version: 5, entries: [{ id: 'a', kind: 'markdown', storage: 'vault', path: 'a.md', displayName: 'a', contentHash: null, size: null, modifiedAt: null, addedAt: 'x', missing: false }, { id: 3 }, null] })
    expect(parsed.entries.map((item) => item.id)).toEqual(['a'])
    expect(parseVaultIndexLenient('nope')).toEqual({ version: 1, entries: [] })
  })
})
