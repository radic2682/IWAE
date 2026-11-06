import { describe, it, expect } from 'vitest'
import { layoutPages, layoutSpread, spreadHeight, totalHeight, visibleRange, scrollTopForPage } from './pageLayout'

describe('layoutPages', () => {
  it('빈 문서는 빈 배열을 돌려준다', () => {
    expect(layoutPages([], 800, 16)).toEqual([])
  })

  it('같은 비율 페이지들은 top 이 앞 페이지 높이 + gap 만큼 누적된다', () => {
    // 200x300 원본을 폭 800 으로 맞추면 높이는 1200
    const boxes = layoutPages(
      [
        [200, 300],
        [200, 300],
      ],
      800,
      16,
    )
    expect(boxes).toEqual([
      { top: 0, height: 1200 },
      { top: 1216, height: 1200 },
    ])
  })

  it('가로 페이지가 섞여도 각자 자기 비율로 높이를 낸다', () => {
    // 긴 문서에 접이식 가로 도표가 세로 페이지 사이에 끼는 경우
    const boxes = layoutPages(
      [
        [100, 200], // 세로, 폭 800 -> 높이 1600
        [400, 100], // 가로, 폭 800 -> 높이 200
        [100, 200], // 세로, 폭 800 -> 높이 1600
      ],
      800,
      0,
    )
    expect(boxes).toEqual([
      { top: 0, height: 1600 },
      { top: 1600, height: 200 },
      { top: 1800, height: 1600 },
    ])
  })

  it('renderWidth 가 0 이면(최초 렌더, 폭 측정 전) 모든 페이지 높이가 0 이다', () => {
    const boxes = layoutPages(
      [
        [200, 300],
        [400, 100],
      ],
      0,
      16,
    )
    expect(boxes).toEqual([
      { top: 0, height: 0 },
      { top: 16, height: 0 },
    ])
  })

  it('renderWidth 가 음수거나 NaN 이어도 크래시 없이 0 폭으로 취급한다', () => {
    expect(layoutPages([[200, 300]], -100, 16)).toEqual([{ top: 0, height: 0 }])
    expect(layoutPages([[200, 300]], Number.NaN, 16)).toEqual([{ top: 0, height: 0 }])
  })

  it('페이지 미디어박스가 0x0 이나 음수로 손상돼도 정사각형으로 대체해 NaN 을 내지 않는다', () => {
    const boxes = layoutPages(
      [
        [0, 0],
        [-50, 100],
      ],
      800,
      0,
    )
    // 비율을 알 수 없으니 정사각형(1:1) 취급 -> 높이 = renderWidth
    expect(boxes).toEqual([
      { top: 0, height: 800 },
      { top: 800, height: 800 },
    ])
  })

  it('gap 이 음수거나 NaN 이면 0 으로 취급한다', () => {
    const boxesNegative = layoutPages(
      [
        [200, 300],
        [200, 300],
      ],
      800,
      -50,
    )
    const boxesNaN = layoutPages(
      [
        [200, 300],
        [200, 300],
      ],
      800,
      Number.NaN,
    )
    expect(boxesNegative[1]).toEqual({ top: 1200, height: 1200 })
    expect(boxesNaN[1]).toEqual({ top: 1200, height: 1200 })
  })
})

describe('totalHeight', () => {
  it('빈 문서는 0 이다', () => {
    expect(totalHeight([], 16)).toBe(0)
  })

  it('페이지 한 장이면 gap 이 더해지지 않는다', () => {
    expect(totalHeight([{ top: 0, height: 500 }], 16)).toBe(500)
  })

  it('layoutPages 가 낸 마지막 박스의 top+height 와 일치한다', () => {
    const sizes: [number, number][] = [
      [200, 300],
      [400, 100],
      [200, 300],
    ]
    const gap = 20
    const boxes = layoutPages(sizes, 800, gap)
    const last = boxes[boxes.length - 1]
    expect(last).toBeDefined()
    if (last === undefined) throw new Error('unreachable')
    expect(totalHeight(boxes, gap)).toBe(last.top + last.height)
  })
})

