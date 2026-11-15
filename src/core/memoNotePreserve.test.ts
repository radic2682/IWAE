import { describe, expect, it } from 'vitest'
import { inspectMemoNoteShape, parseMemoNote, serializeMemoNote, updateSection, updateTextBlock } from './memoNote'

const written = (note: ReturnType<typeof parseMemoNote>) => JSON.parse(serializeMemoNote(note)) as { version: number; blocks: Record<string, unknown>[]; [key: string]: unknown }

describe('memo note: data written by a newer version is not dropped', () => {
  it('keeps blocks of an unknown kind where they were, and unknown fields on blocks and on the note', () => {
    const raw = {
      version: 1,
      theme: 'dark',
      blocks: [
        { id: 'a', kind: 'text', text: 'first', color: 'red' },
        { id: 'img1', kind: 'image', src: 'x.png' },
        { id: 'b', kind: 'memo', highlightId: 'h1', pinned: true },
        { id: 's', kind: 'section', title: 'S', icon: 'star' },
      ],
    }
    const note = parseMemoNote(raw)
    expect(note.blocks.map((block) => block.id)).toEqual(['a', 'b', 's'])
    const out = written(note)
    expect(out.theme).toBe('dark')
    expect(out.blocks).toEqual(raw.blocks)
  })

  it('still carries them after the user edits the text and the section', () => {
    const note = parseMemoNote({
      version: 1,
      blocks: [{ id: 'a', kind: 'text', text: 'first', color: 'red' }, { id: 'x', kind: 'future' }, { id: 's', kind: 'section', title: 'S', icon: 'star' }],
    })
    const edited = updateSection(updateTextBlock(note, 'a', 'changed', ''), 's', { title: 'T' })
    const out = written(edited)
    expect(out.blocks).toEqual([
      { id: 'a', kind: 'text', text: 'changed', color: 'red' },
      { id: 'x', kind: 'future' },
      { id: 's', kind: 'section', title: 'T', icon: 'star' },
    ])
  })

  it('appends an unknown block whose neighbour was deleted instead of losing it', () => {
    const note = parseMemoNote({ version: 1, blocks: [{ id: 'a', kind: 'text', text: 'a' }, { id: 'x', kind: 'future' }] })
    const out = written({ ...note, blocks: [] })
    expect(out.blocks).toEqual([{ id: 'x', kind: 'future' }])
  })

  it('tells a note it cannot safely edit apart from a normal one', () => {
    expect(inspectMemoNoteShape({ version: 1, blocks: [] })).toBe('ok')
    expect(inspectMemoNoteShape({ version: 2, blocks: [] })).toBe('newer')
    expect(inspectMemoNoteShape({ version: 1, blocks: { a: 1 } })).toBe('unrecognized')
    expect(inspectMemoNoteShape(null)).toBe('unrecognized')
  })
})
