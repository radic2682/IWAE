import { flushSync } from 'react-dom'
import { dockZoneAt, dockZoneBox, insertionIndexAt, type Box, type DockEdge, type DockZone } from './tabDock'
import type { PaneId, Tab } from './tabs'
import { GHOST_EDGE_MARGIN, clampGhostPos } from './ghostPlace'
import { EASE_SPRING_FIRM, SPRING_FIRM_MS, springSoft } from './motion'

/**
 * 탭 끌기(크롬·엣지처럼). 포인터 이벤트로 직접 한다 — Tauri 창은 HTML 끌어놓기를 파일 끌어놓기로 가로채 쓸 수 없다.
 *
 * - 잡으면 탭 모양 그대로의 「들린 탭」(ghost)이 손에 붙어 따라온다. 원래 탭은 자리만 남는 구멍이 되고,
 *   같은 줄 안에서는 이웃 탭이 미끄러져 비키며 놓일 자리를 보인다(순서는 끄는 동안 바로 바뀐다).
 * - 다른 패널의 탭 줄 위에서는 그 줄의 탭들이 벌어져 끼워 넣을 자리를 보인다.
 * - 패널 본문 위에서는 가장자리 띠에 반투명 구역 미리보기(좌·우·상·하 절반, 가운데는 그 패널 전체)가 나타난다.
 * - 창 밖으로 나가면(탭이 PDF 일 때) 호스트가 새 창으로 떼어 낸다.
 * - 놓으면 들린 탭이 놓일 자리로 내려앉고, Escape 는 제자리로 돌려보낸다.
 *
 * 끄는 중의 표시는 React 가 그리는 className 이 아니라 data 속성(data-dragging·data-collapsed·data-landing)으로 건다 —
 * 끄는 동안 다시 그려져도 지워지지 않는다.
 */

/** 끌기로 볼 만큼 움직였는지. 이보다 짧으면 클릭이다 */
export const TAB_DRAG_THRESHOLD_PX = 6
/** 창 밖으로 이만큼 나가면 새 창으로 떼어 낸다 */
export const TEAR_OFF_MARGIN_PX = 28
/** 창 가장자리 1px 에 이 시간 머물러도(최대화 창에서 화면 끝에 닿았을 때) 떼어 낸다 */
const TEAR_OFF_EDGE_DWELL_MS = 360
const SETTLE_MS = 300

/** 끌기를 시작한 쪽(탭 줄을 그린 컴포넌트)이 대 주는 것들. 끄는 동안의 최신 값을 읽도록 함수로 준다 */
export interface TabDragHost {
  readonly tab: Tab
  readonly sourcePane: PaneId | undefined
  /** 같은 줄 안에서 순서 바꾸기(끄는 동안 바로 반영) */
  reorder?(id: string, toIndex: number): void
  /** 다른 패널의 index 자리로 옮기기 */
  moveAt?(id: string, pane: PaneId, index: number): void
  /** 패널의 edge 쪽을 갈라 새 패널에 넣기 */
  dock?(id: string, pane: PaneId, edge: DockEdge): void
  /** 그 패널에서 나눌 수 있는 가장자리들. 없으면 나누기 구역을 안 보인다 */
  dockEdges?(pane: PaneId, id: string): readonly DockEdge[]
  /**
   * 창 밖으로 나갔다: 새 창으로 떼어 내고 true 를 돌려주면 끌기는 거기서 끝난다(뒤는 창 쪽이 이어 받는다).
   * 이 탭을 떼어 낼 수 없으면 아예 안 둔다
   */
  tearOff?(id: string, info: TearOffInfo): Promise<boolean> | boolean
  /**
   * 창 하나에 탭이 이 탭뿐인 떼어 낸 창: 이 탭을 끌면 탭이 아니라 창 전체가 마우스를 따라간다.
   * tearOff 가 바로(창 밖으로 안 나가도) 불린다
   */
  dragWindow?: boolean
  /** 끌기가 시작됐다(끝난 뒤 따라오는 click 을 탭 전환으로 안 치려고) */
  onDragged?(): void
}

export interface TearOffInfo {
  readonly id: string
  readonly screenX: number
  readonly screenY: number
  /** 잡은 자리(탭 왼쪽 위에서) */
  readonly grabX: number
  readonly grabY: number
  readonly width: number
  readonly height: number
}

export type Hit =
  /** 칸 머리(탭 줄 구역). card 는 칸 카드(머리 + 본문) */
  | { readonly kind: 'strip'; readonly pane: PaneId; readonly strip: HTMLElement | null; readonly zone: HTMLElement; readonly card: HTMLElement }
  /** 칸 본문. card 는 칸 카드 — 구역도 미리보기도 머리까지 포함한 카드 전체를 기준으로 한다 */
  | { readonly kind: 'body'; readonly pane: PaneId; readonly card: HTMLElement }
  | { readonly kind: 'none' }

