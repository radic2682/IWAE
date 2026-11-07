import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'

/**
 * 오른쪽 메모 바의 폭. PDF 와 Markdown 이 같은 값을 쓴다(한쪽에서 끌어 바꾸면 다른 쪽도 같은 폭).
 * - 자동: 창 틀(바 포함) 폭의 38%, 220–330px
 * - 바 왼쪽 가장자리를 끌어 정한 폭은 이 PC 에 기억한다. 두 번 누르면 자동으로 돌아간다
 */
export const MEMO_BAR_WIDTH = 330
export const MEMO_BAR_MIN = 220
const MEMO_BAR_WIDTH_KEY = 'iwae:memo-bar-width:v1'
const CHANGE_EVENT = 'iwae:memo-bar-width'

function readMemoBarWidth(): number | null {
  try {
    const value = Number(window.localStorage.getItem(MEMO_BAR_WIDTH_KEY))
    return Number.isFinite(value) && value >= MEMO_BAR_MIN ? value : null
  } catch {
    return null
  }
}

function announce(width: number | null) {
  window.dispatchEvent(new CustomEvent<number | null>(CHANGE_EVENT, { detail: width }))
}

/** 메모 바 폭을 정한다. totalWidth = 창 틀(메모 바 포함) 전체 폭 */
export function useMemoBarWidth(totalWidth: number, visible: boolean) {
  const [autoSize, setAutoSize] = useState(MEMO_BAR_WIDTH)
  const [userSize, setUserSize] = useState<number | null>(readMemoBarWidth)
  // 다른 창(PDF ↔ Markdown, 나눈 칸)에서 바꾼 폭을 따라간다
  useEffect(() => {
    const follow = (event: Event) => setUserSize((event as CustomEvent<number | null>).detail)
    window.addEventListener(CHANGE_EVENT, follow)
    return () => window.removeEventListener(CHANGE_EVENT, follow)
  }, [])
  const maxSize = Math.max(MEMO_BAR_MIN, totalWidth - 240)
  const size = userSize === null ? autoSize : Math.round(Math.min(userSize, maxSize))
  const wanted = Math.round(Math.min(MEMO_BAR_WIDTH, Math.max(MEMO_BAR_MIN, totalWidth * 0.38)))
  useEffect(() => {
    if (visible && totalWidth > 0 && wanted !== autoSize) setAutoSize(wanted)
  }, [autoSize, visible, totalWidth, wanted])

  /** 바 왼쪽 가장자리를 끌기 시작 */
  const startResize = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = size
    const target = event.currentTarget
    target.setPointerCapture?.(event.pointerId)
    const widthAt = (clientX: number) => Math.round(Math.min(Math.max(startWidth + (startX - clientX), MEMO_BAR_MIN), maxSize))
    const move = (moveEvent: PointerEvent) => setUserSize(widthAt(moveEvent.clientX))
    const up = (upEvent: PointerEvent) => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      const next = widthAt(upEvent.clientX)
      try {
        window.localStorage.setItem(MEMO_BAR_WIDTH_KEY, String(next))
      } catch {
        // 저장 못 해도 이번 화면에서는 바뀐다
      }
      announce(next)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }
  /** 자동 폭으로 되돌린다(가장자리를 두 번 누르기) */
  const resetSize = () => {
    try {
      window.localStorage.removeItem(MEMO_BAR_WIDTH_KEY)
    } catch {
      // 저장 못 해도 이번 화면에서는 바뀐다
    }
    announce(null)
  }
  return { size, autoShown: userSize ?? autoSize, startResize, resetSize }
}
