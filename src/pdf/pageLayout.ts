/**
 * 페이지 배치 산술. DOM 도, React 도, import 도 없는 순수 계산만 둔다 —
 * "1,000 페이지 중 지금 몇 번부터 몇 번이 보이는가"는 모든 스크롤 뷰어의
 * 버그가 사는 자리이고, 그 계산 자체는 브라우저가 없어도 시험할 수 있다.
 * splitLayout.ts 와 같은 이유로 이 파일만 따로 둔다.
 */

export interface PageBox {
  readonly top: number
  readonly height: number
}

/** renderWidth 가 유효하지 않을 때를 위한 안전값. 컨테이너 폭을 아직
 * 측정하지 못한 최초 렌더에서 0 이 들어오는 게 실제 상황이다. */
function safeRenderWidth(renderWidth: number): number {
  return Number.isFinite(renderWidth) && renderWidth > 0 ? renderWidth : 0
}

/** gap 이 유효하지 않을 때를 위한 안전값. CSS 변수를 parseFloat 한 값이
 * 넘어오면 NaN 이 될 수 있고, 음수 gap 은 페이지가 겹치는 뜻이라 의미가 없다. */
function safeGap(gap: number): number {
  return Number.isFinite(gap) && gap > 0 ? gap : 0
}

/**
 * 각 페이지가 스크롤 좌표계에서 어디에 놓이는지. 폭에 맞춰 비율로 높이를 정한다.
 */
export function layoutPages(
  sizes: readonly (readonly [number, number])[],
  renderWidth: number,
  gap: number,
): PageBox[] {
  const width = safeRenderWidth(renderWidth)
  const gapPx = safeGap(gap)

  const boxes: PageBox[] = []
  let top = 0
  for (const size of sizes) {
    const [nativeWidth, nativeHeight] = size
    // PDF 미디어박스가 손상되어 0x0 이거나 음수로 나오는 페이지가 실제로 있다.
    // 그런 페이지는 원래 비율을 알 수 없으니 정사각형(1:1)으로 대체해서
    // NaN 이나 Infinity 가 레이아웃 전체로 번지지 않게 막는다.
    const aspect =
      Number.isFinite(nativeWidth) && nativeWidth > 0 && Number.isFinite(nativeHeight) && nativeHeight >= 0
        ? nativeHeight / nativeWidth
        : 1
    const height = width * aspect
    boxes.push({ top, height })
    top += height + gapPx
  }
  return boxes
}

/** 전체 문서 높이 */
export function totalHeight(boxes: readonly PageBox[], gap: number): number {
  if (boxes.length === 0) return 0
  const gapPx = safeGap(gap)
  const sumOfHeights = boxes.reduce((sum, box) => sum + box.height, 0)
  // 페이지 사이의 gap 만 더한다 — 페이지가 n 장이면 gap 은 n-1 번만 들어간다.
  return sumOfHeights + gapPx * (boxes.length - 1)
}

/** viewStart 아래로 조금이라도 걸치는 첫 페이지. 다 지나쳐서 못 찾으면
 * 스크롤이 문서 끝을 넘겼다는 뜻이므로 마지막 페이지로 붙인다. */
function findFirstVisible(boxes: readonly PageBox[], viewStart: number): number {
  const index = boxes.findIndex((box) => box.top + box.height > viewStart)
  return index === -1 ? boxes.length - 1 : index
}

/** viewEnd 위로 조금이라도 걸치는 마지막 페이지. 하나도 못 찾으면
 * 뷰포트가 문서 시작보다도 위에 있다는 뜻이므로 첫 페이지로 붙인다. */
function findLastVisible(boxes: readonly PageBox[], viewEnd: number): number {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i]
    // noUncheckedIndexedAccess: i 가 항상 유효 범위 안이라 실제로는 undefined 가
    // 나올 수 없지만, 타입 시스템은 그걸 모르니 건너뛰는 걸로 처리해 둔다.
    if (box !== undefined && box.top < viewEnd) return i
  }
  return 0
}

/**
 * 지금 그려야 할 페이지 번호 범위(0-based, 끝 포함). overscan 만큼 앞뒤로 더 그린다.
 */
