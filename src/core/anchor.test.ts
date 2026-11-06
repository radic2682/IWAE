import { describe, it, expect } from 'vitest'
import type { CharBox, PageTextIndex } from './textIndex'
import { coalesceHighlightRects } from './anchor'

describe('coalesceHighlightRects', () => {
  it('글자별로 저장된 상자를 한 줄로 합치고 다음 줄은 유지한다', () => {
    expect(coalesceHighlightRects([
      { x: 10, y: 20, w: 7, h: 12 },
      { x: 18, y: 21, w: 6, h: 11 },
      { x: 25, y: 20, w: 8, h: 12 },
      { x: 10, y: 40, w: 9, h: 12 },
    ])).toEqual([
      { x: 10, y: 20, w: 23, h: 12 },
      { x: 10, y: 40, w: 9, h: 12 },
    ])
  })
})
import { buildAnchor, resolveAnchor, resolveAnchorAcrossPages, type Anchor } from './anchor'

/**
 * PDFium 이 실제로 주는 모양대로 페이지 인덱스를 짓는다. 진짜 PDF 는 쓰지 않는다
 * (스펙 §8: core 는 의존성 0 인 곳이고, 그래서 위험이 몰린 곳을 픽스처로 전부 덮는다).
 *
 * 두 가지를 일부러 흉내 낸다. 둘 다 Task 1 이 실측으로 확인한 성질이다.
 *  - 줄 사이에 PDFium 이 끼워 넣는 `\r\n` 두 글자. 상자가 줄 끝 한 점으로 눌려 있다(w=h=0).
 *  - 글자 하나당 상자 하나, 배열 인덱스 = text 안의 UTF-16 오프셋.
 */
const LEFT = 72 // 1인치 왼쪽 여백
const TOP = 100
const LINE_GAP = 14 // 줄 간격
const GLYPH_W = 6
const GLYPH_H = 12 // loose box 높이 — 같은 줄 글자는 모두 같은 높이다

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

const DOC = 'ab12cd34ef56'

describe('앵커 왕복 불변식 (스펙 §8 회귀 불변식 1)', () => {
  it('buildAnchor 로 만든 앵커를 바로 resolveAnchor 하면 원래 rects 가 그대로 나온다', () => {
    const page = makePage(['The OPTIONS response shall be', 'defined in Table 42 below.'])
    const start = page.text.indexOf('response')
    const end = page.text.indexOf('in Table') + 'in Table'.length

    const anchor = buildAnchor(DOC, 302, page, start, end)
    const result = resolveAnchor(anchor, page)

    expect(result.confidence).toBe('exact')
    expect(result.page).toBe(302)
    // 두 줄에 걸친 발췌라 rects 가 둘이다 — 빈 배열끼리 같아서 통과하는 일이 없게 못 박는다.
    expect(anchor.rects).toHaveLength(2)
    expect(result.rects).toEqual(anchor.rects)
  })

  it('한 글자 선택도, 줄바꿈만 고른 선택도 왕복한다', () => {
    const page = makePage(['ABCDE', 'FGHIJ'])

    const oneChar = buildAnchor(DOC, 0, page, 0, 1)
    expect(resolveAnchor(oneChar, page)).toEqual({
      rects: oneChar.rects,
      confidence: 'exact',
      page: 0,
    })

    // `\r\n` 만 고르면 그릴 것이 없어 rects 가 비지만, 그래도 exact 로 풀려야 한다.
    const newlineOnly = buildAnchor(DOC, 0, page, 5, 7)
    expect(newlineOnly.rects).toEqual([])
    expect(resolveAnchor(newlineOnly, page).confidence).toBe('exact')
  })
})

