import { describe, expect, it } from 'vitest'
import { findCaption, findOutlineSection, findSectionHeading, parseGoto, resolveGoto, scanOrder } from './pdfGoto'

describe('parseGoto', () => {
  it.each([
    ['81', { kind: 'page', page: 81 }],
    ['p.81', { kind: 'page', page: 81 }],
    ['81쪽', { kind: 'page', page: 81 }],
    ['5.1.9.3', { kind: 'section', number: '5.1.9.3' }],
    ['§13.7', { kind: 'section', number: '13.7' }],
    ['Section 5.1', { kind: 'section', number: '5.1' }],
    ['A.2', { kind: 'section', number: 'A.2' }],
    ['Table 52', { kind: 'caption', label: 'Table', number: '52' }],
    ['표 2-14', { kind: 'caption', label: 'Table', number: '2-14' }],
    ['fig. 6-3', { kind: 'caption', label: 'Figure', number: '6-3' }],
    ['그림 76', { kind: 'caption', label: 'Figure', number: '76' }],
  ])('%s', (input, expected) => {
    expect(parseGoto(input)).toEqual(expected)
  })

  it('알 수 없는 입력은 null', () => {
    expect(parseGoto('')).toBeNull()
    expect(parseGoto('reset 조건')).toBeNull()
  })
})

describe('찾기', () => {
  const toc = 'Contents\nTable 52 – Retry Policy Options ........ 189\n5.1.9.3 Retry Policy Options ......... 189\n'
  const body = 'The RETRY header (see Table 52) is used.\nTable 52 – Retry Policy Value Codes\n5.1.9.3 Retry Policy Options (RETRY)\nbody'

  it('표 제목은 본문 언급·목차 줄이 아니라 캡션을 찾는다', () => {
    expect(findCaption(toc, 'Table', '52')).toBeNull()
    const range = findCaption(body, 'Table', '52')!
    expect(body.slice(range[0], range[1])).toBe('Table 52')
    expect(range[0]).toBe(body.indexOf('Table 52 –'))
  })

  it('번호가 이어지는 다른 표(Table 520, 52-1)와 헷갈리지 않는다', () => {
    expect(findCaption('Table 520 – Other', 'Table', '52')).toBeNull()
    expect(findCaption('Table 52-1 – Other', 'Table', '52')).toBeNull()
  })

  it('구분 기호 없이 줄 번호 뒤에 오는 캡션도 찾는다(줄 번호가 붙은 형식)', () => {
    const numbered = ['Byte 0x02).', '3590 Table 52 Retry Policy Value Codes (RETRY) ', 'Command'].join('\r\n')
    const range = findCaption(numbered, 'Table', '52')!
    expect(numbered.slice(range[0], range[1])).toBe('Table 52')
    expect(findCaption('as shown in Table 52 Retry', 'Table', '52')).toBeNull()
  })

  it('절 제목 줄을 찾고 목차 줄은 건너뛴다', () => {
    expect(findSectionHeading(toc, '5.1.9.3')).toBeNull()
    const range = findSectionHeading(body, '5.1.9.3')!
    expect(body.slice(range[0], range[1])).toBe('5.1.9.3 Retry Policy Options (RETRY)')
  })

  it('목차 항목으로 절의 쪽을 찾는다', () => {
    const outline = [{ title: '5.1.9 Headers', page: 180 }, { title: '5.1.9.3 Retry Policy Options', page: 188 }, { title: '5.1.9.30', page: 200 }]
    expect(findOutlineSection(outline, '5.1.9.3')).toBe(188)
  })

  it('resolveGoto 는 목차가 없으면 앞에서부터 쪽 글자를 읽는다', async () => {
    const pages = [toc, 'intro', body]
    const hit = await resolveGoto({ kind: 'caption', label: 'Table', number: '52' }, {
      pageCount: pages.length,
      outline: async () => [],
      pageText: async (index) => pages[index] ?? '',
    })
    expect(hit?.pageIndex).toBe(2)
  })
})

describe('scanOrder', () => {
  it('가까운 쪽부터 바깥으로 읽는다', () => {
    expect(scanOrder(6, 2)).toEqual([2, 3, 1, 4, 0, 5])
    expect(scanOrder(3)).toEqual([0, 1, 2])
  })
})