type Drop =
  | { readonly kind: 'none' }
  | { readonly kind: 'reorder' }
  | { readonly kind: 'move'; readonly pane: PaneId; readonly index: number }
  | { readonly kind: 'dock'; readonly pane: PaneId; readonly edge: DockEdge }

let flipSuppressed = false
/** 놓아서 상태를 바꾸는 순간에는 탭 줄이 스스로 미끄러지지 않는다(이미 손이 만든 자리에 있으니) */
export function tabFlipSuppressed(): boolean {
  return flipSuppressed
}
/** 다음 그리기 한 번(같은 프레임 안)만 탭 줄이 미끄러지지 않게 한다 — 다른 창에서 붙인 탭이 이미 벌어진 자리에 들어갈 때 */
export function holdTabFlip(): void {
  flipSuppressed = true
  requestAnimationFrame(() => { flipSuppressed = false })
}

export function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const asPane = (value: string | undefined): PaneId | null => value === undefined || value === '' ? null : value

function paneOfZone(zone: HTMLElement): PaneId | null {
  const own = asPane(zone.dataset.paneId)
  if (own !== null) return own
  return asPane(zone.closest<HTMLElement>('.pane-grid-cell')?.querySelector<HTMLElement>('[data-pane-id]')?.dataset.paneId)
}

const insideBox = (box: DOMRect, x: number, y: number): boolean => box.width > 0 && box.height > 0 && x >= box.left && x < box.right && y >= box.top && y < box.bottom

/**
 * 화면 한 점이 어느 칸의 머리(탭 줄)·본문 위인가. 칸 상자(칸 사이 틈까지 칸에 든다)의 자리로 따진다 —
 * 틈과 경계선 위에서도 가장 가까운 칸이라 미리보기가 깜빡이지 않는다. 떠 있는 칸은 DOM 에서 뒤라 먼저 본다(위에 있다).
 * 칸 영역 밖(왼쪽 바 · 상단바 · 창 위에 뜬 것)은 none.
 */
/** 칸 id 의 칸 요소(.pane-card). 속성 선택자로 찾으므로 칸 id 를 따로 이스케이프할 필요가 없다 */
export function paneCardOf(pane: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('.pane-card[data-card-pane]')).find((card) => card.dataset.cardPane === pane) ?? null
}

export function paneHitAt(x: number, y: number): Hit {
  const element = document.elementFromPoint(x, y)
  if (element === null || element.closest('.panes') === null) return { kind: 'none' }
  const cells = Array.from(document.querySelectorAll<HTMLElement>('.pane-grid-cell')).reverse()
  for (const cell of cells) {
    if (cell.classList.contains('pane-zoom-hidden') || cell.closest('[inert]') !== null) continue
    if (!insideBox(cell.getBoundingClientRect(), x, y)) continue
    const card = cell.querySelector<HTMLElement>('.pane-card[data-card-pane]')
    const pane = asPane(card?.dataset.cardPane)
    if (card === null || pane === null) continue
    const head = cell.querySelector<HTMLElement>('.pane-grid-tabs')
    if (head !== null && y < head.getBoundingClientRect().bottom) return { kind: 'strip', pane, strip: head.querySelector<HTMLElement>('.pane-tabs-strip'), zone: head, card }
    return { kind: 'body', pane, card }
  }
  return { kind: 'none' }
}

/** 칸 카드 안 한 점의 구역과 그 카드의 자리. 카드 밖(칸 사이 틈)이면 가장 가까운 카드 안쪽으로 당겨 본다 */
export function dockZoneInCard(card: HTMLElement, x: number, y: number, allowed: readonly DockEdge[]): { readonly zone: DockZone; readonly box: Box } {
  const box = card.getBoundingClientRect()
  const zone = dockZoneAt(box, Math.min(Math.max(x, box.left), box.right), Math.min(Math.max(y, box.top), box.bottom), allowed) ?? 'center'
  return { zone, box }
}

/**
 * 끄는 자리가 어디인가: 탭 줄(머리) 위 · 칸 본문 위 · 칸 밖. 탭 끌기(startTabDrag)와 왼쪽 바 끌기(startDockSession)가 같은 판정을 쓴다.
 * 본문은 구역(zone)과 그 구역의 기준 상자(box)까지 정해서 준다. edges: 그 칸에서 나눌 수 있는 가장자리들(칸마다 달라서 함수도 받는다)
 */
export type DockTarget =
  | { readonly kind: 'strip'; readonly pane: PaneId; readonly strip: HTMLElement | null; readonly zone: HTMLElement }
  | { readonly kind: 'body'; readonly pane: PaneId; readonly zone: DockZone; readonly box: Box }
  | { readonly kind: 'none' }