describe('buildAnchor — rects 를 줄 단위로 묶는다', () => {
  it('한 줄 안의 선택은 사각형 하나, 글자 상자들의 합집합이다', () => {
    const page = makePage(['ABCDE', 'FGHIJ'])
    const anchor = buildAnchor(DOC, 7, page, 1, 4) // BCD

    expect(anchor.rects).toEqual([{ x: 78, y: 100, w: 18, h: 12 }])
    expect(anchor.charRange).toEqual([1, 4])
    expect(anchor.coordSpace).toBe('pdfium-page')
    expect(anchor.docId).toBe(DOC)
    expect(anchor.page).toBe(7)
  })

  it('한 글자 선택은 그 글자의 상자 하나가 된다', () => {
    const page = makePage(['ABCDE', 'FGHIJ'])
    expect(buildAnchor(DOC, 0, page, 2, 3).rects).toEqual([{ x: 84, y: 100, w: 6, h: 12 }])
  })

  it('줄 중간에서 시작해 줄 중간에서 끝나면 줄마다 사각형이 하나씩 생긴다', () => {
    const page = makePage(['ABCDE', 'FGHIJ'])
    // B..G — 첫 줄은 B 부터 줄 끝까지, 둘째 줄은 줄 시작부터 G 까지다.
    const anchor = buildAnchor(DOC, 0, page, 1, 9)

    expect(anchor.rects).toEqual([
      { x: 78, y: 100, w: 24, h: 12 },
      { x: 72, y: 114, w: 12, h: 12 },
    ])
  })

  it('세 줄에 걸친 선택은 사각형 셋이다', () => {
    const page = makePage(['ABCDE', 'FGHIJ', 'KLMNO'])
    const anchor = buildAnchor(DOC, 0, page, 0, page.text.length)

    expect(anchor.rects).toEqual([
      { x: 72, y: 100, w: 30, h: 12 },
      { x: 72, y: 114, w: 30, h: 12 },
      { x: 72, y: 128, w: 30, h: 12 },
    ])
  })

  it('상자를 못 얻어 (0,0,0,0) 으로 들어온 글자가 줄 가운데 있어도 사각형을 원점까지 늘리지 않는다', () => {
    // Rust 는 loose_bounds 를 못 읽은 글자에 (0,0,0,0) 을 넣는다. 면적 0 을 거르지
    // 않으면 사각형이 페이지 왼쪽 위 구석까지 번지고 줄도 둘로 쪼개진다.
    const page: PageTextIndex = {
      text: 'ab­cd',
      chars: [
        { c: 'a', x: 72, y: 100, w: 6, h: 12 },
        { c: 'b', x: 78, y: 100, w: 6, h: 12 },
        { c: '­', x: 0, y: 0, w: 0, h: 0 },
        { c: 'c', x: 84, y: 100, w: 6, h: 12 },
        { c: 'd', x: 90, y: 100, w: 6, h: 12 },
      ],
    }

    expect(buildAnchor(DOC, 0, page, 0, 5).rects).toEqual([{ x: 72, y: 100, w: 24, h: 12 }])
  })

  it('리거처로 두 글자가 상자 하나를 공유해도 줄이 쪼개지지 않는다', () => {
    // LaTeX 조판에서 `fi` 가 글리프 하나로 합쳐지면 PDFium 은 f 와 i 에 똑같은
    // 상자를 준다(실측 56회). 인덱스는 그대로이므로 합집합이 곧 답이다.
    const page: PageTextIndex = {
      text: 'fix',
      chars: [
        { c: 'f', x: 72, y: 100, w: 9, h: 12 },
        { c: 'i', x: 72, y: 100, w: 9, h: 12 },
        { c: 'x', x: 81, y: 100, w: 6, h: 12 },
      ],
    }

    expect(buildAnchor(DOC, 0, page, 0, 3).rects).toEqual([{ x: 72, y: 100, w: 15, h: 12 }])
    expect(buildAnchor(DOC, 0, page, 0, 2).rects).toEqual([{ x: 72, y: 100, w: 9, h: 12 }])
  })

  it('같은 줄의 아래첨자는 한 줄로 묶고, 다음 줄은 쪼갠다', () => {
    // 아래첨자는 글자가 작아 loose box 의 위쪽이 내려온다(y 100 -> 104). 줄이
    // 바뀔 때의 움직임(14)과는 자릿수가 다르다.
    const page: PageTextIndex = {
      text: 'H2O\r\nnext',
      chars: [
        { c: 'H', x: 72, y: 100, w: 6, h: 12 },
        { c: '2', x: 78, y: 104, w: 4, h: 8 },
        { c: 'O', x: 82, y: 100, w: 6, h: 12 },
        { c: '\r', x: 88, y: 100, w: 0, h: 0 },
        { c: '\n', x: 88, y: 100, w: 0, h: 0 },
        { c: 'n', x: 72, y: 114, w: 6, h: 12 },
        { c: 'e', x: 78, y: 114, w: 6, h: 12 },
        { c: 'x', x: 84, y: 114, w: 6, h: 12 },
        { c: 't', x: 90, y: 114, w: 6, h: 12 },
      ],
    }

    expect(buildAnchor(DOC, 0, page, 0, 3).rects).toEqual([{ x: 72, y: 100, w: 16, h: 12 }])
    expect(buildAnchor(DOC, 0, page, 0, 9).rects).toEqual([
      { x: 72, y: 100, w: 16, h: 12 },
      { x: 72, y: 114, w: 24, h: 12 },
    ])
  })

  it('면적 0 인 글자만 고르면 그릴 것이 없다', () => {
    const page = makePage(['ABCDE', 'FGHIJ'])
    expect(buildAnchor(DOC, 0, page, 5, 7).rects).toEqual([])
  })
})

