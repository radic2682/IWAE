import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { t } from '../i18n'
import {
  MINIMAP_WIDTH,
  minimapBars,
  minimapScale,
  scrollTopForClick,
  scrollTopForDrag,
  viewportBox,
  type MinimapBar,
  type MinimapBlock,
} from './noteMinimapGeometry'
import '../ui/note-minimap.css'

/** 블록의 스크롤 칸 안쪽 위치(scrollTop 과 같은 단위). getBoundingClientRect 는 CSS zoom 과 섞이므로 offsetTop 사슬로 센다 */
function topWithin(element: HTMLElement, scroller: HTMLElement): number {
  let top = 0
  let node: HTMLElement | null = element
  while (node !== null && node !== scroller) {
    top += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return top
}

/** 카드 DOM 에서 블록 사각형을 읽는다(읽기만 한다: 쓰기와 섞지 않아 레이아웃을 한 번만 만든다) */
export function readMinimapBlocks(scroller: HTMLElement): readonly MinimapBlock[] {
  const blocks: MinimapBlock[] = []
  for (const element of scroller.querySelectorAll<HTMLElement>('[data-note-block]')) {
    const height = element.offsetHeight
    if (height <= 0) continue
    const section = element.classList.contains('note-section')
    const color = element.dataset.hl
    blocks.push({
      key: element.dataset.noteBlock ?? '',
      top: topWithin(element, scroller),
      height,
      kind: section ? 'section' : element.dataset.memoId !== undefined ? 'memo' : 'text',
      ...(color === undefined ? {} : { color }),
      dim: element.classList.contains('pdf-memo-card-dim'),
    })
  }
  return blocks
}

const sameBars = (a: readonly MinimapBar[], b: readonly MinimapBar[]): boolean =>
  a.length === b.length && a.every((bar, index) => {
    const other = b[index]!
    return bar.key === other.key && bar.top === other.top && bar.height === other.height && bar.kind === other.kind && bar.color === other.color && bar.dim === other.dim
  })

const prefersReducedMotion = (): boolean => {
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true } catch { return false }
}

/**
 * 노트 미니맵: 노트 오른쪽 끝에 붙는 좁은 띠. 블록마다 높이에 비례한 둥근 막대(소제목은 더 진하게, 메모는 형광펜 색 점 + 옅은 색),
 * 노트 검색 중이면 맞는 블록을 강조한다. 반투명 상자가 지금 보이는 부분이고, 상자를 끌거나 띠를 누르면(누른 자리가 가운데로) 노트가 스크롤된다.
 * 싸게 돌도록: 카드 크기는 ResizeObserver·MutationObserver 가 알릴 때만 rAF 로 한 번 읽고, 스크롤은 상자 위치만 바로 쓴다(React 를 거치지 않는다).
 */
