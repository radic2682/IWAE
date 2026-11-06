/**
 * "이 페이지를 몇 픽셀 폭으로 렌더해 달라고 할 것인가"의 산술.
 * pageLayout.ts 와 같은 이유로 DOM 도 React 도 없는 순수 계산만 둔다 —
 * 흐릿함과 렌더 폭주가 둘 다 이 한 줄의 숫자에서 갈린다.
 */

/** src-tauri/src/pdf/engine.rs 의 MIN_RENDER_WIDTH 와 같은 값.
 * 범위 밖이면 iwae:// 가 400 으로 답하고 화면에는 빈 자리만 남는다 —
 * 원인이 안 보이는 고장이라 요청을 만들기 전에 여기서 잘라 둔다. */
export const MIN_RENDER_WIDTH = 32

/** 같은 파일의 MAX_RENDER_WIDTH. 상한이 있는 이유는 Rust 쪽 주석에 있다 —
 * PDFium 이 폭에 비례하는 비트맵을 먼저 할당하기 때문이다. */
export const MAX_RENDER_WIDTH = 4800

/** 같은 파일의 MAX_RENDER_PIXELS. 폭은 범위 안이어도 세로로 긴 쪽은 이 값을 넘을 수 있어
 * (넘으면 400 → 빈 쪽) 요청 전에 쪽 비율로 폭을 더 줄인다. */
export const MAX_RENDER_PIXELS = 36_000_000

/**
 * 렌더 폭을 이 간격으로 올림한다.
 *
 * 구분선을 끌면 패널 폭이 픽셀 단위로 연속해서 바뀐다. 그 값을 그대로
 * URL 에 넣으면 드래그 한 번에 URL 이 수백 개 생기고, 그때마다 새 요청이
 * Rust 의 FIFO 렌더 큐에 쌓인다(취소가 없다). 게다가 매번 URL 이 달라지니
 * 프로토콜이 붙여 보내는 1년짜리 Cache-Control 도 한 번도 맞지 않는다.
 * 100px 로 올림하면 작은 드래그 내내 URL 이 같은 문자열로 남아, 브라우저가
 * Rust 까지 가지도 않고 캐시에서 꺼낸다.
 */
export const RENDER_WIDTH_STEP = 100
export const MIN_RENDER_SCALE = 2

/** Rust 가 받아 주는 범위 안의 정수로 만든다. */
export function clampRenderWidth(width: number): number {
  if (!Number.isFinite(width)) return MIN_RENDER_WIDTH
  return Math.min(Math.max(Math.round(width), MIN_RENDER_WIDTH), MAX_RENDER_WIDTH)
}

/**
 * CSS 폭과 화면 배율로 요청할 비트맵 폭을 정한다.
 *
 * `devicePixelRatio` 를 곱하는 것이 이 함수의 존재 이유다. 이 기계는 배율이
 * 150% 라 CSS 400px 짜리 상자가 실제로는 600 물리 픽셀을 차지한다 —
 * 400px 비트맵을 보내면 브라우저가 1.5배로 늘려 그리고, 글자가 뭉개진다.
 *
 * 올림(ceil)을 쓴 이유: 반올림이면 절반의 경우에 필요한 것보다 좁은
 * 비트맵을 받아 확대 표시가 된다. 흐릿함은 눈에 띄지만 한 단계 더 큰
 * 비트맵은 눈에 띄지 않으므로, 틀릴 때는 큰 쪽으로 틀린다.
 *
 * 아직 상자를 측정하지 못했을 때(최초 렌더의 0)는 0 을 돌려준다. 호출부가
 * "요청하지 않는다"를 이 값으로 판별한다 — 32 로 올려 보내면 아무도 볼 수
 * 없는 32px 짜리 페이지를 1,000장 요청하게 된다.
 */
export function renderWidthFor(cssWidth: number, devicePixelRatio: number, aspect?: number): number {
  if (!Number.isFinite(cssWidth) || cssWidth <= 0) return 0

  // 작은 글씨와 얇은 선이 많은 스펙 문서는 DPR 1 그대로 그리면 100%에서도
  // 흐릿하다. 최소 2배로 그리되 기존 3000px 상한은 그대로 둬 메모리를 묶는다.
  const screenRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  const ratio = Math.max(screenRatio, MIN_RENDER_SCALE)

  const stepped = Math.ceil((cssWidth * ratio) / RENDER_WIDTH_STEP) * RENDER_WIDTH_STEP
  // 높이/폭 비율을 알면 픽셀 상한 안으로 줄인다(올림한 높이까지 넉넉히 본다)
  if (aspect !== undefined && Number.isFinite(aspect) && aspect > 0) {
    const pixelCap = Math.floor(Math.sqrt(MAX_RENDER_PIXELS / aspect) / RENDER_WIDTH_STEP) * RENDER_WIDTH_STEP
    return clampRenderWidth(Math.min(stepped, pixelCap))
  }
  return clampRenderWidth(stepped)
}
