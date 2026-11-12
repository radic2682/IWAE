import type { ReactNode } from 'react'
import type { PaneChannel } from './workspaceChannels'
import { usePaneReaction } from './paneReaction'

/**
 * 칸 하나의 면(둥근 카드). 머리(탭 줄)와 본문이 한 면을 이루고 안에 테두리 선이 없다.
 * - 만지는 칸(active)은 카드 테두리가 강조색 1.5px 로 굵어진다(`.pane-card-active`).
 * - 채널 색은 카드 맨 위 2px 가장자리로 보인다(`data-channel`; 채널이 없으면 `none` 이라 가장자리가 없다). 머리의 색 점은 바꾸는 단추로 그대로 있다.
 * - 탭이 하나도 없는 빈 칸(empty)은 카드가 아니라 자리(slot)다: 바탕 · 실선 · 채널 가장자리 없이 점선 윤곽 하나만(`data-empty` + SVG 윤곽,
 *   점선이 모서리에서도 고르게 이어지도록 CSS border-style 이 아니라 둥근 사각형 선으로 그린다). 만지는 칸이면 같은 윤곽이 강조색이다.
 * - 같은 색의 다른 창에서 신호가 올 창(마우스를 올린 동안)과 신호가 방금 움직인 창(0.6초)은 `data-reacting` 이 채널 색이 되어 안쪽 윤곽이 생긴다.
 */
export function PaneCard({ paneId, channel, active, empty = false, className = '', onFocusPane, children }: {
  readonly paneId: string
  readonly channel: PaneChannel
  readonly active: boolean
  /** 탭이 하나도 없는 빈 칸인가 */
  readonly empty?: boolean
  readonly className?: string
  /** 카드 어디든(머리의 빈 곳 포함) 누르면 이 칸이 만지는 칸이 된다. 본문은 칸 안쪽(.pane-focus-scope)도 따로 잡는다 */
  readonly onFocusPane?: (paneId: string) => void
  readonly children: ReactNode
}) {
  const reacting = usePaneReaction(paneId)
  return (
    <div
      className={`pane-card${active ? ' pane-card-active' : ''}${className === '' ? '' : ` ${className}`}`}
      data-card-pane={paneId}
      onPointerDownCapture={onFocusPane === undefined ? undefined : () => onFocusPane(paneId)}
      data-channel={channel ?? 'none'}
      data-empty={empty ? '' : undefined}
      data-reacting={reacting ?? undefined}
    >
      {empty ? (
        <svg className="pane-slot-outline" aria-hidden="true" focusable="false"><rect /></svg>
      ) : null}
      {children}
    </div>
  )
}
