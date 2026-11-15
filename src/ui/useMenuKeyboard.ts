import { useEffect, useRef, type RefObject } from 'react'
import { useStableCallback } from './useStableCallback'

const ITEMS = '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled), input[type="range"]:not(:disabled)'

/**
 * 단추에서 열리는 메뉴의 키보드 동작(칸 메뉴 PopupMenu 와 같다).
 * 열리면 고른 항목(없으면 첫 항목)에 초점이 가고, ↑↓ · Home · End 로 항목을 옮기고(`grid` 면 ←→ 도), Esc 는 닫고 연 곳으로 초점을 돌려주며,
 * Tab 은 메뉴를 닫고 초점이 자연스럽게 다음으로 가게 둔다.
 * `returnTo` 가 없으면 열릴 때 초점이 있던 요소로 돌려준다.
 */
export function useMenuKeyboard({ open, menuRef, returnTo, onClose, autoFocus = true, grid = false, capture = false }: {
  readonly open: boolean
  readonly menuRef: RefObject<HTMLElement | null>
  readonly returnTo?: RefObject<HTMLElement | null>
  readonly onClose: () => void
  readonly autoFocus?: boolean
  readonly grid?: boolean
  /** 키 입력을 문서 맨 앞(capture)에서 받는다: 다른 곳이 Esc 를 먼저 삼키지 못하게 */
  readonly capture?: boolean
}): () => void {
  const close = useStableCallback(onClose)
  const opener = useRef<HTMLElement | null>(null)
  const returnToRef = useRef(returnTo)
  returnToRef.current = returnTo
  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    if (autoFocus && menu !== null && !menu.contains(document.activeElement)) {
      const items = [...menu.querySelectorAll<HTMLElement>(ITEMS)]
      const first = items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0]
      first?.focus({ preventScroll: true })
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const root = menuRef.current
      if (event.key === 'Escape') {
        event.preventDefault()
        const target = returnTo?.current ?? opener.current
        close()
        if (target?.isConnected === true && (root === null || root.contains(document.activeElement) || document.activeElement === document.body)) target.focus({ preventScroll: true })
        return
      }
      if (root === null || !(event.target instanceof Node) || !root.contains(event.target)) return
      if (event.key === 'Tab') { close(); return }
      const items = [...root.querySelectorAll<HTMLElement>(ITEMS)]
      if (items.length === 0) return
      const index = items.indexOf(document.activeElement as HTMLElement)
      const forward = event.key === 'ArrowDown' || (grid && event.key === 'ArrowRight')
      const backward = event.key === 'ArrowUp' || (grid && event.key === 'ArrowLeft')
      const next = forward ? (index + 1) % items.length
        : backward ? (index <= 0 ? items.length - 1 : index - 1)
          : event.key === 'Home' ? 0
            : event.key === 'End' ? items.length - 1
              : null
      if (next === null) return
      // 범위 입력은 좌우가 값 조절이다
      if (document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'range' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return
      event.preventDefault()
      items[next]?.focus({ preventScroll: true })
    }
    window.addEventListener('keydown', onKeyDown, capture)
    return () => window.removeEventListener('keydown', onKeyDown, capture)
    // 메뉴 ref 와 returnTo 는 바뀌지 않는 ref 다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoFocus, grid, capture])
  // 항목을 골라 메뉴가 닫힐 때(초점이 메뉴 안에 있었다면) 연 곳으로 초점을 돌려주는 함수
  return useStableCallback(() => {
    const target = returnToRef.current?.current ?? opener.current
    const root = menuRef.current
    if (target?.isConnected === true && root !== null && root.contains(document.activeElement)) target.focus({ preventScroll: true })
  })
}
