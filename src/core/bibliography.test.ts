import { describe, expect, it } from 'vitest'
import {
  entryFromPdf,
  extractIdentifiers,
  mergeEntry,
  parseAuthors,
  parseBibliographyFile,
  parseCrossrefWork,
  toBibtex,
  yearFrom,
  type BibEntry,
} from './bibliography'

describe('bibliography', () => {
  it('finds a DOI and an arXiv id in page text and trims trailing punctuation', () => {
    expect(extractIdentifiers('See https://doi.org/10.1145/3290605.3300233. Also arXiv:2106.09685v2 here')).toEqual({
      doi: '10.1145/3290605.3300233',
      arxiv: '2106.09685v2',
    })
    expect(extractIdentifiers('DOI: 10.1038/s41586-021-03819-2),')).toEqual({ doi: '10.1038/s41586-021-03819-2' })
    expect(extractIdentifiers('no identifiers')).toEqual({})
  })

  it('splits author strings on common separators', () => {
    expect(parseAuthors('Kim, Lee')).toEqual(['Kim', 'Lee'])
    expect(parseAuthors('Ada Lovelace and Charles Babbage')).toEqual(['Ada Lovelace', 'Charles Babbage'])
    expect(parseAuthors('Hong Gildong; Kim Cheolsu')).toEqual(['Hong Gildong', 'Kim Cheolsu'])
    expect(parseAuthors('  ')).toEqual([])
  })

  it('reads the year from PDF and ISO dates', () => {
    expect(yearFrom('D:20230115120000Z')).toBe(2023)
    expect(yearFrom('2019-04-01')).toBe(2019)
    expect(yearFrom('garbage')).toBeUndefined()
  })

  it('builds a pdf-sourced entry from metadata and first pages', () => {
    const entry = entryFromPdf(
      { title: 'Linked Paper', author: 'Kim, Lee', creationDate: 'D:20230115120000Z' },
      'Abstract ... doi:10.1000/xyz123',
      '2026-10-02T00:00:00.000Z',
    )
    expect(entry).toEqual({
      title: 'Linked Paper', authors: ['Kim', 'Lee'], year: 2023, doi: '10.1000/xyz123',
      source: 'pdf', updatedAt: '2026-10-02T00:00:00.000Z',
    })
  })

  it('never lets automatic extraction overwrite manual or Crossref data', () => {
    const manual: BibEntry = { title: '수정한 제목', authors: ['홍길동'], source: 'manual', updatedAt: 'a' }
    const fromPdf: BibEntry = { title: 'Auto', authors: ['X'], source: 'pdf', updatedAt: 'b' }
    expect(mergeEntry(manual, fromPdf)).toBe(manual)
    expect(mergeEntry(undefined, fromPdf)).toBe(fromPdf)
    expect(mergeEntry(fromPdf, manual)).toBe(manual)
  })

  it('makes a BibTeX entry with a readable key', () => {
    const bibtex = toBibtex({ title: 'Attention Is All You Need', authors: ['Ashish Vaswani', 'Noam Shazeer'], year: 2017, doi: '10.5555/3295222', journal: 'NeurIPS', source: 'manual', updatedAt: '' })
    expect(bibtex).toBe([
      '@article{vaswani2017attention,',
      '  title = {Attention Is All You Need},',
      '  author = {Ashish Vaswani and Noam Shazeer},',
      '  year = {2017},',
      '  journal = {NeurIPS},',
      '  doi = {10.5555/3295222},',
      '}',
    ].join('\n'))
  })

  it('reads a Crossref work and tolerates missing fields', () => {
    expect(parseCrossrefWork({
      title: ['Deep Learning'],
      author: [{ given: 'Yann', family: 'LeCun' }, { name: 'Consortium' }],
      issued: { 'date-parts': [[2015, 5]] },
      'container-title': ['Nature'],
      DOI: '10.1038/nature14539',
    }, 'z')).toEqual({
      title: 'Deep Learning', authors: ['Yann LeCun', 'Consortium'], year: 2015, journal: 'Nature',
      doi: '10.1038/nature14539', source: 'crossref', updatedAt: 'z',
    })
    expect(parseCrossrefWork({}, 'z')).toEqual({ authors: [], source: 'crossref', updatedAt: 'z' })
    expect(() => parseCrossrefWork('nope', 'z')).toThrow()
  })

  it('parses the stored file and drops malformed entries', () => {
    const file = parseBibliographyFile({
      version: 1,
      entries: {
        good: { title: 'T', authors: ['A'], year: 2020, source: 'manual', updatedAt: 'x' },
        bad: { authors: 'A', source: 'manual' },
      },
    })
    expect(Object.keys(file.entries)).toEqual(['good'])
    expect(parseBibliographyFile(null).entries).toEqual({})
  })
})
