import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

/**
 * 단추 곁에 뜨는 작은 메뉴(칸 ⋯ 메뉴 · 화면 탭 우클릭 · 새 화면 ＋ · 세션 이름). 탭 우클릭 메뉴(.pane-tab-context)와 같은 모양이다.
 * 바깥을 누르거나 Esc · 창이 초점을 잃으면 닫히고, ↑↓·Home·End 로 항목을 고른다. 열리면 첫 항목에 초점이 간다.
 */
export function PopupMenu({ label, left, right, top, onClose, anchorRef, children }: {
  readonly label: string
  /** 왼쪽 끝(px) — right 와 둘 중 하나 */
  readonly left?: number
  /** 오른쪽 끝에서의 거리(px) */
  readonly right?: number
  readonly top: number
  readonly onClose: (restoreFocus: boolean) => void
  /** 이 메뉴를 연 단추(그 위를 누르는 것은 바깥 누름이 아니다) */
  readonly anchorRef?: RefObject<HTMLElement | null>
  readonly children: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event.target instanceof Node && (ref.current?.contains(event.target) || anchorRef?.current?.contains(event.target))) return
      onClose(event instanceof KeyboardEvent)
    }
    const blur = () => onClose(false)
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', close)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', close)
      window.removeEventListener('blur', blur)
    }
  }, [anchorRef, onClose])
  return (
    <div
      ref={(element) => {
        ref.current = element
        if (element !== null && !element.contains(document.activeElement)) element.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus({ preventScroll: true })
      }}
      className="pane-tab-context popup-menu"
      role="menu"
      aria-label={label}
      style={{ top, left: left ?? 'auto', right: right ?? 'auto' }}
      onKeyDown={(event) => {
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)'))
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'ArrowDown' ? (index + 1) % items.length
          : event.key === 'ArrowUp' ? (index <= 0 ? items.length - 1 : index - 1)
            : event.key === 'Home' ? 0
              : event.key === 'End' ? items.length - 1
                : null
        if (next === null || items.length === 0) return
        event.preventDefault()
        items[next]?.focus()
      }}
    >
      {children}
    </div>
  )
}
