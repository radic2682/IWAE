import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { isDragExempt } from '../ui/dragExempt'
import { FLOAT_HEAD_H, floatBoxIn, floatBoxOnScreen, floatFromBox, floatOutgrowsAnchor, moveFloatBox, resizeFloatBox, type FloatBox, type FloatSize } from './floatingPanes'
import type { FloatAnchor, FloatingPane } from './screens'
import { PaneCard } from './PaneCard'
import type { PaneChannel } from './workspaceChannels'
import { t } from '../i18n'
import '../ui/floating-panes.css'

/** 붙은 곳의 사각형(px). 칸 영역 안쪽(.panes 의 안쪽 가장자리)이 원점이다 */
export interface AnchorRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface FloatLayerProps {
  /** 지금 보이는 떠 있는 칸들. 뒤에 있을수록 위에 그린다 */
  readonly floats: readonly FloatingPane[]
  /** 붙은 곳의 사각형. 없으면(그 칸이 숨었다) 그 떠 있는 칸은 그리지 않는다 */
  readonly anchorRect: (anchor: FloatAnchor) => AnchorRect | null
  /** 칸 영역 전체(화면)의 사각형. 붙은 칸이 떠 있는 칸보다 작으면 여기에 가둔다 */
  readonly screenRect?: AnchorRect
  /** 세션을 바꿀 때마다 오르는 번호(칸 보기를 새로 마운트하는 열쇠) */
  readonly epoch: number
  readonly renderHead: (paneId: string) => ReactNode
  readonly renderBody: (paneId: string) => ReactNode
  /** 칸의 색 채널(카드 맨 위 2px 가장자리) */
  readonly paneChannel?: (paneId: string) => PaneChannel
  /** 지금 만지는 칸인가(강조색 테두리) */
  readonly isActive?: (paneId: string) => boolean
  /** 탭이 하나도 없는 빈 칸인가(점선 테두리) */
  readonly paneEmpty?: (paneId: string) => boolean
  /** 끌기 · 크기 바꾸기가 끝났다(저장 모양의 자리 · 크기) */
  readonly onChange: (paneId: string, patch: Pick<FloatingPane, 'x' | 'y' | 'w' | 'h'> & { readonly anchor?: FloatAnchor }) => void
  /** 눌렀다: 맨 위로 올린다 */
  readonly onRaise: (paneId: string) => void
}

interface Gesture {
  readonly mode: 'move' | 'resize'
  readonly startX: number
  readonly startY: number
  readonly box: FloatBox
}

/**
 * 떠 있는 칸들(설계 5): 칸 영역 안, 나누기 트리 칸들 위에 카드로 뜬다. 머리를 잡고 끌어 옮기고(붙은 곳 안에서만),
 * 오른쪽 아래 모서리로 크기를 바꾼다. 끄는 동안은 이 안에서만 다시 그리고 놓을 때 한 번 알린다.
 * 카드는 보통 칸과 같은 껍질(.pane-grid-cell · .pane-grid-tabs · .pane-grid-body)이라 탭 끌어 놓기 · 연결선이 그대로 알아본다.
 */
export function FloatLayer({ floats, anchorRect, screenRect, epoch, renderHead, renderBody, paneChannel, paneEmpty, isActive, onChange, onRaise }: FloatLayerProps) {
  return (
    <>
      {floats.map((float) => {
        const anchor = anchorRect(float.anchor)
        if (anchor === null) return null
        return (
          <FloatCard
            key={`${epoch}:${float.paneId}`}
            float={float}
            anchor={anchor}
            screen={screenRect ?? anchor}
            renderHead={renderHead}
            renderBody={renderBody}
            channel={paneChannel?.(float.paneId) ?? null}
            active={isActive?.(float.paneId) ?? false}
            empty={paneEmpty?.(float.paneId) ?? false}
            onChange={onChange}
            onRaise={onRaise}
          />
        )
      })}
    </>
  )
}