describe('buildAnchor — quote·prefix·suffix', () => {
  // 한 줄 80자. 앞뒤 문맥이 잘리지 않고 다 들어가는 길이다.
  const long = makePage(['abcdefghij'.repeat(8)])

  it('quote 는 charRange 가 가리키는 글이고, 앞뒤 문맥은 32자씩이다', () => {
    const anchor = buildAnchor(DOC, 0, long, 40, 48)

    expect(anchor.quote).toBe(long.text.slice(40, 48))
    expect(anchor.prefix).toBe(long.text.slice(8, 40))
    expect(anchor.suffix).toBe(long.text.slice(48, 80))
    expect(anchor.prefix).toHaveLength(32)
    expect(anchor.suffix).toHaveLength(32)
  })

  it('문서 맨 앞을 고르면 prefix 가 없다 — 지어내지 않고 있는 만큼만 적는다', () => {
    expect(buildAnchor(DOC, 0, long, 0, 5).prefix).toBe('')
    expect(buildAnchor(DOC, 0, long, 3, 5).prefix).toBe(long.text.slice(0, 3))
  })

  it('문서 맨 끝을 고르면 suffix 가 없다', () => {
    const end = long.text.length
    expect(buildAnchor(DOC, 0, long, end - 5, end).suffix).toBe('')
    expect(buildAnchor(DOC, 0, long, end - 5, end - 3).suffix).toBe(long.text.slice(end - 3))
  })

  it('페이지 밖으로 나간 범위는 페이지 안으로 잘린다', () => {
    const anchor = buildAnchor(DOC, 0, long, -10, 1000)
    expect(anchor.charRange).toEqual([0, 80])
    expect(anchor.quote).toBe(long.text)
  })

  it('거꾸로 끈 선택(끝 < 시작)도 바로 세운다', () => {
    const anchor = buildAnchor(DOC, 0, long, 12, 4)
    expect(anchor.charRange).toEqual([4, 12])
    expect(anchor.quote).toBe(long.text.slice(4, 12))
  })

  it('인자를 고치지 않는다 — 건네준 인덱스 전부와 앵커', () => {
    const page = makePage(['ABCDE', 'FGHIJ'])
    // `page` 는 buildAnchor 와 exact 갈래만 밟는다. 검색해서 상자를 다시 만드는
    // 갈래(searchPage → lineRects)가 실제로 훑는 것은 `shifted` 쪽 chars 배열이라,
    // 이 인덱스까지 봐야 "인자를 고치지 않는다" 를 지키는 감시자가 된다.
    const shifted = makePage(['xxABCDE', 'FGHIJ'])
    const pageBefore = structuredClone(page)
    const shiftedBefore = structuredClone(shifted)

    const anchor = buildAnchor(DOC, 0, page, 1, 9)
    const anchorBefore = structuredClone(anchor)

    // exact·relocated·lost 세 갈래를 모두 밟아 본다.
    resolveAnchor(anchor, page)
    resolveAnchor(anchor, shifted)
    resolveAnchor(anchor, { text: '', chars: [] })
    resolveAnchorAcrossPages(anchor, new Map([[2, shifted]]))

    expect(page).toEqual(pageBefore)
    expect(shifted).toEqual(shiftedBefore)
    expect(anchor).toEqual(anchorBefore)
  })
})

