/**
 * 출처 앵커. 발췌한 글이 원본 PDF 의 어디에서 왔는지를 두 겹으로 적고, 문서가 변한
 * 뒤에도 그 자리를 다시 찾아낸다(스펙 §5).
 *
 * 두 겹인 이유(§5.2, W3C Web Annotation 의 TextQuoteSelector + TextPositionSelector):
 * `rects`·`charRange` 는 빠른 정확한 복원용이고, `quote`·`prefix`·`suffix` 는 문서가
 * 변했을 때의 재탐색용이다. 좌표만 적어 두면 문서가 조금만 바뀌어도 엉뚱한 곳을 가리키고,
 * 인용문만 적어 두면 매번 페이지 전체를 뒤져야 한다.
 *
 * 이 파일은 DOM 도 React 도 Tauri 도 PDF 도 모른다. 데이터를 받아 데이터를 돌려주는
 * 순수 함수뿐이다 — 인자를 고치지 않고, 숨은 상태도 없다. 스펙 §8 이 말하는 대로
 * 제품의 위험이 몰린 곳이 정확히 의존성 0 인 곳이라, 여기를 진짜 PDF 없이 전부 시험한다.
 */

import type { CharBox, PageTextIndex } from './textIndex'

export interface AnchorRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** 오래된 PDF 앵커의 글자별 상자를 화면에서 연속된 줄로 합친다. */
export function coalesceHighlightRects(rects: readonly AnchorRect[]): AnchorRect[] {
  const merged: AnchorRect[] = []
  for (const rect of rects) {
    if (!Number.isFinite(rect.x + rect.y + rect.w + rect.h) || rect.w <= 0 || rect.h <= 0) continue
    const previous = merged[merged.length - 1]
    if (previous !== undefined) {
      const overlap = Math.min(previous.y + previous.h, rect.y + rect.h) - Math.max(previous.y, rect.y)
      const gap = rect.x - (previous.x + previous.w)
      if (overlap >= Math.min(previous.h, rect.h) * 0.45 && gap >= -Math.max(previous.h, rect.h) && gap <= Math.max(previous.h, rect.h) * 0.7) {
        const left = Math.min(previous.x, rect.x)
        const top = Math.min(previous.y, rect.y)
        merged[merged.length - 1] = {
          x: left, y: top,
          w: Math.max(previous.x + previous.w, rect.x + rect.w) - left,
          h: Math.max(previous.y + previous.h, rect.y + rect.h) - top,
        }
        continue
      }
    }
    merged.push(rect)
  }
  return merged
}

export interface Anchor {
  readonly docId: string
  readonly page: number
  /** 좌표계는 언제나 PDFium 페이지 좌표(points)다. 스펙 §5.1. */
  readonly coordSpace: 'pdfium-page'
  /** 발췌를 덮는 사각형들. 줄마다 하나씩이다. */
  readonly rects: readonly AnchorRect[]
  /** `[시작, 끝)` — 끝은 포함하지 않는다. `text.slice(...)` 와 같은 약속이다. */
  readonly charRange: readonly [number, number]
  readonly quote: string
  readonly prefix: string
  readonly suffix: string
}

export type ResolveConfidence = 'exact' | 'relocated' | 'lost'

export interface ResolveResult {
  readonly rects: readonly AnchorRect[]
  readonly confidence: ResolveConfidence
  /**
   * `rects` 가 놓인 페이지. `resolveAnchorAcrossPages` 는 다른 페이지로 옮겨 갈 수
   * 있으므로 이 숫자가 없으면 결과를 그릴 수도, 그리로 점프할 수도 없다.
   * `lost` 일 때는 원래 페이지를 그대로 돌려준다(배지를 띄울 자리는 거기다).
   */
  readonly page: number
}

