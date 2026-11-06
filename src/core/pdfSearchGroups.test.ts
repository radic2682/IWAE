import { describe, expect, it } from 'vitest'
import type { PdfSearchMatch } from './pdfSearch'
import { cleanSnippet, groupSearchMatches, isTocHit } from './pdfSearchGroups'

function hit(page: number, before: string, quote: string, after: string): PdfSearchMatch {
  return { id: `d:${page}:${before.length}:${quote}`, docId: 'd', page, start: 0, end: 0, quote, before, after, rects: [] }
}

describe('pdfSearchGroups', () => {
  it('목차 줄(점선)에서 찾은 것을 알아본다', () => {
    expect(isTocHit(hit(3, '3.3.1 HTTP ', 'Keep-Alive', ' (KA) Request..................64'))).toBe(true)
    expect(isTocHit(hit(63, 'If the client sends a matching connection ID with the ', 'Keep-Alive', ' ID, then the response'))).toBe(false)
  })

  it('앞 글은 낱말 경계에서 짧게, 글머리표와 점선은 걷어 내고 찾은 낱말 옆 띄어쓰기는 둔다', () => {
    const snippet = cleanSnippet('ecific Settings and Internal Build Cache ■ ', ' Configuration.......242 4.3')
    expect(snippet.before).toBe('Settings and Internal Build Cache ')
    expect(snippet.after).toBe(' Configuration … 242')
    expect(cleanSnippet('', ' rest of it').after).toBe(' rest of')
    // 앞 글이 길면 낱말 경계에서 자르고 「…」를 붙인다
    const long = cleanSnippet(`${'word '.repeat(30)}`, '')
    expect(long.before.startsWith('…word')).toBe(true)
    expect(long.before.length).toBeLessThanOrEqual(74)
  })

  it('절별로 묶고 목차 줄은 맨 아래 한 묶음으로 모은다', () => {
    const outline = [
      { title: 'Contents', page: 2, depth: 0 },
      { title: '3 Connection Management', page: 54, depth: 0 },
      { title: '3.3.1 HTTP Keep-Alive (KA) Request', page: 63, depth: 2 },
      { title: '3.3.2 HTTP Upgrade Request', page: 64, depth: 2 },
    ]
    const groups = groupSearchMatches([
      hit(3, '3.3.1 HTTP ', 'Keep-Alive', ' (KA) Request........64'),
      hit(63, 'the ', 'Keep-Alive', ' request is'),
      hit(63, 'rejected ', 'Keep-Alive', ' requests'),
      hit(65, 'a ', 'Keep-Alive', ' from'),
      hit(0, 'cover ', 'Keep-Alive', ' x'),
    ], outline)
    expect(groups.map((group) => [group.title, group.items.map((item) => item.index)])).toEqual([
      ['3.3.1 HTTP Keep-Alive (KA) Request', [1, 2]],
      ['3.3.2 HTTP Upgrade Request', [3]],
      [null, [4]],
      ['목차·색인', [0]],
    ])
    expect(groups.at(-1)?.toc).toBe(true)
  })
})
