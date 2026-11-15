import { beforeEach, describe, expect, it } from 'vitest'
import { beginUndoGroup, canRedo, clearUndo, endUndoGroup, recordUndo, redo, touchedAfter, undo, undoGroupState, undoLabeled } from './undoStack'

function cell() {
  const state = { value: 0 }
  const set = (key: string, value: number) => {
    const before = state.value
    state.value = value
    recordUndo({ key, undo: () => { state.value = before }, redo: () => { state.value = value } })
  }
  return { state, set }
}

beforeEach(() => clearUndo())

describe('이름 있는 되돌리기 묶음', () => {
  it('begin/end 사이의 기록은 microtask 를 건너도 한 묶음이고, 비면 묶음이 없다', async () => {
    const { state, set } = cell()
    beginUndoGroup('도구')
    set('a', 1)
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 5))
    set('b', 2)
    const info = endUndoGroup()
    expect(info).toMatchObject({ label: '도구', objects: ['a', 'b'] })
    expect(undo()).toBe(true)
    expect(state.value).toBe(0)
    expect(undo()).toBe(false)
    beginUndoGroup('빈 묶음')
    expect(endUndoGroup()).toBeNull()
  })

  it('이름 있는 묶음은 바로 뒤의 같은 대상 고침을 합치지 않는다', () => {
    const { state, set } = cell()
    beginUndoGroup('ai')
    set('x', 1)
    endUndoGroup()
    set('x', 2)
    undo()
    expect(state.value).toBe(1)
  })

  it('undoLabeled 는 맨 위가 아닌 묶음을 되돌리고 다시 하기에 올린다', () => {
    const { state, set } = cell()
    beginUndoGroup('one')
    set('a', 1)
    const first = endUndoGroup()!
    set('b', 2)
    expect(undoGroupState(first.id)).toBe('past')
    expect(touchedAfter(first.id, new Set())).toBe(false)
    expect(undoLabeled(first.id)).toBe(true)
    expect(undoGroupState(first.id)).toBe('future')
    expect(canRedo()).toBe(true)
    expect(redo()).toBe(true)
    expect(state.value).toBe(1)
    expect(undoLabeled(9999)).toBe(false)
  })

  it('같은 대상을 뒤에 고친 묶음이 있으면 touchedAfter 가 참이다(형광펜 edit 열쇠도 같은 대상)', () => {
    const { set } = cell()
    beginUndoGroup('ai')
    set('pdf-hl:h1', 1)
    const info = endUndoGroup()!
    set('pdf-hl:edit:h1', 2)
    expect(touchedAfter(info.id, new Set())).toBe(true)
  })

  it('글 상자의 다른 칸(크기·배경·테두리)을 잇달아 고쳐도 칸마다 따로 되돌려지고, 같은 상자로 센다', async () => {
    const { state, set } = cell()
    beginUndoGroup('ai')
    set('overlay:o1:size', 1)
    const info = endUndoGroup()!
    expect(info.objects).toEqual(['overlay:o1'])
    await Promise.resolve()
    set('overlay:o1:fill', 2)
    await Promise.resolve()
    set('overlay:o1:border+borderColor', 3)
    expect(touchedAfter(info.id, new Set())).toBe(true)
    expect(undo()).toBe(true)
    expect(state.value).toBe(2)
    expect(undo()).toBe(true)
    expect(state.value).toBe(1)
    expect(undo()).toBe(true)
    expect(state.value).toBe(0)
  })
})

describe('AI 변경이 열려 있는 동안', () => {
  it('사람이 고친 것은 AI 묶음에 섞이지 않아 AI 변경만 되돌려진다', () => {
    const ai = cell()
    const typed = { value: 'old' }
    beginUndoGroup('ai')
    ai.set('memo:ai', 1)
    recordUndo({ key: 'note:user', user: true, undo: () => { typed.value = 'old' }, redo: () => { typed.value = 'typed' } })
    typed.value = 'typed'
    const info = endUndoGroup()!
    expect(info.objects).toEqual(['memo:ai'])
    expect(undoLabeled(info.id)).toBe(true)
    expect(ai.state.value).toBe(0)
    expect(typed.value).toBe('typed')
  })

  it('사람의 입력 이벤트 안에서 남긴 것도 섞이지 않는다', () => {
    const ai = cell()
    beginUndoGroup('ai')
    ai.set('memo:ai', 1)
    ;(globalThis as { event?: unknown }).event = { isTrusted: true }
    try { ai.set('note:user', 5) } finally { delete (globalThis as { event?: unknown }).event }
    expect(endUndoGroup()!.objects).toEqual(['memo:ai'])
  })

  it('열려 있는 동안 Ctrl+Z 를 눌러도 이어지는 AI 기록을 잃지 않는다', () => {
    const { state, set } = cell()
    beginUndoGroup('ai')
    set('a', 1)
    expect(undo()).toBe(true)
    expect(state.value).toBe(0)
    set('a', 2)
    const info = endUndoGroup()
    expect(info).not.toBeNull()
    expect(undoGroupState(info!.id)).toBe('past')
    expect(undo()).toBe(true)
    expect(state.value).toBe(0)
  })

  it('다시 하기 뒤에도 열린 묶음이 되돌릴 수 있는 묶음으로 남는다', () => {
    const { state, set } = cell()
    beginUndoGroup('ai')
    set('a', 1)
    undo()
    redo()
    set('b', 2)
    const info = endUndoGroup()!
    expect(undoGroupState(info.id)).toBe('past')
    expect(info.objects).toContain('b')
    undoLabeled(info.id)
    expect(state.value).toBe(0)
  })
})