/**
 * 앞뒤 문맥을 몇 글자나 적어 둘지.
 *
 * 문맥의 쓸모는 하나뿐이다 — 같은 인용문이 한 페이지에 여러 번 나올 때 어느 쪽인지
 * 고르는 것. 한 페이지에 담기는 글자는 많아야 수천이고, 규격 문서에서 되풀이되는
 * 문장("shall be ignored." 같은)이라도 바로 앞뒤 32글자까지 똑같은 경우는 사실상 없다.
 * 더 길게 적으면 문맥 자체가 수정될 확률만 올라가고(멀리 있는 글일수록 발췌와 무관하게
 * 고쳐진다) 블록마다 `.canvas` 파일이 그만큼 두꺼워진다. 이 패턴을 가장 크게 굴리는
 * Hypothes.is 도 같은 이유로 32 를 쓴다.
 */
const CONTEXT_LENGTH = 32

/** 눈에 보이는 글자인가. 면적이 0 이면 화면에서 아무 자리도 차지하지 않는다. */
function isVisible(box: CharBox): boolean {
  // PDFium 이 끼워 넣는 생성 `\r\n` 이 바로 이 모양이다(w=h=0). NaN 도 여기서 걸러
  // 둬야 한다 — 비교 연산은 NaN 을 조용히 통과시키고, 그러면 사각형 하나가 아니라
  // 그 줄 전체가 NaN 으로 물든다.
  return Number.isFinite(box.w) && box.w > 0 && Number.isFinite(box.h) && box.h > 0
}

/**
 * `[start, end)` 구간의 글자 상자들을 **줄 단위로** 묶어 사각형을 만든다.
 *
 * 여러 줄에 걸친 발췌는 사각형 하나로 표현할 수 없다 — 줄마다 시작 x 와 끝 x 가 다르다.
 * 그래서 y 가 이어지는 구간을 한 줄로 보고 줄마다 하나씩 만든다.
 *
 * # "같은 줄" 의 오차범위 — 두 상자 높이 중 작은 쪽의 절반
 *
 * 같은 줄 안에서도 y 는 조금씩 흔들린다. 아래첨자·각주 번호·본문에 섞인 수식처럼 글자
 * 크기가 다르면 loose box 의 위쪽이 그만큼 내려오기 때문이다. 반대로 줄이 바뀌면 y 는
 * 최소한 한 줄 높이만큼 움직인다. 두 상황 사이의 한가운데가 **글자 높이의 절반**이고,
 * 이것은 고정된 점수(예: 2pt)와 달리 글자 크기에 저절로 맞춰진다 — 6pt 각주에서도
 * 40pt 제목에서도 같은 뜻을 유지한다.
 *
 * 둘 중 작은 높이를 쓰는 이유는 두 실수의 무게가 다르기 때문이다. 한 줄을 둘로
 * 쪼개면 같은 줄에 사각형 두 개가 나란히 놓일 뿐 보이는 결과는 같다. 반면 줄바꿈을
 * 놓치면 두 줄을 한 덩어리로 덮는 커다란 사각형이 생겨 선택하지도 않은 글자까지
 * 칠해진다. 눈에 보이는 쪽 실수를 피해 더 엄격한 기준을 고른다.
 *
 * 비교는 바로 앞 글자와 한다(누적된 첫 글자와가 아니라). 한 줄 안의 흔들림은 이웃
 * 사이에서 작고, 줄이 바뀌는 순간은 이웃 사이에서 크다 — 재는 자리가 "연속 구간"과
 * 같아야 한다.
 *
 * 한계 하나를 적어 둔다: 판정에 y 만 쓰므로 2단 조판에서 왼쪽 단 끝과 오른쪽 단
 * 시작이 같은 높이면 한 줄로 묶인다. 스펙 §5.3 도 브리프도 줄 판정을 y 로 정의하고,
 * 그 경우 사각형이 단 사이 여백까지 덮는 것이 유일한 증상이라 여기서 더 나가지 않는다.
 */
