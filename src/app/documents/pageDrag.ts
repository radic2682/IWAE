import { pageImageUrl } from '../../bridge/pdf'
import { t } from '../../i18n'
import type { PageEditItem, PageRotation } from '../../core/pdfPageEdit'
import type { PaneId } from '../workspace/tabs'
import { paneHitAt } from '../workspace/tabDrag'
import { EASE_SPRING_FIRM, EASE_SPRING_SNAP, SPRING_FIRM_MS, SPRING_SNAP_MS, canAnimate } from '../motion'

/**
 * 쪽 편집 화면에서 쪽을 끌어 다른 PDF 로 옮기는(복사하는) 끌기. 포인터 이벤트로 직접 한다 —
 * Tauri 창은 HTML 끌어놓기를 파일 끌어놓기로 가로채 쓸 수 없다.
 *
 * - 잡으면 손에 쪽 그림(여럿이면 겹쳐 쌓고 개수 배지)이 약간 기운 채 따라온다.
 * - 같은 쪽 편집 화면 안에서는 순서 바꾸기, 다른 PDF 의 쪽 편집 화면 위에서는 그 자리에 끼워 넣기,
 *   다른 PDF 의 탭 위에서는 탭이 강조되고 600ms 머물면 그 PDF 의 쪽 편집 화면이 열린다(스프링 로딩).
 * - 탭에 놓으면 맨 뒤에 끼운다. 대상 PDF 는 놓는 순간 쓰지 않는다 — 끼운 쪽은 그 쪽 편집 화면의 저장 전 상태로만
 *   들어가고, 사용자가 저장해야 파일이 바뀐다. 원본은 그대로(복사).
 * - Esc 는 끌기를 깨끗이 취소한다.
 */

/** 다른 PDF 로 끌어 가는 쪽 하나. 원본 파일 경로와 그 파일의 쪽 */
export interface DraggedPage {
  readonly source: string
  readonly page: number
  readonly rotate: PageRotation
  readonly sourceTitle: string
  /** 그림을 그릴 열린 문서 */
  readonly thumbDocId: string
}

/** 쪽 편집 화면의 쪽 → 다른 PDF 로 끌어 갈 수 있는 모양. 편집 중인 문서 자체의 쪽이면 sourcePath 로 가리킨다 */
export function draggedPageOf(item: PageEditItem & { readonly thumbDocId: string }, own: { readonly path: string; readonly title: string; readonly docId: string }): DraggedPage {
  if (item.source === undefined) return { source: own.path, page: item.page, rotate: item.rotate, sourceTitle: own.title, thumbDocId: own.docId }
  return { source: item.source, page: item.page, rotate: item.rotate, sourceTitle: item.sourceTitle ?? item.source, thumbDocId: item.thumbDocId }
}

export interface PageDragDoc {
  readonly docId: string
  readonly title: string
  /** Vault 목록에 있어 쪽 편집(저장)이 되는 PDF 인가 */
  readonly editable: boolean
  /** 암호가 걸려 열었던 PDF(쪽을 넣을 수 없다) */
  readonly locked: boolean
}

/** App 이 대 주는 것들 */
export interface PageDragHost {
  docInfo(docId: string): PageDragDoc | null
  /** 그 PDF 의 탭을 보이게 한다 */
  activateTab(pane: PaneId, tabId: string): void
  /** 그 PDF 의 쪽 편집 화면을 연다 */
  openEditor(docId: string): void
  announce(message: string): void
}

let host: PageDragHost | null = null
export function setPageDragHost(next: PageDragHost | null): void {
  host = next
}

// ---------------------------------------------------------------- 놓을 자리 표시(구독)

