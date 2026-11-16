import { describe, expect, it } from 'vitest'
import { partitionDroppedDocumentPaths } from './documentDrop'

describe('partitionDroppedDocumentPaths', () => {
  it('accepts supported documents once without changing their original paths', () => {
    expect(partitionDroppedDocumentPaths([
      'C:\\Docs\\A.PDF',
      'C:\\Docs\\a.pdf',
      'C:\\Docs\\notes.Markdown',
      'C:\\Docs\\draft.MD',
      'C:\\Docs\\image.png',
    ])).toEqual({
      accepted: [
        'C:\\Docs\\A.PDF',
        'C:\\Docs\\notes.Markdown',
        'C:\\Docs\\draft.MD',
      ],
      rejected: ['C:\\Docs\\image.png'],
    })
  })

  it('rejects empty and directory-looking values', () => {
    expect(partitionDroppedDocumentPaths([
      '',
      '   ',
      'C:\\Docs\\',
      '/home/user/docs/',
      'C:\\Docs\\report.pdf',
    ])).toEqual({
      accepted: ['C:\\Docs\\report.pdf'],
      rejected: ['', '   ', 'C:\\Docs\\', '/home/user/docs/'],
    })
  })
})

describe('partitionDroppedDocumentPaths · text formats', () => {
  it('txt·html·xml 도 받고, 그 밖의 형식은 거른다', () => {
    expect(partitionDroppedDocumentPaths([
      'C:\\Docs\\a.TXT', 'C:\\Docs\\b.log', 'C:\\Docs\\c.html', 'C:\\Docs\\d.XML', 'C:\\Docs\\e.pptx', 'C:\\Docs\\f.docx', 'C:\\Docs\\cmd',
    ])).toEqual({
      accepted: ['C:\\Docs\\a.TXT', 'C:\\Docs\\b.log', 'C:\\Docs\\c.html', 'C:\\Docs\\d.XML', 'C:\\Docs\\e.pptx'],
      rejected: ['C:\\Docs\\f.docx', 'C:\\Docs\\cmd'],
    })
  })
})