describe('resolveAnchor — 1단계 exact (스펙 §5.3)', () => {
  it('charRange 의 글이 quote 와 같으면 저장된 rects 를 재계산조차 하지 않는다', () => {
    const page = makePage(['ABCDE', 'FGHIJ'])
    // 일부러 계산 결과와 다른 rects 를 넣어 둔다. 다시 계산했다면 이 값이 안 나온다.
    const anchor: Anchor = {
      docId: DOC,
      page: 302,
      coordSpace: 'pdfium-page',
      rects: [{ x: 1, y: 2, w: 3, h: 4 }],
      charRange: [1, 4],
      quote: 'BCD',
      prefix: 'A',
      suffix: 'E',
    }

    expect(resolveAnchor(anchor, page)).toEqual({
      rects: [{ x: 1, y: 2, w: 3, h: 4 }],
      confidence: 'exact',
      page: 302,
    })
  })
})

describe('resolveAnchor — 2단계 relocated (스펙 §5.3)', () => {
  const before = makePage(['The OPTIONS response shall be', 'defined in Table 42 below.'])
  const after = makePage([
    'Note: added later. The OPTIONS response shall be',
    'defined in Table 42 below.',
  ])

  it('앞에 문장이 하나 끼어들어 offset 이 밀려도 quote 를 찾아 rects 를 다시 계산한다', () => {
    const start = before.text.indexOf('response')
    const anchor = buildAnchor(DOC, 302, before, start, start + 'response shall be\r\ndefined'.length)

    const result = resolveAnchor(anchor, after)

    expect(result.confidence).toBe('relocated')
    expect(result.page).toBe(302)
    // 새 자리: 'Note: added later. ' 19자만큼 오른쪽으로 밀렸다(열 31, x = 72 + 31*6).
    expect(result.rects).toEqual([
      { x: 258, y: 100, w: 102, h: 12 },
      { x: 72, y: 114, w: 42, h: 12 },
    ])
  })

  it('밀린 자리의 글이 우연히 quote 와 같은 길이여도, 다른 글이면 exact 가 아니다', () => {
    const start = before.text.indexOf('response')
    const anchor = buildAnchor(DOC, 302, before, start, start + 8)
    expect(resolveAnchor(anchor, after).confidence).toBe('relocated')
  })
})

describe('resolveAnchor — 같은 quote 가 여러 번 나올 때 문맥으로 고른다', () => {
  it('prefix 가 가리키는 쪽을 고른다', () => {
    const before = makePage(['Alpha: the value shall be ignored.', 'Beta: the value shall be ignored.'])
    const after = makePage([
      'Note. Alpha: the value shall be ignored.',
      'Beta: the value shall be ignored.',
    ])
    const quote = 'the value shall be ignored.'
    const start = before.text.lastIndexOf(quote)
    const anchor = buildAnchor(DOC, 302, before, start, start + quote.length)

    const result = resolveAnchor(anchor, after)

    expect(result.confidence).toBe('relocated')
    // 둘째 줄(y=114)의 'Beta: ' 뒤가 정답이다.
    expect(result.rects).toEqual([{ x: 108, y: 114, w: 162, h: 12 }])
  })

  it('앞 문맥이 똑같이 일치하면 뒤 문맥이 정한다 — 위치가 더 가까운 후보보다 우선한다', () => {
    const page = makePage([
      'the same lead words repeated here MARK tail alpha',
      'the same lead words repeated here MARK tail beta',
    ])
    // 두 MARK 의 앞 32자는 글자 하나까지 같다('e same lead words repeated here ').
    // 뒤 문맥만 갈린다: 첫째 줄은 ' tail alpha', 둘째 줄은 ' tail beta'.
    const anchor: Anchor = {
      docId: DOC,
      page: 302,
      coordSpace: 'pdfium-page',
      rects: [{ x: 0, y: 0, w: 0, h: 0 }],
      // 위치만 보면 첫째 줄 MARK(인덱스 34)가 압도적으로 가깝다.
      charRange: [33, 37],
      quote: 'MARK',
      prefix: 'e same lead words repeated here ',
      suffix: ' tail beta',
    }

    const result = resolveAnchor(anchor, page)

    expect(result.confidence).toBe('relocated')
    expect(result.rects).toEqual([{ x: 276, y: 114, w: 24, h: 12 }])
  })

  it('문맥이 하나도 없으면 원래 위치에 가까운 쪽을 고른다', () => {
    const page = makePage(['MARK one', 'MARK two'])
    const anchor: Anchor = {
      docId: DOC,
      page: 302,
      coordSpace: 'pdfium-page',
      rects: [],
      charRange: [9, 13], // 둘째 줄 MARK(인덱스 10) 근처. 첫째 줄(0)보다 가깝다.
      quote: 'MARK',
      prefix: '',
      suffix: '',
    }

    expect(resolveAnchor(anchor, page).rects).toEqual([{ x: 72, y: 114, w: 24, h: 12 }])
  })
})

