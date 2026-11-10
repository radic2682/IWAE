import { describe, expect, it } from 'vitest'
import {
  convertZoteroAnnotations,
  findTextRange,
  parseZoteroLibrary,
  zoteroBibEntry,
  zoteroColorId,
  zoteroFolderFor,
  type ZoteroItem,
} from './zoteroImport'
import type { PageTextIndex } from './textIndex'

const PAGE_TEXT = 'Deep learning allows computational models\nthat are composed of multiple processing layers.'
const PAGE: PageTextIndex = { text: PAGE_TEXT, chars: [...PAGE_TEXT].map((c, i) => ({ c, x: i * 6, y: 100, w: 6, h: 12 })) }

const item = (over: Partial<ZoteroItem> = {}): ZoteroItem => ({
  key: 'K1', itemType: 'journalArticle', authors: [], collections: [], attachments: [], notes: [], ...over,
})

describe('zoteroImport', () => {
  it('parses the Rust payload defensively', () => {
    const library = parseZoteroLibrary({
      dataDir: 'C:/Zotero',
      items: [
        { key: 'A', itemType: 'book', title: 'T', authors: ['Ada', 3], year: 2020, collections: ['ML/Papers'], attachments: [{ key: 'X', path: 'C:/Zotero/storage/X/a.pdf', fileName: 'a.pdf', annotations: [{ kind: 'highlight', text: 'hi', pageIndex: 2 }, { kind: 'weird' }, 5] }], notes: ['n'] },
        { title: 'no key' },
        'junk',
      ],
    })
    expect(library.items).toHaveLength(1)
    expect(library.items[0]).toMatchObject({ key: 'A', title: 'T', authors: ['Ada'], year: 2020, notes: ['n'] })
    expect(library.items[0]!.attachments[0]!.annotations.map((a) => a.kind)).toEqual(['highlight', 'other'])
    expect(parseZoteroLibrary(null).items).toEqual([])
  })

  it('places an item in a folder per collection and cleans path parts', () => {
    expect(zoteroFolderFor(item())).toBe('Zotero')
    expect(zoteroFolderFor(item({ collections: ['ML/Papers: 2020?', 'Other'] }))).toBe('Zotero/ML/Papers_ 2020_')
    expect(zoteroFolderFor(item({ collections: ['../..'] }))).toBe('Zotero')
  })

  it('builds a bibliography entry that automatic extraction cannot overwrite', () => {
    const entry = zoteroBibEntry(item({ title: 'Deep', authors: ['Ada Lovelace'], year: 2015, doi: '10.1/x', journal: 'Nature' }), '2026-11-11T00:00:00Z')
    expect(entry).toEqual({ title: 'Deep', authors: ['Ada Lovelace'], year: 2015, doi: '10.1/x', journal: 'Nature', source: 'manual', updatedAt: '2026-11-11T00:00:00Z' })
  })

  it('maps Zotero colors to the nearest highlight color', () => {
    expect(zoteroColorId('#ffd400')).toBe('yellow')
    expect(zoteroColorId('#5fb236')).toBe('green')
    expect(zoteroColorId('#2ea8e5')).toBe('blue')
    expect(zoteroColorId('#e56eee')).toBe('pink')
    expect(zoteroColorId(undefined)).toBe('yellow')
  })

  it('finds quotes across line breaks and different spacing', () => {
    const range = findTextRange(PAGE, 'computational  models that are\ncomposed')
    expect(range).not.toBeNull()
    expect(PAGE_TEXT.slice(range![0], range![1])).toBe('computational models\nthat are composed')
    expect(findTextRange(PAGE, 'not on this page')).toBeNull()
    expect(findTextRange(PAGE, '   ')).toBeNull()
  })

  it('turns matched annotations into highlights with the comment as the memo, and keeps the rest as text', () => {
    const result = convertZoteroAnnotations('doc', [
      { kind: 'highlight', text: 'multiple processing layers', comment: 'key point', color: '#5fb236', pageIndex: 0 },
      { kind: 'underline', text: 'text that is not on the page', comment: 'check', pageIndex: 0, pageLabel: '12' },
      { kind: 'note', comment: 'Ask the author', pageIndex: 0 },
      { kind: 'image', pageIndex: 0 },
      { kind: 'highlight', text: 'Deep learning', pageIndex: 5 },
      { kind: 'highlight', text: 'multiple processing layers', pageIndex: 0 },
    ], (page) => (page === 0 ? PAGE : null), undefined, '2026-11-11T00:00:00Z')
    expect(result.highlights).toHaveLength(1)
    expect(result.highlights[0]).toMatchObject({ color: 'green', note: 'key point', source: 'imported' })
    expect(result.highlights[0]!.anchor.quote).toBe('multiple processing layers')
    expect(result.memos).toEqual([
      'p.12 — “text that is not on the page” — check',
      'p.1 — Ask the author',
      'p.6 — “Deep learning”',
    ])
    // 이미지 1, 같은 글자에 두 번 칠한 형광펜 1
    expect(result.skipped).toBe(2)
  })
})
