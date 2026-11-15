import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** 보이는 초점 가능한 요소들(숨김·0 크기 제외) */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0 || element === document.activeElement)
}

/** 같은 이름의 라디오 묶음에서 Tab 이 서는 곳: 선택된 것, 없으면 첫 번째 */
function radioStop(radio: HTMLInputElement, items: readonly HTMLElement[]): HTMLElement {
  const group = items.filter((item): item is HTMLInputElement => item instanceof HTMLInputElement && item.type === 'radio' && item.name === radio.name && item.form === radio.form)
  return group.find((item) => item.checked) ?? group[0] ?? radio
}

/** Tab 으로 실제 멈추는 곳들: 라디오 묶음은 한 곳으로 센다 */
export function tabStopsIn(root: HTMLElement): HTMLElement[] {
  const items = focusableIn(root)
  return items.filter((item) => !(item instanceof HTMLInputElement && item.type === 'radio' && item.name !== '') || radioStop(item, items) === item)
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
      const all = focusableIn(root)
      const items = tabStopsIn(root)
      if (items.length === 0) { event.preventDefault(); return }
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      const current = active instanceof HTMLInputElement && active.type === 'radio' && active.name !== '' ? radioStop(active, all) : active
      if (!root.contains(active)) { event.preventDefault(); first.focus(); return }
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
