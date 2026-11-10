import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** 보이는 초점 가능한 요소들(숨김·0 크기 제외) */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0 || element === document.activeElement)
}

/**
 * 대화상자 초점 가두기: Tab·Shift+Tab 이 상자 밖으로 나가지 않고 처음↔끝을 돈다.
 * 열릴 때 초점이 상자 안에 없으면 첫 요소(또는 initialFocus)로 옮기고, 닫히면 열기 전 요소로 되돌린다.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true, restore = true): void {
  // 열리는 그림을 그리는 동안(autoFocus 가 초점을 가져가기 전)에 열기 전 요소를 잡아 둔다
  const opener = useRef<HTMLElement | null>(null)
  if (active && opener.current === null && typeof document !== 'undefined') opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  if (!active) opener.current = null
  useEffect(() => {
    if (!active) return
    const root = ref.current
    if (root === null) return
    const previous = opener.current
    if (!root.contains(document.activeElement)) (focusableIn(root)[0] ?? root).focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return
      const items = focusableIn(root)
      if (items.length === 0) { event.preventDefault(); return }
      const first = items[0]!
      const last = items[items.length - 1]!
      const current = document.activeElement
      if (!root.contains(current)) { event.preventDefault(); first.focus(); return }
      if (event.shiftKey && current === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && current === last) { event.preventDefault(); first.focus() }
    }
    root.addEventListener('keydown', onKeyDown)
    return () => {
      root.removeEventListener('keydown', onKeyDown)
      if (restore && previous !== null && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [ref, active, restore])
}
