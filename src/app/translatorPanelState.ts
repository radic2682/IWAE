import { useSyncExternalStore } from 'react'

/**
 * 떠 있는 번역기의 열림·자리·크기. 문서 종류(PDF · Markdown)마다 하나씩 기억한다.
 * localStorage `iwae:translator-panel:v1` 에 `{ pdf: {...}, markdown: {...} }` 로 둔다.
 * x·y 가 null 이면 기본 자리(문서 칸 오른쪽 위).
 */
export type TranslatorPanelKind = 'pdf' | 'markdown'

export interface TranslatorPanelState {
  readonly open: boolean
  readonly x: number | null
  readonly y: number | null
  readonly w: number
  readonly h: number
}

export const PANEL_MIN_WIDTH = 280
export const PANEL_MIN_HEIGHT = 240
export const PANEL_MARGIN = 8
export const TRANSLATOR_PANEL_STORAGE_KEY = 'iwae:translator-panel:v1'

const DEFAULT_STATE: TranslatorPanelState = { open: false, x: null, y: null, w: 340, h: 380 }

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseOne(raw: unknown): TranslatorPanelState {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_STATE
  const record = raw as Record<string, unknown>
  return {
    open: record.open === true,
    x: finite(record.x),
    y: finite(record.y),
    w: Math.max(finite(record.w) ?? DEFAULT_STATE.w, PANEL_MIN_WIDTH),
    h: Math.max(finite(record.h) ?? DEFAULT_STATE.h, PANEL_MIN_HEIGHT),
  }
}

function load(): Record<TranslatorPanelKind, TranslatorPanelState> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(TRANSLATOR_PANEL_STORAGE_KEY) ?? 'null')
    const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
    return { pdf: parseOne(record.pdf), markdown: parseOne(record.markdown) }
  } catch {
    return { pdf: DEFAULT_STATE, markdown: DEFAULT_STATE }
  }
}

let states = load()
const listeners = new Set<() => void>()

export function getTranslatorPanelState(kind: TranslatorPanelKind): TranslatorPanelState {
  return states[kind]
}

export function updateTranslatorPanel(kind: TranslatorPanelKind, patch: Partial<TranslatorPanelState>): void {
  states = { ...states, [kind]: { ...states[kind], ...patch } }
  try { window.localStorage.setItem(TRANSLATOR_PANEL_STORAGE_KEY, JSON.stringify(states)) } catch { /* 이번 실행에만 */ }
  for (const listener of listeners) listener()
}

/** 저장된 값을 다시 읽는다(시험용: 앱을 다시 켠 것처럼) */
export function reloadTranslatorPanelState(): void {
  states = load()
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useTranslatorPanelState(kind: TranslatorPanelKind): TranslatorPanelState {
  return useSyncExternalStore(subscribe, () => states[kind], () => states[kind])
}

export interface PanelBox { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** 문서 칸(bounds) 안에 들어오게: 크기는 칸보다 커지지 않고, 자리는 칸 가장자리 여백 안쪽. x·y 가 없으면 오른쪽 위 */
export function placePanel(state: Pick<TranslatorPanelState, 'x' | 'y' | 'w' | 'h'>, bounds: { readonly width: number; readonly height: number }): PanelBox {
  // 아직 칸 크기를 못 쟀으면(첫 그림) 저장된 값 그대로
  if (bounds.width <= 0 || bounds.height <= 0) return { x: state.x ?? PANEL_MARGIN, y: state.y ?? PANEL_MARGIN, w: state.w, h: state.h }
  const w = Math.max(Math.min(state.w, bounds.width - PANEL_MARGIN * 2), Math.min(PANEL_MIN_WIDTH, bounds.width - PANEL_MARGIN * 2))
  const h = Math.max(Math.min(state.h, bounds.height - PANEL_MARGIN * 2), Math.min(PANEL_MIN_HEIGHT, bounds.height - PANEL_MARGIN * 2))
  const maxX = Math.max(bounds.width - w - PANEL_MARGIN, PANEL_MARGIN)
  const maxY = Math.max(bounds.height - h - PANEL_MARGIN, PANEL_MARGIN)
  const x = Math.min(Math.max(state.x ?? maxX - 8, PANEL_MARGIN), maxX)
  const y = Math.min(Math.max(state.y ?? PANEL_MARGIN + 4, PANEL_MARGIN), maxY)
  return { x, y, w: Math.max(w, 0), h: Math.max(h, 0) }
}
