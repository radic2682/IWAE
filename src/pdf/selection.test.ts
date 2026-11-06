import { describe, it, expect } from 'vitest'
import type { CharBox, PageTextIndex } from '../core/textIndex'
import { charIndexAtPoint, selectionRange } from './selection'

/**
 * anchor.test.ts 와 같은 방식으로 PDFium 모양을 흉내 낸 픽스처를 손으로 짓는다.
 * 진짜 PDF 는 쓰지 않는다 — 이 파일도 순수 계산만 시험한다.
 */
const LEFT = 72
const TOP = 100
const LINE_GAP = 14 // 줄 간격
const GLYPH_W = 6
const GLYPH_H = 12

function makePage(lines: readonly string[]): PageTextIndex {
  const chars: CharBox[] = []
  let text = ''
  lines.forEach((line, lineIndex) => {
    const y = TOP + lineIndex * LINE_GAP
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === undefined) continue
      chars.push({ c, x: LEFT + i * GLYPH_W, y, w: GLYPH_W, h: GLYPH_H })
      text += c
    }
    if (lineIndex < lines.length - 1) {
      const endX = LEFT + line.length * GLYPH_W
      for (const c of ['\r', '\n']) {
        chars.push({ c, x: endX, y, w: 0, h: 0 })
        text += c
      }
    }
  })
  return { text, chars }
}

describe('charIndexAtPoint', () => {
  it('정확히 한 글자 상자 위의 점은 그 글자를 돌려준다', () => {
    const page = makePage(['AB', 'CD'])
    // A 의 상자: x:[72,78], y:[100,112]
    expect(charIndexAtPoint(page, 1, { x: 74, y: 105 })).toBe(0)
  })

  it('PF-4: renderScale 은 화면 px 를 페이지 좌표로 나누는 배율이다 (배율 ≠ 1 로 고정)', () => {
    const page = makePage(['AB', 'CD'])
    // A 의 페이지 좌표 (74, 105) 를 배율 2 인 화면에서 클릭하면 화면 좌표는 그 두 배다.
    // 배율을 곱해 버리면(반대로 적용하면) 전혀 다른 글자를 가리키게 되어 이 테스트가 깨진다.
    expect(charIndexAtPoint(page, 2, { x: 148, y: 210 })).toBe(0)
  })

  it('글자 사이 여백을 클릭하면 더 가까운 글자로 스냅한다', () => {
    // A: x:[0,4], gap: [4,10], B: x:[10,14] — 실제 PDF 에도 커닝으로 상자 사이 틈이 있다.
    const spaced: PageTextIndex = {
      text: 'AB',
      chars: [
        { c: 'A', x: 0, y: 0, w: 4, h: 10 },
        { c: 'B', x: 10, y: 0, w: 4, h: 10 },
      ],
    }
    // x=8: A 까지 거리 4, B 까지 거리 2 — B 가 더 가깝다.
    expect(charIndexAtPoint(spaced, 1, { x: 8, y: 5 })).toBe(1)
    // x=6: A 까지 거리 2, B 까지 거리 4 — A 가 더 가깝다.
    expect(charIndexAtPoint(spaced, 1, { x: 6, y: 5 })).toBe(0)
  })

  it('페이지 맨 앞보다 위/왼쪽으로 한참 벗어난 점은 첫 글자로 clamp 된다', () => {
    const page = makePage(['AB', 'CD'])
    expect(charIndexAtPoint(page, 1, { x: -1000, y: -1000 })).toBe(0)
  })

  it('페이지 맨 끝보다 아래/오른쪽으로 한참 벗어난 점은 마지막 글자로 clamp 된다', () => {
    const page = makePage(['AB', 'CD'])
    // text 는 'AB\r\nCD' — 마지막 글자 D 의 인덱스는 5.
    expect(page.text.length).toBe(6)
    expect(charIndexAtPoint(page, 1, { x: 100000, y: 100000 })).toBe(5)
  })

  it('줄이 여러 개일 때 다른 줄의 좌표는 그 줄의 글자를 돌려준다', () => {
    const page = makePage(['AB', 'CD'])
    // C 의 상자: x:[72,78], y:[114,126] — 둘째 줄.
    expect(charIndexAtPoint(page, 1, { x: 74, y: 119 })).toBe(4)
  })

  it('"가장 가깝다"는 세로(줄) 우선, 가로는 그다음이다 — 줄 사이 여백은 세로로 더 가까운 줄에 스냅한다', () => {
    // 첫 줄 글자는 클릭 x 와 한참 멀고(가로 200), 둘째 줄 글자는 클릭 x 와 정확히 일치한다(가로 0).
    // 하지만 클릭 지점은 첫 줄 바로 아래(세로 1)라서 첫 줄이 둘째 줄(세로 39)보다 훨씬 가깝다.
    // 가로세로를 합친 단순 유클리드 거리라면 둘째 줄이 이겨 버린다(1²+200² > 39²+0²) —
    // 텍스트는 줄 단위로 흐르므로 그건 사용자가 조준한 줄이 아니다.
    const twoLines: PageTextIndex = {
      text: 'XY',
      chars: [
        { c: 'X', x: 200, y: 0, w: 10, h: 10 }, // 첫 줄: y:[0,10]
        { c: 'Y', x: 0, y: 50, w: 10, h: 10 }, // 둘째 줄: y:[50,60]
      ],
    }
    expect(charIndexAtPoint(twoLines, 1, { x: 0, y: 11 })).toBe(0)
  })

  it('같은 상자를 공유하는 글자(리가처)는 배열에서 먼저 나오는 쪽이 이긴다', () => {
    // 타이프셋 "fi" 리가처처럼 f 와 i 가 완전히 같은 사각형을 보고한다(Task 1 실측:
    // 한 LaTeX 논문에서 56 회). 스캔이 처음 만나는 글자를 그대로 두는 규칙이므로
    // 인덱스가 더 작은(논리적으로 먼저 오는) 글자가 이긴다 — 임의적이지만 결정돼 있다.
    const ligature: PageTextIndex = {
      text: 'fi',
      chars: [
        { c: 'f', x: 0, y: 0, w: 10, h: 10 },
        { c: 'i', x: 0, y: 0, w: 10, h: 10 },
      ],
    }
    expect(charIndexAtPoint(ligature, 1, { x: 5, y: 5 })).toBe(0)
  })

  it('면적 0 인 글자는 정확히 그 점 위를 클릭해도 nearest 후보에서 이길 수 없다', () => {
    // PDFium 이 끼워 넣는 생성 \r\n 처럼 면적이 없는 글자를 흉내 낸다. 화면에 자리를
    // 차지하지 않는 글자를 "가장 가깝다"고 골라 버리면, 사용자 눈에는 아무 근거 없는
    // 자리(빈 페이지 한가운데)가 선택 시작점이 된다 — 그래서 후보에서 아예 뺀다.
    const withInvisible: PageTextIndex = {
      text: 'A\nB',
      chars: [
        { c: 'A', x: 0, y: 0, w: 10, h: 10 },
        { c: '\n', x: 50, y: 50, w: 0, h: 0 }, // A, B 둘 다로부터 멀리 떨어진 자리에 고립
        { c: 'B', x: 200, y: 200, w: 10, h: 10 },
      ],
    }
    // (50,50) 은 \n 의 점과 정확히 겹친다. 후보에 끼워 줬다면 거리 0 으로 무조건 이긴다.
    // 실제로는 A(거리 40,40)가 B(거리 150,150)보다 가까우므로 A 가 나와야 한다.
    expect(charIndexAtPoint(withInvisible, 1, { x: 50, y: 50 })).toBe(0)
  })

  it('빈 페이지는 0 을 돌려준다', () => {
    // chars 가 비어 있으면 고를 후보가 없다. text.length 도 0 이라 유효한 오프셋은
    // 0 하나뿐이다(문서의 시작이자 끝) — clampRange(core/anchor.ts)의 결론과 같다.
    const empty: PageTextIndex = { text: '', chars: [] }
    expect(charIndexAtPoint(empty, 1, { x: 0, y: 0 })).toBe(0)
  })
})