export function visibleRange(
  boxes: readonly PageBox[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): readonly [number, number] {
  if (boxes.length === 0) {
    // 페이지가 없으면 그릴 것도 없다. start > end 로 "빈 범위" 를 나타내면
    // 호출부가 `for (i = start; i <= end; i++)` 를 그대로 써도 0 번 돈다.
    return [0, -1]
  }

  // 맥 트랙패드의 오버스크롤 바운스는 음수 scrollTop 을 만들고, 빠르게
  // 스크롤하면 문서 끝을 넘긴 scrollTop 이 들어온다 — 둘 다 실제로 생긴다.
  const scrollTopPx = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0
  // 컨테이너 높이를 아직 측정하지 못했을 때 0 이나 음수가 들어올 수 있다.
  const viewportPx = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0
  // overscan 이 음수면 "덜 그린다" 는 뜻이 되어 오히려 firstVisible/lastVisible
  // 범위보다 좁아질 수 있으니, 실제로 존재하는 용도(앞뒤로 더 그리기)만 허용한다.
  const overscanPages = Number.isFinite(overscan) ? Math.max(0, overscan) : 0

  const viewStart = scrollTopPx
  const viewEnd = scrollTopPx + viewportPx

  const firstVisible = findFirstVisible(boxes, viewStart)
  const lastVisible = findLastVisible(boxes, viewEnd)

  const lastIndex = boxes.length - 1
  // overscan 이 문서 경계를 넘어가면 Task 4 가 존재하지 않는 페이지를 요청하게
  // 되고, iwae:// 프로토콜은 그걸 404 로 답한다 — 화면엔 빈 줄로만 보이는 버그다.
  const start = Math.max(firstVisible - overscanPages, 0)
  const end = Math.min(lastVisible + overscanPages, lastIndex)

  return [start, end]
}

/**
 * 지금 "보고 있는" 쪽(0-based): 화면에서 가장 넓은 면적을 차지하는 쪽. 같으면 앞쪽.
 * 첫 줄에 걸친 앞쪽의 꼬리(바닥글)가 아니라 화면 대부분을 채운 쪽을 가리키므로,
 * 메모로 건너뛰어 쪽 맨 위 근처에 문장이 놓였을 때 쪽 번호가 하나 덜 나오지 않는다.
 * 왼쪽 바 미리보기의 보고 있는 곳 사각형(visibleRegions)과 같은 기준이다.
 */
export function dominantPage(boxes: readonly PageBox[], scrollTop: number, viewportHeight: number): number {
  if (boxes.length === 0) return 0
  const viewStart = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0
  const viewEnd = viewStart + (Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0)
  let best = -1
  let bestArea = 0
  for (let page = findFirstVisible(boxes, viewStart); page < boxes.length; page += 1) {
    const box = boxes[page]!
    if (box.top >= viewEnd) break
    const area = Math.min(box.top + box.height, viewEnd) - Math.max(box.top, viewStart)
    if (area > bestArea) {
      best = page
      bestArea = area
    }
  }
  return best === -1 ? findFirstVisible(boxes, viewStart) : best
}

/** 특정 페이지의 맨 위로 가려면 얼마나 스크롤해야 하는가 */
export function scrollTopForPage(boxes: readonly PageBox[], page: number): number {
  if (boxes.length === 0) return 0

  // 문서가 줄어들었거나 잘못된 인덱스가 넘어오면 가장 가까운 유효한
  // 페이지로 붙인다. 정수가 아닌 값도 방어한다.
  const pageIndex = Number.isFinite(page) ? Math.min(Math.max(Math.trunc(page), 0), boxes.length - 1) : 0
  const box = boxes[pageIndex]
  return box === undefined ? 0 : box.top
}

/** 여러 쪽 펼침에서 한 페이지가 놓이는 자리. left 는 줄의 왼쪽 끝에서 잰다 */
export interface SpreadBox extends PageBox {
  readonly left: number
  readonly width: number
}

/**
 * 여러 쪽 펼침 배치. 두 장이면 1·2쪽, 3·4쪽…, 세 장이면 1·2·3쪽, 4·5·6쪽… 한 줄에 놓는다(첫 쪽이 왼쪽).
 * 남는 쪽은 마지막 줄 왼쪽부터 놓인다. `rowWidth` 는 한 줄 전체 폭이고 쪽 사이 `gap` 을 빼고 똑같이 나눈다.
 * 줄 높이는 그 줄에서 가장 긴 쪽을 따른다.
 */
export function layoutSpread(
  sizes: readonly (readonly [number, number])[],
  rowWidth: number,
  gap: number,
  columns = 2,
): SpreadBox[] {
  const gapPx = safeGap(gap)
  const perRow = Number.isFinite(columns) && columns >= 1 ? Math.trunc(columns) : 2
  const pageWidth = Math.max((safeRenderWidth(rowWidth) - gapPx * (perRow - 1)) / perRow, 0)
  const heightOf = (size: readonly [number, number] | undefined) => {
    if (size === undefined) return 0
    const [nativeWidth, nativeHeight] = size
    const aspect =
      Number.isFinite(nativeWidth) && nativeWidth > 0 && Number.isFinite(nativeHeight) && nativeHeight >= 0
        ? nativeHeight / nativeWidth
        : 1
    return pageWidth * aspect
  }

  const boxes: SpreadBox[] = []
  let top = 0
  // [0,1], [2,3] … (세 장이면 [0,1,2], [3,4,5] …). 앞 쪽이 왼쪽.
  const rows: number[][] = []
  for (let page = 0; page < sizes.length; page += perRow) {
    rows.push(Array.from({ length: Math.min(perRow, sizes.length - page) }, (_, slot) => page + slot))
  }
  rows.forEach((row) => {
    const rowHeight = Math.max(...row.map((page) => heightOf(sizes[page])))
    row.forEach((page, slot) => {
      boxes[page] = { top, left: slot * (pageWidth + gapPx), width: pageWidth, height: heightOf(sizes[page]) }
    })
    top += rowHeight + gapPx
  })
  return boxes
}

/** 펼침 배치 전체 높이. 마지막 줄의 아래 끝이다 */
export function spreadHeight(boxes: readonly SpreadBox[]): number {
  return boxes.reduce((bottom, box) => Math.max(bottom, box.top + box.height), 0)
}

/** 한 장(또는 두·세 장) 넘겨 보기의 한 화면: index 쪽과 같은 줄(top)에 놓인 쪽들 */
export interface PageUnit {
  readonly first: number
  readonly last: number
  readonly top: number
  readonly height: number
}

export function pageUnitAt(boxes: readonly PageBox[], index: number): PageUnit | null {
  if (boxes.length === 0) return null
  const at = Math.min(Math.max(Math.trunc(index), 0), boxes.length - 1)
  const top = boxes[at]?.top ?? 0
  let first = at
  let last = at
  while (first > 0 && boxes[first - 1]?.top === top) first--
  while (last < boxes.length - 1 && boxes[last + 1]?.top === top) last++
  let height = 0
  for (let page = first; page <= last; page++) height = Math.max(height, boxes[page]?.height ?? 0)
  return { first, last, top, height }
}

/** 한 쪽 안에서 지금 화면에 보이는 부분. 쪽 크기에 대한 0~1 비율 */
export interface VisibleRegion {
  readonly page: number
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * 스크롤 영역(view: 문서 좌표계의 left·top·width·height)에 걸치는 쪽마다 보이는 부분을 구한다.
 * boxes 는 문서 좌표계의 쪽 자리(left 는 이미 가운데 맞춤 값을 더한 것). 왼쪽 바 미리보기의 「보고 있는 곳」 사각형이 쓴다.
 */
export function visibleRegions(
  boxes: readonly SpreadBox[],
  view: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
): VisibleRegion[] {
  const regions: VisibleRegion[] = []
  if (!(view.width > 0) || !(view.height > 0)) return regions
  const viewRight = view.left + view.width
  const viewBottom = view.top + view.height
  for (let page = 0; page < boxes.length; page += 1) {
    const box = boxes[page]!
    if (!(box.width > 0) || !(box.height > 0)) continue
    if (box.top >= viewBottom) {
      // 위에서부터 쌓인 쪽이라 한 줄(여러 쪽 펼침) 단위로 이어진다. 같은 줄의 다음 쪽은 계속 본다
      if (regions.length > 0 && box.top > viewBottom) break
      continue
    }
    const x0 = Math.max(box.left, view.left)
    const x1 = Math.min(box.left + box.width, viewRight)
    const y0 = Math.max(box.top, view.top)
    const y1 = Math.min(box.top + box.height, viewBottom)
    if (x1 <= x0 || y1 <= y0) continue
    regions.push({
      page,
      x: (x0 - box.left) / box.width,
      y: (y0 - box.top) / box.height,
      w: (x1 - x0) / box.width,
      h: (y1 - y0) / box.height,
    })
  }
  return regions
}
