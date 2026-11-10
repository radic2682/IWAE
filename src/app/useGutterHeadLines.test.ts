import { describe, expect, it } from 'vitest'
import { gutterLinePlacement } from './useGutterHeadLines'

describe('gutterLinePlacement', () => {
  it('머리 줄 밑선 높이를 부모 기준 위치로 바꾼다', () => {
    expect(gutterLinePlacement(199, 38, 75, 962)).toEqual({ top: 161, visible: true })
  })

  it('위에 붙은 머리 줄 아래로 지나가거나 목록 아래로 벗어나면 숨긴다', () => {
    expect(gutterLinePlacement(60, 38, 75, 962).visible).toBe(false)
    expect(gutterLinePlacement(980, 38, 75, 962).visible).toBe(false)
  })
})
