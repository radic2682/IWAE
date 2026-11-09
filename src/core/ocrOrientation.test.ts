import { describe, expect, it } from 'vitest'
import { isClearlyUpright, isSidewaysBox, pickOrientation, readStats } from './ocrOrientation'

const wide = [[0, 0], [200, 0], [200, 20], [0, 20]] as const
const tall = [[0, 0], [20, 0], [20, 200], [0, 200]] as const

describe('readStats', () => {
  it('공백을 뺀 글자 수에 확신을 곱해 더한다', () => {
    expect(readStats([{ text: 'ab cd', score: 0.5 }, { text: '가나다', score: 1 }])).toEqual({ chars: 7, score: 2 + 3 })
  })

  it('확신이 숫자가 아니면 건너뛰고, 범위를 벗어난 확신은 0~1 로 자른다', () => {
    expect(readStats([{ text: 'abc', score: Number.NaN }, { text: 'abcd', score: 3 }])).toEqual({ chars: 4, score: 4 })
    expect(readStats([])).toEqual({ chars: 0, score: 0 })
  })
})

describe('세로 상자(눕거나 선 글자)', () => {
  it('글자가 어느 정도 있는 줄이 세로 상자에 담기면 옆으로 누운 것으로 본다', () => {
    expect(isSidewaysBox({ text: 'hello world', score: 0.9, poly: tall }, 10)).toBe(true)
    expect(isSidewaysBox({ text: 'hello world', score: 0.9, poly: wide }, 10)).toBe(false)
  })

  it('글자가 아주 적은 줄(낱글자 칸)이나 상자 정보가 없는 줄은 세로로 치지 않는다', () => {
    expect(isSidewaysBox({ text: 'ab', score: 0.9, poly: tall }, 2)).toBe(false)
    expect(isSidewaysBox({ text: 'hello world', score: 0.9 }, 10)).toBe(false)
  })

  it('세로 상자로 읽힌 글자는 점수에 넣지 않는다(엔진이 스스로 돌려 읽은 것)', () => {
    const items = [
      { text: 'sideways line one', score: 1, poly: tall },
      { text: 'sideways line two', score: 1, poly: tall },
      { text: 'ok', score: 1, poly: tall },
    ]
    expect(readStats(items)).toEqual({ chars: 2, score: 2 })
    expect(readStats(items.map((item) => ({ ...item, poly: wide })))).toEqual({ chars: 32, score: 32 })
  })
})

describe('isClearlyUpright', () => {
  it('글자가 충분하고 확신이 높으면 다른 각도를 살피지 않는다', () => {
    expect(isClearlyUpright({ chars: 120, score: 110 })).toBe(true)
    expect(isClearlyUpright({ chars: 20, score: 20 })).toBe(false)
    expect(isClearlyUpright({ chars: 120, score: 60 })).toBe(false)
  })
})

describe('pickOrientation', () => {
  it('0도가 가장 잘 읽히면 그대로 둔다', () => {
    expect(pickOrientation({ 0: 90, 90: 3, 180: 10, 270: 2 })).toBe(0)
  })

  it('거꾸로 선 쪽은 180 을 고른다', () => {
    expect(pickOrientation({ 0: 4, 90: 2, 180: 88, 270: 5 })).toBe(180)
  })

  it('옆으로 누운 쪽은 90 이나 270 을 고른다', () => {
    expect(pickOrientation({ 0: 1, 90: 75, 180: 3, 270: 6 })).toBe(90)
    expect(pickOrientation({ 0: 8, 90: 4, 180: 2, 270: 64 })).toBe(270)
  })

  it('0도와 비슷하게 읽히면(방향이 애매하면) 돌리지 않는다', () => {
    expect(pickOrientation({ 0: 50, 90: 5, 180: 60, 270: 4 })).toBe(0)
  })

  it('어디서도 거의 안 읽히면(그림·빈 쪽) 돌리지 않는다', () => {
    expect(pickOrientation({ 0: 0, 90: 3, 180: 5, 270: 1 })).toBe(0)
    expect(pickOrientation({ 0: 0, 90: 0, 180: 0, 270: 0 })).toBe(0)
  })

  it('점수가 같으면 돌리지 않고, 살피지 않은 각도는 0점으로 본다', () => {
    expect(pickOrientation({ 0: 40, 180: 40 })).toBe(0)
    expect(pickOrientation({ 0: 2, 180: 55 })).toBe(180)
    expect(pickOrientation({})).toBe(0)
  })
})
