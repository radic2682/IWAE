import { describe, expect, it } from 'vitest'
import { findStaleDocuments } from './staleDocuments'

const entry = (docId: string, sha256: string) => ({ docId, sha256, path: `C:/Vault/${docId}.pdf` })

describe('findStaleDocuments', () => {
  it('finds opened documents whose library hash changed in another window', () => {
    const stale = findStaleDocuments(
      [{ docId: 'a', sha256: 'old' }, { docId: 'b', sha256: 'same' }],
      [entry('a', 'new'), entry('b', 'same')],
      new Set(),
    )
    expect(stale).toEqual([{ docId: 'a', path: 'C:/Vault/a.pdf', key: 'a:new' }])
  })

  it('ignores documents that are not in the library and those already refreshed for that hash', () => {
    expect(findStaleDocuments([{ docId: 'x', sha256: 'h' }], [entry('a', 'new')], new Set())).toEqual([])
    expect(findStaleDocuments([{ docId: 'a', sha256: 'old' }], [entry('a', 'new')], new Set(['a:new']))).toEqual([])
  })
})