export interface PageDragHover {
  readonly docId: string
  readonly index: number
}
let hover: PageDragHover | null = null
const hoverListeners = new Set<() => void>()
export const subscribePageDragHover = (listener: () => void): (() => void) => {
  hoverListeners.add(listener)
  return () => { hoverListeners.delete(listener) }
}
export const getPageDragHover = (): PageDragHover | null => hover
function setHover(next: PageDragHover | null): void {
  if (hover?.docId === next?.docId && hover?.index === next?.index) return
  hover = next
  for (const listener of [...hoverListeners]) listener()
}

// ---------------------------------------------------------------- 끼워 넣을 쪽의 우편함(저장 전 상태)

export interface PendingInsert {
  /** null 이면 맨 뒤 */
  readonly index: number | null
  readonly pages: readonly DraggedPage[]
}
const inbox = new Map<string, PendingInsert[]>()
const inboxListeners = new Map<string, Set<() => void>>()

export function deliverPages(docId: string, insert: PendingInsert): void {
  inbox.set(docId, [...(inbox.get(docId) ?? []), insert])
  for (const listener of [...(inboxListeners.get(docId) ?? [])]) listener()
}
/** 쪽 편집 화면이 가져간다(가져가면 비운다) */
export function drainPages(docId: string): PendingInsert[] {
  const batches = inbox.get(docId) ?? []
  inbox.delete(docId)
  return batches
}
export function subscribePages(docId: string, listener: () => void): () => void {
  const set = inboxListeners.get(docId) ?? new Set()
  set.add(listener)
  inboxListeners.set(docId, set)
  return () => { set.delete(listener) }
}

// ---------------------------------------------------------------- 저장 전 편집 초안(화면을 잠깐 떠나도 남긴다)

const drafts = new Map<string, unknown>()
export const takePageEditDraft = <T>(docId: string): T | undefined => {
  const draft = drafts.get(docId) as T | undefined
  drafts.delete(docId)
  return draft
}
export const keepPageEditDraft = (docId: string, draft: unknown): void => { drafts.set(docId, draft) }
export const forgetPageEditDraft = (docId: string): void => {
  drafts.delete(docId)
  inbox.delete(docId)
}

// ---------------------------------------------------------------- 끌기

export const PAGE_DRAG_THRESHOLD_PX = 6
/** 손이 쥔 자리(그림 왼쪽 위에서). 탭 줄 위에서도 그림이 창 밖으로 잘리지 않게 위쪽을 짧게 */
const GRAB_X = 26
const GRAB_Y = 16
/** 탭 위에 이만큼 머물면 그 PDF 의 쪽 편집 화면이 열린다 */
export const SPRING_LOAD_MS = 600

export interface PageDragOptions {
  /** 끄는 쪽이 들어 있는 문서 */
  readonly docId: string
  /** 끌려 가는 쪽들(다른 PDF 로 갈 수 있는 모양). null 이면 같은 화면 안 순서 바꾸기만 된다 */
  readonly pages: readonly DraggedPage[] | null
  /** 같은 화면 안에서 to 자리에 놓았다 */
  readonly onReorder: (to: number) => void
  /** 끌기가 시작됐다 / 끝났다(클릭으로 안 치려고) */
  readonly onStart?: () => void
}

type Target =
  | { readonly kind: 'grid'; readonly docId: string; readonly index: number }
  | { readonly kind: 'tab'; readonly docId: string; readonly tabId: string; readonly pane: PaneId; readonly element: HTMLElement }
  | { readonly kind: 'none' }

const NONE: Target = { kind: 'none' }
let active = false
export const isPageDragging = (): boolean => active

/** 가장 가까운 카드 기준으로 놓일 자리(0 = 맨 앞 … n = 맨 뒤). 격자 밖이면 null */
function gridIndexAt(grid: HTMLElement, x: number, y: number): number | null {
  const box = grid.getBoundingClientRect()
  if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null
  const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-page-index]'))
  if (cards.length === 0) return 0
  let best: { at: number; rect: DOMRect; distance: number } | null = null
  for (const card of cards) {
    const rect = card.getBoundingClientRect()
    const dx = Math.max(rect.left - x, 0, x - rect.right)
    const dy = Math.max(rect.top - y, 0, y - rect.bottom)
    const distance = Math.hypot(dx, dy)
    if (best === null || distance < best.distance) best = { at: Number(card.dataset.pageIndex), rect, distance }
  }
  if (best === null) return null
  return x > best.rect.left + best.rect.width / 2 ? best.at + 1 : best.at
}

