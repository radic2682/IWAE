/**
 * 칸의 주 초점 자리. 키보드로 칸을 옮기거나 칸 · 탭을 닫은 뒤 초점을 이리로 보낸다(초점이 body 로 떨어지면 키보드 사용자가 길을 잃는다).
 * 본문의 초점 자리(PDF · 글 칸 · tabindex 0) → 고른 탭 → 머리의 첫 단추 순이다.
 */
export function paneMainFocusTarget(paneId: string): HTMLElement | null {
  const card = document.querySelector<HTMLElement>(`[data-card-pane="${paneId}"]`)
  if (card === null) return null
  const usable = (element: HTMLElement | null) => (element !== null && element.closest('[inert], [hidden]') === null ? element : null)
  // 캔버스 안의 요소(블록 · 선 · 도형)는 주 초점 자리가 아니다
  const body = [...card.querySelectorAll<HTMLElement>('.pane-grid-body .pdf-pane, .pane-grid-body [data-pane-main], .pane-grid-body [contenteditable="true"], .pane-grid-body [tabindex="0"]')].find((element) => !(element instanceof SVGElement) && element.closest('svg, .react-flow') === null) ?? null
  return usable(body)
    ?? usable(card.querySelector<HTMLElement>('.pane-head [role="tab"][aria-selected="true"], .pane-head .pane-top-tab-title'))
    ?? usable(card.querySelector<HTMLElement>('.pane-head button:not(:disabled)'))
}

/** 칸의 주 초점 자리로 초점을 옮긴다. 이미 그 칸 안에 초점이 있으면 건드리지 않는다. 옮겼으면 true */
export function focusPaneMain(paneId: string): boolean {
  const card = document.querySelector<HTMLElement>(`[data-card-pane="${paneId}"]`)
  if (card === null) return false
  const current = document.activeElement
  if (current instanceof HTMLElement && current !== document.body && card.contains(current) && current.closest('[inert]') === null) return false
  const target = paneMainFocusTarget(paneId)
  if (target === null) return false
  target.focus({ preventScroll: true })
  return document.activeElement === target
}

/** 키보드로 초점이 들어왔는가(마우스 누름이 일으킨 초점은 누름 쪽 처리가 칸을 바꾼다). 판별하지 못하면 true */
export function focusCameFromKeyboard(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true
  try {
    return target.matches(':focus-visible')
  } catch {
    return true
  }
}
