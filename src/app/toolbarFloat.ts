import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import {
  clampFloat, decideDrop, FORMAT_FLOAT_MARGIN_PX, getPlace, initialPlaceState, keyDelta, placeReducer, setPlace, subscribePlaces, toolbarPlaceOf,
  type RectLike,
} from '../ui/format/formatBarPlace'
import { snapOutline } from '../ui/format/useFormatBarPlace'
import { trackGripDrag } from '../ui/format/gripDrag'

/**
 * 상단바 도구줄 묶음(손잡이 + 주인 칩 + 이 칸의 도구)을 떼어 내는 일. 자리는 하나다 — 칸 종류(PDF · Markdown · 노트)와 무관하게 한 번 뜨면 어느 칸을 만져도 그 자리에 남고,
 * 붙어 있으면 계속 붙어 있다. 카드는 도구줄 자리(.topbar-toolbar-host) 요소 자신이다: 칸들이 포털로 도구를 넣는 요소를 새로 만들지 않고 position: fixed 로만 바꾼다.
 * 계산(가두기 · 놓을 자리 · 방향키 · 상태 전이)과 저장은 서식 줄과 같은 것(formatBarPlace.ts), 끌기 뼈대도 같은 것(gripDrag.ts)이다.
 */

/** 떠 있는 카드 테두리 1px + 안쪽 여백 3px: 카드 왼쪽 위와 손잡이의 차이 */
export const TOOLBAR_CARD_INSET_PX = 4
/** 붙는 자리(비어 있는 상단바 자리)가 아주 좁을 때도 놓기 쉽게 하는 최소 폭(px) */
export const TOOLBAR_DOCK_MIN_W = 120

/** 놓을 수 있는 붙는 자리: 상단바에 남아 있는 자리 틀. 너무 좁으면 왼쪽으로 넓힌다(오른쪽에는 앱 단추가 있다) */
export function dockZoneOf(rect: RectLike, minWidth = TOOLBAR_DOCK_MIN_W): RectLike {
  return rect.right - rect.left >= minWidth ? rect : { left: rect.right - minWidth, top: rect.top, right: rect.right, bottom: rect.bottom }
}

export interface ToolbarDragView {
  readonly x: number
  readonly y: number
  readonly snap: { readonly left: number; readonly top: number; readonly width: number; readonly height: number } | null
}

export interface ToolbarFloat {
  /** 떠 있는가(끄는 중 포함) */
  readonly floating: boolean
  readonly snap: ToolbarDragView['snap']
  readonly dragging: boolean
  readonly dock: () => void
  readonly onGripPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  readonly onGripKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
}

/**
 * @param hostRef 도구줄 자리 요소(떠 있으면 카드가 된다)
 * @param gripRef 묶음 맨 왼쪽 손잡이
 * @param dockRef 떠 있는 동안 상단바에 남는 자리 틀(없으면 붙어 있다는 뜻)
 */