function lineRects(chars: readonly CharBox[], start: number, end: number): AnchorRect[] {
  const rects: AnchorRect[] = []

  // 열려 있는 줄. 합집합을 네 변으로 들고 다닌다.
  let left = 0
  let top = 0
  let right = 0
  let bottom = 0
  // 직전 글자의 y·h — 다음 글자가 같은 줄인지 재는 기준이다.
  let lastY = 0
  let lastH = 0
  let open = false

  const closeLine = (): void => {
    if (open) rects.push({ x: left, y: top, w: right - left, h: bottom - top })
  }

  for (let i = start; i < end; i++) {
    const box = chars[i]
    // noUncheckedIndexedAccess: 범위를 이미 잘라 왔지만 타입 시스템은 모른다.
    // 인덱스가 비어 있다는 건 "그 자리에 글자가 없다" 는 뜻이니 건너뛰는 게 맞다.
    if (box === undefined) continue
    // 면적 0 인 글자(줄 끝의 생성 `\r\n`)는 그리지도, 줄 판정에 쓰지도 않는다.
    // 높이가 0 이라 오차범위가 0 이 되어 버려서, 끼워 두면 줄마다 거짓 줄바꿈이 생긴다.
    if (!isVisible(box)) continue

    const sameLine = open && Math.abs(box.y - lastY) <= Math.min(lastH, box.h) / 2
    if (sameLine) {
      left = Math.min(left, box.x)
      top = Math.min(top, box.y)
      right = Math.max(right, box.x + box.w)
      bottom = Math.max(bottom, box.y + box.h)
    } else {
      closeLine()
      left = box.x
      top = box.y
      right = box.x + box.w
      bottom = box.y + box.h
      open = true
    }
    lastY = box.y
    lastH = box.h
  }
  closeLine()

  return rects
}

/**
 * `charStart`/`charEnd` 를 이 인덱스 안의 쓸 수 있는 `[시작, 끝)` 으로 바로잡는다.
 *
 * 앵커에 적히는 값이 곧 이 값이다. 복원 1단계가 `text.slice(charRange[0], charRange[1])`
 * 로 확인하므로, 저장된 범위와 `quote` 를 만든 범위가 한 글자라도 다르면 방금 만든
 * 앵커조차 `exact` 로 풀리지 않는다 — 왕복 불변식(스펙 §8)이 여기서 깨진다.
 */
function clampRange(index: PageTextIndex, charStart: number, charEnd: number): [number, number] {
  const length = index.text.length
  const safe = (value: number): number =>
    Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 0), length) : 0
  const a = safe(charStart)
  const b = safe(charEnd)
  // 뒤집힌 범위는 "거꾸로 끈 선택" 이지 오류가 아니다. 위아래로 드래그한 결과가
  // 여기까지 그대로 올 수 있으므로 조용히 바로 세운다.
  return a <= b ? [a, b] : [b, a]
}

/**
 * 페이지 텍스트 인덱스와 글자 범위로부터 앵커를 만든다. `charEnd` 는 포함하지 않는다.
 */
export function buildAnchor(
  docId: string,
  page: number,
  index: PageTextIndex,
  charStart: number,
  charEnd: number,
): Anchor {
  const [start, end] = clampRange(index, charStart, charEnd)

  return {
    docId,
    page,
    coordSpace: 'pdfium-page',
    rects: lineRects(index.chars, start, end),
    charRange: [start, end],
    quote: index.text.slice(start, end),
    // 문서 맨 앞·맨 끝에서는 적을 문맥이 모자란다. slice 가 알아서 잘라 주므로
    // 짧은 문맥이 남고, 아무것도 없으면 빈 문자열이다 — 문맥이 없다는 사실
    // 자체가 정보라서(그 자리는 페이지의 시작이다) 지어내지 않는다.
    prefix: index.text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: index.text.slice(end, end + CONTEXT_LENGTH),
  }
}

