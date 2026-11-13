/**
 * 서식 줄이 놓이는 자리: 붙어 있을 때(왼쪽 · 가운데)와 떠 있을 때(창 안의 좌표).
 * 순수한 계산(상태 전이 · 가두기 · 놓을 자리 정하기 · 방향키)과 자리별(노트 · 캔버스 · 글 상자) 저장만 여기에 둔다 — 그리는 일은 FormatBar.tsx.
 */

/** 서식 줄을 쓰는 주인의 종류: 자리는 종류마다 따로 기억한다 */
export type FormatHostKind = 'notes' | 'canvas' | 'textbox'
export const FORMAT_HOST_KINDS: readonly FormatHostKind[] = ['notes', 'canvas', 'textbox']

export type FormatDockSide = 'left' | 'center'
export type FormatPlace =
  | { readonly mode: 'left' }
  | { readonly mode: 'center' }
  | { readonly mode: 'float'; readonly x: number; readonly y: number }

export const DEFAULT_PLACE: FormatPlace = { mode: 'left' }
export const FORMAT_PLACE_KEY = 'iwae:format-bar-place:v1'
/** 끌기 시작 문턱(px): 탭 끌기와 같다 */
export const FORMAT_DRAG_THRESHOLD_PX = 6
/** 방향키로 떠 있는 줄을 옮기는 걸음(px) */
export const FORMAT_KEY_STEP_PX = 8
/** 창 가장자리에서 띄우는 여유(px) */
export const FORMAT_FLOAT_MARGIN_PX = 8

/** 끌기가 문턱을 넘었는가 */
export function passedDragThreshold(dx: number, dy: number, threshold = FORMAT_DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(dx, dy) >= threshold
}

const clampAxis = (value: number, size: number, view: number, margin: number): number => {
  const max = view - size - margin
  // 창이 줄이 들어갈 만큼 크지 않으면 왼쪽 · 위쪽 끝을 우선한다
  return Math.round(Math.max(margin, Math.min(value, Math.max(margin, max))))
}

/** 떠 있는 줄(w×h)의 왼쪽 위 좌표를 창(vw×vh) 안에 가둔다 */
export function clampFloat(x: number, y: number, w: number, h: number, vw: number, vh: number, margin = FORMAT_FLOAT_MARGIN_PX): { x: number; y: number } {
  return { x: clampAxis(x, w, vw, margin), y: clampAxis(y, h, vh, margin) }
}

/**
 * 붙는 자리 안에서 가리킨 곳이 어느 쪽에 붙는가: 가운데 3분의 1 은 가운데, 나머지는 왼쪽(원래 자리).
 * 폭이 0 이하면 왼쪽.
 */
export function snapZone(pointerX: number, dockLeft: number, dockWidth: number): FormatDockSide {
  if (!(dockWidth > 0)) return 'left'
  const ratio = (pointerX - dockLeft) / dockWidth
  return ratio >= 1 / 3 && ratio < 2 / 3 ? 'center' : 'left'
}