export function resolveDockTarget(hit: Hit, x: number, y: number, edges: readonly DockEdge[] | ((pane: PaneId) => readonly DockEdge[])): DockTarget {
  if (hit.kind === 'strip') return { kind: 'strip', pane: hit.pane, strip: hit.strip, zone: hit.zone }
  if (hit.kind === 'body') {
    const { zone, box } = dockZoneInCard(hit.card, x, y, typeof edges === 'function' ? edges(hit.pane) : edges)
    return { kind: 'body', pane: hit.pane, zone, box }
  }
  return { kind: 'none' }
}

/**
 * 끄는 동안의 표시(미리보기 · 탭 줄 틈 · 머리 표시)를 target 에 맞춘다. gap 이 있고 탭 줄 위일 때만 그 줄에 탭 하나(tabWidth)의 틈을 연다
 * (같은 줄 안에서 순서를 바꿀 때처럼 틈이 필요 없으면 null).
 */
export function paintDockTarget(visuals: DockVisuals, target: DockTarget, gap: { readonly index: number; readonly tabWidth: number } | null): void {
  if (target.kind === 'strip') {
    visuals.showPreview(null)
    visuals.markZone(target.zone)
    if (gap !== null && target.strip !== null) visuals.setGap(target.strip, gap.index, gap.tabWidth)
    else visuals.clearGap()
    return
  }
  visuals.clearGap()
  visuals.markZone(null)
  visuals.showPreview(target.kind === 'body' ? dockZoneBox(target.box, target.zone) : null)
}

/** 왼쪽 바 끌기 중 body 표시: dock-dragging 은 칸 안 내용에 마우스가 걸리지 않게, dock-drop-ok 는 받을 수 있는 자리 위에서만 「복사」 커서를 낸다(tab-drag.css) */
export function setDockDragging(on: boolean): void {
  document.body.classList.toggle('dock-dragging', on)
  if (!on) document.body.classList.remove('dock-drop-ok')
}
export function setDockDropOk(ok: boolean): void {
  document.body.classList.toggle('dock-drop-ok', ok)
}

export const tabsIn = (strip: HTMLElement | null): HTMLElement[] => strip === null ? [] : Array.from(strip.querySelectorAll<HTMLElement>(':scope > .pane-top-tab'))

/** 미끄러지는 중(transform)이어도 흔들리지 않게, 변환을 뺀 원래 자리(왼쪽·너비) */
export function layoutBox(element: HTMLElement): { left: number; width: number } {
  const box = element.getBoundingClientRect()
  return { left: box.left - translateXOf(getComputedStyle(element).transform), width: box.width }
}

/** 계산된 transform 의 가로 이동량(px) */
function translateXOf(transform: string): number {
  if (transform === '' || transform === 'none') return 0
  if (typeof DOMMatrix === 'function') return new DOMMatrix(transform).m41
  const matrix = /matrix(([^)]+))/u.exec(transform)
  if (matrix !== null) return Number(matrix[1]!.split(',')[4]) || 0
  const translate = /translateX((-?[d.]+)px)/u.exec(transform)
  return translate === null ? 0 : Number(translate[1])
}

/** 탭 줄 안의 탭들을 mutate 전후로 재서, 자리가 바뀐 것은 이전 자리에서 새 자리로 미끄러지게 한다(FLIP) */
export function flip(elements: readonly HTMLElement[], mutate: () => void, duration = SPRING_FIRM_MS): void {
  const before = new Map(elements.map((element) => [element, layoutBox(element).left]))
  mutate()
  if (reducedMotion() || typeof HTMLElement.prototype.animate !== 'function') return
  for (const element of elements) {
    const from = before.get(element)
    if (from === undefined) continue
    const delta = from - layoutBox(element).left
    if (Math.abs(delta) < 0.5) continue
    element.animate(
      [{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }],
      { duration, easing: EASE_SPRING_FIRM },
    )
  }
}

/** 탭 줄의 탭 사이 간격(px): CSS 의 column-gap 을 재서 쓴다. 못 재면(jsdom) 디자인 값 4px */
export function stripGapPx(strip: HTMLElement): number {
  const gap = Number.parseFloat(getComputedStyle(strip).columnGap)
  return Number.isFinite(gap) ? gap : 4
}

