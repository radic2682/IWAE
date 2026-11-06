import { describe, expect, it } from 'vitest'
import { classifyVaultEvents, isIgnoredVaultEvent } from './vaultWatch'
import type { VaultIndexEntry } from './vaultIndex'

const index: VaultIndexEntry[] = [
  {
    id: 'pdf-1', kind: 'pdf', storage: 'reference', path: 'C:/Docs/spec.pdf', displayName: 'Spec',
    contentHash: null, size: null, modifiedAt: null, addedAt: '2026-09-27T00:00:00.000Z', missing: false,
  },
  {
    id: 'md-1', kind: 'markdown', storage: 'vault', path: 'Notes/readme.md', displayName: 'Readme',
    contentHash: null, size: null, modifiedAt: null, addedAt: '2026-09-27T00:00:00.000Z', missing: false,
  },
]

describe('vault watch classification', () => {
  it.each([
    'C:/Vault/.iwae/index.json',
    'C:/Vault/.iwae-123.tmp',
    'C:/Vault/file.part',
    'C:/Vault/spec (conflicted copy 2026-09-27).pdf',
    'C:/Vault/~$draft.md',
  ])('ignores internal or synchronization noise: %s', (path) => {
    expect(isIgnoredVaultEvent(path)).toBe(true)
  })

  it('reloads clean indexed files and conflicts dirty indexed files', () => {
    const result = classifyVaultEvents([
      { paths: ['c:/docs/SPEC.pdf'] },
      { paths: ['C:/Vault/Notes/readme.md'] },
      { paths: ['C:/Vault/New.canvas'] },
    ], index, new Set(['md-1']), 'C:/Vault')

    expect(result.reloadIds).toEqual(['pdf-1'])
    expect(result.conflictIds).toEqual(['md-1'])
    expect(result.shouldReindex).toBe(true)
  })
})
