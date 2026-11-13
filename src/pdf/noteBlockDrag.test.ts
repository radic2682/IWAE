// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MemoNote, MemoNoteBlock } from '../core/memoNote'
import type { MemoNoteApi } from './memoNoteContext'
import { createBlockGhost, ghostTextOf, dropBeforeIdAt, startBlockDragSession, transferBlocks, type NoteDropTarget } from './noteBlockDrag'

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
  it('moves into the target and removes from the source', async () => {
    const { api, notes } = fakeApi({ S: note(memo('a', 'h1'), text('b')), T: note(text('x')) })
    const added = await transferBlocks({ api, sourcePath: 'S', target: target('T'), keys: ['a'], beforeId: null, link: false, snapSection: false })
    expect(added).toEqual(['a'])
    expect(notes.get('T')!.blocks.map((block) => block.id)).toEqual(['x', 'a'])
    expect(notes.get('S')!.blocks.map((block) => block.id)).toEqual(['b'])
    // 탭 위에 놓은 것은 그 노트를 열지 않는다
    expect((api.openInTab as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })
  it('link leaves the source alone and adds a new block', async () => {
    const { api, notes } = fakeApi({ S: note(memo('a', 'h1')), T: note() })
    const added = await transferBlocks({ api, sourcePath: 'S', target: target('T', 'body'), keys: ['a'], beforeId: null, link: true, snapSection: false })
    expect(added).toHaveLength(1)
    expect(added[0]).not.toBe('a')
    expect(notes.get('S')!.blocks.map((block) => block.id)).toEqual(['a'])
    expect(notes.get('T')!.blocks[0]).toMatchObject({ kind: 'memo', highlightId: 'h1' })
    // 보이는 노트에 놓으면 그 블록으로 간다
    expect((api.openInTab as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('T')
  })
  it('does not touch the source when the target write fails', async () => {
    const { api, notes } = fakeApi({ S: note(text('a')), T: note() }, true)
    const events: string[] = []
    const listen = (event: Event) => events.push((event as CustomEvent<string>).detail)
    window.addEventListener('iwae:action-feedback', listen)
    expect(await transferBlocks({ api, sourcePath: 'S', target: target('T'), keys: ['a'], beforeId: null, link: false, snapSection: false })).toEqual([])
    window.removeEventListener('iwae:action-feedback', listen)
    expect(notes.get('S')!.blocks.map((block) => block.id)).toEqual(['a'])
    expect(events).toHaveLength(1)
  })
  it('announces and keeps the source when the target already has the memo', async () => {
    const { api, notes } = fakeApi({ S: note(memo('a', 'h1')), T: note(memo('x', 'h1')) })
    const events: string[] = []
    const listen = (event: Event) => events.push((event as CustomEvent<string>).detail)
    window.addEventListener('iwae:action-feedback', listen)
    expect(await transferBlocks({ api, sourcePath: 'S', target: target('T'), keys: ['a'], beforeId: null, link: false, snapSection: false })).toEqual([])
    window.removeEventListener('iwae:action-feedback', listen)
    expect(events).toHaveLength(1)
    expect(notes.get('S')!.blocks).toHaveLength(1)
    expect(notes.get('T')!.blocks).toHaveLength(1)
  })
  it('writes the target first, then the source', async () => {
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
    await transferBlocks({ api, sourcePath: 'S', target: target('T'), keys: ['a'], beforeId: null, link: false, snapSection: false })
    expect(calls).toEqual(['T', 'S'])
  })
  it('refuses a MOVE into a held (conflicted) note but still allows a link', async () => {
    const { api, notes } = fakeApi({ S: note(text('a')), T: note() })
    ;(api as { isNoteHeld?: (path: string) => boolean }).isNoteHeld = (path) => path === 'T'
    const events: string[] = []
    const listen = (event: Event) => events.push((event as CustomEvent<string>).detail)
    window.addEventListener('iwae:action-feedback', listen)
    expect(await transferBlocks({ api, sourcePath: 'S', target: target('T'), keys: ['a'], beforeId: null, link: false, snapSection: false })).toEqual([])
    window.removeEventListener('iwae:action-feedback', listen)
    expect(events).toEqual(['이 노트는 저장 충돌을 풀어야 옮길 수 있습니다'])
    expect(notes.get('T')!.blocks).toHaveLength(0)
    expect(notes.get('S')!.blocks).toHaveLength(1)
    expect(await transferBlocks({ api, sourcePath: 'S', target: target('T'), keys: ['a'], beforeId: null, link: true, snapSection: false })).toHaveLength(1)
  })
  it('removes from the source only after the target save is confirmed', async () => {
    const { api, notes } = fakeApi({ S: note(text('a')), T: note() })
    let release: (ok: boolean) => void = () => undefined
    ;(api as { flushNote?: (path: string) => Promise<boolean> }).flushNote = () => new Promise<boolean>((resolve) => { release = resolve })
    const pending = transferBlocks({ api, sourcePath: 'S', target: target('T'), keys: ['a'], beforeId: null, link: false, snapSection: false })
    expect(notes.get('T')!.blocks).toHaveLength(1)
    expect(notes.get('S')!.blocks).toHaveLength(1)
    release(true)
    await pending
    expect(notes.get('S')!.blocks).toHaveLength(0)
  })
  it('keeps the source when the target save does not go through', async () => {
    const { api, notes } = fakeApi({ S: note(text('a')), T: note() })
    ;(api as { flushNote?: (path: string) => Promise<boolean> }).flushNote = async () => false
    await transferBlocks({ api, sourcePath: 'S', target: target('T'), keys: ['a'], beforeId: null, link: false, snapSection: false })
    expect(notes.get('S')!.blocks).toHaveLength(1)
  })
})

describe('ghostTextOf · createBlockGhost', () => {
  const cardWith = (html: string, cls = 'pdf-memo-card') => {
    const card = document.createElement('div')
    card.className = cls
    card.innerHTML = html
    document.body.append(card)
    return card
  }

  it('소제목은 제목만, 메모 · 글은 내 글만(출처 · 단추 글은 빼고), 내 글이 없으면 원문 인용', () => {
    expect(ghostTextOf(cardWith('<button>접기</button><span class="note-section-title">  개요 </span><span class="note-section-count">3</span>', 'note-section'))).toBe('개요')
    expect(ghostTextOf(cardWith('<div class="note-ticket-id">REQ-1</div><div class="pdf-memo-card-text">내  글 둘째 줄</div><div class="note-source-quote">인용</div><button>메뉴</button>'))).toBe('내 글 둘째 줄')
    expect(ghostTextOf(cardWith('<span class="note-source-quote">원문   인용</span><span class="note-source-page">p.3</span>'))).toBe('원문 인용')
  })

  it('복사본은 글 하나뿐이다: 출처 줄 · 탭 · 단추 없이 불투명한 카드이고, 이름표는 카드 안 글을 가리지 않게 따로 붙는다', () => {
    const card = cardWith('<div class="pdf-memo-card-text">본문</div><div class="note-block-tabs">탭</div><div class="note-source-chip">출처</div><button>단추</button>')
    card.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 90, right: 500, bottom: 90, x: 0, y: 0, toJSON: () => ({}) })
    const ghost = createBlockGhost(card, 100, 100, 3)
    const root = document.querySelector<HTMLElement>('.note-block-ghost')!
    expect(root.style.width).toBe('280px')
    expect(root.textContent).toContain('본문')
    expect(root.textContent).not.toContain('출처')
    expect(root.textContent).not.toContain('단추')
    expect(root.querySelector('.note-block-ghost-text')?.textContent).toBe('본문')
    expect(root.querySelector('.note-block-ghost-count')?.textContent).toBe('3')
    ghost.setBadge('link', false)
    const mode = root.querySelector<HTMLElement>('.note-block-ghost-mode')!
    expect(mode.hidden).toBe(false)
    ghost.setBadge('copy', true)
    expect(mode.classList.contains('note-block-ghost-mode-dim')).toBe(true)
    ghost.remove()
    expect(document.querySelector('.note-block-ghost')).toBeNull()
  })

  it('원래 카드의 바탕 · 글자색 · 모서리를 그대로 입는다(투명하면 조상의 바탕)', () => {
    const card = cardWith('<div class="pdf-memo-card-text">본문</div>')
    card.style.backgroundColor = 'rgb(250, 248, 240)'
    card.style.color = 'rgb(20, 20, 20)'
    card.style.borderRadius = '6px'
    card.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 60, right: 300, bottom: 60, x: 0, y: 0, toJSON: () => ({}) })
    const ghost = createBlockGhost(card, 0, 0, 1)
    const root = document.querySelector<HTMLElement>('.note-block-ghost')!
    expect(root.style.backgroundColor).toBe('rgb(250, 248, 240)')
    expect(root.style.color).toBe('rgb(20, 20, 20)')
    expect(root.style.borderRadius).toBe('6px')
    ghost.remove()
    const parent = document.createElement('div')
    parent.style.backgroundColor = 'rgb(1, 2, 3)'
    const section = document.createElement('div')
    section.className = 'note-section'
    parent.append(section)
    document.body.append(parent)
    section.getBoundingClientRect = card.getBoundingClientRect
    const second = createBlockGhost(section, 0, 0, 1)
    expect(document.querySelector<HTMLElement>('.note-block-ghost')!.style.backgroundColor).toBe('rgb(1, 2, 3)')
    second.remove()
  })

  it('포인터의 오른쪽 아래에 떠서 포인터 자리를 덮지 않는다', () => {
    const card = cardWith('<div class="pdf-memo-card-text">본문</div>')
    card.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 60, right: 300, bottom: 60, x: 0, y: 0, toJSON: () => ({}) })
    const ghost = createBlockGhost(card, 200, 150, 1)
    const root = document.querySelector<HTMLElement>('.note-block-ghost')!
    expect(root.style.transform).toBe('translate(214px, 166px)')
    ghost.move(300, 300)
    expect(root.style.transform).toBe('translate(314px, 316px)')
    ghost.remove()
  })
})

describe('startBlockDragSession', () => {
  it('원래 노트가 화면에서 사라졌으면(탭이 바뀌었다) 놓을 노트가 없을 때 노트 안 순서 바꾸기로 이어 가지 않는다', () => {
    document.elementFromPoint = () => null
    const scroller = document.createElement('div')
    scroller.dataset.notePath = 'S'
    const cardEl = document.createElement('div')
    cardEl.dataset.noteBlock = 'a'
    scroller.append(cardEl)
    document.body.append(scroller)
    const { api } = fakeApi({ S: note(text('a')), T: note() })
    const session = startBlockDragSession({ card: cardEl, startX: 0, startY: 0, keys: ['a'], sourcePath: 'S', snapSection: false, api: () => api, onCancel: () => undefined })
    expect(session.sourceGone()).toBe(false)
    expect(session.drop()).toBe(false)
    scroller.remove()
    expect(session.sourceGone()).toBe(true)
    expect(session.drop()).toBe(true)
    session.dispose()
  })
})