export function useToolbarFloat(hostRef: RefObject<HTMLElement | null>, gripRef: RefObject<HTMLElement | null>, dockRef: RefObject<HTMLElement | null>): ToolbarFloat {
  const stored = useSyncExternalStore(subscribePlaces, () => getPlace('toolbar'), () => getPlace('toolbar'))
  const place = toolbarPlaceOf(stored)
  const [drag, setDrag] = useState<ToolbarDragView | null>(null)
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])

  const floating = drag !== null || place.mode === 'float'
  const at = useRef<{ x: number; y: number } | null>(null)
  at.current = drag !== null ? { x: drag.x, y: drag.y } : place.mode === 'float' ? { x: place.x, y: place.y } : null

  // 카드 크기를 재서 창 안에 가둔다: 그릴 때마다, 도구가 바뀌어 카드 크기가 변할 때, 창 크기가 바뀔 때(저장한 좌표는 그대로 두고 그리기만 가둔다)
  const apply = useCallback(() => {
    const card = hostRef.current
    if (card === null) return
    const position = at.current
    if (position === null) {
      card.style.removeProperty('left')
      card.style.removeProperty('top')
      return
    }
    const rect = card.getBoundingClientRect()
    const clamped = clampFloat(position.x, position.y, rect.width, rect.height, window.innerWidth, window.innerHeight)
    card.style.left = `${clamped.x}px`
    card.style.top = `${clamped.y}px`
  }, [hostRef])
  useLayoutEffect(apply)
  useEffect(() => {
    if (!floating) return undefined
    const card = hostRef.current
    const observer = typeof ResizeObserver === 'undefined' || card === null ? null : new ResizeObserver(apply)
    if (card !== null) observer?.observe(card)
    window.addEventListener('resize', apply)
    return () => { observer?.disconnect(); window.removeEventListener('resize', apply) }
  }, [floating, hostRef, apply])

  const dock = useCallback(() => { setPlace('toolbar', { mode: 'left' }) }, [])

  const onGripPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    cleanup.current?.()
    const host = hostRef.current
    const grip = gripRef.current
    if (host === null || grip === null) return
    const start = { x: event.clientX, y: event.clientY }
    const hostRect = host.getBoundingClientRect()
    const gripRect = grip.getBoundingClientRect()
    // 손잡이가 포인터 밑에 그대로 있도록 카드의 왼쪽 위를 잡는다(붙은 줄에서 떼어도 · 이미 뜬 카드를 끌어도 튀지 않는다)
    const grab = { x: start.x - gripRect.left + TOOLBAR_CARD_INSET_PX, y: start.y - gripRect.top + TOOLBAR_CARD_INSET_PX }
    const slot0: RectLike | null = dockRef.current === null ? hostRect : dockRef.current.getBoundingClientRect()
    const zoneNow = (): RectLike => {
      const element = dockRef.current
      return dockZoneOf(element !== null && element.isConnected ? element.getBoundingClientRect() : slot0 ?? hostRect)
    }
    let last: ToolbarDragView | null = null
    const finish = () => {
      dockRef.current?.removeAttribute('data-format-drop')
      cleanup.current = null
    }
    const stop = trackGripDrag(start, {
      onMove: (move) => {
        const zone = zoneNow()
        const decision = decideDrop(move.clientX, move.clientY, zone)
        const card = host.getBoundingClientRect()
        const snap = decision.kind === 'dock' ? snapOutline('left', zone, card.width, card.height) : null
        if (snap === null) dockRef.current?.removeAttribute('data-format-drop')
        else dockRef.current?.setAttribute('data-format-drop', '')
        last = { x: move.clientX - grab.x, y: move.clientY - grab.y, snap }
        setDrag(last)
      },
      onDrop: (up) => {
        finish()
        const decision = decideDrop(up.clientX, up.clientY, zoneNow())
        const card = host.getBoundingClientRect()
        setDrag(null)
        if (decision.kind === 'dock') { dock(); return }
        const raw = last ?? { x: up.clientX - grab.x, y: up.clientY - grab.y }
        const clamped = clampFloat(raw.x, raw.y, card.width, card.height, window.innerWidth, window.innerHeight)
        setPlace('toolbar', { mode: 'float', x: clamped.x, y: clamped.y })
      },
      onCancel: () => { finish(); setDrag(null) },
    })
    cleanup.current = () => { stop(); finish() }
  }

  const onGripKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const grip = gripRef.current?.getBoundingClientRect()
      const host = hostRef.current?.getBoundingClientRect()
      const state = placeReducer(initialPlaceState(place), {
        type: 'toggle',
        x: Math.round((grip?.left ?? 0) - TOOLBAR_CARD_INSET_PX),
        y: Math.round((host?.bottom ?? 0) + FORMAT_FLOAT_MARGIN_PX),
      })
      setPlace('toolbar', toolbarPlaceOf(state.place))
      return
    }
    if (place.mode !== 'float') return
    const delta = keyDelta(event.key)
    if (delta === null) return
    event.preventDefault()
    const card = hostRef.current?.getBoundingClientRect()
    const next = placeReducer(initialPlaceState(place), { type: 'nudge', ...delta }).place
    if (next.mode !== 'float') return
    const clamped = clampFloat(next.x, next.y, card?.width ?? 0, card?.height ?? 0, window.innerWidth, window.innerHeight)
    setPlace('toolbar', { mode: 'float', x: clamped.x, y: clamped.y })
  }

  return { floating, snap: drag?.snap ?? null, dragging: drag !== null, dock, onGripPointerDown, onGripKeyDown }
}
