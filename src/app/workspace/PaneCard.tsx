import { useContext, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { PaneChannel } from './workspaceChannels'
import { usePaneReaction } from './paneReaction'
import { TAB_DRAG_THRESHOLD_PX } from './tabDrag'
import { TopBarToolbarContext, eventInTopBarSlot } from '../topBarToolbar'

/** 지금 기다리는 탭 누름 하나의 정리(새 누름이 오면 먼저 것을 접는다) */
let cancelPendingPress: (() => void) | null = null

/**
 * 카드를 누르면 그 칸을 만지는 칸으로: 왼쪽 단추(button 0)만(오른쪽 · 가운데 클릭으로는 바꾸지 않는다). 이미 만지는 칸이어도 부른다 — 칸 안에서 탭을 바꾼 뒤 누르면
 * 연결 경로(노트 · 문서가 오는 칸)를 이 칸으로 다시 잡아야 한다(`focusPane` 은 이미 그 칸이고 경로도 같으면 아무것도 하지 않는다). 탭을 누른 것은 끌기의 시작일 수 있으므로 놓을 때(움직이지 않았을 때)로 미룬다 —
 * 끄는 동안 상단바 도구줄이 바뀌면 끌기 위의 화면이 흔들린다.
 */
function focusOnPress(event: ReactPointerEvent<HTMLElement>, paneId: string, onFocusPane: (paneId: string) => void, toolbarSlot: HTMLElement | null): void {
  if (event.button !== 0) return
  // 상단바 도구줄은 포털이라 React 로는 이 카드 안이다: 상단바 도구줄 자리의 누름은 칸을 누른 것이 아니다(body 포털 메뉴는 이 칸의 것이라 누른 것이다)
  if (eventInTopBarSlot(event, toolbarSlot)) return
  cancelPendingPress?.()
  const target = event.target instanceof Element ? event.target : null
  // 탭 닫기 ×: 닫는 것 말고는 아무것도 하지 않는다(칸도 만지는 칸이 되지 않는다)
  if (target?.closest('.pane-top-tab-close') != null) return
  // 탭(오른쪽 여백 포함)은 끌기의 시작일 수 있어 놓을 때로 미룬다. 끌기와 같은 문턱(TAB_DRAG_THRESHOLD_PX) 이상 움직이면 끌기라 칸을 바꾸지 않는다
  if (target?.closest('.pane-top-tab, [role="tab"]') == null) { onFocusPane(paneId); return }
  const startX = event.clientX
  const startY = event.clientY
  let moved = false
  const move = (next: PointerEvent) => { if (Math.hypot(next.clientX - startX, next.clientY - startY) >= TAB_DRAG_THRESHOLD_PX) moved = true }
  const finish = (focus: boolean) => {
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', cancel, true)
    window.removeEventListener('keydown', key, true)
    window.removeEventListener('blur', cancel)
    if (cancelPendingPress === cancel) cancelPendingPress = null
    if (focus && !moved) onFocusPane(paneId)
  }
  const up = () => finish(true)
  const cancel = () => finish(false)
  const key = (keyEvent: KeyboardEvent) => { if (keyEvent.key === 'Escape') finish(false) }
  cancelPendingPress = cancel
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', cancel, true)
  window.addEventListener('keydown', key, true)
  window.addEventListener('blur', cancel)
}

/**
 * 칸 하나의 면(둥근 카드). 두 톤이다: 머리(탭 줄)는 `--paper`(`--pane-surface`), 본문은 `--workspace`(`--pane-body`)로 머리 아래 4px 를 띄우고 카드 가장자리까지 채운다. 안에 테두리 선 · 띠는 없다.
 * - 카드 테두리 하나가 채널 색이다(`data-channel`, 층을 쌓지 않는다): 쉬는 칸은 채널 색 35%, 만지는 칸(`.pane-card-active`) · 반응하는 칸은 100%. 채널이 없으면(`none`) 쉴 때 `--divider`, 만질 때 `--accent`. 두께는 모두 2px.
 *   머리의 색 점은 바꾸는 단추로 그대로 있다.
 * - 탭이 하나도 없는 빈 칸(empty)은 카드가 아니라 자리(slot)다: 바탕 · 실선 · 채널 색 없이 점선 윤곽 하나만(`data-empty` + SVG 윤곽, 규칙은 workspace-surface.css 의 `.pane-slot-outline`;
 *   점선이 모서리에서도 고르게 이어지도록 CSS border-style 이 아니라 둥근 사각형 선으로 그린다). 만지는 칸이면 같은 윤곽이 강조색이다.
 * - 같은 색의 다른 창에서 신호가 올 창(마우스를 올린 동안)과 신호가 방금 움직인 창(0.6초)은 `data-reacting` 으로 테두리가 채널 색 100% 가 된다.
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
  const toolbarSlot = useContext(TopBarToolbarContext)?.element ?? null
  return (
    <div
      className={`pane-card${active ? ' pane-card-active' : ''}${className === '' ? '' : ` ${className}`}`}
      data-card-pane={paneId}
      onPointerDownCapture={onFocusPane === undefined ? undefined : (event) => focusOnPress(event, paneId, onFocusPane, toolbarSlot)}
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