export function NoteMinimap({ scrollerRef, query = '' }: { readonly scrollerRef: RefObject<HTMLElement | null>; readonly query?: string }) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [bars, setBars] = useState<readonly MinimapBar[]>([])
  const [top, setTop] = useState(0)
  const syncRef = useRef<() => void>(() => undefined)
  const dragRef = useRef<{ readonly pointerId: number; readonly grab: number } | null>(null)
  const searching = query.trim() !== ''

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const track = trackRef.current
    if (scroller === null || track === null) return undefined
    let measureFrame = 0
    let boxFrame = 0
    const observed = new Set<Element>()
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => scheduleMeasure())

    const scale = () => minimapScale(scroller.scrollHeight, track.clientHeight)
    const syncBox = () => {
      boxFrame = 0
      const box = boxRef.current
      if (box === null) return
      const next = viewportBox(scroller.scrollTop, scroller.clientHeight, scroller.scrollHeight, scale())
      box.style.transform = `translateY(${next.top}px)`
      box.style.height = `${next.height}px`
    }
    const scheduleBox = () => { if (boxFrame === 0) boxFrame = window.requestAnimationFrame(syncBox) }
    const measure = () => {
      measureFrame = 0
      const blocks = readMinimapBlocks(scroller)
      const next = minimapBars(blocks, scale())
      setBars((previous) => (sameBars(previous, next) ? previous : next))
      setTop(scroller.offsetTop)
      // 새로 생긴 카드를 지켜보고, 사라진 카드는 놓는다
      const present = new Set<Element>(scroller.querySelectorAll('[data-note-block]'))
      for (const element of observed) if (!present.has(element)) { resize?.unobserve(element); observed.delete(element) }
      for (const element of present) if (!observed.has(element)) { resize?.observe(element); observed.add(element) }
      syncBox()
    }
    function scheduleMeasure() { if (measureFrame === 0) measureFrame = window.requestAnimationFrame(measure) }
    syncRef.current = scheduleMeasure

    resize?.observe(scroller)
    resize?.observe(track)
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(scheduleMeasure)
    mutations?.observe(scroller, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    scroller.addEventListener('scroll', scheduleBox, { passive: true })
    measure()
    return () => {
      scroller.removeEventListener('scroll', scheduleBox)
      mutations?.disconnect()
      resize?.disconnect()
      if (measureFrame !== 0) window.cancelAnimationFrame(measureFrame)
      if (boxFrame !== 0) window.cancelAnimationFrame(boxFrame)
      syncRef.current = () => undefined
    }
  }, [scrollerRef])

  // 검색어가 바뀌면 블록의 흐림이 바뀐다(클래스 변화는 MutationObserver 가 알리지만, 같은 그림에서 바로 맞추려 한 번 더 잰다)
  useEffect(() => { syncRef.current() }, [query])

  const place = (clientY: number): { y: number; scroller: HTMLElement; track: HTMLElement } | null => {
    const scroller = scrollerRef.current
    const track = trackRef.current
    if (scroller === null || track === null) return null
    return { y: clientY - track.getBoundingClientRect().top, scroller, track }
  }
  const scrollTo = (scroller: HTMLElement, top: number, smooth: boolean) => {
    if (smooth && !prefersReducedMotion() && typeof scroller.scrollTo === 'function') scroller.scrollTo({ top, behavior: 'smooth' })
    else scroller.scrollTop = top
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const at = place(event.clientY)
    if (at === null) return
    event.preventDefault()
    const scale = minimapScale(at.scroller.scrollHeight, at.track.clientHeight)
    const box = viewportBox(at.scroller.scrollTop, at.scroller.clientHeight, at.scroller.scrollHeight, scale)
    const inside = at.y >= box.top && at.y <= box.top + box.height
    // 상자를 잡으면 잡은 자리를 유지하고, 다른 곳을 누르면 그 자리가 가운데로(그 뒤 끌면 상자 가운데를 잡고 따라간다)
    const grab = inside ? at.y - box.top : box.height / 2
    if (!inside) scrollTo(at.scroller, scrollTopForClick(at.y, scale, at.scroller.clientHeight, at.scroller.scrollHeight), true)
    dragRef.current = { pointerId: event.pointerId, grab }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 합성 포인터 */ }
    document.body.classList.add('note-minimap-dragging')
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const at = place(event.clientY)
    if (at === null) return
    const scale = minimapScale(at.scroller.scrollHeight, at.track.clientHeight)
    // 끄는 동안은 늘 즉시(부드러운 스크롤이 포인터를 뒤따르면 어긋난다)
    at.scroller.scrollTop = scrollTopForDrag(at.y, drag.grab, scale, at.scroller.clientHeight, at.scroller.scrollHeight)
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    document.body.classList.remove('note-minimap-dragging')
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 이미 놓였다 */ }
  }
  useEffect(() => () => document.body.classList.remove('note-minimap-dragging'), [])

  return (
    <div
      ref={trackRef}
      className="note-minimap"
      data-note-minimap=""
      role="presentation"
      aria-label={t('노트 미니맵')}
      style={{ top, width: MINIMAP_WIDTH }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={(event) => {
        const scroller = scrollerRef.current
        if (scroller !== null) scroller.scrollTop += event.deltaY * (event.deltaMode === 1 ? 16 : 1)
      }}
    >
      {bars.map((bar) => {
        const hit = searching && !bar.dim && bar.kind !== 'section'
        return (
          <div
            key={bar.key}
            className="note-minimap-bar"
            data-kind={bar.kind}
            data-hl={bar.color}
            data-hit={hit ? '' : undefined}
            data-dim={searching && bar.dim ? '' : undefined}
            style={{ top: bar.top, height: bar.height }}
          >
            {bar.kind === 'memo' && bar.height >= 5 ? <i className="note-minimap-dot" /> : null}
          </div>
        )
      })}
      <div ref={boxRef} className="note-minimap-box" data-minimap-box="" />
    </div>
  )
}