/** 탭 줄(strip)의 index 번째 앞에 탭 하나(tabWidth)와 탭 사이 간격만큼 빈자리를 연다(그 뒤 탭들이 오른쪽으로 미끄러진다). index 가 null 이면 닫는다 */
export function setStripGap(strip: HTMLElement, index: number | null, tabWidth: number, immediate = false): void {
  const gap = stripGapPx(strip)
  const width = tabWidth + gap
  // 줄 상자는 탭 폭만큼만 자라 있어서(overflow 가 잘린다) 벌어지는 만큼 오른쪽 안쪽 여백도 함께 늘려 준다
  if (index !== null) {
    if (strip.dataset.gapBase === undefined) strip.dataset.gapBase = String(parseFloat(getComputedStyle(strip).paddingRight) || 0)
    strip.style.transition = immediate || reducedMotion() ? 'none' : `padding-right ${SPRING_FIRM_MS}ms ${EASE_SPRING_FIRM}`
    strip.style.paddingRight = `${Number(strip.dataset.gapBase) + width}px`
  } else if (strip.dataset.gapBase !== undefined) {
    strip.style.transition = immediate || reducedMotion() ? 'none' : `padding-right ${SPRING_FIRM_MS}ms ${EASE_SPRING_FIRM}`
    strip.style.paddingRight = `${strip.dataset.gapBase}px`
    const done = () => {
      if (strip.dataset.gapBase !== undefined) return
      strip.style.transition = ''
      strip.style.paddingRight = ''
    }
    delete strip.dataset.gapBase
    if (immediate) done()
    else window.setTimeout(done, SPRING_FIRM_MS + 30)
  }
  tabsIn(strip).forEach((element, at) => {
    const shift = index === null || at < index ? 0 : width
    if (element.dataset.gapShift === String(shift) || (shift === 0 && element.dataset.gapShift === undefined)) return
    if (shift === 0) delete element.dataset.gapShift
    else element.dataset.gapShift = String(shift)
    element.style.transition = immediate || reducedMotion() ? 'none' : `transform ${SPRING_FIRM_MS}ms ${EASE_SPRING_FIRM}`
    element.style.transform = shift === 0 ? '' : `translateX(${shift}px)`
    if (shift === 0) window.setTimeout(() => { if (element.dataset.gapShift === undefined) element.style.transition = '' }, SPRING_FIRM_MS + 30)
  })
  updateGapHint(strip, index, tabWidth, gap, immediate)
}

/** 벌어진 자리에 「여기에 놓인다」는 점선 칸을 보인다(원래 탭이 비운 구멍과 같은 모양) */
function updateGapHint(strip: HTMLElement, index: number | null, tabWidth: number, gap: number, immediate: boolean): void {
  const menu = strip.parentElement
  if (menu === null) return
  const shown = menu.querySelector<HTMLElement>(':scope > .tab-gap-hint.tab-gap-hint-on')
  if (index === null) {
    if (shown === null) return
    if (immediate || reducedMotion()) { shown.remove(); return }
    shown.classList.remove('tab-gap-hint-on')
    window.setTimeout(() => shown.remove(), 200)
    return
  }
  const tabs = tabsIn(strip)
  const anchor = tabs[Math.min(index, tabs.length - 1)]
  if (anchor === undefined) return
  const menuBox = menu.getBoundingClientRect()
  const anchorBox = anchor.getBoundingClientRect()
  const layout = layoutBox(anchor)
  const left = (index < tabs.length ? layout.left : layout.left + layout.width + gap) - menuBox.left
  let hint = shown
  if (hint === null) {
    hint = document.createElement('div')
    hint.className = 'tab-gap-hint'
    hint.setAttribute('aria-hidden', 'true')
    hint.style.transition = 'none'
    menu.append(hint)
  }
  hint.style.left = `${left}px`
  hint.style.top = `${anchorBox.top - menuBox.top}px`
  hint.style.width = `${Math.max(0, tabWidth)}px`
  hint.style.height = `${anchorBox.height}px`
  if (!hint.classList.contains('tab-gap-hint-on')) {
    void hint.offsetWidth
    hint.style.transition = ''
    hint.classList.add('tab-gap-hint-on')
  }
}

/** 들린 탭 껍질이 탭 둘레에 두르는 여백(px): 좌우 20 씩, 위아래 4 씩(tab-drag.css 의 padding 0 20px 과 같다) */
export const GHOST_PAD_X = 40
export const GHOST_PAD_Y = 8

/**
 * 들린 탭의 껍질: 탭 하나(tab)를 탭 줄 모양(.pane-tabs-menu > .pane-tabs-strip)으로 감싼다. 탭 끌기(ghostFor)와 왼쪽 바 끌기(createPillGhost)가 같이 쓴다.
 * zoneClass: 상단바 안에서만 맞는 탭 모양 규칙(.topbar-panetab-zone …)이 그대로 걸리게 하는 머리 구역 class. 머리 바탕을 그려 주는
 * pane-grid-tabs(와 표시용 pane-drop-target)는 뺀다: 들린 것은 탭 하나뿐이어야 한다.
 */
export function buildGhostShell(zoneClass: string, tab: HTMLElement, tabWidth: number, tabHeight: number): HTMLElement {
  const root = document.createElement('div')
  root.className = `tab-drag-ghost ${zoneClass}`.replace(/\b(?:pane-drop-target|pane-grid-tabs)\b/gu, '').replace(/\s+/gu, ' ').trim()
  root.setAttribute('aria-hidden', 'true')
  const menu = document.createElement('div')
  menu.className = 'pane-tabs-menu pane-tabs-focused'
  const strip = document.createElement('div')
  strip.className = 'pane-tabs-strip'
  tab.style.width = `${tabWidth}px`
  tab.style.flex = '0 0 auto'
  strip.append(tab)
  menu.append(strip)
  root.append(menu)
  root.style.width = `${tabWidth + GHOST_PAD_X}px`
  root.style.height = `${tabHeight + GHOST_PAD_Y}px`
  return root
}

