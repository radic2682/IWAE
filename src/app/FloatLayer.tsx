import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { isDragExempt } from '../ui/dragExempt'
import { FLOAT_HEAD_H, floatBoxIn, floatFromBox, moveFloatBox, resizeFloatBox, type FloatBox, type FloatSize } from './floatingPanes'
import type { FloatAnchor, FloatingPane } from './screens'
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
  /** 세션을 바꿀 때마다 오르는 번호(칸 보기를 새로 마운트하는 열쇠) */
  readonly epoch: number
  readonly renderHead: (paneId: string) => ReactNode
  readonly renderBody: (paneId: string) => ReactNode
  /** 끌기 · 크기 바꾸기가 끝났다(저장 모양의 자리 · 크기) */
  readonly onChange: (paneId: string, patch: Pick<FloatingPane, 'x' | 'y' | 'w' | 'h'>) => void
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
export function FloatLayer({ floats, anchorRect, epoch, renderHead, renderBody, onChange, onRaise }: FloatLayerProps) {
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
            renderHead={renderHead}
            renderBody={renderBody}
            onChange={onChange}
            onRaise={onRaise}
          />
        )
      })}
    </>
  )
}

function FloatCard({ float, anchor, renderHead, renderBody, onChange, onRaise }: {
  readonly float: FloatingPane
  readonly anchor: AnchorRect
  readonly renderHead: (paneId: string) => ReactNode
  readonly renderBody: (paneId: string) => ReactNode
  readonly onChange: FloatLayerProps['onChange']
  readonly onRaise: FloatLayerProps['onRaise']
}) {
  const size: FloatSize = { width: anchor.width, height: anchor.height }
  // 붙은 곳 크기를 아직 못 쟀으면(0) 저장된 크기 그대로 왼쪽 위에 둔다
  const measured = size.width > 0 && size.height > 0
  const stored: FloatBox = measured ? floatBoxIn(float, size) : { x: 0, y: 0, w: float.w, h: float.collapsed ? FLOAT_HEAD_H : float.h }
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
    onChange(float.paneId, { x: saved.x, y: saved.y, w: saved.w, h: saved.h })
  }

  const style: CSSProperties = { left: anchor.left + box.x, top: anchor.top + box.y, width: box.w, height: box.h }
  return (
    <div
      className="pane pane-grid-cell pane-float"
      data-float-pane={float.paneId}
      data-collapsed={float.collapsed ? '' : undefined}
      style={style}
      onPointerDownCapture={() => onRaise(float.paneId)}
    >
      <div className="pane-card pane-float-card">
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
      </div>
    </div>
  )
}
