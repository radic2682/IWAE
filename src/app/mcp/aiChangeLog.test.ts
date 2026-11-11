// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canUndo, clearUndo, recordUndo, undo } from '../undoStack'
import { AI_ACTIVITY_LINGER_MS, getAiActivity, resetAiActivity } from './aiActivityStore'
import { AI_CHANGE_LIMIT, aiChangeCount, aiChanges, aiUndo, resetAiChangeLog, runAiChange, undoAllAiChanges } from './aiChangeLog'

/** 값 하나를 바꾸고 되돌리기에 남기는 가짜 저장소 */
function store() {
  const values: Record<string, number> = {}
  const set = (key: string, value: number) => {
    const before = values[key] ?? 0
    values[key] = value
    recordUndo({ key: `obj:${key}`, undo: () => { values[key] = before }, redo: () => { values[key] = value } })
  }
  return { values, set }
}

beforeEach(() => {
  clearUndo()
  resetAiChangeLog()
  resetAiActivity()
})
afterEach(() => {
  vi.useRealTimers()
  resetAiActivity()
})

describe('runAiChange', () => {
  it('쓰기 하나가 await 를 건너도 되돌리기 묶음 하나가 되고 기록에 한 줄 남는다', async () => {
    const { values, set } = store()
    await runAiChange('memo_add', async (note) => {
      set('a', 1)
      await new Promise((resolve) => setTimeout(resolve, 5))
      set('b', 2)
      note.count = 2
      note.summary = '두 개'
      note.target = '노트'
    })
    expect(aiChangeCount()).toBe(1)
    expect(aiChanges().changes[0]).toMatchObject({ seq: 1, tool: 'memo_add', summary: '두 개', target: '노트', undone: false, edited_since: false })
    // 사용자의 Ctrl+Z 도 이 묶음을 한 번에 되돌린다
    expect(undo()).toBe(true)
    expect(values).toEqual({ a: 0, b: 0 })
    expect(aiChanges().changes[0]!.undone).toBe(true)
  })

  it('바뀐 것이 없으면 기록하지 않는다', async () => {
    await runAiChange('memo_add', () => undefined)
    expect(aiChangeCount()).toBe(0)
    expect(canUndo()).toBe(false)
  })

  it('도중에 실패해도 이미 바뀐 것은 묶음으로 남고 오류가 그것을 알린다', async () => {
    const { values, set } = store()
    await expect(runAiChange('note_build', () => { set('a', 1); throw new Error('boom') })).rejects.toThrow(/boom.*ai_undo/su)
    expect(aiChangeCount()).toBe(1)
    await aiUndo()
    expect(values.a).toBe(0)
  })

  it('기록은 최근 200개만 둔다', async () => {
    const { set } = store()
    for (let n = 1; n <= AI_CHANGE_LIMIT + 5; n += 1) await runAiChange('x', () => set(`k${n}`, n))
    expect(aiChangeCount()).toBe(AI_CHANGE_LIMIT)
    expect(aiChanges(500).changes[0]!.seq).toBe(AI_CHANGE_LIMIT + 5)
  })
})

describe('aiUndo', () => {
  it('새것부터 steps 개를 되돌리고, 사람 것은 건드리지 않는다', async () => {
    const { values, set } = store()
    await runAiChange('one', () => set('a', 1))
    set('human', 9) // 사람이 한 변경(다른 대상)
    await runAiChange('two', () => set('b', 2))
    const result = await aiUndo({ steps: 2 })
    expect(result.undone).toEqual([2, 1])
    expect(values).toEqual({ a: 0, b: 0, human: 9 })
  })

  it('사람이 같은 대상을 그 뒤에 고쳤으면 건너뛴다(edited since)', async () => {
    const { values, set } = store()
    await runAiChange('ai', () => set('a', 1))
    set('a', 5) // 사람이 같은 대상을 고침
    expect(aiChanges().changes[0]!.edited_since).toBe(true)
    const result = await aiUndo()
    expect(result.undone).toEqual([])
    expect(result.skipped).toEqual([{ seq: 1, reason: 'edited since' }])
    expect(values.a).toBe(5)
  })

  it('사람의 바로 뒤 입력이 AI 묶음에 합쳐지지 않는다', async () => {
    const { values, set } = store()
    await runAiChange('ai', () => set('a', 1))
    set('a', 2)
    expect(aiChanges().changes[0]!.undone).toBe(false)
    // 사람이 Ctrl+Z 하면 사람 것만 되돌아간다
    undo()
    expect(values.a).toBe(1)
    const result = await aiUndo()
    expect(result.undone).toEqual([1])
    expect(values.a).toBe(0)
  })

  it('seq 로 맨 위가 아닌 묶음도 되돌리고, 이미 되돌린 것·모르는 seq 는 알려 준다', async () => {
    const { values, set } = store()
    await runAiChange('one', () => set('a', 1))
    await runAiChange('two', () => set('b', 2))
    expect((await aiUndo({ seq: 1 })).undone).toEqual([1])
    expect(values).toEqual({ a: 0, b: 2 })
    expect((await aiUndo({ seq: 1 })).skipped).toEqual([{ seq: 1, reason: 'already undone' }])
    expect((await aiUndo({ seq: 99 })).skipped).toEqual([{ seq: 99, reason: 'unknown seq' }])
  })

  it('undoAllAiChanges 는 되돌릴 수 있는 것을 모두 되돌린다', async () => {
    const { values, set } = store()
    await runAiChange('one', () => set('a', 1))
    await runAiChange('two', () => set('b', 2))
    const result = await undoAllAiChanges()
    expect(result.undone).toEqual([2, 1])
    expect(values).toEqual({ a: 0, b: 0 })
  })
})

describe('활동 알약 상태', () => {
  it('쓰는 동안 켜지고, 마지막 요청 3초 뒤에 꺼지며 바뀐 개수를 센다', async () => {
    vi.useFakeTimers()
    const { set } = store()
    await runAiChange('memo_add', (note) => { set('a', 1); note.count = 3; note.target = '전원' }, '전원')
    expect(getAiActivity()).toEqual({ active: true, target: '전원', changes: 3 })
    await runAiChange('memo_add', (note) => { set('b', 1); note.count = 2 }, '전원')
    expect(getAiActivity().changes).toBe(5)
    vi.advanceTimersByTime(AI_ACTIVITY_LINGER_MS - 1)
    expect(getAiActivity().active).toBe(true)
    vi.advanceTimersByTime(2)
    expect(getAiActivity()).toEqual({ active: false, target: '', changes: 0 })
  })
})
