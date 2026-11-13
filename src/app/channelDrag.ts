import { armClickSuppress } from '../ui/clickSuppress'
import type { PaneId } from './tabs'
import type { Channel, PaneChannel } from './workspaceChannels'
import { TAB_DRAG_THRESHOLD_PX, paneHitAt, setDockDragging } from './tabDrag'

/**
 * 창 머리의 색 점을 끌어 다른 칸에 놓아 두 칸을 잇는다(규칙은 channelLink.ts, 여기는 포인터 · 표시만).
 *
 * - 점을 누르고 TAB_DRAG_THRESHOLD_PX 이상 움직이면 끌기가 시작된다. 움직이지 않은 누름은 그대로 클릭(색 바꾸기)이고,
 *   끌기가 있었으면 놓은 뒤 따라오는 클릭 한 번은 삼킨다.
 * - 끄는 동안: 끈 칸의 색 12px 점(채널이 없으면 점선 고리)이 포인터를 따라오고, 점의 가운데에서 포인터까지 1.5px 선이 이어진다
 *   (SVG 한 장, 포인터를 받지 않는다). 움직임은 따라오기뿐이다.
 * - 놓을 칸(다른 보이는 칸: 트리 칸 · 떠 있는 칸의 머리 · 본문)의 테두리는 놓으면 될 색을 100% 로 미리 보인다(data-link-preview).
 *   자기 자신 · 빈 곳 · 상단바 위에 놓거나 Esc 를 누르면 취소다.
 * - 끄는 동안 body 에 dock-dragging 을 달아 칸 안 내용에 마우스가 걸리지 않게 한다(tabDrag 의 setDockDragging).
 */

/** 끌기가 App 에게 묻고 시키는 것(App 이 setChannelDragHost 로 채운다) */
export interface ChannelDragHost {
  /** 점의 칸의 지금 채널(끄는 점의 모양) */
  channelOf(pane: PaneId): PaneChannel
  /** source 를 target 에 놓으면 두 칸이 갖게 될 채널. 놓을 수 없으면(자기 자신 · 보이지 않는 칸) null */
  previewChannel(source: PaneId, target: PaneId): Channel | null
  /** 두 칸을 잇는다(채널을 정하고 두 칸에 반응 표시를 낸다) */
  link(source: PaneId, target: PaneId): void
}

let host: ChannelDragHost | null = null

export function setChannelDragHost(next: ChannelDragHost | null): void {
  host = next
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const GHOST_SIZE = 12

export interface ChannelDragStart {
  readonly source: PaneId
  /** 누른 점 단추(선이 나가는 가운데를 잰다) */
  readonly dot: HTMLElement
  readonly startX: number
  readonly startY: number
  /** 끌기가 시작됐다(알림용) */
  readonly onDragged?: () => void
}

/** 점 위에서 눌렀다: 움직임을 지켜보다가 문턱을 넘으면 끌기 표시를 낸다. 끝나면 지켜보기도 걷는다 */
export function startChannelDrag(start: ChannelDragStart): void {
  const { source, dot } = start
  let dragging = false
  let finished = false
  let lastX = start.startX
  let lastY = start.startY
  let ghost: HTMLElement | null = null
  let svg: SVGSVGElement | null = null
  let line: SVGLineElement | null = null
  let previewCard: HTMLElement | null = null
  let target: PaneId | null = null
  let originX = start.startX
  let originY = start.startY

  const clearPreview = () => {
    if (previewCard !== null) delete previewCard.dataset.linkPreview
    previewCard = null
  }

  const begin = () => {
    dragging = true
    const box = dot.getBoundingClientRect()
    originX = box.left + box.width / 2
    originY = box.top + box.height / 2
    const channel = host?.channelOf(source) ?? null
    ghost = document.createElement('div')
    ghost.className = 'channel-drag-ghost'
    ghost.dataset.channel = channel ?? 'none'
    ghost.setAttribute('aria-hidden', 'true')
    svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('class', 'channel-drag-line')
    svg.setAttribute('aria-hidden', 'true')
    svg.dataset.channel = channel ?? 'none'
    line = document.createElementNS(SVG_NS, 'line')
    line.setAttribute('stroke', 'currentColor')
    line.setAttribute('stroke-width', '1.5')
    line.setAttribute('stroke-linecap', 'round')
    svg.append(line)
    document.body.append(svg, ghost)
    setDockDragging(true)
    start.onDragged?.()
    // 이 끌기 뒤에 따라오는 클릭(점을 눌러 색을 바꾸는)은 삼킨다: 손을 뗀 한 틱 뒤(Esc 였으면 손을 떼거나 새로 누를 때)에 풀린다
    armClickSuppress()
  }

  const paint = () => {
    if (ghost === null || line === null) return
    ghost.style.transform = `translate3d(${lastX - GHOST_SIZE / 2}px, ${lastY - GHOST_SIZE / 2}px, 0)`
    line.setAttribute('x1', String(originX))
    line.setAttribute('y1', String(originY))
    line.setAttribute('x2', String(lastX))
    line.setAttribute('y2', String(lastY))
    const hit = paneHitAt(lastX, lastY)
    const hovered = hit.kind === 'none' ? null : hit.pane
    const preview = hovered === null || hovered === source ? null : host?.previewChannel(source, hovered) ?? null
    clearPreview()
    target = preview === null ? null : hovered
    if (hit.kind !== 'none' && preview !== null) {
      hit.card.dataset.linkPreview = preview
      previewCard = hit.card
    }
  }

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('blur', onCancel)
    clearPreview()
    ghost?.remove()
    svg?.remove()
    ghost = null
    svg = null
    line = null
    if (dragging) setDockDragging(false)
  }

  const cancel = () => {
    if (finished) return
    finished = true
    cleanup()
  }
  const onCancel = () => cancel()
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    cancel()
  }
  const onMove = (event: PointerEvent) => {
    lastX = event.clientX
    lastY = event.clientY
    if (!dragging) {
      if (Math.hypot(lastX - start.startX, lastY - start.startY) < TAB_DRAG_THRESHOLD_PX) return
      begin()
    }
    paint()
  }
  const onUp = (event: PointerEvent) => {
    if (finished) return
    finished = true
    lastX = event.clientX
    lastY = event.clientY
    if (dragging) paint()
    const dropped = dragging ? target : null
    cleanup()
    if (dropped !== null) host?.link(source, dropped)
  }

  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('blur', onCancel)
}