function ghostFor(tabElement: HTMLElement, rect: DOMRect): HTMLElement {
  const clone = tabElement.cloneNode(true) as HTMLElement
  for (const name of ['data-tab-id', 'data-dragging', 'data-collapsed', 'data-landing', 'data-entering', 'data-gap-shift', 'style']) clone.removeAttribute(name)
  clone.querySelectorAll('[tabindex]').forEach((node) => node.removeAttribute('tabindex'))
  return buildGhostShell(tabElement.closest<HTMLElement>('.topbar-panetab-zone, .pane-grid-tabs')?.className ?? '', clone, rect.width, rect.height)
}

const INSET = 1

/** 끄는 동안의 표시 한 벌: 구역 미리보기 · 탭 줄 틈(점선 칸) · 탭 줄 구역 표시. 탭 끌기와 왼쪽 바 끌기가 같이 쓴다 */
export interface DockVisuals {
  /** 구역 미리보기. null 이면 숨긴다. 한 번 만들어 두고 자리·크기만 옮겨 다닌다(전환으로 미끄러진다) */
  showPreview(box: Box | null): void
  /** 탭 줄(strip)의 index 자리에 탭 하나(tabWidth)와 탭 사이 간격만큼 틈을 연다. 다른 줄에 열려 있던 틈은 닫는다 */
  setGap(strip: HTMLElement | null, index: number, tabWidth: number): void
  clearGap(immediate?: boolean): void
  markZone(zone: HTMLElement | null): void
  /** 모두 치운다 */
  clear(immediate?: boolean): void
}

export function createDockVisuals(): DockVisuals {
  let preview: HTMLElement | null = null
  let gapStrip: HTMLElement | null = null
  let marked: HTMLElement | null = null
  const clearGap = (immediate = false) => {
    if (gapStrip === null) return
    setStripGap(gapStrip, null, 0, immediate)
    gapStrip = null
  }
  return {
    showPreview(box) {
      if (box === null) {
        preview?.classList.remove('tab-dock-preview-on')
        return
      }
      if (preview === null) {
        preview = document.createElement('div')
        preview.className = 'tab-dock-preview'
        preview.setAttribute('aria-hidden', 'true')
        document.body.append(preview)
      }
      const on = preview.classList.contains('tab-dock-preview-on')
      // 처음 나타날 때는 자리를 바로 잡고(떠돌지 않게), 그 뒤로는 전환으로 옮겨 간다
      if (!on) preview.style.transition = 'none'
      preview.style.left = `${box.left + INSET}px`
      preview.style.top = `${box.top + INSET}px`
      preview.style.width = `${Math.max(0, box.width - INSET * 2)}px`
      preview.style.height = `${Math.max(0, box.height - INSET * 2)}px`
      if (!on) {
        void preview.offsetWidth
        preview.style.transition = ''
        preview.classList.add('tab-dock-preview-on')
      }
    },
    setGap(strip, index, tabWidth) {
      if (gapStrip !== null && gapStrip !== strip) clearGap()
      if (strip === null) return
      gapStrip = strip
      setStripGap(strip, index, tabWidth)
    },
    clearGap,
    markZone(zone) {
      if (marked === zone) return
      marked?.classList.remove('pane-drop-target')
      marked = zone
      marked?.classList.add('pane-drop-target')
    },
    clear(immediate = false) {
      clearGap(immediate)
      if (marked !== null) { marked.classList.remove('pane-drop-target'); marked = null }
      if (preview !== null) {
        const element = preview
        preview = null
        element.classList.remove('tab-dock-preview-on')
        window.setTimeout(() => element.remove(), 240)
      }
    },
  }
}

