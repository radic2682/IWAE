import { describe, expect, it } from 'vitest'
import { addRecentPdf, parseRecentPdfs, recentPdfDate, removeRecentPdf } from './recentPdfs'

describe('recentPdfs', () => {
  it('새로 연 것이 앞, 같은 경로(대소문자·구분자 무시)는 하나만', () => {
    const a = { path: 'C:\\Docs\\A.pdf', title: 'A', openedAt: '2026-10-15T01:00:00Z' }
    const list = addRecentPdf(addRecentPdf([], a), { path: 'c:/docs/a.pdf', title: 'A', openedAt: '2026-10-16T01:00:00Z' })
    expect(list).toHaveLength(1)
    expect(list[0]?.openedAt).toBe('2026-10-16T01:00:00Z')
    expect(removeRecentPdf(list, 'C:\\Docs\\A.pdf')).toEqual([])
    expect(parseRecentPdfs([{ path: 1 }, a])).toEqual([a])
  })

  it('날짜는 오늘이면 시:분, 올해면 월.일', () => {
    const now = new Date(2026, 9, 16, 12, 0)
    expect(recentPdfDate(new Date(2026, 9, 16, 9, 5).toISOString(), now)).toBe('09:05')
    expect(recentPdfDate(new Date(2026, 8, 3).toISOString(), now)).toBe('9.3')
    expect(recentPdfDate(new Date(2025, 0, 2).toISOString(), now)).toBe('2025.1.2')
  })
})
