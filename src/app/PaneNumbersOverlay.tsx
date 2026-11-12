import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import '../ui/keys-help.css'

/** 칸 번호가 떠 있는 시간(ms) */
export const PANE_NUMBERS_MS = 1500

interface Badge {
  readonly pane: string
  readonly index: number
  readonly left: number
  readonly top: number
  readonly size: number
}

/** 칸의 화면 사각형(칸 카드 DOM). 못 찾으면 null */
function boxOf(pane: string): DOMRect | null {
  const scope = document.querySelector(`.pane-focus-scope[data-pane-id="${pane}"]`)
  const card = scope?.closest<HTMLElement>('.pane-grid-cell, .pane-card') ?? (scope instanceof HTMLElement ? scope : null)
  const box = card?.getBoundingClientRect()
  return box === undefined || box.width === 0 ? null : box
}

/**
 * display-panes(접두키 + q): 칸마다 큰 번호를 겹쳐 보인다(약 1.5 초). 번호는 칸 머리의 번호와 같다(0 부터).
 * 숫자 키를 누르면 그 칸으로 가는 일은 usePrefixMode 가 받는다. 움직임 없이 나타나고 사라진다.
 */
export function PaneNumbersOverlay({ panes, activePane, onDone }: {
  readonly panes: readonly string[]
  readonly activePane: string
  readonly onDone: () => void
}) {
  const [badges, setBadges] = useState<readonly Badge[]>([])
  useEffect(() => {
    const measured: Badge[] = []
    panes.forEach((pane, index) => {
      const box = boxOf(pane)
      if (box === null) return
      const size = Math.max(40, Math.min(120, Math.min(box.width, box.height) * 0.5))
      measured.push({ pane, index, size, left: box.left + (box.width - size) / 2, top: box.top + (box.height - size) / 2 })
    })
    setBadges(measured)
    const timer = window.setTimeout(onDone, PANE_NUMBERS_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 열릴 때 한 번 재고 한 번 닫는다
  }, [])
  return createPortal(
    <div className="pane-numbers-overlay" aria-hidden="true" data-testid="pane-numbers">
      {badges.map((badge) => (
        <div
          key={badge.pane}
          className="pane-number-badge"
          data-active={badge.pane === activePane ? 'true' : 'false'}
          style={{ left: badge.left, top: badge.top, width: badge.size, height: badge.size, fontSize: badge.size * 0.7 }}
        >{badge.index}</div>
      ))}
    </div>,
    document.body,
  )
}
