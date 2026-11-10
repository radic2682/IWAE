import { describe, expect, it } from 'vitest'
import { applySnapshotChange, mergeJsonText, mergeValue } from './jsonMerge'

const file = (items: object[]) => `${JSON.stringify({ version: 1, highlights: items }, null, 2)}\n`
const ids = (text: string | null) => (JSON.parse(text ?? '{}') as { highlights: { id: string }[] }).highlights.map((item) => item.id)

describe('mergeJsonText', () => {
  it('keeps both sides additions to an id list', () => {
    const base = file([{ id: 'a' }])
    const merged = mergeJsonText(base, file([{ id: 'a' }, { id: 'local' }]), file([{ id: 'a' }, { id: 'remote' }]))
    expect(ids(merged).sort()).toEqual(['a', 'local', 'remote'])
  })

  it('applies a local delete without dropping a remote addition', () => {
    const base = file([{ id: 'a' }, { id: 'b' }])
    const merged = mergeJsonText(base, file([{ id: 'b' }]), file([{ id: 'a' }, { id: 'b' }, { id: 'c' }]))
    expect(ids(merged).sort()).toEqual(['b', 'c'])
  })

  it('keeps an item one side deleted when the other side edited it', () => {
    const base = file([{ id: 'a', memo: 'old' }])
    const merged = mergeJsonText(base, file([]), file([{ id: 'a', memo: 'edited' }]))
    expect(JSON.parse(merged!).highlights).toEqual([{ id: 'a', memo: 'edited' }])
  })

  it('merges edits to different fields of the same item', () => {
    const base = file([{ id: 'a', color: 'y', memo: '' }])
    const merged = mergeJsonText(base, file([{ id: 'a', color: 'r', memo: '' }]), file([{ id: 'a', color: 'y', memo: 'note' }]))
    expect(JSON.parse(merged!).highlights).toEqual([{ id: 'a', color: 'r', memo: 'note' }])
  })

  it('lets the writing side win when both edit the same field', () => {
    const base = file([{ id: 'a', memo: '' }])
    const merged = mergeJsonText(base, file([{ id: 'a', memo: 'mine' }]), file([{ id: 'a', memo: 'theirs' }]))
    expect(JSON.parse(merged!).highlights[0].memo).toBe('mine')
  })

  it('merges records by key', () => {
    const wrap = (documents: object) => `${JSON.stringify({ version: 1, documents }, null, 2)}\n`
    const merged = mergeJsonText(wrap({ a: { n: 1 } }), wrap({ a: { n: 1 }, local: { n: 2 } }), wrap({ a: { n: 1 }, remote: { n: 3 } }))
    expect(Object.keys(JSON.parse(merged!).documents).sort()).toEqual(['a', 'local', 'remote'])
  })

  it('treats a missing base as empty', () => {
    const merged = mergeJsonText(null, file([{ id: 'l' }]), file([{ id: 'r' }]))
    expect(ids(merged).sort()).toEqual(['l', 'r'])
  })

  it('unions object arrays without ids like sets', () => {
    const wrap = (entries: object[]) => `${JSON.stringify({ entries })}`
    const merged = mergeJsonText(wrap([{ s: 'x' }]), wrap([{ s: 'x' }, { s: 'l' }]), wrap([{ s: 'x' }, { s: 'r' }]))
    expect(JSON.parse(merged!).entries.map((entry: { s: string }) => entry.s).sort()).toEqual(['l', 'r', 'x'])
  })

  it('returns null when a side is not JSON', () => {
    expect(mergeJsonText('{}', '{"a":1}', 'not json')).toBeNull()
  })

  it('keeps the local format', () => {
    const merged = mergeJsonText(file([]), file([{ id: 'l' }]), file([{ id: 'r' }]))!
    expect(merged.endsWith('}\n')).toBe(true)
    expect(merged).toContain('\n  "version"')
  })

  it('takes the other side when only one side changed', () => {
    expect(mergeValue({ a: 1 }, { a: 1 }, { a: 2 })).toEqual({ a: 2 })
  })
})

describe('applySnapshotChange (undo / redo as a merge)', () => {
  type Item = { id: string; memo?: string }
  const ids = (items: Item[]) => items.map((item) => item.id).sort()
  const undo = (before: Item[], after: Item[], current: Item[]) => applySnapshotChange(after, before, current)
  const redo = (before: Item[], after: Item[], current: Item[]) => applySnapshotChange(before, after, current)

  it('undo after a remote add keeps the remote item and removes only the local add', () => {
    const before: Item[] = [{ id: 'a' }]
    const after: Item[] = [{ id: 'a' }, { id: 'local' }]
    const current: Item[] = [{ id: 'a' }, { id: 'local' }, { id: 'remote' }]
    expect(ids(undo(before, after, current))).toEqual(['a', 'remote'])
  })

  it('undo of a local delete restores it even if another item was added remotely', () => {
    const before: Item[] = [{ id: 'a' }, { id: 'b' }]
    const after: Item[] = [{ id: 'a' }]
    const current: Item[] = [{ id: 'a' }, { id: 'remote' }]
    expect(ids(undo(before, after, current))).toEqual(['a', 'b', 'remote'])
  })

  it('undo of a local edit reverts only that edit', () => {
    const before: Item[] = [{ id: 'a', memo: 'old' }]
    const after: Item[] = [{ id: 'a', memo: 'new' }]
    const current: Item[] = [{ id: 'a', memo: 'new' }, { id: 'remote' }]
    expect(undo(before, after, current)).toEqual([{ id: 'a', memo: 'old' }, { id: 'remote' }])
  })

  it('redo is symmetric: it re-applies the action and keeps remote additions', () => {
    const before: Item[] = [{ id: 'a' }]
    const after: Item[] = [{ id: 'a' }, { id: 'local' }]
    const undone = undo(before, after, [{ id: 'a' }, { id: 'local' }, { id: 'remote' }])
    expect(ids(redo(before, after, undone))).toEqual(['a', 'local', 'remote'])
    const afterDelete: Item[] = [{ id: 'a' }]
    expect(ids(redo([{ id: 'a' }, { id: 'b' }], afterDelete, [{ id: 'a' }, { id: 'b' }, { id: 'remote' }]))).toEqual(['a', 'remote'])
  })

  it('works without remote changes', () => {
    expect(undo([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }])).toEqual([{ id: 'a' }])
  })
})
