import { isDragExempt } from '../ui/dragExempt'
import { t } from '../i18n'
import { createPillGhost, type PillGhost } from './dockSession'
import { TAB_DRAG_THRESHOLD_PX, createDockVisuals, paintDockTarget, paneHitAt, reducedMotion, resolveDockTarget, setDockDragging, type DockTarget } from './tabDrag'
import { dockZoneBox, type DockEdge } from './tabDock'
import type { PaneId } from './tabs'
import '../ui/pane-drag.css'

/**
 * 칸 머리를 잡고 칸 통째로 끌어 옮기기(포인터 이벤트로 직접 한다 — tabDrag 와 같다).
 * - 머리의 빈자리 · 칸 번호를 누르고 문턱(TAB_DRAG_THRESHOLD_PX) 이상 움직이면 시작한다. 탭 · 색 점 · 단추 위에서는 시작하지 않는다(탭은 자기 끌기가 있다).
 * - 손에는 작은 알약(칸 번호 + 보는 탭의 아이콘 · 이름)이 붙어 오고, 원래 칸은 점선 · 흐린 상태가 된다.
 * - 놓을 자리는 탭 끌기와 같은 판정(paneHitAt · resolveDockTarget · paintDockTarget): 다른 칸의 가장자리 = 그 쪽에 나누어 넣기(옮기기),
 *   가운데나 머리 줄 = 두 칸의 자리 맞바꾸기. 미리보기가 보이는 자리는 놓으면 꼭 된다(edgesFor 가 못 하는 쪽을 미리 뺀다).
 * - 제 자리 · 칸 밖에 놓거나 Esc 를 누르면 아무 일도 없다.
 * - 끄는 동안 body 에 dock-dragging 을 달아 칸 안 내용에 마우스가 걸리지 않게 한다(올려 둔 카드가 들뜨지 않게).
 */

/** 끌기를 시작한 쪽(App)이 대 주는 것들. 끄는 동안의 최신 값을 읽도록 함수로 준다 */
export interface PaneDragHost {
  /** 끄는 칸 */
  readonly pane: PaneId
  /** target 이 놓을 수 있는 칸인가(트리의 다른 칸. 떠 있는 칸은 대상이 아니다) */
  canTarget(target: PaneId): boolean
  /** target 칸에서 나눌 수 있는 가장자리들(비어 있으면 가운데 맞바꾸기만) */
  edgesFor(target: PaneId): readonly DockEdge[]
  /** target 의 edge 쪽으로 옮기기 */
  dock(target: PaneId, edge: DockEdge): void
  /** target 과 자리 맞바꾸기 */
  swap(target: PaneId): void
}

/** 칸 머리에서 끌기를 시작하지 않는 자리: 탭 · 색 점 · 탭 목록 단추 · 그 밖의 단추 · 입력칸 */
const PANE_DRAG_EXEMPT = '.pane-top-tab, [role="tab"], .pane-channel-dot, .pane-tabs-overflow, .pane-tabs-popover, .pane-tabs-backdrop'

/** 트리 칸의 머리(떠 있는 칸의 머리는 자기 끌기가 있다) */
const TREE_HEAD = '.pane-grid-tabs[data-pane-head]:not(.pane-float-head)'

/** 이 누름이 칸 끌기의 시작이 될 수 있는 자리인가(트리 칸 머리의 빈자리 · 칸 번호). 칸 만지기는 누를 때 그대로 일어난다(끄는 칸 자신이라 다른 칸으로 옮겨 가지 않는다) */
export function isPaneDragPress(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest(TREE_HEAD) === null) return false
  return !isDragExempt(target) && target.closest(PANE_DRAG_EXEMPT) === null
}

/** 끄는 동안 칸 카드에 다는 표시 이름(pane-drag.css) */
const SOURCE_ATTR = 'data-pane-dragging'
/** 끄는 동안 원래 칸에 붙이는 점선 윤곽(빈 칸의 .pane-slot-outline 과 같은 규칙) */
const SOURCE_OUTLINE_CLASS = 'pane-drag-outline'

function sourceOutline(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', `pane-slot-outline ${SOURCE_OUTLINE_CLASS}`)
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'rect'))
  return svg
}

function sourceCard(pane: PaneId): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('.pane-card[data-card-pane]')).find((card) => card.dataset.cardPane === pane) ?? null
}

