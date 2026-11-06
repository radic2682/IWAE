/**
 * 선택 히트테스트. 마우스 드래그(화면 px)를 char 인덱스 범위로 바꾸는 순수 계산만
 * 둔다 — DOM 도 React 도 Tauri 도 PDF 도 모른다(스펙 §7). pageLayout.ts·anchor.ts와
 * 같은 이유로 이 파일만 따로 둔다: 좌표를 픽셀에서 글자로 되짚는 계산 자체가
 * 진짜 PDF 없이도, 화면 없이도 시험할 수 있다.
 *
 * 좌표 두 겹을 오간다. `PageTextIndex.chars` 의 `x`/`y`는 PDFium 페이지 좌표(points,
 * y 는 아래로 증가)이고, 이 모듈이 받는 `point`는 페이지 렌더 좌상단을 원점으로 하는
 * 화면 px 다. `renderScale`(페이지 렌더 폭 ÷ 페이지 원래 폭)이 그 둘을 잇는 유일한
 * 다리이고, 여기서만 적용한다 — 스펙 §5.1: 변환을 안 하는 것이 최선의 변환이므로
 * 줌 배율이나 렌더 해상도를 저장된 좌표 쪽에 섞지 않는다.
 */

import type { CharBox, PageTextIndex } from '../core/textIndex'

/**
 * renderScale 이 고장 나 있어도(0 이하, NaN) 나눗셈이 Infinity/NaN 을 퍼뜨리지
 * 않게 막는다. 정상 경로에서는 PdfPane 이 항상 양수를 넘기지만, pageLayout.ts 의
 * safeRenderWidth 가 보여 주듯 폭을 아직 못 잰 최초 렌더 순간에 0 이 들어오는 사례가
 * 실제로 있다 — 여기서도 같은 방어를 해 둔다.
 */
function safeScale(renderScale: number): number {
  return Number.isFinite(renderScale) && renderScale > 0 ? renderScale : 1
}

/** 화면 px 점을 페이지 좌표(points) 점으로. */
function toPagePoint(
  renderScale: number,
  point: { x: number; y: number },
): { x: number; y: number } {
  const scale = safeScale(renderScale)
  return { x: point.x / scale, y: point.y / scale }
}

/**
 * 눈에 보이는 글자인가. core/anchor.ts 의 isVisible 과 같은 판정이지만 그쪽은
 * 모듈 밖으로 내보내지 않으므로 여기 다시 둔다. PDFium 이 줄 끝에 끼워 넣는 생성
 * `\r\n`은 상자가 한 점으로 눌려 있어(w=h=0) 화면에 자리를 차지하지 않는다.
 */
function isVisible(box: CharBox): boolean {
  return Number.isFinite(box.w) && box.w > 0 && Number.isFinite(box.h) && box.h > 0
}

/** value 가 [min, max] 안이면 0, 밖이면 가까운 쪽 끝까지의 거리. */
function axisDistance(value: number, min: number, max: number): number {
  if (value < min) return min - value
  if (value > max) return value - max
  return 0
}

