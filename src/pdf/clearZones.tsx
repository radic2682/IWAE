import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** 선이 지나가면 안 되는 자리(svg 좌표). 빈 창 안내 글처럼 읽혀야 하는 글 둘레 */
export interface ClearRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

const CLEAR_SELECTOR = '.pane-placeholder-empty'
const CLEAR_MARGIN = 14

/** 이 svg 위로 지나가는 형광펜→카드 선이 읽을 글 위를 덮지 않게 비워 둘 자리들을 잰다 */
export function useClearZones(): { readonly ref: RefObject<SVGSVGElement | null>; readonly rects: readonly ClearRect[] } {
  const ref = useRef<SVGSVGElement | null>(null)
  const [rects, setRects] = useState<readonly ClearRect[]>([])
  useLayoutEffect(() => {
    const svg = ref.current
    if (svg === null || typeof document === 'undefined') return
    const origin = svg.getBoundingClientRect()
    const next = Array.from(document.querySelectorAll<HTMLElement>(CLEAR_SELECTOR)).filter((element) => element.closest('[inert]') === null && element.getBoundingClientRect().width >= 80).map((element) => {
      const box = element.getBoundingClientRect()
      return {
        x: Math.round(box.left - origin.left - CLEAR_MARGIN),
        y: Math.round(box.top - origin.top - CLEAR_MARGIN),
        w: Math.round(box.width + CLEAR_MARGIN * 2),
        h: Math.round(box.height + CLEAR_MARGIN * 2),
      }
    }).filter((rect) => rect.w > CLEAR_MARGIN * 2 && rect.h > CLEAR_MARGIN * 2)
    setRects((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
  })
  return { ref, rects }
}

/** rects 를 뺀 곳에만 그리게 하는 마스크. 선 묶음 <g> 에 mask 속성으로 건다 */
export function useClearMask(rects: readonly ClearRect[]) {
  const id = `clear-${useId().replace(/:/g, '')}`
  return {
    id,
    defs: (
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x={-5000} y={-5000} width={20000} height={20000}>
          <rect x={-5000} y={-5000} width={20000} height={20000} fill="white" />
          {rects.map((rect, index) => <rect key={index} x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={12} fill="black" />)}
        </mask>
      </defs>
    ),
  }
}
