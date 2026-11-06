import { describe, expect, it } from 'vitest'
import type { CharBox, PageTextIndex } from './textIndex'
import { addRecentPdfSearch, pdfSearchCacheKey, searchPageIndex } from './pdfSearch'

const GLYPH_WIDTH = 6
const GLYPH_HEIGHT = 12

function makePage(lines: readonly string[]): PageTextIndex {
  const chars: CharBox[] = []
  let text = ''

  lines.forEach((line, lineIndex) => {
    const y = 100 + lineIndex * 16
    for (let index = 0; index < line.length; index += 1) {
      const c = line[index]
      if (c === undefined) continue
      chars.push({
        c,
        x: 72 + index * GLYPH_WIDTH,
        y,
        w: GLYPH_WIDTH,
        h: GLYPH_HEIGHT,
      })
      text += c
    }

    if (lineIndex < lines.length - 1) {
      const x = 72 + line.length * GLYPH_WIDTH
      chars.push({ c: '\r', x, y, w: 0, h: 0 }, { c: '\n', x, y, w: 0, h: 0 })
      text += '\r\n'
    }
  })

  return { text, chars }
}

describe('searchPageIndex', () => {
  it('페이지의 모든 일치와 안정적인 범위를 반환한다', () => {
    const page = makePage(['Use TCP, then TCP again.'])

    const matches = searchPageIndex('doc', 3, page, 'TCP', {
      caseSensitive: false,
      wholeWord: true,
    })

    expect(matches).toHaveLength(2)
    expect(matches.map(({ id, docId, page, start, end, quote }) => ({
      id,
      docId,
      page,
      start,
      end,
      quote,
    }))).toEqual([
      { id: 'doc:3:4:7', docId: 'doc', page: 3, start: 4, end: 7, quote: 'TCP' },
      { id: 'doc:3:14:17', docId: 'doc', page: 3, start: 14, end: 17, quote: 'TCP' },
    ])
  })

  it('대소문자 구분 옵션을 적용한다', () => {
    const page = makePage(['TCP tcp Tcp'])

    expect(searchPageIndex('doc', 0, page, 'TCP', {
      caseSensitive: true,
      wholeWord: false,
    }).map((match) => match.start)).toEqual([0])

    expect(searchPageIndex('doc', 0, page, 'TCP', {
      caseSensitive: false,
      wholeWord: false,
    }).map((match) => match.start)).toEqual([0, 4, 8])
  })

  it('유니코드 문자와 숫자 경계를 기준으로 완전한 단어만 찾는다', () => {
    const page = makePage(['한글 한글판 (한글) café café42 café_끝'])

    expect(searchPageIndex('doc', 0, page, '한글', {
      caseSensitive: true,
      wholeWord: true,
    }).map((match) => match.start)).toEqual([0, 8])

    expect(searchPageIndex('doc', 0, page, 'café', {
      caseSensitive: true,
      wholeWord: true,
    }).map((match) => match.start)).toEqual([12])
  })

  it('조합형이 다른 유니코드도 원문의 범위를 유지해 찾는다', () => {
    const page = makePage(['cafe\u0301 noir'])

    const [match] = searchPageIndex('doc', 0, page, 'café', {
      caseSensitive: true,
      wholeWord: true,
    })

    expect(match).toMatchObject({
      start: 0,
      end: 5,
      quote: 'cafe\u0301',
    })
    expect(match?.rects).toEqual([{ x: 72, y: 100, w: 30, h: 12 }])
  })

  it('겹치는 반복 일치도 빠뜨리지 않는다', () => {
    const page = makePage(['aaaa'])

    expect(searchPageIndex('doc', 0, page, 'aa', {
      caseSensitive: true,
      wholeWord: false,
    }).map(({ start, end }) => [start, end])).toEqual([
      [0, 2],
      [1, 3],
      [2, 4],
    ])
  })

  it('빈 검색어에는 결과를 만들지 않는다', () => {
    const page = makePage(['anything'])

    expect(searchPageIndex('doc', 0, page, '', {
      caseSensitive: false,
      wholeWord: false,
    })).toEqual([])
  })

  it('일치 전후 문맥을 각각 최대 160자로 자른다', () => {
    const before = 'a'.repeat(170)
    const after = 'z'.repeat(170)
    const page = makePage([`${before}needle${after}`])

    const [match] = searchPageIndex('doc', 0, page, 'needle', {
      caseSensitive: true,
      wholeWord: false,
    })

    expect(match?.before).toBe('a'.repeat(160))
    expect(match?.after).toBe('z'.repeat(160))
  })

  it('일치 글자 상자를 줄별 사각형으로 병합하고 면적 없는 상자는 제외한다', () => {
    const page = makePage(['ABCD', 'EFGH'])

    const [match] = searchPageIndex('doc', 2, page, 'CD\r\nEF', {
      caseSensitive: true,
      wholeWord: false,
    })

    expect(match?.rects).toEqual([
      { x: 84, y: 100, w: 12, h: 12 },
      { x: 72, y: 116, w: 12, h: 12 },
    ])
  })

  it('같은 입력은 실행할 때마다 같은 ID와 결과 순서를 만든다', () => {
    const page = makePage(['term term'])
    const options = { caseSensitive: false, wholeWord: true }

    const first = searchPageIndex('doc:id', 9, page, 'term', options)
    const second = searchPageIndex('doc:id', 9, page, 'term', options)

    expect(second).toEqual(first)
    expect(first.map((match) => match.id)).toEqual([
      'doc:id:9:0:4',
      'doc:id:9:5:9',
    ])
  })
})

describe('pdfSearchCacheKey', () => {
  it('문서·검색어·옵션이 같을 때만 같은 키를 만든다', () => {
    const base = pdfSearchCacheKey('doc', 'TCP', {
      caseSensitive: false,
      wholeWord: true,
    })

    expect(pdfSearchCacheKey('doc', 'TCP', {
      wholeWord: true,
      caseSensitive: false,
    })).toBe(base)
    expect(pdfSearchCacheKey('other', 'TCP', {
      caseSensitive: false,
      wholeWord: true,
    })).not.toBe(base)
    expect(pdfSearchCacheKey('doc', 'tcp', {
      caseSensitive: false,
      wholeWord: true,
    })).not.toBe(base)
    expect(pdfSearchCacheKey('doc', 'TCP', {
      caseSensitive: true,
      wholeWord: true,
    })).not.toBe(base)
    expect(pdfSearchCacheKey('doc', 'TCP', {
      caseSensitive: false,
      wholeWord: false,
    })).not.toBe(base)
  })
})

describe('addRecentPdfSearch', () => {
  it('검색어를 정리해 최신순으로 중복 없이 30개까지 보관한다', () => {
    expect(addRecentPdfSearch(
      ['six', 'five', 'four', 'three', 'two', 'one'],
      '  four  ',
    )).toEqual(['four', 'six', 'five', 'three', 'two', 'one'])
    expect(addRecentPdfSearch(['two', 'one'], '   ')).toEqual(['two', 'one'])
    const many = Array.from({ length: 30 }, (_, index) => `q${index}`)
    const added = addRecentPdfSearch(many, 'new')
    expect(added).toHaveLength(30)
    expect(added[0]).toBe('new')
    expect(added.at(-1)).toBe('q28')
  })
})