/** 손에 붙을 알약: 칸 번호 + 보는 탭의 아이콘 · 이름(탭이 없으면 「칸 N」) */
function buildGhost(head: HTMLElement, pane: PaneId): PillGhost {
  const number = head.querySelector<HTMLElement>('.pane-head-number')?.textContent ?? ''
  const active = head.querySelector<HTMLElement>('.pane-top-tab-active') ?? head.querySelector<HTMLElement>('.pane-top-tab')
  const title = active?.querySelector<HTMLElement>('.pane-top-tab-label')?.textContent?.trim()
  const icon = active?.querySelector('.pane-top-tab-kind') ?? null
  const ghost = createPillGhost(icon, title !== undefined && title !== '' ? title : t('칸 {n}', { n: number === '' ? pane : number }))
  if (number !== '') {
    const mark = document.createElement('span')
    mark.className = 'pane-drag-number'
    mark.textContent = number
    ghost.element.querySelector('.pane-top-tab-title')?.prepend(mark)
  }
  return ghost
}

/** Phosphor ArrowsLeftRight(regular) 의 경로 — 14px 로 쓴다 */
const SWAP_ICON = '<svg viewBox="0 0 256 256" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M213.66,181.66l-32,32a8,8,0,0,1-11.32-11.32L188.69,184H48a8,8,0,0,1,0-16H188.69l-18.35-18.34a8,8,0,0,1,11.32-11.32l32,32A8,8,0,0,1,213.66,181.66Zm-139.32-64a8,8,0,0,0,11.32-11.32L67.31,88H208a8,8,0,0,0,0-16H67.31L85.66,53.66A8,8,0,0,0,74.34,42.34l-32,32a8,8,0,0,0,0,11.32Z"/></svg>'

/** 가운데(맞바꾸기) 미리보기 한가운데의 이름표: 「이 칸으로 탭 옮기기」 미리보기와 똑같아 보이지 않게 한다. 한 번 만들어 두고 자리만 옮긴다 */
function createSwapChip(): { show(box: { readonly left: number; readonly top: number; readonly width: number; readonly height: number } | null): void; remove(): void } {
  const chip = document.createElement('div')
  chip.className = 'pane-drag-swap-chip'
  chip.setAttribute('aria-hidden', 'true')
  chip.hidden = true
  chip.innerHTML = `${SWAP_ICON}<span>${t('자리 바꾸기')}</span>`
  document.body.append(chip)
  return {
    show(box) {
      chip.hidden = box === null
      if (box === null) return
      chip.style.left = `${Math.round(box.left + box.width / 2)}px`
      chip.style.top = `${Math.round(box.top + box.height / 2)}px`
    },
    remove: () => chip.remove(),
  }
}

type Drop =
  | { readonly kind: 'none' }
  | { readonly kind: 'swap'; readonly pane: PaneId }
  | { readonly kind: 'dock'; readonly pane: PaneId; readonly edge: DockEdge }

