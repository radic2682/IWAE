import { beforeEach, describe, expect, it } from 'vitest'
import {
  FORMAT_PLACE_KEY, clampFloat, decideDrop, getPlace, initialPlaceState, keyDelta, parsePlace, passedDragThreshold, placeReducer, readPlaces,
  resetPlacesForTest, setPlace, snapZone, writePlaces,
} from './formatBarPlace'

const memory = () => {
  const data = new Map<string, string>()
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
}

describe('서식 줄 자리 — 상태 전이', () => {
  it('떼면 뜨고(붙어 있던 쪽을 기억), 붙이면 기억한 쪽으로 돌아간다', () => {
    let state = initialPlaceState({ mode: 'center' })
    state = placeReducer(state, { type: 'float', x: 40, y: 90 })
    expect(state.place).toEqual({ mode: 'float', x: 40, y: 90 })
    expect(state.lastDock).toBe('center')
    expect(placeReducer(state, { type: 'toggle', x: 0, y: 0 }).place).toEqual({ mode: 'center' })
  })

  it('Enter/Space(toggle): 붙어 있으면 주어진 곳에 뜨고, 떠 있으면 마지막 붙은 쪽에 붙는다', () => {
    const floated = placeReducer(initialPlaceState(), { type: 'toggle', x: 12, y: 34 })
    expect(floated.place).toEqual({ mode: 'float', x: 12, y: 34 })
    expect(placeReducer(floated, { type: 'toggle', x: 0, y: 0 }).place).toEqual({ mode: 'left' })
  })

  it('옮기기(nudge)는 떠 있을 때만 듣는다', () => {
    expect(placeReducer(initialPlaceState(), { type: 'nudge', dx: 8, dy: 0 }).place).toEqual({ mode: 'left' })
    expect(placeReducer(initialPlaceState({ mode: 'float', x: 10, y: 10 }), { type: 'nudge', dx: 8, dy: -8 }).place).toEqual({ mode: 'float', x: 18, y: 2 })
  })
})

describe('서식 줄 자리 — 가두기 · 끌기 문턱 · 놓을 자리', () => {
  it('창 안으로 가둔다(여유 8px). 창이 줄보다 작으면 왼쪽 위를 우선한다', () => {
    expect(clampFloat(-50, -50, 400, 40, 1000, 800)).toEqual({ x: 8, y: 8 })
    expect(clampFloat(900, 790, 400, 40, 1000, 800)).toEqual({ x: 592, y: 752 })
    expect(clampFloat(100, 100, 400, 40, 1000, 800)).toEqual({ x: 100, y: 100 })
    expect(clampFloat(100, 100, 500, 40, 300, 800)).toEqual({ x: 8, y: 100 })
  })

  it('문턱은 6px', () => {
    expect(passedDragThreshold(3, 4)).toBe(false)
    expect(passedDragThreshold(6, 0)).toBe(true)
    expect(passedDragThreshold(0, -7)).toBe(true)
  })

  it('붙는 자리의 가운데 3분의 1 은 가운데, 나머지는 왼쪽', () => {
    expect(snapZone(100, 0, 900)).toBe('left')
    expect(snapZone(299, 0, 900)).toBe('left')
    expect(snapZone(300, 0, 900)).toBe('center')
    expect(snapZone(599, 0, 900)).toBe('center')
    expect(snapZone(600, 0, 900)).toBe('left')
    expect(snapZone(50, 0, 0)).toBe('left')
  })

  it('놓은 곳이 붙는 자리 위면 붙고, 밖이면 뜬다', () => {
    const dock = { left: 100, top: 0, right: 1000, bottom: 36 }
    expect(decideDrop(550, 18, dock)).toEqual({ kind: 'dock', side: 'center' })
    expect(decideDrop(150, 18, dock)).toEqual({ kind: 'dock', side: 'left' })
    expect(decideDrop(550, 300, dock)).toEqual({ kind: 'float' })
    expect(decideDrop(550, 18, null)).toEqual({ kind: 'float' })
  })

  it('방향키는 8px 걸음', () => {
    expect(keyDelta('ArrowLeft')).toEqual({ dx: -8, dy: 0 })
    expect(keyDelta('ArrowDown')).toEqual({ dx: 0, dy: 8 })
    expect(keyDelta('a')).toBeNull()
  })
})

describe('서식 줄 자리 — 저장', () => {
  beforeEach(() => resetPlacesForTest())

  it('종류별로 저장하고 모르는 값은 버린다', () => {
    const storage = memory()
    writePlaces(storage, { notes: { mode: 'center' }, canvas: { mode: 'float', x: 5, y: 6 } })
    expect(readPlaces(storage)).toEqual({ notes: { mode: 'center' }, canvas: { mode: 'float', x: 5, y: 6 } })
    storage.data.set(FORMAT_PLACE_KEY, JSON.stringify({ notes: { mode: 'float', x: 'a' }, textbox: { mode: 'left' }, canvas: 3 }))
    expect(readPlaces(storage)).toEqual({ textbox: { mode: 'left' } })
    expect(parsePlace({ mode: 'float', x: Number.NaN, y: 1 })).toBeNull()
  })

  it('깨진 JSON · 막힌 저장소에서도 던지지 않는다', () => {
    const storage = memory()
    storage.data.set(FORMAT_PLACE_KEY, '{nope')
    expect(readPlaces(storage)).toEqual({})
    expect(readPlaces(null)).toEqual({})
    expect(() => writePlaces({ setItem: () => { throw new Error('quota') } }, {})).not.toThrow()
  })

  it('저장소: 기본은 왼쪽, 바꾸면 종류별로 기억한다', () => {
    expect(getPlace('notes')).toEqual({ mode: 'left' })
    setPlace('canvas', { mode: 'center' })
    expect(getPlace('canvas')).toEqual({ mode: 'center' })
    expect(getPlace('textbox')).toEqual({ mode: 'left' })
  })
})