/**
 * 화면 좌표(페이지 렌더 좌상단 기준 px, 렌더 배율 포함) 하나가 어느 char 인덱스에
 * 해당하는지. 그 좌표를 포함하는 char box 가 없으면 가장 가까운 것으로 스냅한다 —
 * 글자 사이 여백을 클릭해도 선택이 시작되어야 한다.
 *
 * # "가장 가깝다"의 정의: (세로 거리, 가로 거리) 사전식 비교
 *
 * 세로 거리가 다르면 세로가 작은 쪽이 무조건 이기고, 세로가 같을 때만 가로로 가른다.
 * 텍스트는 줄 단위로 흐르므로 이렇게 해야 두 줄 사이 여백을 클릭했을 때 "세로로
 * 훨씬 가까운" 줄이 이긴다. 가로세로를 하나로 합친 단순 유클리드 거리를 썼다면, 멀리
 * 있는 줄에 우연히 클릭 x 와 정확히 겹치는 글자가 있을 때 그 글자가 세로로 훨씬 가까운
 * 지금 줄의 글자를 이겨 버린다 — 사용자가 조준한 줄이 아니다(아래 테스트가 이 실패
 * 사례를 그대로 재현하고 고정한다).
 *
 * 포함 판정은 이 규칙의 특수한 경우일 뿐이다. 점이 상자 안에 있으면 거리가 정확히
 * (0, 0)이라, 스캔 도중 그 상자를 만나는 순간 이미 있을 수 있는 가장 작은 값이고,
 * 다른 상자가 같은 점을 담고 있어도 (0, 0)보다 작을 수 없어 갈아치우지 못한다.
 * 동점이면 배열에서 먼저 나오는(인덱스가 더 작은) 글자가 그대로 남는다 — 타이프셋
 * "fi" 리가처처럼 f 와 i 가 완전히 같은 사각형을 보고하는 경우(Task 1 실측: 한 LaTeX
 * 논문에서 56 회)가 바로 이 규칙으로 풀린다. 어느 쪽을 골라도 사용자 눈에는 같은
 * 자리라 임의적이지만, 스캔 순서를 그대로 쓰는 것으로 결정해 두면 같은 입력에는
 * 늘 같은 답이 나온다.
 *
 * 면적 0 인 글자(`isVisible`이 거르는 것들)는 후보에서 아예 뺀다. 포함 판정에서
 * 절대 못 이기는 것과 같은 논리다 — 화면에 아무 자리도 차지하지 않는 글자를 "가장
 * 가깝다"고 골라 버리면, 사용자 눈에는 근거 없는 자리(그 문자가 존재하는지도 모르는
 * 자리)가 선택 시작점이 되어 버린다.
 *
 * 빈 페이지(chars 가 비어 있음)는 고를 후보가 없다. 0 을 돌려준다 — 길이 0 인
 * 텍스트에서 유효한 오프셋은 0 하나뿐이고(문서의 시작이자 끝), core/anchor.ts 의
 * clampRange 가 잘못된 값을 0 으로 접는 것과 같은 결론이다.
 */
export function charIndexAtPoint(
  index: PageTextIndex,
  renderScale: number,
  point: { x: number; y: number },
): number {
  const pagePoint = toPagePoint(renderScale, point)

  let best: number | undefined
  let bestVertical = Number.POSITIVE_INFINITY
  let bestHorizontal = Number.POSITIVE_INFINITY

  for (let i = 0; i < index.chars.length; i++) {
    const box = index.chars[i]
    // noUncheckedIndexedAccess: 루프 범위는 항상 유효하지만 타입 시스템은 모른다.
    if (box === undefined || !isVisible(box)) continue

    const vertical = axisDistance(pagePoint.y, box.y, box.y + box.h)
    const horizontal = axisDistance(pagePoint.x, box.x, box.x + box.w)

    if (vertical < bestVertical || (vertical === bestVertical && horizontal < bestHorizontal)) {
      best = i
      bestVertical = vertical
      bestHorizontal = horizontal
    }
  }

  return best ?? 0
}

/**
 * 두 화면 좌표(드래그 시작·끝) 사이의 charRange. 시작이 끝보다 아래/오른쪽이면
 * 뒤집어서 항상 [작은, 큰] 순서로 돌려준다 — 사용자는 아래에서 위로도 드래그한다.
 *
 * 두 끝점을 각각 `charIndexAtPoint`로 포함 인덱스까지 바꾼 다음 `[min, max + 1)`로
 * 돌려준다(PF-5) — anchor.ts의 `Anchor.charRange`와 같은 "끝은 포함하지 않는다"
 * 약속이다. 드래그가 정확히 한 글자만 덮어도 그 결과는 `[i, i + 1)`이 된다.
 *
 * "빈 선택"은 화면 좌표 `from`/`to`가 완전히 같은 점일 때로 정의한다(브리프). char
 * 인덱스가 우연히 같아지는 경우 — 같은 글자 상자 안에서 아주 짧게 드래그했지만
 * 시작점과 끝점 자체는 다른 경우 — 와는 다르다. 그런 드래그는 여전히 한 글자짜리
 * 유효한 선택이다: 클릭 하나(드래그 없음)만 `null`이어야 한다.
 *
 * 빈 페이지(chars 없음)는 무조건 `null`이다. `charIndexAtPoint`가 그런 인덱스에는
 * 항상 0 을 돌려주므로, 점 검사만으로는 서로 다른 두 점이 `[0, 1)`을 만들어 낼
 * 텐데, `text.length`가 0 이라 실제로는 가리킬 글자가 하나도 없다. "고를 게 없다"는
 * 사실 자체가 정보이니 지어내지 않는다.
 */
export function selectionRange(
  index: PageTextIndex,
  renderScale: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
): readonly [number, number] | null {
  if (index.text.length === 0) return null
  if (from.x === to.x && from.y === to.y) return null

  const a = charIndexAtPoint(index, renderScale, from)
  const b = charIndexAtPoint(index, renderScale, to)

  return [Math.min(a, b), Math.max(a, b) + 1]
}
