import { useEffect, useRef } from 'react'
import { t } from '../i18n'
import { getAppPrefs } from './appPrefs'

/** 한 획의 방향 */
export type GestureStroke = 'U' | 'D' | 'L' | 'R'

/** 한 방향으로 이만큼(px) 가야 한 획으로 친다 */
const STROKE_PX = 28

/** 지금까지의 움직임(dx, dy)이 새 획이면 그 방향 */
export function strokeOf(dx: number, dy: number): GestureStroke | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < STROKE_PX) return null
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U')
}

export interface MouseGestureActions {
  /** ↓ 문서 맨 아래로 */
  readonly bottom: () => void
  /** ↑ 문서 맨 위로 */
  readonly top: () => void
  /** ㄴ(↓→) 탭 닫기 */
  readonly closeTab: () => void
  /** ㄱ(→↓) 닫은 탭 다시 열기 */
  readonly reopenTab: () => void
  /** ← 뒤로 */
  readonly back: () => void
  /** → 앞으로 */
  readonly forward: () => void
}

export const GESTURES: Readonly<Record<string, { readonly label: string; readonly run: keyof MouseGestureActions }>> = {
  D: { label: '↓ 맨 아래로', run: 'bottom' },
  U: { label: '↑ 맨 위로', run: 'top' },
  DR: { label: 'ㄴ 탭 닫기', run: 'closeTab' },
  RD: { label: 'ㄱ 닫은 탭 다시 열기', run: 'reopenTab' },
  L: { label: '← 뒤로', run: 'back' },
  R: { label: '→ 앞으로', run: 'forward' },
}

/**
 * 브라우저처럼 오른쪽 단추를 누른 채 그리는 마우스 제스처. 움직이지 않고 떼면 평소 우클릭(메뉴)이고,
 * 그렸으면 그 동작을 하고 뒤따르는 우클릭 메뉴는 막는다. 그리는 동안 커서 옆에 할 일을 보인다.
 */
export function useMouseGestures(actions: MouseGestureActions): void {
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    let tracking: { anchorX: number; anchorY: number; strokes: GestureStroke[] } | null = null
    // 그리는 길(브라우저처럼 화면에 선으로 남긴다)과 커서 옆 안내. 화면에는 프레임마다 한 번만 반영한다
    let trail: SVGSVGElement | null = null
    let line: SVGPolylineElement | null = null
    let hint: HTMLDivElement | null = null
    let pending: { x: number; y: number }[] = []
    let cursor = { x: 0, y: 0 }
    let hintText: string | null = null
    let frame: number | null = null

    const render = () => {
      frame = null
      if (tracking === null || tracking.strokes.length === 0) return
      if (trail === null) {
        trail = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        trail.setAttribute('class', 'mouse-gesture-trail')
        line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
        trail.appendChild(line)
        document.body.appendChild(trail)
        // 그리는 동안 아래 화면은 마우스에 반응하지 않게 한다(호버·끌기 계산이 획마다 돌면 끊긴다)
        document.documentElement.classList.add('mouse-gesture-active')
      }
      // 점은 새로 생긴 것만 덧붙인다(매번 전체 문자열을 다시 만들지 않는다)
      if (line !== null && trail !== null) {
        for (const point of pending) {
          const svgPoint = trail.createSVGPoint()
          svgPoint.x = point.x
          svgPoint.y = point.y
          line.points.appendItem(svgPoint)
        }
      }
      pending = []
      if (hint === null) {
        hint = document.createElement('div')
        hint.className = 'mouse-gesture-hint'
        document.body.appendChild(hint)
      }
      const known = GESTURES[tracking.strokes.join('')]
      const text = (known === undefined ? undefined : t(known.label)) ?? tracking.strokes.map((stroke) => ({ U: '↑', D: '↓', L: '←', R: '→' })[stroke]).join('')
      if (text !== hintText) {
        hintText = text
        hint.textContent = text
        hint.dataset.known = known === undefined ? 'false' : 'true'
      }
      hint.style.transform = `translate3d(${cursor.x + 16}px, ${cursor.y + 16}px, 0)`
    }
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(render)
    }
    const hideHint = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      hint?.remove()
      hint = null
      hintText = null
      trail?.remove()
      trail = null
      line = null
      pending = []
      document.documentElement.classList.remove('mouse-gesture-active')
    }

    const down = (event: PointerEvent) => {
      if (event.button !== 2) return
      // 설정에서 끈 경우: 오른쪽 버튼은 평소 우클릭만
      if (!getAppPrefs().mouseGestures) return
      if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]') !== null) return
      tracking = { anchorX: event.clientX, anchorY: event.clientY, strokes: [] }
      pending = [{ x: event.clientX, y: event.clientY }]
    }
    const move = (event: PointerEvent) => {
      if (tracking === null || (event.buttons & 2) === 0) return
      cursor = { x: event.clientX, y: event.clientY }
      pending.push(cursor)
      const stroke = strokeOf(event.clientX - tracking.anchorX, event.clientY - tracking.anchorY)
      if (stroke !== null) {
        tracking.anchorX = event.clientX
        tracking.anchorY = event.clientY
        if (tracking.strokes.at(-1) !== stroke) tracking.strokes.push(stroke)
      }
      if (tracking.strokes.length > 0) schedule()
    }
    const up = (event: PointerEvent) => {
      if (tracking === null || event.button !== 2) return
      const { strokes } = tracking
      tracking = null
      hideHint()
      if (strokes.length === 0) return
      // 그렸으면 뒤따르는 우클릭 메뉴는 막는다
      const swallow = (menuEvent: Event) => {
        menuEvent.preventDefault()
        menuEvent.stopPropagation()
      }
      window.addEventListener('contextmenu', swallow, { capture: true, once: true })
      window.setTimeout(() => window.removeEventListener('contextmenu', swallow, { capture: true }), 400)
      const known = GESTURES[strokes.join('')]
      if (known !== undefined) actionsRef.current[known.run]()
    }
    const cancel = () => {
      tracking = null
      hideHint()
    }

    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move, { capture: true, passive: true })
    window.addEventListener('pointerup', up, true)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', move, { capture: true })
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('blur', cancel)
      hideHint()
    }
  }, [])
}
