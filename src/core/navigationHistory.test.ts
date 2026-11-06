import { describe, expect, it } from 'vitest'
import { EMPTY_HISTORY, goBack, goForward, pushLocation, type NavLocation } from './navigationHistory'

const at = (docId: string, page: number): NavLocation => ({ docId, page })

describe('navigationHistory', () => {
  it('records where a jump came from and returns there on back', () => {
    const pushed = pushLocation(EMPTY_HISTORY, at('a', 3), at('a', 40))
    const back = goBack(pushed, at('a', 40))
    expect(back.target).toEqual(at('a', 3))
    const forward = goForward(back.history, at('a', 3))
    expect(forward.target).toEqual(at('a', 40))
  })

  it('a new jump clears the forward stack', () => {
    let history = pushLocation(EMPTY_HISTORY, at('a', 1), at('a', 10))
    history = goBack(history, at('a', 10)).history
    history = pushLocation(history, at('a', 1), at('b', 5))
    expect(history.future).toEqual([])
    expect(goForward(history, at('b', 5)).target).toBeNull()
  })

  it('ignores a jump to the place you already are and dedupes repeats', () => {
    expect(pushLocation(EMPTY_HISTORY, at('a', 2), at('a', 2))).toBe(EMPTY_HISTORY)
    let history = pushLocation(EMPTY_HISTORY, at('a', 2), at('a', 9))
    history = pushLocation(history, at('a', 2), at('a', 9))
    expect(history.past).toEqual([at('a', 2)])
  })

  it('caps history at 100 entries, dropping the oldest', () => {
    let history = EMPTY_HISTORY
    for (let page = 1; page <= 130; page += 1) history = pushLocation(history, at('a', page), at('a', page + 1000))
    expect(history.past).toHaveLength(100)
    expect(history.past[0]).toEqual(at('a', 31))
  })

  it('returns no target at either end', () => {
    expect(goBack(EMPTY_HISTORY, at('a', 1)).target).toBeNull()
    expect(goForward(EMPTY_HISTORY, at('a', 1)).target).toBeNull()
  })

  it('skips locations whose document no longer exists', () => {
    let history = pushLocation(EMPTY_HISTORY, at('gone', 4), at('a', 1))
    history = pushLocation(history, at('a', 1), at('a', 7))
    const back1 = goBack(history, at('a', 7), (loc) => loc.docId !== 'gone')
    expect(back1.target).toEqual(at('a', 1))
    const back2 = goBack(back1.history, at('a', 1), (loc) => loc.docId !== 'gone')
    expect(back2.target).toBeNull()
  })
})