export function startTabDrag(event: { readonly clientX: number; readonly clientY: number; readonly button: number }, tabElement: HTMLElement, getHost: () => TabDragHost): void {
  if (event.button !== 0) return
  const startX = event.clientX
  const startY = event.clientY
  const startRect = tabElement.getBoundingClientRect()
  const grabX = startX - startRect.left
  const grabY = startY - startRect.top
  const tabId = getHost().tab.id
  const sourcePane = getHost().sourcePane

  let dragging = false
  let finished = false
  let ghost: HTMLElement | null = null
  const visuals = createDockVisuals()
  let drop: Drop = { kind: 'none' }
  let lastX = startX
  let lastY = startY
  let holeCollapsed = false
  let edgeTimer: number | null = null
  let tearing = false
  // 껍질 안에서 탭이 놓인 자리(껍질 왼쪽 위에서). 탭의 왼쪽 위가 손에서 grab 만큼 떨어지게 껍질을 둔다
  let insetX = 20
  let insetY = 0
  let ghostX = startRect.left
  let ghostY = startRect.top

  const sourceTab = (): HTMLElement | null => document.querySelector<HTMLElement>(`.pane-top-tab[data-dragging][data-tab-id="${CSS.escape(tabId)}"]`)
  const anyTab = (): HTMLElement | null => document.querySelector<HTMLElement>(`.pane-top-tab[data-tab-id="${CSS.escape(tabId)}"]`)

  const placeGhost = () => {
    if (ghost === null) return
    // 보이는 탭이 창 가장자리 8px 안에 들도록 껍질(투명 여백 포함)을 민다
    const clamped = clampGhostPos(lastX - grabX - insetX, lastY - grabY - insetY, ghost.offsetWidth, ghost.offsetHeight, window.innerWidth, window.innerHeight, GHOST_EDGE_MARGIN - insetX, GHOST_EDGE_MARGIN - insetY)
    ghostX = clamped.x
    ghostY = clamped.y
    ghost.style.transform = `translate3d(${ghostX}px, ${ghostY}px, 0)`
  }

  const collapseHole = (collapsed: boolean) => {
    if (collapsed === holeCollapsed) return
    holeCollapsed = collapsed
    const hole = sourceTab()
    if (hole === null) return
    flip(tabsIn(hole.parentElement), () => { if (collapsed) hole.dataset.collapsed = ''; else delete hole.dataset.collapsed }, 170)
  }
  const { clearGap } = visuals

  const reorderAt = (strip: HTMLElement) => {
    const h = getHost()
    if (h.reorder === undefined) return
    const elements = tabsIn(strip)
    const from = elements.findIndex((element) => element.dataset.tabId === tabId)
    if (from < 0) return
    // 끄는 탭을 뺀 나머지 탭들 가운데 어디에 들어갈지: 들린 탭의 가운데가 이웃 탭 가운데를 넘으면 그 뒤로
    const others = elements.filter((_, index) => index !== from).map(layoutBox)
    const to = insertionIndexAt(others, lastX - grabX + startRect.width / 2)
    if (to !== from) h.reorder(tabId, to)
  }

  const update = () => {
    if (!dragging) return
    const h = getHost()
    placeGhost()
    const target = resolveDockTarget(paneHitAt(lastX, lastY), lastX, lastY, (pane) => h.dockEdges?.(pane, tabId) ?? [])
    if (target.kind === 'strip') {
      if (target.pane === sourcePane) {
        paintDockTarget(visuals, target, null)
        collapseHole(false)
        if (target.strip !== null) reorderAt(target.strip)
        drop = { kind: 'reorder' }
        return
      }
      if (h.moveAt === undefined) { paintDockTarget(visuals, target, null); drop = { kind: 'none' }; return }
      collapseHole(true)
      const index = insertionIndexAt(tabsIn(target.strip).map(layoutBox), lastX - grabX + startRect.width / 2)
      paintDockTarget(visuals, target, { index, tabWidth: startRect.width })
      drop = { kind: 'move', pane: target.pane, index }
      return
    }
    if (target.kind === 'body' && h.moveAt !== undefined) {
      if (target.pane === sourcePane && target.zone === 'center') {
        // 자기 패널의 한가운데: 아무 일도 하지 않는다(구멍은 그대로)
        collapseHole(false)
        paintDockTarget(visuals, { kind: 'none' }, null)
        drop = { kind: 'none' }
        return
      }
      collapseHole(target.pane !== sourcePane && target.zone === 'center')
      paintDockTarget(visuals, target, null)
      drop = target.zone === 'center' ? { kind: 'move', pane: target.pane, index: Number.MAX_SAFE_INTEGER } : { kind: 'dock', pane: target.pane, edge: target.zone }
      return
    }
    collapseHole(false)
    paintDockTarget(visuals, { kind: 'none' }, null)
    drop = { kind: 'none' }
  }

  // 끄는 동안은 올라가는 탭·단추의 설명 말풍선이 뜨지 않게 한다
  const swallowHover = (hoverEvent: Event) => hoverEvent.stopPropagation()
  const beginDrag = () => {
    dragging = true
    window.addEventListener('pointerover', swallowHover, true)
    document.body.classList.add('pane-tab-dragging')
    tabElement.dataset.dragging = ''
    ghost = ghostFor(tabElement, startRect)
    document.body.append(ghost)
    const cloneBox = ghost.querySelector<HTMLElement>('.pane-top-tab')?.getBoundingClientRect()
    const rootBox = ghost.getBoundingClientRect()
    if (cloneBox !== undefined) {
      insetX = cloneBox.left - rootBox.left
      insetY = cloneBox.top - rootBox.top
    }
    placeGhost()
    // 들어 올리기: 크기가 살짝 커지고 그림자가 생긴다(자리에서 바로 시작해 부드럽게 커진다)
    void ghost.offsetWidth
    ghost.classList.add('tab-drag-ghost-lifted')
    getHost().onDragged?.()
  }

  /** 들린 탭을 target(자리를 매 프레임 다시 읽는 함수)으로 내려앉힌 뒤 지운다 */
  const settle = (target: () => DOMRect | null, done: () => void) => {
    const element = ghost
    ghost = null
    if (element === null) { done(); return }
    if (reducedMotion()) { element.remove(); done(); return }
    const fromX = ghostX
    const fromY = ghostY
    const begin = performance.now()
    element.classList.remove('tab-drag-ghost-lifted')
    element.classList.add('tab-drag-ghost-settling')
    const tick = (now: number) => {
      const t = Math.min(1, (now - begin) / SETTLE_MS)
      const eased = springSoft(t)
      const to = target()
      if (to !== null) {
        const x = fromX + (to.left - insetX - fromX) * eased
        const y = fromY + (to.top - insetY - fromY) * eased
        element.style.transform = `translate3d(${x}px, ${y}px, 0)`
      }
      if (t < 1) { requestAnimationFrame(tick); return }
      element.remove()
      done()
    }
    requestAnimationFrame(tick)
  }

  const cleanupListeners = () => {
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('blur', onCancel)
    window.removeEventListener('pointerover', swallowHover, true)
    if (edgeTimer !== null) window.clearTimeout(edgeTimer)
  }
  const cleanupVisuals = (immediateGap = false) => {
    visuals.clear(immediateGap)
    document.body.classList.remove('pane-tab-dragging')
  }
  /** 구멍(원래 탭)을 되살린다 */
  const reveal = () => {
    document.querySelectorAll<HTMLElement>('.pane-top-tab[data-dragging], .pane-top-tab[data-landing]').forEach((element) => {
      delete element.dataset.dragging
      delete element.dataset.collapsed
      delete element.dataset.landing
    })
  }

  const cancel = () => {
    if (finished) return
    finished = true
    cleanupListeners()
    cleanupVisuals()
    if (!dragging) return
    // 접혀 있던 구멍을 다시 펴고, 들린 탭이 제자리로 돌아간다
    holeCollapsed = true
    collapseHole(false)
    settle(() => sourceTab()?.getBoundingClientRect() ?? null, reveal)
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
    const h = getHost()
    const chosen = drop
    cleanupVisuals(chosen.kind === 'move' || chosen.kind === 'dock')
    if (chosen.kind === 'none') {
      holeCollapsed = true
      collapseHole(false)
      settle(() => sourceTab()?.getBoundingClientRect() ?? null, reveal)
      return
    }
    if (chosen.kind === 'reorder') {
      settle(() => sourceTab()?.getBoundingClientRect() ?? null, reveal)
      return
    }
    // 새 자리로 옮기는 것은 상태를 바꿔야 하므로 지금 그리고(동기), 새로 생긴 탭은 들린 탭이 내려앉을 때까지 숨는다
    flipSuppressed = true
    try {
      flushSync(() => {
        if (chosen.kind === 'move') h.moveAt?.(tabId, chosen.pane, chosen.index)
        else h.dock?.(tabId, chosen.pane, chosen.edge)
      })
    } finally {
      flipSuppressed = false
    }
    document.querySelectorAll<HTMLElement>('.pane-top-tab[data-dragging]').forEach((element) => {
      delete element.dataset.dragging
      delete element.dataset.collapsed
    })
    const landing = anyTab()
    if (landing !== null) landing.dataset.landing = ''
    settle(() => anyTab()?.getBoundingClientRect() ?? null, reveal)
  }

  const tear = async (screenX: number, screenY: number) => {
    const h = getHost()
    if (tearing || finished || h.tearOff === undefined) return
    tearing = true
    if (edgeTimer !== null) { window.clearTimeout(edgeTimer); edgeTimer = null }
    let handled = false
    try {
      handled = await h.tearOff(tabId, { id: tabId, screenX, screenY, grabX, grabY, width: startRect.width, height: startRect.height })
    } catch {
      handled = false
    }
    if (finished) return
    if (handled) {
      // 새 창이 이어 받았다. 이 창의 끌기는 여기서 끝: 들린 탭을 지우고 구멍은 탭이 닫히면서 사라진다
      finished = true
      cleanupListeners()
      cleanupVisuals()
      ghost?.remove()
      ghost = null
      reveal()
      return
    }
    tearing = false
  }

  const onMove = (moveEvent: PointerEvent) => {
    lastX = moveEvent.clientX
    lastY = moveEvent.clientY
    if (!dragging) {
      if (Math.hypot(lastX - startX, lastY - startY) < TAB_DRAG_THRESHOLD_PX) return
      if (getHost().dragWindow === true) {
        // 창 전체를 끄는 탭: 들린 탭 없이 바로 창이 마우스를 따라간다
        dragging = true
        getHost().onDragged?.()
        void tear(moveEvent.screenX, moveEvent.screenY)
        return
      }
      beginDrag()
    }
    if (tearing) return
    const h = getHost()
    if (h.tearOff !== undefined) {
      const outside = lastX < -TEAR_OFF_MARGIN_PX || lastY < -TEAR_OFF_MARGIN_PX
        || lastX > window.innerWidth + TEAR_OFF_MARGIN_PX || lastY > window.innerHeight + TEAR_OFF_MARGIN_PX
      // 왼쪽 바가 보이면 창 왼쪽 가장자리는 왼쪽 바 위다: 거기 머문다고 새 창으로 떼어 내지 않는다(창 밖으로 나가야 떼어 낸다)
      const leftIsSidebar = document.querySelector('.sidebar:not([inert])') !== null
      const atEdge = (lastX <= 0 && !leftIsSidebar) || lastY <= 0 || lastX >= window.innerWidth - 1 || lastY >= window.innerHeight - 1
      if (atEdge && !outside) {
        if (edgeTimer === null) edgeTimer = window.setTimeout(() => { edgeTimer = null; void tear(moveEvent.screenX, moveEvent.screenY) }, TEAR_OFF_EDGE_DWELL_MS)
      } else if (edgeTimer !== null) {
        window.clearTimeout(edgeTimer)
        edgeTimer = null
      }
      if (outside) { void tear(moveEvent.screenX, moveEvent.screenY); return }
    }
    update()
  }

  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('blur', onCancel)
}

