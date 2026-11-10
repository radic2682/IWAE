import { describe, expect, it } from 'vitest'
import { isFreshHighlight, markFreshHighlight } from './freshHighlight'

describe('freshHighlight', () => {
  it('marks a highlight fresh only briefly after creation', () => {
    markFreshHighlight('a', 1000)
    expect(isFreshHighlight('a', 1100)).toBe(true)
    expect(isFreshHighlight('a', 1950)).toBe(false)
  })
  it('does not treat unknown highlights as fresh', () => {
    expect(isFreshHighlight('never-created', 1)).toBe(false)
  })
})
