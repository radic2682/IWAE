// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PDF_VIEW_PREFS, readPdfViewPrefs, writePdfViewPrefs, nextRotation } from './pdfViewPrefs'

describe('pdfViewPrefs', () => {
  beforeEach(() => localStorage.clear())

  it('persists the only-open-notes toggle and drops it when off', () => {
    writePdfViewPrefs({ spread: 'single', invert: false, onlyOpenNotes: true })
    expect(readPdfViewPrefs()).toEqual({ spread: 'single', invert: false, onlyOpenNotes: true })
    writePdfViewPrefs({ spread: 'single', invert: false, onlyOpenNotes: false })
    expect(readPdfViewPrefs()).toEqual({ spread: 'single', invert: false })
  })

  it('defaults to single pages without inversion', () => {
    expect(readPdfViewPrefs()).toEqual(DEFAULT_PDF_VIEW_PREFS)
  })

  it('round-trips and ignores malformed values', () => {
    writePdfViewPrefs({ spread: 'double', invert: true })
    expect(readPdfViewPrefs()).toEqual({ spread: 'double', invert: true })
    localStorage.setItem('iwae:pdf-view', '{"spread":"triple","invert":"yes"}')
    expect(readPdfViewPrefs()).toEqual(DEFAULT_PDF_VIEW_PREFS)
    localStorage.setItem('iwae:pdf-view', 'not json')
    expect(readPdfViewPrefs()).toEqual(DEFAULT_PDF_VIEW_PREFS)
  })

  it('keeps the three-page spread', () => {
    writePdfViewPrefs({ spread: 'triple', invert: false })
    expect(readPdfViewPrefs()).toEqual({ spread: 'triple', invert: false })
  })

  it('survives blocked storage', () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('blocked') }
    expect(() => writePdfViewPrefs({ spread: 'double', invert: false })).not.toThrow()
    Storage.prototype.setItem = original
  })

  it('rotates clockwise in quarter turns', () => {
    expect(nextRotation(0)).toBe(90)
    expect(nextRotation(270)).toBe(0)
  })
})
