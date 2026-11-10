import { describe, expect, it } from 'vitest'
import { annotationOfferCount, annotationOfferSeen, importedToHighlights, markAnnotationOfferSeen, nearestHighlightColor } from './annotationImport'
import type { ImportedPdfAnnotation } from '../bridge/pdf'
import type { PageTextIndex } from './textIndex'
import { createPersistentPdfHighlight } from '../pdf/persistentHighlight'

const PAGE: PageTextIndex = {
  text: 'Hello world',
  chars: [...'Hello world'].map((c, i) => ({ c, x: 10 + i * 10, y: 100, w: 10, h: 12 })),
}

const annotation = (over: Partial<ImportedPdfAnnotation> = {}): ImportedPdfAnnotation => ({
  page: 0,
  kind: 'highlight',
  rects: [{ x: 10, y: 99, w: 50, h: 14 }],
  color: [255, 255, 0],
  contents: null,
  ...over,
})

describe('annotationImport', () => {
  it('maps colors to the nearest of the four highlighter colors', () => {
    expect(nearestHighlightColor([255, 255, 0])).toBe('yellow')
    expect(nearestHighlightColor([30, 200, 60])).toBe('green')
    expect(nearestHighlightColor([20, 120, 255])).toBe('blue')
    expect(nearestHighlightColor([255, 100, 180])).toBe('pink')
    expect(nearestHighlightColor(null)).toBe('yellow')
  })

  it('turns a highlight over text into an anchored highlight with its note', () => {
    const result = importedToHighlights('doc', [annotation({ contents: '메모' })], () => PAGE, [])
    expect(result.skipped).toBe(0)
    expect(result.highlights).toHaveLength(1)
    expect(result.highlights[0]).toMatchObject({ color: 'yellow', note: '메모', source: 'imported' })
    expect(result.highlights[0]?.anchor.quote).toBe('Hello')
    expect(result.highlights[0]?.anchor.docId).toBe('doc')
  })

  it('anchors a sticky note to the nearest character', () => {
    const result = importedToHighlights('doc', [annotation({ kind: 'text', rects: [{ x: 108, y: 90, w: 10, h: 10 }], contents: '쪽지' })], () => PAGE, [])
    expect(result.highlights[0]?.anchor.quote).toBe('d')
    expect(result.highlights[0]?.note).toBe('쪽지')
  })

  it('skips pages without a text layer and annotations already imported', () => {
    const first = importedToHighlights('doc', [annotation()], () => PAGE, [])
    const again = importedToHighlights('doc', [annotation(), annotation({ page: 3 })], (page) => page === 0 ? PAGE : null, first.highlights)
    expect(again.highlights).toHaveLength(0)
    expect(again.skipped).toBe(2)
  })

  it('treats an existing highlight on the same characters as a duplicate', () => {
    const existing = importedToHighlights('doc', [annotation()], () => PAGE, []).highlights[0]!
    const own = createPersistentPdfHighlight(existing.anchor)
    const result = importedToHighlights('doc', [annotation()], () => PAGE, [own])
    expect(result.highlights).toHaveLength(0)
    expect(result.skipped).toBe(1)
  })

  it('offers the import once, only when marks exist and none were imported yet', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) }
    expect(annotationOfferSeen('doc', storage)).toBe(false)
    expect(annotationOfferCount('doc', [annotation(), annotation({ kind: 'text' })], [], false)).toBe(2)
    expect(annotationOfferCount('doc', [], [], false)).toBe(0)
    const imported = importedToHighlights('doc', [annotation()], () => PAGE, []).highlights
    expect(annotationOfferCount('doc', [annotation()], imported, false)).toBe(0)
    expect(annotationOfferCount('other', [annotation()], imported, false)).toBe(1)
    markAnnotationOfferSeen('doc', storage)
    markAnnotationOfferSeen('doc', storage)
    expect(annotationOfferSeen('doc', storage)).toBe(true)
    expect(JSON.parse(store.get('iwae:annotation-offer:v1')!)).toEqual(['doc'])
    expect(annotationOfferCount('doc', [annotation()], [], true)).toBe(0)
  })
})
