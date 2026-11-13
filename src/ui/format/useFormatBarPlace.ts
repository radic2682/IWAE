import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import {
  clampFloat, decideDrop, getPlace, isDocked, keyDelta, passedDragThreshold, placeReducer, setPlace, subscribePlaces, initialPlaceState,
  FORMAT_FLOAT_MARGIN_PX, type FormatDockSide, type FormatHostKind, type FormatPlace, type RectLike,
} from './formatBarPlace'

/** 붙는 자리(서식 줄이 앉는 칸) 후보. 상단바 노트 도구줄 · 캔버스 도구줄 첫 줄 · 캔버스 메모 자리 · 글 상자 띠 · 박스 메모 띠 */
const DOCK_SELECTOR = '.note-format-dock, [data-format-fold-host], .canvas-memo-format-slot, .pdf-box-format-slot, .doc-format-strip'

/** 떠 있는 카드의 테두리 1px + 안쪽 여백 3px: 줄(막대)과 카드 왼쪽 위의 차이 */
const CARD_INSET_PX = 4

export function detectHostKind(element: Element | null): FormatHostKind {
  if (element === null) return 'notes'
  if (element.closest('[data-format-fold-host], .canvas-memo-format-slot') !== null) return 'canvas'
  if (element.closest('.doc-format-strip, .pdf-box-format-slot') !== null) return 'textbox'
  return 'notes'
}

export function findDock(from: Element | null): HTMLElement | null {
  if (from === null) return null
  return from.closest<HTMLElement>(DOCK_SELECTOR) ?? from.parentElement
}

const unionRect = (a: RectLike, b: RectLike | null): RectLike =>
  b === null ? a : { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) }

/** 놓으면 줄이 앉을 자리(윤곽): 왼쪽은 붙는 자리의 왼쪽 끝, 가운데는 붙는 자리 한가운데 */
export function snapOutline(side: FormatDockSide, dock: RectLike, barW: number, barH: number): { left: number; top: number; width: number; height: number } {
  const width = Math.min(barW, dock.right - dock.left)
  const left = side === 'center' ? dock.left + (dock.right - dock.left - width) / 2 : dock.left
  return { left, top: dock.top + (dock.bottom - dock.top - barH) / 2, width, height: barH }
}

export interface FormatDragView {
  readonly x: number
  readonly y: number
  readonly snap: { readonly side: FormatDockSide; readonly left: number; readonly top: number; readonly width: number; readonly height: number } | null
}

/**
 * 서식 줄의 자리(붙음 왼쪽 · 가운데 · 뜸)와 손잡이 동작(끌기 · 키보드).
 * 자리는 종류(노트 · 캔버스 · 글 상자)별 저장소를 같이 본다. 손잡이는 누를 때 초점을 가져오지 않는다(pointerdown preventDefault).
 */
