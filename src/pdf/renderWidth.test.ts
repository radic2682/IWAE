import { describe, it, expect } from 'vitest'
import {
  clampRenderWidth,
  renderWidthFor,
  MIN_RENDER_WIDTH,
  MAX_RENDER_WIDTH,
  RENDER_WIDTH_STEP,
} from './renderWidth'

describe('clampRenderWidth', () => {
  it('Rust 가 받는 범위 안으로 자른다', () => {
    // 범위 밖은 iwae:// 가 400 으로 답한다 — 화면엔 빈 자리만 남고
    // 어디에도 이유가 안 적힌다. 요청을 만들기 전에 여기서 막는다.
    expect(clampRenderWidth(0)).toBe(MIN_RENDER_WIDTH)
    expect(clampRenderWidth(-10)).toBe(MIN_RENDER_WIDTH)
    expect(clampRenderWidth(999_999)).toBe(MAX_RENDER_WIDTH)
    expect(clampRenderWidth(MIN_RENDER_WIDTH)).toBe(MIN_RENDER_WIDTH)
    expect(clampRenderWidth(MAX_RENDER_WIDTH)).toBe(MAX_RENDER_WIDTH)
  })

  it('정수로 만든다 — 소수점이 붙은 w 는 Rust 가 파싱하지 못한다', () => {
    expect(clampRenderWidth(800.4)).toBe(800)
    expect(Number.isInteger(clampRenderWidth(777.7))).toBe(true)
  })

  it('NaN·Infinity 도 유효한 폭이 된다 — 안전한 쪽인 최소값으로 떨어진다', () => {
    // 값이 무의미할 때 상한으로 올리면 3000px 짜리 비트맵을 요청하게 된다.
    // 뜻을 모를 때는 제일 싼 쪽으로 간다.
    expect(clampRenderWidth(Number.NaN)).toBe(MIN_RENDER_WIDTH)
    expect(clampRenderWidth(Number.POSITIVE_INFINITY)).toBe(MIN_RENDER_WIDTH)
  })
})

describe('renderWidthFor', () => {
  it('화면 배율이 낮아도 최소 2배로 그린다 — 100% 화면의 작은 글자도 선명해야 한다', () => {
    expect(renderWidthFor(400, 1)).toBe(800)
    expect(renderWidthFor(400, 1.5)).toBe(800)
    expect(renderWidthFor(400, 2)).toBe(800)
    expect(renderWidthFor(400, 2.5)).toBe(1000)
  })

  it('폭을 100px 간격으로 올림해서 URL 을 안정시킨다', () => {
    // 이것이 구분선 드래그 중에 렌더가 폭주하지 않는 이유이자,
    // 프로토콜이 붙여 보내는 1년짜리 Cache-Control 이 실제로 맞는 이유다.
    const stable = [201, 210, 225, 233].map((css) => renderWidthFor(css, 1))
    expect(new Set(stable).size).toBe(1)
    expect(stable[0]).toBe(500)
  })

  it('필요한 폭보다 작게는 절대 요청하지 않는다', () => {
    // 올림이라 항상 요청 폭 >= 필요한 폭이다. 반대면 확대 표시가 되어
    // 흐릿해지는데, 한 단계 큰 비트맵은 눈에 띄지 않는다.
    for (const css of [100, 333, 777, 1000]) {
      for (const ratio of [1, 1.25, 1.5, 2]) {
        expect(renderWidthFor(css, ratio)).toBeGreaterThanOrEqual(css * ratio)
      }
    }
  })

  it('간격의 배수다', () => {
    for (const css of [100, 333, 777]) {
      expect(renderWidthFor(css, 1.5) % RENDER_WIDTH_STEP).toBe(0)
    }
  })

  it('아직 못 잰 상자(0)는 0 이다 — "요청하지 않는다"의 신호다', () => {
    // 여기서 MIN 으로 올려 보내면 아무도 볼 수 없는 32px 짜리 페이지를
    // 문서 전체만큼 긁어 오게 된다.
    expect(renderWidthFor(0, 1.5)).toBe(0)
    expect(renderWidthFor(-5, 1.5)).toBe(0)
    expect(renderWidthFor(Number.NaN, 1.5)).toBe(0)
  })

  it('배율이 이상하면 1 로 친다', () => {
    expect(renderWidthFor(400, 0)).toBe(800)
    expect(renderWidthFor(400, Number.NaN)).toBe(800)
  })

  it('아주 넓은 패널도 Rust 의 상한을 넘지 않는다', () => {
    expect(renderWidthFor(4000, 2)).toBe(MAX_RENDER_WIDTH)
  })
})
