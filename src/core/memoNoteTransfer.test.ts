import { describe, expect, it } from 'vitest'
import {
  carriedBlocks,
  linkBlocksInto,
  memoHighlightIds,
  moveBlocksBetweenNotes,
  removeBlocksById,
  snapBeforeId,
  type MemoNote,
  type MemoNoteBlock,
} from './memoNote'

const memo = (id: string, highlightId: string, extra: Partial<Extract<MemoNoteBlock, { kind: 'memo' }>> = {}): MemoNoteBlock => ({ id, kind: 'memo', highlightId, ...extra })
const text = (id: string, body = id): MemoNoteBlock => ({ id, kind: 'text', text: body, html: `<p>${body}</p>` })
const section = (id: string): MemoNoteBlock => ({ id, kind: 'section', title: id })
const note = (...blocks: MemoNoteBlock[]): MemoNote => ({ version: 1, blocks })
const ids = (value: MemoNote) => value.blocks.map((block) => block.id)

describe('carriedBlocks', () => {
  it('keeps document order and expands a section to its group once', () => {
    const source = note(memo('a', 'h1'), section('s'), text('t'), memo('m', 'h2'), section('s2'), text('u'))
    expect(carriedBlocks(source, ['m', 's', 't']).map((block) => block.id)).toEqual(['s', 't', 'm'])
    expect(carriedBlocks(source, ['zzz'])).toEqual([])
  })
})

describe('snapBeforeId', () => {
  const target = note(memo('a', 'h1'), section('s'), text('t'), section('s2'))
  it('moves a section drop to the next section start, or the end', () => {
    expect(snapBeforeId(target, 't', true)).toBe('s2')
    expect(snapBeforeId(target, 's2', true)).toBe('s2')
    expect(snapBeforeId(target, 'a', true)).toBe('s')
    expect(snapBeforeId(note(memo('a', 'h1'), text('t')), 't', true)).toBeNull()
  })
  it('leaves ordinary drops alone', () => {
    expect(snapBeforeId(target, 't', false)).toBe('t')
    expect(snapBeforeId(target, null, true)).toBeNull()
  })
})

describe('moveBlocksBetweenNotes', () => {
  it('inserts before the anchor and reports the ids to remove from the source', () => {
    const source = note(memo('a', 'h1'), text('b'))
    const target = note(text('x'), text('y'))
    const result = moveBlocksBetweenNotes(source, target, ['a'], 'y')
    expect(ids(result.target)).toEqual(['x', 'a', 'y'])
    expect(result.movedIds).toEqual(['a'])
    expect(ids(removeBlocksById(source, result.movedIds))).toEqual(['b'])
  })
  it('appends at the end when there is no anchor', () => {
    const result = moveBlocksBetweenNotes(note(text('b')), note(text('x')), ['b'], null)
    expect(ids(result.target)).toEqual(['x', 'b'])
  })
  it('moves a section with its group, snapped to a section boundary', () => {
    const source = note(section('s'), text('t'), section('s2'), text('after'))
    const target = note(section('p'), text('q'), section('r'), text('z'))
    const result = moveBlocksBetweenNotes(source, target, ['s'], 'q', true)
    expect(ids(result.target)).toEqual(['p', 'q', 's', 't', 'r', 'z'])
    expect(result.movedIds).toEqual(['s', 't'])
  })
  it('leaves a memo in the source when the target already has its highlight', () => {
    const source = note(memo('a', 'h1'), memo('b', 'h2'))
    const target = note(memo('x', 'h1'))
    const result = moveBlocksBetweenNotes(source, target, ['a', 'b'], null)
    expect(result.skipped).toBe(1)
    expect(result.movedIds).toEqual(['b'])
    expect(ids(result.target)).toEqual(['x', 'b'])
  })
  it('treats refs as references too', () => {
    const target = note(memo('x', 'h1'))
    const result = moveBlocksBetweenNotes(note(memo('a', 'h9', { refs: ['h1'] })), target, ['a'], null)
    expect(result.skipped).toBe(1)
    expect(result.movedIds).toEqual([])
    expect(result.target).toBe(target)
  })
})

describe('linkBlocksInto', () => {
  it('makes new memo blocks for the same highlights and copies the ticket', () => {
    const source = note(memo('a', 'h1', { ticket: { id: 'REQ-1', title: 'T' }, refs: ['h2'] }))
    const result = linkBlocksInto(source, note(text('x')), ['a'], null)
    const [added] = result.added
    expect(added).toBeDefined()
    expect(added!.id).not.toBe('a')
    expect(memoHighlightIds(added!)).toEqual(['h1', 'h2'])
    expect(added).toMatchObject({ kind: 'memo', ticket: { id: 'REQ-1', title: 'T' } })
    expect(ids(result.target)).toEqual(['x', added!.id])
  })
  it('copies text and sections with new ids and never links a highlight twice', () => {
    const source = note(section('s'), text('t', 'hello'), memo('a', 'h1'))
    const target = note(memo('x', 'h1'))
    const result = linkBlocksInto(source, target, ['s', 'a'], null)
    expect(result.skipped).toBe(1)
    expect(result.added.map((block) => block.kind)).toEqual(['section', 'text'])
    expect(result.added.some((block) => ['s', 't'].includes(block.id))).toBe(false)
    expect(result.added[1]).toMatchObject({ kind: 'text', text: 'hello', html: '<p>hello</p>' })
  })
  it('returns the same target object when nothing is added', () => {
    const target = note(memo('x', 'h1'))
    expect(linkBlocksInto(note(memo('a', 'h1')), target, ['a'], null).target).toBe(target)
  })
})
