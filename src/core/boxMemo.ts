/**
 * 박스 메모: PDF 쪽 위에 직접 떠 있고 형광펜과 선으로 이어진 메모. 노트나 메모 바로 가지 않는다.
 * 위치는 PDF 좌표(points, 왼쪽 위 기준)라서 확대·축소해도 쪽의 같은 자리에 남는다.
 */

export interface MemoBox {
  readonly x: number
  readonly y: number
  /** 너비(points) */
  readonly w: number
  /** 최소 높이(points). 모서리를 끌어 정한다. 없으면 글에 따라 자란다(글이 더 길면 늘 더 자란다) */
  readonly h?: number
}

export const BOX_DEFAULT_WIDTH = 170
export const BOX_MIN_WIDTH = 90
export const BOX_MAX_WIDTH = 420
/** 접었을 때와 첫 줄 높이를 가늠하는 값(자리 계산용 어림) */
export const BOX_ESTIMATED_HEIGHT = 70

interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

export function clampBox(box: MemoBox, pageSize: readonly [number, number]): MemoBox {
  const w = Math.min(Math.max(box.w, BOX_MIN_WIDTH), Math.min(BOX_MAX_WIDTH, pageSize[0] - 8))
  return {
    w,
    x: Math.min(Math.max(box.x, 0), Math.max(pageSize[0] - w, 0)),
    y: Math.min(Math.max(box.y, 0), Math.max(pageSize[1] - 24, 0)),
    ...(box.h === undefined ? {} : { h: Math.min(Math.max(box.h, 24), pageSize[1]) }),
  }
}

/**
 * 새 박스의 첫 자리(자동): 오른쪽 여백, 왼쪽 여백, 고른 글 아래, 고른 글 위 중에서 글(textRects)을 가장 덜 덮는 곳.
 * 고른 글(selection)은 절대 덮지 않는다. 같은 점수면 오른쪽 → 왼쪽 → 아래 → 위 차례.
 */
export function placeBoxMemo(
  pageSize: readonly [number, number],
  selection: readonly Rect[],
  textRects: readonly Rect[],
  width: number = BOX_DEFAULT_WIDTH,
): MemoBox {
  const [pageW, pageH] = pageSize
  const w = Math.min(Math.max(width, BOX_MIN_WIDTH), Math.max(pageW - 16, BOX_MIN_WIDTH))
  const top = selection.length === 0 ? 0 : Math.min(...selection.map((rect) => rect.y))
  const bottom = selection.length === 0 ? 0 : Math.max(...selection.map((rect) => rect.y + rect.h))
  const left = selection.length === 0 ? 0 : Math.min(...selection.map((rect) => rect.x))
  const h = BOX_ESTIMATED_HEIGHT
  const candidates: { box: MemoBox; order: number }[] = [
    { box: { x: pageW - w - 8, y: top, w }, order: 0 },
    { box: { x: 8, y: top, w }, order: 1 },
    { box: { x: left, y: bottom + 10, w }, order: 2 },
    { box: { x: left, y: top - h - 10, w }, order: 3 },
  ]
  let best: { box: MemoBox; score: number; order: number } | null = null
  for (const { box, order } of candidates) {
    const placed = clampBox(box, pageSize)
    const area: Rect = { x: placed.x, y: placed.y, w: placed.w, h }
    // 고른 글을 덮는 자리는 크게 감점(사실상 금지), 다른 글은 덮는 넓이만큼
    const covered = selection.reduce((sum, rect) => sum + overlapArea(area, rect), 0) * 1000
      + textRects.reduce((sum, rect) => sum + overlapArea(area, rect), 0)
    const outside = placed.y + h > pageH ? (placed.y + h - pageH) * placed.w : 0
    const score = covered + outside
    if (best === null || score < best.score - 1e-6 || (Math.abs(score - best.score) <= 1e-6 && order < best.order)) best = { box: placed, score, order }
  }
  return best!.box
}

/**
 * 연결선의 두 끝(쪽 좌표): 형광펜 첫 줄 끝 → 박스 가장자리. 박스가 형광펜의 오른쪽에 있으면 박스 왼쪽 가장자리,
 * 왼쪽에 있으면 오른쪽 가장자리, 위아래에 있으면 가까운 위·아래 가장자리로 잇는다. 높이는 모르므로 머리줄 높이(14)를 쓴다.
 */
export function boxConnector(
  anchor: { readonly x: number; readonly y: number },
  box: MemoBox,
  boxHeight: number,
): { readonly from: { x: number; y: number }; readonly to: { x: number; y: number } } {
  const headY = box.y + Math.min(14, boxHeight / 2)
  if (anchor.x < box.x) return { from: { x: anchor.x, y: anchor.y }, to: { x: box.x, y: headY } }
  if (anchor.x > box.x + box.w) return { from: { x: anchor.x, y: anchor.y }, to: { x: box.x + box.w, y: headY } }
  // 박스 위·아래
  return anchor.y < box.y
    ? { from: { x: anchor.x, y: anchor.y }, to: { x: Math.min(Math.max(anchor.x, box.x + 8), box.x + box.w - 8), y: box.y } }
    : { from: { x: anchor.x, y: anchor.y }, to: { x: Math.min(Math.max(anchor.x, box.x + 8), box.x + box.w - 8), y: box.y + boxHeight } }
}

export function parseMemoBox(value: unknown): MemoBox | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { x, y, w, h } = value as Record<string, unknown>
  if (![x, y, w].every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined
  const height = typeof h === 'number' && Number.isFinite(h) && h > 0 ? { h: Math.min(Math.max(h, 24), 2000) } : {}
  return { x: x as number, y: y as number, w: Math.min(Math.max(w as number, BOX_MIN_WIDTH), BOX_MAX_WIDTH), ...height }
}
