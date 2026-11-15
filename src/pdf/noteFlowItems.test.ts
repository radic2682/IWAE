import { describe, expect, it } from 'vitest'
import type { PersistentPdfHighlight } from './persistentHighlight'
import { buildNoteFlowItems } from './noteFlowItems'

const draft = { id: 'draft', anchor: { docId: 'a.pdf', page: 1, quote: 'q' }, color: 'yellow' } as unknown as PersistentPdfHighlight

describe('buildNoteFlowItems draft card', () => {
  it('names the draft card after its PDF when the title is known', () => {
    const items = buildNoteFlowItems([], { highlightById: new Map(), docTitles: { 'a.pdf': '논문 A' }, otherLabel: '다른 문서', draft })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ draft: true, sourceLabel: '논문 A' })
  })
  it('falls back to the other-document label when the PDF is unknown', () => {
    const items = buildNoteFlowItems([], { highlightById: new Map(), otherLabel: '다른 문서', draft })
    expect(items[0]).toMatchObject({ sourceLabel: '다른 문서' })
  })
})
