/**
 * 캔버스 단축키가 먹는 범위. 캔버스가 만지는 칸에 있고 눈에 보일 때만이다.
 * (다른 칸의 PDF 를 보는 중이거나 확대로 가려졌으면 Ctrl+A · Delete · Ctrl+Z · 배율 키가 캔버스로 가면 안 된다)
 * 칸 카드 밖에 놓인 캔버스(단독 화면)는 늘 범위 안이다.
 */
export function isCanvasShortcutScope(canvas: Element | null): boolean {
  if (canvas === null || !canvas.isConnected) return false
  if (canvas.closest('[inert], [aria-hidden="true"], .pane-zoom-hidden') !== null) return false
  const card = canvas.closest('.pane-card')
  return card === null || card.classList.contains('pane-card-active')
}

/** 지금 단축키를 받는 캔버스가 있는가(앱의 되돌리기 · 배율 키가 비켜서야 하는 경우) */
export function hasShortcutCanvas(): boolean {
  return Array.from(document.querySelectorAll('.note-canvas')).some(isCanvasShortcutScope)
}
