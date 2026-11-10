import { describe, expect, it } from 'vitest'
import {
  buildMarkdownBlocks,
  markdownFileStem,
  relativePdfLink,
  renderNoteMarkdown,
  uniqueFileStem,
  type BuildContext,
} from './markdownExport'
import type { MemoNote } from './memoNote'
import { createPersistentPdfHighlight, type PersistentPdfHighlight } from '../pdf/persistentHighlight'
import type { Anchor } from './anchor'

const anchor = (quote: string, page = 2, docId = 'doc1'): Anchor => ({
  docId, page, coordSpace: 'pdfium-page', rects: [{ x: 1, y: 2, w: 3, h: 4 }], charRange: [0, quote.length], quote, prefix: '', suffix: '',
})

const highlight = (quote: string, extras: Parameters<typeof createPersistentPdfHighlight>[2] = {}, page = 2): PersistentPdfHighlight =>
  createPersistentPdfHighlight(anchor(quote, page), 'yellow', extras)

const context = (highlights: PersistentPdfHighlight[], over: Partial<BuildContext> = {}): BuildContext => ({
  highlights: new Map(highlights.map((item) => [item.id, item])),
  docTitle: () => 'Paper A',
  link: (_docId, page) => `../Paper%20A.pdf#page=${page}`,
  translation: () => undefined,
  image: () => undefined,
  ...over,
})

describe('markdownExport', () => {
  it('renders sections, ticket headings, quotes with page links, memos and translations', () => {
    const first = highlight('Attention is all\nyou need', { note: 'Key idea' })
    const second = highlight('Second quote', {}, 4)
    const note: MemoNote = {
      version: 1,
      blocks: [
        { id: 'a', kind: 'section', title: 'Background' },
        { id: 'b', kind: 'memo', highlightId: first.id, ticket: { id: 'REQ-01', title: 'Core claim' } },
        { id: 'c', kind: 'memo', highlightId: second.id },
        { id: 'd', kind: 'text', text: 'Free text' },
      ],
    }
    const blocks = buildMarkdownBlocks(note, context([first, second], { translation: (quote) => (quote.startsWith('Attention') ? '주의만 있으면 된다' : undefined) }))
    const md = renderNoteMarkdown({ title: 'My note', blocks, exportedAt: '2026-11-11' })
    expect(md).toContain('title: "My note"')
    expect(md).toContain('documents:\n  - "Paper A"')
    expect(md).toContain('# My note')
    expect(md).toContain('## Background')
    expect(md).toContain('### REQ-01 · Core claim')
    expect(md).toContain('> Attention is all\n> you need')
    expect(md).toContain('— [Paper A, p.3](../Paper%20A.pdf#page=3)')
    expect(md).toContain('Key idea')
    expect(md).toContain('> 주의만 있으면 된다')
    expect(md).toContain('— [Paper A, p.5](../Paper%20A.pdf#page=5)')
    expect(md).toContain('Free text')
    expect(md.endsWith('\n')).toBe(true)
  })

  it('uses second-level headings for ticket memos before any section and skips memos whose highlight is gone', () => {
    const only = highlight('Only')
    const note: MemoNote = { version: 1, blocks: [
      { id: 'a', kind: 'memo', highlightId: only.id, ticket: { title: 'Plain title' } },
      { id: 'b', kind: 'memo', highlightId: 'missing' },
    ] }
    const md = renderNoteMarkdown({ title: 'N', blocks: buildMarkdownBlocks(note, context([only])), exportedAt: '2026-11-11' })
    expect(md).toContain('\n## Plain title\n')
    expect(md.match(/^> /gmu)).toHaveLength(1)
  })

  it('writes region captures as an image link without an empty quote, and keeps extra references', () => {
    const region = highlight('', { kind: 'region', pageSize: [600, 800] })
    const other = highlight('Second source', {}, 7)
    const note: MemoNote = { version: 1, blocks: [{ id: 'a', kind: 'memo', highlightId: region.id, refs: [other.id] }] }
    const blocks = buildMarkdownBlocks(note, context([region, other], { image: () => 'My%20note.assets/region-1.png' }))
    const md = renderNoteMarkdown({ title: 'My note', blocks, exportedAt: '2026-11-11' })
    expect(md).toContain('![영역 그림 Paper A p.3](My%20note.assets/region-1.png)')
    expect(md).toContain('> Second source')
    expect(md).not.toContain('>\n')
  })

  it('makes safe, unique file names', () => {
    expect(markdownFileStem('A/B: C?*')).toBe('A_B_ C__')
    expect(markdownFileStem('   ')).toBe('노트')
    expect(markdownFileStem('end. ')).toBe('end')
    expect(uniqueFileStem('Note', new Set(['note', 'note (2)']))).toBe('Note (3)')
    expect(uniqueFileStem('Fresh', new Set(['note']))).toBe('Fresh')
  })

  it('builds relative links to the PDF, and file URLs across drives', () => {
    expect(relativePdfLink('C:\\Export\\notes', 'C:\\Vault\\Papers\\a b.pdf', 3)).toBe('../../Vault/Papers/a%20b.pdf#page=3')
    expect(relativePdfLink('C:/Vault/export', 'C:/Vault/export/x.pdf')).toBe('x.pdf')
    expect(relativePdfLink('D:/Export', 'C:/Vault/a.pdf', 2)).toBe('file:///C:/Vault/a.pdf#page=2')
    expect(relativePdfLink('/Users/me/export', '/Users/me/Vault/a (1).pdf', 1)).toBe('../Vault/a%20%281%29.pdf#page=1')
  })
})
