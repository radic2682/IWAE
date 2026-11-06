import { describe, expect, it } from 'vitest'
import { createPdfBookmark, parsePdfBookmarks, pdfBookmarkFile } from './pdfBookmarks'

describe('pdfBookmarks', () => {
  it('문서와 페이지당 하나의 안정적인 책갈피를 만든다', () => {
    expect(createPdfBookmark('doc-a', 4, '동적 주소 할당', new Date('2026-09-20T00:00:00.000Z'))).toEqual({
      id: 'doc-a:4',
      docId: 'doc-a',
      page: 4,
      title: '동적 주소 할당',
      createdAt: '2026-09-20T00:00:00.000Z',
    })
  })

  it('저장 파일을 검증하고 페이지 순서로 정렬한다', () => {
    const later = createPdfBookmark('doc-a', 8, '9쪽')
    const earlier = createPdfBookmark('doc-a', 1, '2쪽')
    expect(parsePdfBookmarks(pdfBookmarkFile([later, earlier]))).toEqual([earlier, later])
    expect(() => parsePdfBookmarks({ version: 1, bookmarks: [{ docId: 'doc-a', page: -1 }] })).toThrow()
  })
})
