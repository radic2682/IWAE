/**
 * 분할 폭 계산. DOM 을 모르는 순수 함수만 둔다 — 드래그 중에 좌표가
 * 튀거나(포인터 캡처 경계) 최초 렌더에서 폭이 0 인 순간이 실제로 있고,
 * 그때 레이아웃이 무너지지 않는지는 마우스 없이 시험해야 한다.
 */

export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 420
/**
 * 시작 폭. CSS 토큰(--sidebar-default)이 아니라 여기 있는 이유:
 * 이 값의 주인은 드래그 상태이고, 토큰으로 두면 CSS 는 선언만 해 두고
 * 실제 값은 JS 가 따로 들고 있는 이중 장부가 된다. 한쪽만 고쳐지는 순간
 * 토큰이 거짓말을 시작한다. JS 에서 CSS 변수를 읽어 오는 길도 있지만,
 * 렌더 전에 계산돼야 하는 숫자를 DOM 왕복으로 받아올 이유가 없다.
 */
export const SIDEBAR_DEFAULT = 280
/** 한쪽 패널이 전체의 이 비율 밑으로 내려가지 않는다 */
export const PANE_MIN_FRAC = 0.2

export function clampSidebar(px: number): number {
  if (!Number.isFinite(px)) return SIDEBAR_MIN
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, px))
}

export function clampLeftFrac(frac: number): number {
  if (!Number.isFinite(frac)) return 0.5
  return Math.min(1 - PANE_MIN_FRAC, Math.max(PANE_MIN_FRAC, frac))
}

export function fracFromPointer(clientX: number, areaLeft: number, areaWidth: number): number {
  // 최초 렌더에서는 측정된 폭이 0 이다. 나누면 Infinity 가 된다.
  if (areaWidth <= 0) return 0.5
  return clampLeftFrac((clientX - areaLeft) / areaWidth)
}

export interface WorkspaceColumns {
  readonly sidebar: number
  readonly leftStart: number
  readonly divider: number
  readonly rightStart: number
}

export function workspaceColumns(
  sidebarCollapsed: boolean,
  sidebarPx: number,
  leftFrac: number,
  width: number,
): WorkspaceColumns {
  const sidebar = sidebarCollapsed ? 0 : clampSidebar(sidebarPx)
  const leftStart = sidebarCollapsed ? 0 : sidebar + 1
  const available = Math.max(0, Number.isFinite(width) ? width - leftStart : 0)
  const divider = leftStart + Math.round(available * clampLeftFrac(leftFrac))
  return { sidebar, leftStart, divider, rightStart: divider + 1 }
}