function targetAt(x: number, y: number, ownDocId: string, crossAllowed: boolean): Target {
  const element = document.elementFromPoint(x, y)
  if (element === null) return NONE
  const grid = element.closest<HTMLElement>('.page-edit-grid[data-doc-id]')
  if (grid !== null) {
    const docId = grid.dataset.docId ?? ''
    if (docId !== ownDocId && !crossAllowed) return NONE
    const index = gridIndexAt(grid, x, y)
    return index === null ? NONE : { kind: 'grid', docId, index }
  }
  const tab = element.closest<HTMLElement>('.pane-top-tab[data-tab-id]')
  if (tab !== null) {
    const hit = paneHitAt(x, y)
    const tabId = tab.dataset.tabId ?? ''
    const pane = hit.kind === 'strip' ? hit.pane : null
    if (pane === null) return NONE
    return { kind: 'tab', docId: tabId.replace(/#\d+$/u, ''), tabId, pane, element: tab }
  }
  return NONE
}

/** 탭이 쪽을 받을 수 있나. 받을 수 없으면 이유(없으면 null 은 받는다는 뜻) */
type TabVerdict = { readonly ok: true } | { readonly ok: false; readonly silent: boolean; readonly reason: string }
function tabVerdict(target: Extract<Target, { kind: 'tab' }>, ownDocId: string): TabVerdict {
  if (!target.element.classList.contains('pane-top-tab-pdf')) return { ok: false, silent: true, reason: '' }
  if (target.docId === ownDocId) return { ok: false, silent: true, reason: '' }
  const info = host?.docInfo(target.docId) ?? null
  if (info === null || !info.editable) return { ok: false, silent: false, reason: t('Vault에 없는 PDF에는 쪽을 끌어 넣을 수 없습니다') }
  if (info.locked) return { ok: false, silent: false, reason: t('암호가 걸린 PDF에는 쪽을 끌어 넣을 수 없습니다') }
  return { ok: true }
}

function buildSilhouette(pages: readonly DraggedPage[], count: number): HTMLElement {
  const ratio = window.devicePixelRatio || 1
  const root = document.createElement('div')
  root.className = 'page-drag-silhouette'
  root.setAttribute('aria-hidden', 'true')
  const stack = document.createElement('div')
  stack.className = 'page-drag-stack'
  const shown = pages.slice(0, 3)
  // 뒤에 깔린 쪽부터 그린다(맨 위가 잡은 쪽)
  for (let index = shown.length - 1; index >= 0; index -= 1) {
    const page = shown[index]!
    const sheet = document.createElement('div')
    sheet.className = 'page-drag-sheet'
    sheet.style.setProperty('--sheet-dx', `${index * 5}px`)
    sheet.style.setProperty('--sheet-dy', `${index * 5}px`)
    sheet.style.setProperty('--sheet-rot', `${index * 2.2}deg`)
    const image = document.createElement('img')
    image.alt = ''
    image.draggable = false
    image.src = pageImageUrl(page.thumbDocId, page.page, Math.round(120 * ratio))
    if (page.rotate !== 0) image.style.transform = `rotate(${page.rotate}deg)`
    sheet.append(image)
    stack.append(sheet)
  }
  root.append(stack)
  if (count > 1) {
    const badge = document.createElement('span')
    badge.className = 'page-drag-badge'
    badge.textContent = String(count)
    root.append(badge)
  }
  return root
}

/**
 * 쪽 카드를 눌렀을 때 부른다. 일정 거리 움직이면 끌기가 되고, 그 전에 놓으면 아무 일도 없다(클릭).
 * 반환값은 없다 — 끝나는 일은 onReorder 와 우편함(deliverPages)으로 전한다.
 */
export function startPageDrag(down: { readonly clientX: number; readonly clientY: number }, source: HTMLElement, options: PageDragOptions): void {
  if (active) return
  const startX = down.clientX
  const startY = down.clientY
  const crossAllowed = options.pages !== null && options.pages.length > 0
  const sourceRect = source.getBoundingClientRect()
  const grabX = startX - sourceRect.left
  const grabY = startY - sourceRect.top
  let dragging = false
  let silhouette: HTMLElement | null = null
  let x = startX
  let y = startY
  let dwellKey: string | null = null
  let dwellTimer: number | null = null
  let sprungKey: string | null = null
  let hoveredTab: HTMLElement | null = null

  const place = () => {
    if (silhouette === null) return
    // 위치는 translate 속성으로 준다: 개별 속성은 translate → rotate → scale 순이라, 기울임이 위치를 돌리지 않는다
    silhouette.style.translate = `${x - GRAB_X}px ${y - GRAB_Y}px`
  }

  const setTabState = (tab: HTMLElement | null, state: 'ok' | 'no' | null) => {
    if (hoveredTab !== null && hoveredTab !== tab) delete hoveredTab.dataset.pageDrop
    hoveredTab = tab
    if (tab === null) return
    if (state === null) delete tab.dataset.pageDrop
    else tab.dataset.pageDrop = state
  }
  const clearDwell = () => {
    if (dwellTimer !== null) window.clearTimeout(dwellTimer)
    dwellTimer = null
    dwellKey = null
  }
  const setCursorState = (no: boolean) => {
    document.body.dataset.pageDrop = no ? 'no' : 'ok'
  }

  const begin = () => {
    dragging = true
    active = true
    options.onStart?.()
    const pages = options.pages ?? []
    const count = Math.max(pages.length, 1)
    silhouette = pages.length > 0 ? buildSilhouette(pages, count) : null
    document.body.classList.add('page-dragging')
    setCursorState(false)
    if (silhouette !== null) {
      document.body.append(silhouette)
      place()
      if (canAnimate()) {
        // 집어 올림: 작게 시작해 스프링으로 커지며 기운다
        silhouette.animate(
          [{ scale: 0.82, rotate: '0deg' }, { scale: 1, rotate: '-4deg' }],
          { duration: SPRING_SNAP_MS, easing: EASE_SPRING_SNAP, fill: 'forwards' },
        )
      } else {
        silhouette.style.rotate = '-4deg'
      }
    }
  }

  const refresh = () => {
    const target = targetAt(x, y, options.docId, crossAllowed)
    if (target.kind === 'grid') {
      clearDwell()
      setTabState(null, null)
      setCursorState(false)
      setHover({ docId: target.docId, index: target.index })
      return
    }
    setHover(null)
    if (target.kind === 'tab') {
      const verdict = tabVerdict(target, options.docId)
      if (!verdict.ok) {
        clearDwell()
        setTabState(target.element, null)
        setCursorState(true)
        return
      }
      setTabState(target.element, 'ok')
      setCursorState(false)
      const key = target.tabId
      if (dwellKey !== key) {
        clearDwell()
        dwellKey = key
        if (sprungKey !== key) {
          dwellTimer = window.setTimeout(() => {
            dwellTimer = null
            if (!active || host === null) return
            sprungKey = key
            host.activateTab(target.pane, target.tabId)
            host.openEditor(target.docId)
            if (canAnimate()) {
              target.element.animate(
                [{ scale: 1.08 }, { scale: 1 }],
                { duration: SPRING_SNAP_MS, easing: EASE_SPRING_SNAP },
              )
            }
          }, SPRING_LOAD_MS)
        }
      }
      return
    }
    clearDwell()
    setTabState(null, null)
    // 쪽 편집 화면 바깥(다른 창·탭 줄 밖): 놓아도 아무 일이 없다
    setCursorState(false)
  }

  const finish = (apply: boolean, upX: number, upY: number) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancelPointer)
    window.removeEventListener('keydown', key, true)
    window.removeEventListener('blur', cancelPointer)
    if (!dragging) return
    clearDwell()
    const target = apply ? targetAt(upX, upY, options.docId, crossAllowed) : NONE
    setHover(null)
    setTabState(null, null)
    document.body.classList.remove('page-dragging')
    delete document.body.dataset.pageDrop
    // 끌기가 끝난 뒤 따라오는 click 이 쪽을 다시 고르지 않게 한 번 삼킨다
    const swallow = (event: Event) => { event.stopPropagation(); event.preventDefault() }
    window.addEventListener('click', swallow, { capture: true, once: true })
    window.setTimeout(() => window.removeEventListener('click', swallow, true), 0)

    let landed = false
    if (target.kind === 'grid') {
      if (target.docId === options.docId) {
        options.onReorder(target.index)
        landed = true
      } else if (options.pages !== null) {
        const info = host?.docInfo(target.docId) ?? null
        if (info === null || !info.editable) host?.announce(t('Vault에 없는 PDF에는 쪽을 끌어 넣을 수 없습니다'))
        else if (info.locked) host?.announce(t('암호가 걸린 PDF에는 쪽을 끌어 넣을 수 없습니다'))
        else {
          deliverPages(target.docId, { index: target.index, pages: options.pages })
          landed = true
        }
      }
    } else if (target.kind === 'tab') {
      const verdict = tabVerdict(target, options.docId)
      if (verdict.ok && options.pages !== null) {
        deliverPages(target.docId, { index: null, pages: options.pages })
        landed = true
        if (host !== null) {
          host.activateTab(target.pane, target.tabId)
          host.openEditor(target.docId)
        }
      } else if (!verdict.ok && !verdict.silent) {
        host?.announce(verdict.reason)
      }
    }

    const ghost = silhouette
    silhouette = null
    active = false
    if (ghost === null) return
    if (!canAnimate()) { ghost.remove(); return }
    if (landed) {
      // 놓인 자리에 빨려 들어가듯 작아지며 사라진다
      const animation = ghost.animate(
        [{ opacity: 1, scale: 1 }, { opacity: 0, scale: 0.6 }],
        { duration: SPRING_SNAP_MS, easing: EASE_SPRING_FIRM, fill: 'forwards' },
      )
      animation.onfinish = () => ghost.remove()
      return
    }
    // 취소·허공에 놓음: 잡았던 자리로 스프링으로 돌아가 사라진다
    const fromX = upX - GRAB_X
    const fromY = upY - GRAB_Y
    const toX = sourceRect.left + grabX - GRAB_X
    const toY = sourceRect.top + grabY - GRAB_Y
    ghost.style.translate = `${toX}px ${toY}px`
    const animation = ghost.animate(
      [{ translate: `${fromX}px ${fromY}px`, opacity: 1 }, { translate: `${toX}px ${toY}px`, opacity: 0 }],
      { duration: SPRING_FIRM_MS, easing: EASE_SPRING_FIRM, fill: 'forwards' },
    )
    animation.onfinish = () => ghost.remove()
  }

  const move = (event: PointerEvent) => {
    x = event.clientX
    y = event.clientY
    if (!dragging) {
      if (Math.hypot(x - startX, y - startY) < PAGE_DRAG_THRESHOLD_PX) return
      begin()
    }
    place()
    refresh()
  }
  const up = (event: PointerEvent) => finish(true, event.clientX, event.clientY)
  const cancelPointer = () => finish(false, x, y)
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !dragging) return
    event.preventDefault()
    event.stopImmediatePropagation()
    finish(false, x, y)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancelPointer)
  window.addEventListener('blur', cancelPointer)
  window.addEventListener('keydown', key, true)
}