export interface RectLike { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

export function pointInRect(x: number, y: number, rect: RectLike, slop = 0): boolean {
  return x >= rect.left - slop && x <= rect.right + slop && y >= rect.top - slop && y <= rect.bottom + slop
}

export type DropDecision = { readonly kind: 'dock'; readonly side: FormatDockSide } | { readonly kind: 'float' }

/** 놓은 곳이 붙는 자리 위면 붙고(가운데 / 왼쪽), 아니면 그 자리에 뜬다 */
export function decideDrop(pointerX: number, pointerY: number, dock: RectLike | null): DropDecision {
  if (dock === null || !pointInRect(pointerX, pointerY, dock, 4)) return { kind: 'float' }
  return { kind: 'dock', side: snapZone(pointerX, dock.left, dock.right - dock.left) }
}

export const isDocked = (place: FormatPlace): place is { readonly mode: FormatDockSide } => place.mode !== 'float'

/** 방향키 → 옮길 거리(없으면 null) */
export function keyDelta(key: string, step = FORMAT_KEY_STEP_PX): { dx: number; dy: number } | null {
  switch (key) {
    case 'ArrowLeft': return { dx: -step, dy: 0 }
    case 'ArrowRight': return { dx: step, dy: 0 }
    case 'ArrowUp': return { dx: 0, dy: -step }
    case 'ArrowDown': return { dx: 0, dy: step }
    default: return null
  }
}

export interface PlaceState {
  readonly place: FormatPlace
  /** 마지막으로 붙어 있던 쪽(「붙이기」가 돌아갈 곳) */
  readonly lastDock: FormatDockSide
}

export type PlaceAction =
  | { readonly type: 'float'; readonly x: number; readonly y: number }
  | { readonly type: 'dock'; readonly side: FormatDockSide }
  | { readonly type: 'toggle'; readonly x: number; readonly y: number }
  | { readonly type: 'nudge'; readonly dx: number; readonly dy: number }

export const initialPlaceState = (place: FormatPlace = DEFAULT_PLACE): PlaceState => ({ place, lastDock: isDocked(place) ? place.mode : 'left' })

/** 자리 상태 전이: 떼기 · 붙이기 · 뗐다 붙였다(Enter/Space) · 떠 있을 때 옮기기 */
export function placeReducer(state: PlaceState, action: PlaceAction): PlaceState {
  switch (action.type) {
    case 'float':
      return { place: { mode: 'float', x: action.x, y: action.y }, lastDock: isDocked(state.place) ? state.place.mode : state.lastDock }
    case 'dock':
      return { place: { mode: action.side }, lastDock: action.side }
    case 'toggle':
      return isDocked(state.place)
        ? placeReducer(state, { type: 'float', x: action.x, y: action.y })
        : placeReducer(state, { type: 'dock', side: state.lastDock })
    case 'nudge':
      return state.place.mode === 'float' ? { ...state, place: { mode: 'float', x: state.place.x + action.dx, y: state.place.y + action.dy } } : state
  }
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** 저장된 값을 자리로 읽는다(모르는 모양은 null) */
export function parsePlace(raw: unknown): FormatPlace | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (record.mode === 'left' || record.mode === 'center') return { mode: record.mode }
  if (record.mode === 'float' && isNumber(record.x) && isNumber(record.y)) return { mode: 'float', x: record.x, y: record.y }
  return null
}

export function readPlaces(storage: Pick<Storage, 'getItem'> | null): Partial<Record<FormatHostKind, FormatPlace>> {
  try {
    const text = storage?.getItem(FORMAT_PLACE_KEY)
    if (text === null || text === undefined) return {}
    const data: unknown = JSON.parse(text)
    if (typeof data !== 'object' || data === null) return {}
    const out: Partial<Record<FormatHostKind, FormatPlace>> = {}
    for (const kind of FORMAT_HOST_KINDS) {
      const place = parsePlace((data as Record<string, unknown>)[kind])
      if (place !== null) out[kind] = place
    }
    return out
  } catch {
    return {}
  }
}

export function writePlaces(storage: Pick<Storage, 'setItem'> | null, value: Partial<Record<FormatHostKind, FormatPlace>>): void {
  try {
    storage?.setItem(FORMAT_PLACE_KEY, JSON.stringify(value))
  } catch {
    // 저장이 막혀도(사생활 보호 창 · 용량) 이번 실행에서는 그대로 쓴다
  }
}

const browserStorage = (): Storage | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/** 자리 저장소: 종류별 자리를 모든 서식 줄이 같이 본다(한 곳에서 바꾸면 같은 종류가 다 따라온다) */
let store: Partial<Record<FormatHostKind, FormatPlace>> | null = null
const listeners = new Set<() => void>()
const ensure = () => (store ??= readPlaces(browserStorage()))

export function getPlace(kind: FormatHostKind): FormatPlace {
  return ensure()[kind] ?? DEFAULT_PLACE
}

export function setPlace(kind: FormatHostKind, place: FormatPlace): void {
  store = { ...ensure(), [kind]: place }
  writePlaces(browserStorage(), store)
  listeners.forEach((listener) => listener())
}

export function subscribePlaces(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 시험용: 저장소를 비우고 다시 읽게 한다 */
export function resetPlacesForTest(): void {
  store = null
  listeners.forEach((listener) => listener())
}
