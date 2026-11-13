/**
 * 손에 붙어 따라오는 모양(ghost)을 창 안에 두는 순수 계산. 알약 · 들린 탭 · 메모 블록 ghost 가 같이 쓴다.
 */

/** ghost 가 창 가장자리에서 떨어져야 하는 거리(px) */
export const GHOST_EDGE_MARGIN = 8
/** 메모 ghost 를 포인터에서 오른쪽 · 아래로 띄우는 거리(포인터 끝이 가려지지 않게) */
export const GHOST_CURSOR_DX = 14
export const GHOST_CURSOR_DY = 16

/** 한 축: 왼쪽(위) 위치 pos 의 크기 size 짜리를 [margin, limit - margin] 안에 둔다. 들어갈 자리가 없으면 margin 쪽에 붙인다 */
function clampAxis(pos: number, size: number, limit: number, margin: number): number {
  return Math.max(margin, Math.min(pos, limit - size - margin))
}

/**
 * 왼쪽 위 (x, y), 크기 (width, height) 인 ghost 를 창(viewW × viewH) 안에 둔다.
 * marginX · marginY 는 ghost 껍질 안쪽의 투명한 여백만큼 음수로 줄 수 있다(보이는 부분이 8px 안에 들도록)
 */
export function clampGhostPos(
  x: number, y: number, width: number, height: number, viewW: number, viewH: number,
  marginX: number = GHOST_EDGE_MARGIN, marginY: number = marginX,
): { readonly x: number; readonly y: number } {
  return { x: clampAxis(x, width, viewW, marginX), y: clampAxis(y, height, viewH, marginY) }
}

/**
 * 포인터 (px, py) 의 오른쪽 아래(+14, +16)에 ghost 를 둔다. 창 밖으로 나가면 포인터의 왼쪽 · 위로 뒤집고, 그래도 넘치면 창 안으로 민다 —
 * 포인터 끝은 어느 쪽에서도 ghost 에 가려지지 않는다(창이 ghost 보다 작아 어쩔 수 없는 경우만 빼고)
 */
export function anchorGhostBelowRight(px: number, py: number, width: number, height: number, viewW: number, viewH: number): { readonly x: number; readonly y: number } {
  let x = px + GHOST_CURSOR_DX
  let y = py + GHOST_CURSOR_DY
  if (x + width > viewW - GHOST_EDGE_MARGIN) x = px - GHOST_CURSOR_DX - width
  if (y + height > viewH - GHOST_EDGE_MARGIN) y = py - GHOST_CURSOR_DY - height
  return clampGhostPos(x, y, width, height, viewW, viewH)
}