describe('selectionRange', () => {
  it('정방향 드래그: [시작, 끝) 을 돌려준다 (PF-5)', () => {
    const page = makePage(['AB', 'CD'])
    // A(0) 위에서 D(5) 위까지 정방향 드래그 -> [0, 6)
    const range = selectionRange(page, 1, { x: 74, y: 105 }, { x: 80, y: 119 })
    expect(range).toEqual([0, 6])
  })

  it('역방향 드래그(끝 -> 시작)는 정방향과 같은 범위를 돌려준다', () => {
    const page = makePage(['AB', 'CD'])
    const forward = selectionRange(page, 1, { x: 74, y: 105 }, { x: 80, y: 119 })
    const backward = selectionRange(page, 1, { x: 80, y: 119 }, { x: 74, y: 105 })
    expect(backward).toEqual(forward)
  })

  it('같은 글자 상자 안에서라도 from 과 to 가 다른 점이면 한 글자짜리 유효한 선택이다', () => {
    const page = makePage(['AB', 'CD'])
    // 둘 다 A 의 상자([72,78]x[100,112]) 안이지만 서로 다른 점 -> 빈 선택이 아니다.
    const range = selectionRange(page, 1, { x: 73, y: 101 }, { x: 77, y: 111 })
    expect(range).toEqual([0, 1])
  })

  it('빈 드래그(from === to 인 점)는 null 이다', () => {
    const page = makePage(['AB', 'CD'])
    expect(selectionRange(page, 1, { x: 74, y: 105 }, { x: 74, y: 105 })).toBeNull()
  })

  it('빈 페이지에서는 드래그해도 null 이다 — 가리킬 글자가 실제로 없다', () => {
    const empty: PageTextIndex = { text: '', chars: [] }
    expect(selectionRange(empty, 1, { x: 0, y: 0 }, { x: 100, y: 100 })).toBeNull()
  })
})
