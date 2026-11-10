/** 글을 고치는 자리(입력칸·textarea·contenteditable)인가. 거기서는 잘라내기·복사·붙여넣기 메뉴가 필요하다 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]') !== null) return true
  return false
}

/**
 * 앱이 자기 메뉴를 열지 않은 곳(= 이벤트가 아직 취소되지 않은 곳)의 우클릭은 아무 일도 하지 않게 한다.
 * 웹뷰 기본 메뉴(뒤로·새로고침·검사 …)가 뜨지 않는다. 글 입력 자리는 기본 메뉴를 남긴다.
 */
export function installNativeContextMenuSuppressor(target: Window = window): () => void {
  const handler = (event: MouseEvent) => {
    if (event.defaultPrevented) return
    if (isEditableTarget(event.target)) return
    event.preventDefault()
  }
  // 버블 단계: 앱의 onContextMenu(React 루트)가 먼저 돌고 난 뒤 마지막으로 거른다
  target.addEventListener('contextmenu', handler)
  return () => target.removeEventListener('contextmenu', handler)
}