/** `quote` 가 나오는 모든 자리. 겹치는 등장까지 하나도 빼지 않고 센다. */
function occurrences(text: string, quote: string): number[] {
  const found: number[] = []
  // 빈 quote 는 모든 자리에 있으므로 어느 자리도 가리키지 않는다. 찾은 척하면
  // 페이지 맨 앞을 정답이라고 우기게 된다 — 못 찾은 것으로 보는 편이 정직하다.
  if (quote.length === 0) return found
  for (let from = 0; ; ) {
    const at = text.indexOf(quote, from)
    if (at === -1) break
    found.push(at)
    // +1 씩 나아간다. quote 길이만큼 건너뛰면 'aa' 를 'aaa' 에서 한 번밖에
    // 못 찾는데, 후보를 놓치면 문맥으로 고를 기회 자체가 없어진다.
    from = at + 1
  }
  return found
}

/**
 * 경계에서 바깥쪽으로 세어 나가며 연속으로 몇 글자가 일치하는지.
 *
 * 편집 거리 같은 것을 쓰지 않는 이유: 문서가 바뀌면 글이 통째로 밀리므로 멀리 있는
 * 글자를 자리끼리 맞대 보는 것은 잡음이다. 후보를 구분해 주는 것은 인용문 **바로 옆**
 * 글자들이고, 거기서부터 끊길 때까지 세는 것이 가장 싸면서 가장 잘 드는 자다.
 */
function matchBackward(text: string, boundary: number, expected: string): number {
  let matched = 0
  while (matched < expected.length) {
    // 경계 바로 왼쪽부터 한 칸씩 뒤로. 페이지 앞을 넘어가면 undefined 라 저절로 멈춘다.
    if (text[boundary - 1 - matched] !== expected[expected.length - 1 - matched]) break
    matched += 1
  }
  return matched
}

function matchForward(text: string, boundary: number, expected: string): number {
  let matched = 0
  while (matched < expected.length) {
    if (text[boundary + matched] !== expected[matched]) break
    matched += 1
  }
  return matched
}

/**
 * 여러 후보 중 하나를 고른다 — 스펙 §5.3 2단계의 "가장 가까운 문맥이 일치하는 위치".
 *
 * 점수는 `prefix` 를 뒤로 세어 맞은 글자 수 + `suffix` 를 앞으로 세어 맞은 글자 수다
 * (각각 최대 CONTEXT_LENGTH). 높은 쪽이 이긴다.
 *
 * 동점이면 **원래 charRange 의 시작에 가장 가까운 후보**를 고른다. 문서를 고쳐도 보통은
 * 한 문단이 끼거나 빠질 뿐이라 원래 자리에서 멀지 않기 때문이다. 거리까지 같으면
 * (원래 자리를 사이에 두고 양쪽으로 똑같이 떨어진 경우) 앞쪽 후보를 쓴다 — 자의적이지만
 * 정해져 있다는 것이 중요하다. 같은 입력에 늘 같은 답이 나오지 않으면 다시 열 때마다
 * 하이라이트가 이 줄 저 줄로 옮겨 다닌다.
 */
function pickOccurrence(
  text: string,
  anchor: Anchor,
  candidates: readonly number[],
): number | undefined {
  const origin = anchor.charRange[0]
  let best: number | undefined
  let bestScore = -1
  let bestDistance = Number.POSITIVE_INFINITY

  for (const at of candidates) {
    const score =
      matchBackward(text, at, anchor.prefix) +
      matchForward(text, at + anchor.quote.length, anchor.suffix)
    const distance = Math.abs(at - origin)
    // 부등호가 둘 다 진짜 부등호다 — 점수도 거리도 같으면 먼저 본 후보가 남고,
    // `occurrences` 가 오름차순으로 주므로 그것이 곧 "앞쪽 후보" 다.
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = at
      bestScore = score
      bestDistance = distance
    }
  }
  return best
}

/**
 * 한 페이지 안에서 `quote` 를 찾아 rects 를 다시 계산한다. 못 찾으면 undefined.
 * 빈 배열이 아니라 undefined 인 이유: 면적 0 인 글자만 고른 발췌는 "찾았는데 그릴 게
 * 없는" 정상 결과라서, 못 찾은 것과 구분되어야 한다.
 */