function FloatCard({ float, anchor, screen, renderHead, renderBody, channel, active, empty, onChange, onRaise }: {
  readonly float: FloatingPane
  readonly anchor: AnchorRect
  readonly screen: AnchorRect
  readonly renderHead: (paneId: string) => ReactNode
  readonly renderBody: (paneId: string) => ReactNode
  readonly channel: PaneChannel
  readonly active: boolean
  readonly empty: boolean
  readonly onChange: FloatLayerProps['onChange']
  readonly onRaise: FloatLayerProps['onRaise']
}) {
  // 붙은 칸이 떠 있는 칸보다 작으면(가로든 세로든) 칸이 아니라 화면 전체에 가둔다: 칸에 가두면 아래 · 오른쪽이 잘리거나 옆 칸 위로 삐져나간다
  const onScreen = float.anchor.kind === 'pane' && screen.width > 0 && screen.height > 0 && floatOutgrowsAnchor(float, anchor)
  const frame = onScreen ? { left: screen.left, top: screen.top } : { left: anchor.left, top: anchor.top }
  const size: FloatSize = onScreen ? { width: screen.width, height: screen.height } : { width: anchor.width, height: anchor.height }
  // 붙은 곳 크기를 아직 못 쟀으면(0) 저장된 크기 그대로 왼쪽 위에 둔다
  const measured = size.width > 0 && size.height > 0
  const stored: FloatBox = !measured ? { x: 0, y: 0, w: float.w, h: float.collapsed ? FLOAT_HEAD_H : float.h } : onScreen ? floatBoxOnScreen(float, anchor, size) : floatBoxIn(float, size)
  const [live, setLive] = useState<FloatBox | null>(null)
  const liveRef = useRef<FloatBox | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const box = live ?? stored

  const begin = (mode: Gesture['mode']) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    // 단추 · 입력칸과 탭(탭은 자기 끌기가 있다)에서는 옮기지 않는다
    if (mode === 'move' && (isDragExempt(event.target) || (event.target as Element).closest('.pane-top-tab') !== null)) return
    event.preventDefault()
    gesture.current = { mode, startX: event.clientX, startY: event.clientY, box: stored }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 포인터를 잡지 못해도 끌기는 된다 */ }
  }
  const drag = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current
    if (g === null || !measured) return
    const dx = event.clientX - g.startX
    const dy = event.clientY - g.startY
    const next = g.mode === 'move' ? moveFloatBox(g.box, dx, dy, size) : resizeFloatBox(g.box, dx, dy, size)
    liveRef.current = next
    setLive(next)
  }
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    if (gesture.current === null) return
    gesture.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 이미 놓였다 */ }
    const done = liveRef.current
    liveRef.current = null
    setLive(null)
    if (done === null) return
    const saved = floatFromBox(float, done, size)
    // 화면에 가두는 중에 옮겼으면 이제 화면에 붙인다(자리 비율이 화면 기준이 되었으니 칸을 따라다니지 않는다)
    onChange(float.paneId, { x: saved.x, y: saved.y, w: saved.w, h: saved.h, ...(onScreen ? { anchor: { kind: 'screen' as const } } : {}) })
  }

  const style: CSSProperties = { left: frame.left + box.x, top: frame.top + box.y, width: box.w, height: box.h }
  return (
    <div
      className="pane pane-grid-cell pane-float"
      data-float-pane={float.paneId}
      data-collapsed={float.collapsed ? '' : undefined}
      style={style}
      onPointerDownCapture={() => onRaise(float.paneId)}
    >
      <PaneCard paneId={float.paneId} channel={channel} active={active} empty={empty} className="pane-float-card">
        <div
          className="pane-grid-tabs topbar-panetab-zone pane-head pane-float-head"
          data-pane-head={float.paneId}
          onPointerDown={begin('move')}
          onPointerMove={drag}
          onPointerUp={end}
          onPointerCancel={end}
        >
          {renderHead(float.paneId)}
        </div>
        <div className="pane-grid-body pane-float-body" hidden={float.collapsed}>{renderBody(float.paneId)}</div>
        {float.collapsed ? null : (
          <div
            className="pane-float-resize"
            role="separator"
            aria-label={t('떠 있는 칸 크기 바꾸기')}
            onPointerDown={begin('resize')}
            onPointerMove={drag}
            onPointerUp={end}
            onPointerCancel={end}
          />
        )}
      </PaneCard>
    </div>
  )
}
