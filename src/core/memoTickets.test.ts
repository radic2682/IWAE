import { describe, expect, it } from 'vitest'
import type { MemoNote, MemoNoteBlock } from './memoNote'
import { buildTicketIndex, syncTicketEdit, ticketChoices, ticketGroupOf, ticketKey } from './memoTickets'

const memo = (id: string, highlightId: string, ticket?: { id?: string; title?: string }): MemoNoteBlock => ({ id, kind: 'memo', highlightId, ...(ticket === undefined ? {} : { ticket }) })
const note = (...blocks: MemoNoteBlock[]): MemoNote => ({ version: 1, blocks })
const notes = (entries: Record<string, MemoNote>) => new Map(Object.entries(entries))

describe('티켓 모아 보기', () => {
  it('같은 ID 의 자리를 노트 가로질러 모으고 소제목·차례를 적는다', () => {
    const index = buildTicketIndex(notes({
      '노트/A.iwnote': note({ id: 's1', kind: 'section', title: '1장' }, memo('b1', 'h1', { id: 'REQ-01', title: '로그인' })),
      '노트/B.iwnote': note(memo('b2', 'h1', { id: 'req-01', title: '로그인' }), memo('b3', 'h2', { title: '제목만' })),
    }))
    const group = ticketGroupOf(index, 'REQ-01')!
    expect(group.places.map((place) => [place.path, place.index, place.section])).toEqual([['노트/A.iwnote', 1, '1장'], ['노트/B.iwnote', 0, null]])
    expect(group.conflict).toBe(false)
    // 제목만 있는 블록은 모으지 않는다
    expect(index.groups.size).toBe(1)
  })

  it('같은 ID 인데 형광펜이 다르면 충돌이다', () => {
    const index = buildTicketIndex(notes({ a: note(memo('b1', 'h1', { id: 'REQ-01' })), b: note(memo('b2', 'h2', { id: 'REQ-01' })) }))
    const group = ticketGroupOf(index, 'REQ-01')!
    expect(group.conflict).toBe(true)
    expect(group.highlightIds).toEqual(['h1', 'h2'])
    expect(ticketChoices(index).map((choice) => choice.highlightId)).toEqual(['h1', 'h2'])
  })

  it('고르기 목록은 ID 를 숫자 차례로 놓는다', () => {
    const index = buildTicketIndex(notes({ a: note(memo('b1', 'h1', { id: 'REQ-10' }), memo('b2', 'h2', { id: 'REQ-2' })) }))
    expect(ticketChoices(index).map((choice) => choice.id)).toEqual(['REQ-2', 'REQ-10'])
    expect(ticketKey(' Req-2 ')).toBe('req-2')
  })
})

describe('티켓 고침 맞추기', () => {
  const base = notes({
    a: note(memo('b1', 'h1', { id: 'REQ-01', title: '옛 제목' }), memo('b9', 'h9', { id: 'REQ-09' })),
    b: note(memo('b2', 'h1', { id: 'REQ-01', title: '옛 제목' })),
    c: note(memo('b3', 'h2', { id: 'REQ-01', title: '다른 메모' }), memo('b4', 'h1')),
  })

  it('제목을 바꾸면 같은 ID·같은 형광펜의 블록 모두가 바뀐다', () => {
    const changed = syncTicketEdit(base, 'a', 'b1', { id: 'REQ-01', title: '새 제목' })
    expect([...changed.keys()].sort()).toEqual(['a', 'b'])
    expect(changed.get('a')!.blocks[0]).toMatchObject({ ticket: { id: 'REQ-01', title: '새 제목' } })
    expect(changed.get('b')!.blocks[0]).toMatchObject({ ticket: { id: 'REQ-01', title: '새 제목' } })
    // 다른 형광펜(충돌)과 ID 없는 블록은 그대로
    expect(changed.has('c')).toBe(false)
  })

  it('ID 를 바꾸면 짝들의 ID 도 같이 바뀐다', () => {
    const changed = syncTicketEdit(base, 'b', 'b2', { id: 'REQ-05', title: '옛 제목' })
    expect(changed.get('a')!.blocks[0]).toMatchObject({ ticket: { id: 'REQ-05' } })
    expect(changed.get('a')!.blocks[1]).toBe(base.get('a')!.blocks[1])
  })

  it('ID·제목을 지우면 짝들도 그냥 메모로 돌아간다', () => {
    const changed = syncTicketEdit(base, 'a', 'b1', null)
    expect(changed.get('b')!.blocks[0]).not.toHaveProperty('ticket')
    expect(changed.get('a')!.blocks[0]).not.toHaveProperty('ticket')
  })

  it('처음 ID 를 붙일 때는 그 블록만 바뀐다', () => {
    const changed = syncTicketEdit(base, 'c', 'b4', { id: 'REQ-07' })
    expect([...changed.keys()]).toEqual(['c'])
  })

  it('바뀐 것이 없으면 빈 맵', () => {
    expect(syncTicketEdit(base, 'a', 'b1', { id: 'REQ-01', title: '옛 제목' }).size).toBe(0)
    expect(syncTicketEdit(base, 'a', 'nope', { id: 'X-1' }).size).toBe(0)
  })
})