// ── 다른 창에서 끌려 온 탭을 받는 쪽 ────────────────────────────────────────────

let externalStrip: HTMLElement | null = null
let externalZone: HTMLElement | null = null
const EXTERNAL_GAP_WIDTH = 243

/** 패널 pane 의 탭 줄(구역). 격자의 아랫줄 칸은 칸 안 탭 줄을 쓴다 */
export function tabZoneOfPane(pane: string): HTMLElement | null {
  const zones = Array.from(document.querySelectorAll<HTMLElement>('.topbar-panetab-zone[data-pane-id], .pane-grid-tabs'))
  return zones.find((zone) => paneOfZone(zone) === pane) ?? null
}

/** 모든 탭 줄 구역의 자리(창 안쪽 왼쪽 위에서, 물리 픽셀). 다른 창이 끄는 탭을 어느 줄에 놓는지 가리려고 Rust 에 알린다 */
export function tabZoneRects(): { pane: string; left: number; top: number; width: number; height: number }[] {
  const ratio = window.devicePixelRatio || 1
  const out: { pane: string; left: number; top: number; width: number; height: number }[] = []
  for (const zone of Array.from(document.querySelectorAll<HTMLElement>('.topbar-panetab-zone[data-pane-id], .pane-grid-tabs'))) {
    const pane = paneOfZone(zone)
    const box = zone.getBoundingClientRect()
    if (pane === null || box.width <= 0 || box.height <= 0) continue
    // 숨은 구역(문서 검색·라이브러리 모드로 가려진 것)은 뺀다
    if (getComputedStyle(zone).opacity === '0') continue
    out.push({ pane, left: Math.round(box.left * ratio), top: Math.round(box.top * ratio), width: Math.round(box.width * ratio), height: Math.round(box.height * ratio) })
  }
  return out
}

