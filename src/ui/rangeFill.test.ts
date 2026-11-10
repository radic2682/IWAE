import { describe, expect, it } from 'vitest'
import { rangeFillStyle } from './rangeFill'

describe('rangeFillStyle', () => {
  it('값을 min~max 안의 퍼센트로', () => {
    expect(rangeFillStyle(50, 0, 100)).toEqual({ '--range-fill': '50%' })
    expect(rangeFillStyle(105, 25, 3200)).toEqual({ '--range-fill': '2.5%' })
  })
  it('범위를 벗어나거나 min>=max 이면 0~100 으로 막는다', () => {
    expect(rangeFillStyle(-5, 0, 10)['--range-fill' as never]).toBe('0%')
    expect(rangeFillStyle(99, 0, 10)['--range-fill' as never]).toBe('100%')
    expect(rangeFillStyle(3, 5, 5)['--range-fill' as never]).toBe('0%')
  })
})