describe('resolveAnchor — 4단계 lost (스펙 §5.3, §5.4)', () => {
  it('quote 가 그 페이지에서 사라졌으면 lost 다 — 엉뚱한 자리를 가리키지 않는다', () => {
    const before = makePage(['The OPTIONS response shall be', 'defined in Table 42 below.'])
    const rewritten = makePage(['This section was rewritten in', 'revision 1.2 and says nothing.'])
    const start = before.text.indexOf('response')
    const anchor = buildAnchor(DOC, 302, before, start, start + 8)

    expect(resolveAnchor(anchor, rewritten)).toEqual({
      rects: [],
      confidence: 'lost',
      page: 302,
    })
  })

  it('페이지에 글자가 하나도 없어도(그림만 있는 페이지) 죽지 않고 lost 를 돌려준다', () => {
    const before = makePage(['The OPTIONS response shall be'])
    const anchor = buildAnchor(DOC, 302, before, 4, 11)

    expect(resolveAnchor(anchor, { text: '', chars: [] }).confidence).toBe('lost')
  })
})

describe('resolveAnchorAcrossPages — 3단계 (스펙 §5.3)', () => {
  const source = makePage(['The OPTIONS response shall be', 'defined in Table 42 below.'])
  const elsewhere = makePage(['Moved here: The OPTIONS response shall be', 'defined elsewhere.'])
  const unrelated = makePage(['Nothing to see on this page.'])
  const quoteStart = source.text.indexOf('response')
  const anchor = buildAnchor(DOC, 302, source, quoteStart, quoteStart + 'response shall be'.length)

  it('원래 페이지엔 없고 +2 페이지에 있으면 그 페이지에서 relocated 다', () => {
    const pages = new Map([
      [302, unrelated],
      [304, elsewhere],
    ])

    const result = resolveAnchorAcrossPages(anchor, pages)

    expect(result.confidence).toBe('relocated')
    expect(result.page).toBe(304)
    // 'Moved here: ' 12자만큼 밀린 자리(열 24, x = 72 + 24*6).
    expect(result.rects).toEqual([{ x: 216, y: 100, w: 102, h: 12 }])
  })

  it('어디에도 없으면 lost 이고, 페이지는 원래 페이지 그대로다', () => {
    const pages = new Map([
      [301, unrelated],
      [302, unrelated],
      [303, unrelated],
    ])

    expect(resolveAnchorAcrossPages(anchor, pages)).toEqual({
      rects: [],
      confidence: 'lost',
      page: 302,
    })
  })

  it('원래 페이지가 맵에 있고 그대로면 exact 로 끝난다 — resolveAnchor 와 같은 답이다', () => {
    const pages = new Map([
      [302, source],
      [304, elsewhere],
    ])

    expect(resolveAnchorAcrossPages(anchor, pages)).toEqual(resolveAnchor(anchor, source))
  })

  it('가까운 페이지부터 본다', () => {
    const near = makePage(['near: The OPTIONS response shall be here.'])
    const far = makePage(['far: The OPTIONS response shall be here.'])
    const pages = new Map([
      [302, unrelated],
      [303, near],
      [307, far],
    ])

    expect(resolveAnchorAcrossPages(anchor, pages).page).toBe(303)
  })

  it('거리가 같으면 뒤쪽 페이지를 먼저 본다', () => {
    const pages = new Map([
      [301, elsewhere],
      [302, unrelated],
      [303, elsewhere],
    ])

    expect(resolveAnchorAcrossPages(anchor, pages).page).toBe(303)
  })
})