export function startPaneDrag(event: { readonly clientX: number; readonly clientY: number; readonly button: number }, head: HTMLElement, getHost: () => PaneDragHost): void {
  if (event.button !== 0) return
  const host0 = getHost()
  const pane = host0.pane
  const startX = event.clientX
  const startY = event.clientY
  const visuals = createDockVisuals()
  let dragging = false
  let finished = false
  let ghost: PillGhost | null = null
  let swapChip: ReturnType<typeof createSwapChip> | null = null
  let drop: Drop = { kind: 'none' }
  let lastX = startX
  let lastY = startY

  const paint = (target: DockTarget) => paintDockTarget(visuals, target, null)

  const update = () => {
    if (!dragging) return
    ghost?.move(lastX, lastY)
    const hit = paneHitAt(lastX, lastY)
    const h = getHost()
    if (hit.kind === 'none' || hit.pane === pane || !h.canTarget(hit.pane)) {
      paint({ kind: 'none' })
      swapChip?.show(null)
      drop = { kind: 'none' }
      return
    }
    // 머리 줄 위는 맞바꾸기(탭을 놓는 자리와 달리 칸 통째로 오는 것이라 줄에 끼울 틈이 없다)
    const target: DockTarget = hit.kind === 'strip'
      ? { kind: 'body', pane: hit.pane, zone: 'center', box: hit.card.getBoundingClientRect() }
      : resolveDockTarget(hit, lastX, lastY, h.edgesFor(hit.pane))
    if (target.kind !== 'body') {
      paint({ kind: 'none' })
      swapChip?.show(null)
      drop = { kind: 'none' }
      return
    }
    paint(target)
    swapChip?.show(target.zone === 'center' ? dockZoneBox(target.box, 'center') : null)
    drop = target.zone === 'center' ? { kind: 'swap', pane: target.pane } : { kind: 'dock', pane: target.pane, edge: target.zone }
  }

  // 끄는 동안은 올라가는 단추 · 탭의 말풍선이 뜨지 않게 한다
  const swallowHover = (hoverEvent: Event) => hoverEvent.stopPropagation()
  const begin = () => {
    dragging = true
    window.addEventListener('pointerover', swallowHover, true)
    setDockDragging(true)
    const card = sourceCard(pane)
    if (card !== null) {
      card.setAttribute(SOURCE_ATTR, '')
      // 원래 자리는 빈 칸과 같은 SVG 점선 윤곽 하나로 그린다. CSS dashed 테두리는 틈으로 카드 바탕이 비쳐 실선 위에 점선이 겹쳐 보였다
      if (card.querySelector(`:scope > .${SOURCE_OUTLINE_CLASS}`) === null) card.appendChild(sourceOutline())
    }
    ghost = buildGhost(head, pane)
    swapChip = createSwapChip()
    ghost.attach()
    update()
  }

  /** 들린 알약을 투명하게 걷는다(120ms 페이드, 움직임 줄이기면 바로) */
  const dismissGhost = () => {
    const current = ghost
    ghost = null
    if (current === null) return
    const element = current.element
    if (reducedMotion()) { current.remove(); return }
    element.style.transition = 'opacity 120ms ease-out'
    element.style.opacity = '0'
    window.setTimeout(() => current.remove(), 140)
  }

  const cleanupListeners = () => {
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('blur', onCancel)
    window.removeEventListener('pointerover', swallowHover, true)
  }
  const cleanupVisuals = () => {
    visuals.clear(true)
    swapChip?.remove()
    swapChip = null
    setDockDragging(false)
    sourceCard(pane)?.removeAttribute(SOURCE_ATTR)
    document.querySelectorAll(`[${SOURCE_ATTR}]`).forEach((element) => element.removeAttribute(SOURCE_ATTR))
    document.querySelectorAll(`.${SOURCE_OUTLINE_CLASS}`).forEach((element) => element.remove())
  }
  /** 끌고 난 뒤 따라오는 click 이 아래 요소에 닿지 않게 한 번 삼킨다(놓은 뒤 한 틱 뒤에 풀고, 새로 누르면 바로 푼다) */
  const swallowClickOnce = () => {
    const swallow = (clickEvent: Event) => { clickEvent.stopPropagation(); clickEvent.preventDefault() }
    let timer: number | null = null
    const release = () => {
      window.removeEventListener('click', swallow, true)
      window.removeEventListener('pointerdown', release, true)
      if (timer !== null) window.clearTimeout(timer)
    }
    window.addEventListener('click', swallow, true)
    window.addEventListener('pointerdown', release, true)
    timer = window.setTimeout(release, 400)
  }

  const cancel = () => {
    if (finished) return
    finished = true
    cleanupListeners()
    const was = dragging
    cleanupVisuals()
    dismissGhost()
    if (was) swallowClickOnce()
  }
  const onCancel = () => cancel()
  const onKey = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key !== 'Escape') return
    keyEvent.preventDefault()
    keyEvent.stopPropagation()
    cancel()
  }
  const onUp = (upEvent: PointerEvent) => {
    if (finished) return
    lastX = upEvent.clientX
    lastY = upEvent.clientY
    if (!dragging) { finished = true; cleanupListeners(); return }
    update()
    finished = true
    cleanupListeners()
    const chosen = drop
    cleanupVisuals()
    dismissGhost()
    swallowClickOnce()
    const h = getHost()
    if (chosen.kind === 'swap') h.swap(chosen.pane)
    else if (chosen.kind === 'dock') h.dock(chosen.pane, chosen.edge)
  }
  const onMove = (moveEvent: PointerEvent) => {
    lastX = moveEvent.clientX
    lastY = moveEvent.clientY
    if (!dragging) {
      if (Math.hypot(lastX - startX, lastY - startY) < TAB_DRAG_THRESHOLD_PX) return
      begin()
    }
    update()
  }

  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('blur', onCancel)
}