describe('visibleRange', () => {
  it('빈 문서는 빈 범위([0, -1])를 돌려준다', () => {
    expect(visibleRange([], 0, 500, 2)).toEqual([0, -1])
  })

  const uniformBoxes = layoutPages(
    [
      [200, 300],
      [200, 300],
      [200, 300],
      [200, 300],
      [200, 300],
    ],
    800,
    0,
  )
  // 각 페이지 높이 1200, gap 0 -> top: 0, 1200, 2400, 3600, 4800

  it('scrollTop 0, 뷰포트가 한 페이지보다 작으면 첫 페이지 하나만 보인다', () => {
    expect(visibleRange(uniformBoxes, 0, 500, 0)).toEqual([0, 0])
  })

  it('뷰포트가 여러 페이지를 덮으면 여러 페이지가 한꺼번에 보인다', () => {
    // scrollTop 1000 ~ 1000+2500=3500 => 0,1,2 번 페이지와 겹친다
    expect(visibleRange(uniformBoxes, 1000, 2500, 0)).toEqual([0, 2])
  })

  it('문서 끝을 넘긴 scrollTop 은 마지막 페이지로 붙는다', () => {
    expect(visibleRange(uniformBoxes, 999999, 500, 0)).toEqual([4, 4])
  })

  it('음수 scrollTop(오버스크롤 바운스)은 0 으로 취급해 첫 페이지를 보여준다', () => {
    expect(visibleRange(uniformBoxes, -300, 500, 0)).toEqual([0, 0])
  })

  it('overscan 만큼 앞뒤로 더 그린다', () => {
    // 2번 페이지(top 2400~3600)만 보이는 뷰포트, overscan 1 -> 1,2,3
    expect(visibleRange(uniformBoxes, 2500, 500, 1)).toEqual([1, 3])
  })

  it('overscan 이 문서 시작을 넘어가도 음수 페이지를 돌려주지 않는다', () => {
    expect(visibleRange(uniformBoxes, 0, 500, 10)).toEqual([0, 4])
  })

  it('overscan 이 문서 끝을 넘어가도 마지막 페이지 너머를 돌려주지 않는다', () => {
    expect(visibleRange(uniformBoxes, 999999, 500, 10)).toEqual([0, 4])
  })

  it('가로 페이지가 섞인 문서에서도 실제 top/height 로 정확히 찾는다', () => {
    // 0: top0~1600(세로), 1: top1600~1800(가로, 얇음), 2: top1800~3400(세로)
    const mixedBoxes = layoutPages(
      [
        [100, 200],
        [400, 100],
        [100, 200],
      ],
      800,
      0,
    )
    // 가로 페이지(1번, top 1600~1800)만 정확히 겨냥하는 뷰포트
    expect(visibleRange(mixedBoxes, 1650, 100, 0)).toEqual([1, 1])
  })

  it('scrollTop/viewportHeight/overscan 이 NaN 이어도 크래시 없이 유효한 범위를 돌려준다', () => {
    const [start, end] = visibleRange(uniformBoxes, Number.NaN, Number.NaN, Number.NaN)
    expect(Number.isFinite(start)).toBe(true)
    expect(Number.isFinite(end)).toBe(true)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeLessThanOrEqual(4)
    expect(start).toBeLessThanOrEqual(end)
  })

  it('viewportHeight 가 음수여도 start 가 end 를 앞지르는 뒤집힌 범위를 내지 않는다', () => {
    // scrollTop 2500(2번 페이지 한복판)에서 viewportHeight 를 음수로 주면
    // viewEnd < viewStart 가 되어, 위/아래를 따로 찾는 두 탐색이 서로 어긋난
    // 인덱스를 낼 수 있다 — 가드 없이 짜면 [2, 0] 같은 깨진 범위가 나온다.
    const [start, end] = visibleRange(uniformBoxes, 2500, -2000, 0)
    expect(start).toBeLessThanOrEqual(end)
    expect(start).toEqual(end) // 뷰포트가 사실상 0 이니 페이지 하나만 가리켜야 한다
  })

  it('overscan 이 음수여도 start 가 end 를 앞지르는 뒤집힌 범위를 내지 않는다', () => {
    // overscan 이 음수면 start = firstVisible - (음수) 로 오히려 커지고
    // end = lastVisible + (음수) 로 오히려 작아져서, 가드가 없으면 start > end 가 된다.
    const [start, end] = visibleRange(uniformBoxes, 2500, 500, -1)
    expect(start).toBeLessThanOrEqual(end)
  })
})

