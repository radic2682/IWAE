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
})