/** x(창 안 CSS 좌표)가 pane 의 탭 줄에서 들어갈 자리 */
export function insertionIndexInPane(pane: string, x: number): number {
  const strip = tabZoneOfPane(pane)?.querySelector<HTMLElement>('.pane-tabs-strip') ?? null
  return insertionIndexAt(tabsIn(strip).map(layoutBox), x)
}

/** 다른 창의 탭이 이 창 pane 의 탭 줄 위에 있다: 그 자리에 탭이 들어갈 만큼 벌려 보인다 */
export function showExternalTabHover(pane: string, x: number): void {
  const zone = tabZoneOfPane(pane)
  if (zone === null) { clearExternalTabHover(); return }
  const strip = zone.querySelector<HTMLElement>('.pane-tabs-strip')
  if (externalZone !== zone) {
    externalZone?.classList.remove('pane-drop-target')
    externalZone = zone
    zone.classList.add('pane-drop-target')
  }
  if (externalStrip !== null && externalStrip !== strip) setStripGap(externalStrip, null, 0)
  externalStrip = strip
  if (strip !== null) setStripGap(strip, insertionIndexInPane(pane, x), EXTERNAL_GAP_WIDTH)
}

export function clearExternalTabHover(immediate = false): void {
  externalZone?.classList.remove('pane-drop-target')
  externalZone = null
  if (externalStrip !== null) setStripGap(externalStrip, null, 0, immediate)
  externalStrip = null
}