describe('scrollTopForPage', () => {
  it('빈 문서는 0 이다', () => {
    expect(scrollTopForPage([], 0)).toBe(0)
  })

  // page0: 200x300 -> 800*1.5=1200 높이, top 0
  // page1: 400x100 -> 800*0.25=200 높이, top 1200+20=1220
  // page2: 200x300 -> 800*1.5=1200 높이, top 1220+200+20=1440
  // 페이지마다 높이가 달라서, "평균 높이 * 번호" 로 계산하면 이 값들과 어긋난다.
  const boxes = layoutPages(
    [
      [200, 300],
      [400, 100],
      [200, 300],
    ],
    800,
    20,
  )

  it('0 번 페이지는 항상 0 이다', () => {
    expect(scrollTopForPage(boxes, 0)).toBe(0)
  })

  it('가운데 페이지는 그 페이지의 실제 top 을 돌려준다(균일 높이 가정 금지)', () => {
    expect(scrollTopForPage(boxes, 1)).toBe(1220)
  })

  it('마지막 페이지 너머의 번호는 마지막 페이지로 붙는다', () => {
    expect(scrollTopForPage(boxes, 999)).toBe(1440)
  })

  it('음수 페이지 번호는 첫 페이지로 붙는다', () => {
    expect(scrollTopForPage(boxes, -5)).toBe(0)
  })

  it('NaN 페이지 번호는 0으로 취급한다', () => {
    expect(scrollTopForPage(boxes, Number.NaN)).toBe(0)
  })

  it('소수 페이지 번호는 내림해서 그 페이지로 붙는다', () => {
    expect(scrollTopForPage(boxes, 1.9)).toBe(1220)
  })
})

describe('layoutSpread — 두 쪽 펼침', () => {
  it('1·2쪽, 3·4쪽… 두 쪽씩 한 줄에(첫 쪽이 왼쪽), 홀수면 마지막 쪽은 왼쪽에 혼자 놓는다', () => {
    const boxes = layoutSpread([[100, 200], [100, 200], [100, 200], [100, 200], [100, 200]], 210, 10)
    // 한 쪽 폭 = (210 - 10) / 2 = 100, 높이 = 200
    expect(boxes[0]).toEqual({ top: 0, left: 0, width: 100, height: 200 })
    expect(boxes[1]).toEqual({ top: 0, left: 110, width: 100, height: 200 })
    expect(boxes[2]).toEqual({ top: 210, left: 0, width: 100, height: 200 })
    expect(boxes[3]).toEqual({ top: 210, left: 110, width: 100, height: 200 })
    expect(boxes[4]).toEqual({ top: 420, left: 0, width: 100, height: 200 })
    expect(spreadHeight(boxes)).toBe(620)
  })

  it('한 줄의 높이는 더 긴 쪽을 따른다', () => {
    const boxes = layoutSpread([[100, 100], [100, 300], [100, 100]], 210, 10)
    expect(boxes[0]?.top).toBe(0)
    expect(boxes[1]?.top).toBe(0)
    expect(boxes[2]?.top).toBe(310)
    expect(spreadHeight(boxes)).toBe(310 + 100)
  })

  it('세 장이면 1·2·3쪽, 4·5·6쪽… 한 줄에 세 쪽씩, 남는 쪽은 마지막 줄 왼쪽부터', () => {
    const boxes = layoutSpread([[100, 200], [100, 200], [100, 200], [100, 200]], 320, 10, 3)
    // 한 쪽 폭 = (320 - 10×2) / 3 = 100
    expect(boxes[0]).toEqual({ top: 0, left: 0, width: 100, height: 200 })
    expect(boxes[1]).toEqual({ top: 0, left: 110, width: 100, height: 200 })
    expect(boxes[2]).toEqual({ top: 0, left: 220, width: 100, height: 200 })
    expect(boxes[3]).toEqual({ top: 210, left: 0, width: 100, height: 200 })
    expect(spreadHeight(boxes)).toBe(410)
  })

  it('빈 문서는 높이 0', () => {
    expect(layoutSpread([], 300, 10)).toEqual([])
    expect(spreadHeight([])).toBe(0)
  })
})

describe('pageUnitAt', () => {
  it('한 장 보기는 그 쪽만, 두 장 보기는 같은 줄의 쌍을 한 화면으로 묶는다', async () => {
    const { pageUnitAt, layoutSpread, layoutPages } = await import('./pageLayout')
    const single = layoutPages([[100, 200], [100, 100]], 100, 10)
    expect(pageUnitAt(single, 1)).toEqual({ first: 1, last: 1, top: 210, height: 100 })
    const spread = layoutSpread([[100, 100], [100, 100], [100, 150], [100, 100]], 210, 10)
    expect(pageUnitAt(spread, 0)).toMatchObject({ first: 0, last: 1 })
    expect(pageUnitAt(spread, 3)).toMatchObject({ first: 2, last: 3, height: 150 })
    expect(pageUnitAt([], 0)).toBeNull()
  })
})