export function useFormatBarPlace(kindProp: FormatHostKind | undefined, barRef: RefObject<HTMLElement | null>, anchorRef: RefObject<HTMLElement | null>, floatRef: RefObject<HTMLElement | null>, gripRef: RefObject<HTMLElement | null>) {
  const [detected, setDetected] = useState<FormatHostKind>(kindProp ?? 'notes')
  useLayoutEffect(() => {
    if (kindProp !== undefined) return
    const next = detectHostKind(anchorRef.current ?? barRef.current)
    if (next !== detected) setDetected(next)
  })
  const kind = kindProp ?? detected
  const place = useSyncExternalStore(subscribePlaces, () => getPlace(kind), () => getPlace(kind))
  const lastDock = useRef<FormatDockSide>('left')
  if (isDocked(place)) lastDock.current = place.mode
  const [drag, setDrag] = useState<FormatDragView | null>(null)
  const [tick, setTick] = useState(0)
  const refocus = useRef(false)
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])

  const floating = drag !== null || place.mode === 'float'
  const floatAt = drag !== null ? { x: drag.x, y: drag.y } : place.mode === 'float' ? { x: place.x, y: place.y } : null

  // 창 크기가 바뀌면 떠 있는 줄을 다시 가둔다(저장한 좌표는 그대로 두고 그리기만 가둔다)
  useEffect(() => {
    if (!floating) return undefined
    const onResize = () => setTick((value) => value + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [floating])
  // 그린 뒤 카드 크기를 재서 창 안에 가둔다(내용 · 크기 · 창 크기가 바뀔 때마다)
  useLayoutEffect(() => {
    const card = floatRef.current
    if (card === null || floatAt === null) return
    const rect = card.getBoundingClientRect()
    const clamped = clampFloat(floatAt.x, floatAt.y, rect.width, rect.height, window.innerWidth, window.innerHeight)
    card.style.left = `${clamped.x}px`
    card.style.top = `${clamped.y}px`
    card.style.maxWidth = `${Math.max(120, window.innerWidth - 2 * FORMAT_FLOAT_MARGIN_PX)}px`
  })
  // 키보드로 자리를 바꾸면 손잡이가 새 자리에 다시 그려진다: 초점을 되돌린다
  useLayoutEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    gripRef.current?.focus()
  }, [place, gripRef])

  const commit = useCallback((next: FormatPlace) => { setPlace(kind, next) }, [kind])
  const floatRect = () => {
    const rect = floatRef.current?.getBoundingClientRect() ?? null
    return rect === null ? null : { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
  }
  const dock = useCallback((side: FormatDockSide = lastDock.current) => { refocus.current = true; commit({ mode: side }) }, [commit])

  const onGripPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    cleanup.current?.()
    const start = { x: event.clientX, y: event.clientY }
    const barRect = (barRef.current ?? floatRef.current)?.getBoundingClientRect()
    if (barRect === undefined) return
    const dockEl = findDock(anchorRef.current ?? barRef.current)
    const dockRect0: RectLike | null = dockEl === null ? null : dockEl.getBoundingClientRect()
    const grab = { x: start.x - barRect.left + CARD_INSET_PX, y: start.y - barRect.top + CARD_INSET_PX }
    let started = false
    let last: FormatDragView | null = null
    const clear = () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
      window.removeEventListener('keydown', onKey, true)
      document.body.classList.remove('format-bar-dragging')
      dockEl?.removeAttribute('data-format-drop')
      cleanup.current = null
    }
    const dockRectNow = (): RectLike | null => {
      if (dockEl === null || !dockEl.isConnected) return dockRect0
      return unionRect(dockEl.getBoundingClientRect(), anchorRef.current === null ? null : anchorRef.current.getBoundingClientRect())
    }
    function onMove(move: PointerEvent) {
      if (!started) {
        if (!passedDragThreshold(move.clientX - start.x, move.clientY - start.y)) return
        started = true
        document.body.classList.add('format-bar-dragging')
      }
      const rect = dockRectNow()
      const decision = decideDrop(move.clientX, move.clientY, rect)
      const snap = decision.kind === 'dock' && rect !== null ? { side: decision.side, ...snapOutline(decision.side, rect, barRect!.width, barRect!.height) } : null
      if (snap === null) dockEl?.removeAttribute('data-format-drop')
      else dockEl?.setAttribute('data-format-drop', '')
      last = { x: move.clientX - grab.x, y: move.clientY - grab.y, snap }
      setDrag(last)
    }
    function onUp(up: PointerEvent) {
      const wasStarted = started
      clear()
      if (!wasStarted) return
      const decision = decideDrop(up.clientX, up.clientY, dockRectNow())
      const size = floatRect()
      setDrag(null)
      if (decision.kind === 'dock') { refocus.current = false; commit({ mode: decision.side }); return }
      const raw = last ?? { x: up.clientX - grab.x, y: up.clientY - grab.y }
      const clamped = clampFloat(raw.x, raw.y, size?.w ?? barRect!.width + 2 * CARD_INSET_PX, size?.h ?? barRect!.height + 2 * CARD_INSET_PX, window.innerWidth, window.innerHeight)
      commit({ mode: 'float', x: clamped.x, y: clamped.y })
    }
    function onCancel() { clear(); setDrag(null) }
    function onKey(key: KeyboardEvent) {
      if (key.key !== 'Escape') return
      key.preventDefault()
      key.stopPropagation()
      onCancel()
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onCancel, true)
    window.addEventListener('keydown', onKey, true)
    cleanup.current = clear
  }

  const onGripKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      refocus.current = true
      const rect = (barRef.current ?? floatRef.current)?.getBoundingClientRect()
      const state = placeReducer({ place, lastDock: lastDock.current }, { type: 'toggle', x: Math.round((rect?.left ?? 0) - CARD_INSET_PX), y: Math.round((rect?.bottom ?? 0) + FORMAT_FLOAT_MARGIN_PX) })
      commit(state.place)
      return
    }
    const delta = keyDelta(event.key)
    if (delta === null) return
    if (place.mode === 'float') {
      event.preventDefault()
      const size = floatRect()
      const base = { x: place.x, y: place.y }
      const next = placeReducer(initialPlaceState({ mode: 'float', x: base.x, y: base.y }), { type: 'nudge', ...delta }).place
      if (next.mode !== 'float') return
      const clamped = clampFloat(next.x, next.y, size?.w ?? 0, size?.h ?? 0, window.innerWidth, window.innerHeight)
      commit({ mode: 'float', x: clamped.x, y: clamped.y })
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      refocus.current = true
      commit({ mode: event.key === 'ArrowRight' ? 'center' : 'left' })
    }
  }

  return { kind, place, floating, floatAt, drag, tick, dock, onGripPointerDown, onGripKeyDown }
}
