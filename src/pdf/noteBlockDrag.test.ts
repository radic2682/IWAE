// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MemoNote, MemoNoteBlock } from '../core/memoNote'
import type { MemoNoteApi } from './memoNoteContext'
import { dropBeforeIdAt, transferBlocks, type NoteDropTarget } from './noteBlockDrag'

const memo = (id: string, highlightId: string): MemoNoteBlock => ({ id, kind: 'memo', highlightId })
const text = (id: string): MemoNoteBlock => ({ id, kind: 'text', text: id })
const note = (...blocks: MemoNoteBlock[]): MemoNote => ({ version: 1, blocks })

function fakeApi(initial: Record<string, MemoNote>, failTarget = false) {
  const notes = new Map(Object.entries(initial))
  const api = {
    noteAt: (path: string) => notes.get(path) ?? null,
    updateNoteAt: vi.fn((path: string, change: (current: MemoNote) => MemoNote) => {
      const current = notes.get(path)
      if (current === undefined || (failTarget && path === 'T')) return
      notes.set(path, change(current))
    }),
    openInTab: vi.fn(),
    open: vi.fn(),
    openPath: null,
  } as unknown as MemoNoteApi
  return { api, notes }
}

const target = (path: string, kind: 'tab' | 'body' = 'tab'): NoteDropTarget => (
  kind === 'tab'
    ? { kind: 'tab', path, pill: document.createElement('div') }
    : { kind: 'body', path, scroller: document.createElement('div'), card: document.createElement('div') }
)

afterEach(() => { document.body.innerHTML = '' })

describe('dropBeforeIdAt', () => {
  it('picks the first card whose midpoint is below the pointer, skipping the draft', () => {
    const scroller = document.createElement('div')
    const tops = { draft: 0, a: 0, b: 100 }
    for (const [id, top] of Object.entries(tops)) {
      const card = document.createElement('div')
      card.dataset.noteBlock = id
      card.getBoundingClientRect = () => ({ top, height: 80, bottom: top + 80, left: 0, right: 10, width: 10, x: 0, y: top, toJSON: () => ({}) })
      scroller.append(card)
    }
    expect(dropBeforeIdAt(scroller, 10)).toBe('a')
    expect(dropBeforeIdAt(scroller, 60)).toBe('b')
    expect(dropBeforeIdAt(scroller, 500)).toBeNull()
  })
})

describe('transferBlocks', () => {
  it('moves into the target and removes from the source', () => {
    const { api, notes } = fakeApi({ S: note(memo('a', 'h1'), text('b')), T: note(text('x')) })
    const added = transferBlocks({ api, sourcePath: 'S', target: target('T'), keys: ['a'], beforeId: null, link: false, snapSection: false })
    expect(added).toEqual(['a'])
    expect(notes.get('T')!.blocks.map((block) => block.id)).toEqual(['x', 'a'])
    expect(notes.get('S')!.blocks.map((block) => block.id)).toEqual(['b'])
    // 탭 위에 놓은 것은 그 노트를 열지 않는다
    expect((api.openInTab as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })
  it('link leaves the source alone and adds a new block', () => {
    const { api, notes } = fakeApi({ S: note(memo('a', 'h1')), T: note() })
    const added = transferBlocks({ api, sourcePath: 'S', target: target('T', 'body'), keys: ['a'], beforeId: null, link: true, snapSection: false })
    expect(added).toHaveLength(1)
    expect(added[0]).not.toBe('a')
    expect(notes.get('S')!.blocks.map((block) => block.id)).toEqual(['a'])
    expect(notes.get('T')!.blocks[0]).toMatchObject({ kind: 'memo', highlightId: 'h1' })
    // 보이는 노트에 놓으면 그 블록으로 간다
    expect((api.openInTab as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('T')
  })
  it('does not touch the source when the target write fails', () => {
    const { api, notes } = fakeApi({ S: note(text('a')), T: note() }, true)
    const events: string[] = []
    const listen = (event: Event) => events.push((event as CustomEvent<string>).detail)
    window.addEventListener('iwae:action-feedback', listen)
    expect(transferBlocks({ api, sourcePath: 'S', target: target('T'), keys: ['a'], beforeId: null, link: false, snapSection: false })).toEqual([])
    window.removeEventListener('iwae:action-feedback', listen)
    expect(notes.get('S')!.blocks.map((block) => block.id)).toEqual(['a'])
    expect(events).toHaveLength(1)
  })
  it('announces and keeps the source when the target already has the memo', () => {
    const { api, notes } = fakeApi({ S: note(memo('a', 'h1')), T: note(memo('x', 'h1')) })
    const events: string[] = []
    const listen = (event: Event) => events.push((event as CustomEvent<string>).detail)
    window.addEventListener('iwae:action-feedback', listen)
    expect(transferBlocks({ api, sourcePath: 'S', target: target('T'), keys: ['a'], beforeId: null, link: false, snapSection: false })).toEqual([])
    window.removeEventListener('iwae:action-feedback', listen)
    expect(events).toHaveLength(1)
    expect(notes.get('S')!.blocks).toHaveLength(1)
    expect(notes.get('T')!.blocks).toHaveLength(1)
  })
  it('writes the target first, then the source', () => {
    // 쓰는 차례: 받는 노트가 먼저, 원래 노트가 나중
    const notes = new Map<string, MemoNote>([['S', note(text('a'))], ['T', note()]])
    const calls: string[] = []
    const api = {
      noteAt: (path: string) => notes.get(path) ?? null,
      updateNoteAt: (path: string, change: (current: MemoNote) => MemoNote) => { calls.push(path); notes.set(path, change(notes.get(path)!)) },
      openInTab: vi.fn(),
      open: vi.fn(),
      openPath: null,
    } as unknown as MemoNoteApi
    transferBlocks({ api, sourcePath: 'S', target: target('T'), keys: ['a'], beforeId: null, link: false, snapSection: false })
    expect(calls).toEqual(['T', 'S'])
  })
})
