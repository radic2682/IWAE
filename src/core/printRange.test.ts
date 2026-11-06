import { describe, expect, it } from 'vitest'
import { parsePageRange } from './printRange'

describe('parsePageRange', () => {
  it('쉼표·범위·끝없는 범위를 0-기반 쪽 목록으로', () => {
    expect(parsePageRange('1-3, 5', 10)).toEqual([0, 1, 2, 4])
    expect(parsePageRange('8-', 10)).toEqual([7, 8, 9])
    expect(parsePageRange('-2', 10)).toEqual([0, 1])
    expect(parsePageRange('9-20', 10)).toEqual([8, 9])
  })

  it('읽을 수 없거나 남는 쪽이 없으면 null', () => {
    expect(parsePageRange('a', 10)).toBeNull()
    expect(parsePageRange('5-3', 10)).toBeNull()
    expect(parsePageRange('11', 10)).toBeNull()
    expect(parsePageRange('', 10)).toBeNull()
  })
})