function searchPage(anchor: Anchor, index: PageTextIndex): AnchorRect[] | undefined {
  const at = pickOccurrence(index.text, anchor, occurrences(index.text, anchor.quote))
  if (at === undefined) return undefined
  return lineRects(index.chars, at, at + anchor.quote.length)
}

/**
 * 스펙 §5.3 의 1·2단계. 3단계(±5페이지 → 전체)는 `resolveAnchorAcrossPages` 가 맡는다.
 *
 * `sameDocPage` 는 `charRange` 가 가리키던 바로 그 페이지의 **지금** 인덱스다.
 */
export function resolveAnchor(anchor: Anchor, sameDocPage: PageTextIndex): ResolveResult {
  // 1단계. 저장된 자리의 글이 그대로면 저장된 rects 를 재계산조차 하지 않고 쓴다 —
  // 스펙이 말하는 가장 싼 경로이고, 압도적으로 자주 밟는 경로다.
  if (sameDocPage.text.slice(anchor.charRange[0], anchor.charRange[1]) === anchor.quote) {
    return { rects: anchor.rects, confidence: 'exact', page: anchor.page }
  }

  // 2단계. 글이 밀렸을 뿐 그 페이지에 아직 있으면 새 자리에서 상자를 다시 만든다.
  const relocated = searchPage(anchor, sameDocPage)
  if (relocated !== undefined) {
    return { rects: relocated, confidence: 'relocated', page: anchor.page }
  }

  // 4단계. 이 페이지에서는 끝났다. 더 넓게 볼지는 부르는 쪽이 정한다.
  return { rects: [], confidence: 'lost', page: anchor.page }
}

/**
 * 스펙 §5.3 의 3단계. `pages` 에 담긴 페이지들을 **원래 페이지에서 가까운 순서로** 훑는다.
 * 어디까지 담을지는 부르는 쪽 몫이다(±5페이지 → 전체). 멀리 갈수록 비싸므로 앞 단계가
 * 성공하면 이 함수까지 오지 않는다.
 *
 * 원래 페이지가 맵에 들어 있으면 거리 0 이라 가장 먼저 보고, 그 페이지에 한해서는
 * `resolveAnchor` 를 그대로 부른다. 즉 `exact` 도 나올 수 있다 — 맵에 원래 페이지만
 * 담아 부르면 `resolveAnchor` 와 글자 하나까지 같은 답이 나와야 한다는 뜻이고, 두 입구가
 * 다른 답을 내면 부르는 쪽이 어느 쪽을 믿어야 할지 알 수 없게 된다.
 *
 * 다른 페이지에서는 `charRange` 가 의미를 잃으므로(그 숫자는 원래 페이지의 오프셋이다)
 * 검색만 한다. 그래서 결과는 `relocated` 아니면 `lost` 다.
 */
export function resolveAnchorAcrossPages(
  anchor: Anchor,
  pages: ReadonlyMap<number, PageTextIndex>,
): ResolveResult {
  const ordered = [...pages.keys()].sort((a, b) => {
    const distance = Math.abs(a - anchor.page) - Math.abs(b - anchor.page)
    if (distance !== 0) return distance
    // 거리가 같으면 뒤쪽 페이지부터. 문서 개정은 지우는 일보다 끼워 넣는 일이
    // 훨씬 잦고, 앞에 글이 끼면 우리가 찾는 글은 뒤 페이지로 밀려난다.
    return b - a
  })

  for (const page of ordered) {
    const index = pages.get(page)
    // 키로 돌고 있으므로 비어 있을 수 없지만, 단언 대신 건너뛰는 것으로 좁힌다.
    if (index === undefined) continue

    if (page === anchor.page) {
      const own = resolveAnchor(anchor, index)
      if (own.confidence !== 'lost') return own
      continue
    }

    const found = searchPage(anchor, index)
    if (found !== undefined) return { rects: found, confidence: 'relocated', page }
  }

  return { rects: [], confidence: 'lost', page: anchor.page }
}
