import { describe, expect, it } from 'vitest'
import { filterToOpenNotes } from './openNoteFilter'

const highlights = [{ id: 'own' }, { id: 'shared' }, { id: 'other' }, { id: 'none' }, { id: 'draft' }, { id: 'fresh' }]
const owners: Record<string, readonly string[]> = { own: ['A'], 'shared': ['A', 'Z'], other: ['Z'] }
const base = { enabled: true, tabPaths: ['A'], notesOf: (id: string) => owners[id] ?? [] }
const ids = (list: readonly { id: string }[]) => list.map((item) => item.id)

describe('filterToOpenNotes — 열린 노트 표시만 보기', () => {
  it('꺼져 있으면 모두 그대로(같은 배열)', () => {
    expect(filterToOpenNotes(highlights, { ...base, enabled: false })).toBe(highlights)
  })

  it('열린 노트에 속한 것만 남긴다(닫힌 노트와 함께 있어도)', () => {
    expect(ids(filterToOpenNotes(highlights, base))).toEqual(['own', 'shared'])
  })

  it('닫힌 노트의 것과 어느 노트에도 없는 것은 감춘다', () => {
    const result = ids(filterToOpenNotes(highlights, base))
    expect(result).not.toContain('other')
    expect(result).not.toContain('none')
  })

  it('열린 노트가 없으면 예외 말고는 모두 감춘다', () => {
    expect(filterToOpenNotes(highlights, { ...base, tabPaths: [] })).toEqual([])
  })

  it('만드는 중인 메모·방금 만든 형광펜은 노트에 없어도 늘 보인다', () => {
    const result = filterToOpenNotes(highlights, { ...base, isExempt: (id) => id === 'draft' || id === 'fresh' })
    expect(ids(result)).toEqual(['own', 'shared', 'draft', 'fresh'])
  })

  it('표시 모두 감추기가 이긴다: 예외도 감춘 채로', () => {
    expect(filterToOpenNotes(highlights, { ...base, clean: true, isExempt: () => true })).toEqual([])
    expect(filterToOpenNotes(highlights, { ...base, enabled: false, clean: true })).toEqual([])
  })

  it('열린 노트 = 같은 색 창에 보이는 노트 탭뿐이다(노트 바의 열린 노트는 더하지 않는다)', () => {
    const result = filterToOpenNotes([{ id: 'in-channel' }, { id: 'elsewhere' }], { enabled: true, tabPaths: ['노트/채널.iwnote'], notesOf: (id) => (id === 'in-channel' ? ['노트/채널.iwnote'] : ['노트/딴곳.iwnote']) })
    expect(result.map((item) => item.id)).toEqual(['in-channel'])
  })

  it('원본 배열을 고치지 않는다', () => {
    const before = [...highlights]
    filterToOpenNotes(highlights, base)
    expect(highlights).toEqual(before)
  })
})
