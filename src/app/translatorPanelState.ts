import { useSyncExternalStore } from 'react'

/**
 * 번역기: 앱 창 전체에 떠 있는 창(칸에 붙지 않는다). 열림 · 자리 · 크기는 창 하나에 하나만 있고
 * localStorage `iwae:translator-window:v1` 에 둔다. x·y 가 null 이면 기본 자리(창 오른쪽 아래, 가장자리 12px).
 *
 * 한때(2026-11-12) 번역기는 떠 있는 칸의 탭이었다. 그 세션 · 그보다 앞선 문서 종류별 저장값(`iwae:translator-panel:v1`)은
 * 여기서 한 번 이 창의 열림 · 자리 · 크기로 옮긴다(아래 migrate 함수들).
 */
export interface TranslatorWindowState {
  readonly open: boolean
  readonly x: number | null
  readonly y: number | null
  readonly w: number
  readonly h: number
}

/** 처음 크기: 내용(언어 줄 · 입력 3줄 · 번역 단추 · 결과 3줄 · 복사)에 맞춰 작게 */
export const TRANSLATOR_WINDOW_W = 340
export const TRANSLATOR_WINDOW_H = 300
export const PANEL_MIN_WIDTH = 280
export const PANEL_MIN_HEIGHT = 240
/** 창 가장자리에서 띄우는 여백 */
export const PANEL_MARGIN = 12
export const TRANSLATOR_WINDOW_STORAGE_KEY = 'iwae:translator-window:v1'
/** 문서 종류별로 저장하던 예전 값 */
export const TRANSLATOR_PANEL_STORAGE_KEY = 'iwae:translator-panel:v1'
/** 옮기고 나면 적어 두는 표시: 같은 값을 두 번 옮기지 않는다 */
export const TRANSLATOR_MIGRATED_KEY = 'iwae:translator-panel:migrated:v1'

const DEFAULT_STATE: TranslatorWindowState = { open: false, x: null, y: null, w: TRANSLATOR_WINDOW_W, h: TRANSLATOR_WINDOW_H }

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseState(raw: unknown): TranslatorWindowState {
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

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function safeStorage(): StorageLike | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

function load(): TranslatorWindowState {
  try {
    const text = safeStorage()?.getItem(TRANSLATOR_WINDOW_STORAGE_KEY)
    return text === null || text === undefined ? DEFAULT_STATE : parseState(JSON.parse(text))
  } catch {
    return DEFAULT_STATE
  }
}

let state = load()
const listeners = new Set<() => void>()

export function getTranslatorWindow(): TranslatorWindowState {
  return state
}

export function updateTranslatorWindow(patch: Partial<TranslatorWindowState>): void {
  state = { ...state, ...patch }
  try { safeStorage()?.setItem(TRANSLATOR_WINDOW_STORAGE_KEY, JSON.stringify(state)) } catch { /* 이번 실행에만 */ }
  for (const listener of listeners) listener()
}

/** 번역기 단추: 열려 있으면 닫고 닫혀 있으면 연다 */
export function toggleTranslatorWindow(): void {
  updateTranslatorWindow({ open: !state.open })
}

/** 저장된 값을 다시 읽는다(시험용: 앱을 다시 켠 것처럼) */
export function reloadTranslatorWindow(): void {
  state = load()
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useTranslatorWindow(): TranslatorWindowState {
  return useSyncExternalStore(subscribe, getTranslatorWindow, getTranslatorWindow)
}

export interface PanelBox { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/**
 * 앱 창(bounds) 안에 들어오게: 크기는 창보다 커지지 않고, 자리는 가장자리 여백 안쪽. x·y 가 없으면 오른쪽 위.
 * bounds.top: 맨 윗줄(상단바)의 높이. 번역기는 그 아래에만 놓인다.
 */
export function placePanel(value: Pick<TranslatorWindowState, 'x' | 'y' | 'w' | 'h'>, bounds: { readonly width: number; readonly height: number; readonly top?: number }): PanelBox {
  const top = Math.max(0, bounds.top ?? 0)
  // 아직 창 크기를 못 쟀으면(첫 그림) 저장된 값 그대로
  if (bounds.width <= 0 || bounds.height <= 0) return { x: value.x ?? PANEL_MARGIN, y: Math.max(value.y ?? 0, top + PANEL_MARGIN), w: value.w, h: value.h }
  const w = Math.max(Math.min(value.w, bounds.width - PANEL_MARGIN * 2), Math.min(PANEL_MIN_WIDTH, bounds.width - PANEL_MARGIN * 2))
  const room = bounds.height - top - PANEL_MARGIN * 2
  const h = Math.max(Math.min(value.h, room), Math.min(PANEL_MIN_HEIGHT, room))
  const maxX = Math.max(bounds.width - w - PANEL_MARGIN, PANEL_MARGIN)
  const minY = top + PANEL_MARGIN
  const maxY = Math.max(bounds.height - h - PANEL_MARGIN, minY)
  const x = Math.min(Math.max(value.x ?? maxX, PANEL_MARGIN), maxX)
  const y = Math.min(Math.max(value.y ?? maxY, minY), maxY)
  return { x, y, w: Math.max(w, 0), h: Math.max(h, 0) }
}

// ── 예전 값 옮기기 ────────────────────────────────────────────────────────────

/** 번역기 탭(떠 있는 칸의 탭)이었던 예전 탭 id: `translator` · `translator:<칸 id>` */
export const isLegacyTranslatorTabId = (id: string): boolean => id === 'translator' || id.startsWith('translator:')

/** 문서 종류(PDF · Markdown)마다 하나씩 저장하던 예전 값 */
export type LegacyTranslatorKind = 'pdf' | 'markdown'

/** 옮길 예전 값. 이미 옮겼거나 저장된 값이 없거나 깨졌으면 null */
export function readLegacyTranslatorPanels(storage: StorageLike | null = safeStorage()): Record<LegacyTranslatorKind, TranslatorWindowState> | null {
  try {
    if (storage === null || storage.getItem(TRANSLATOR_MIGRATED_KEY) !== null) return null
    const text = storage.getItem(TRANSLATOR_PANEL_STORAGE_KEY)
    if (text === null) return null
    const raw: unknown = JSON.parse(text)
    const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
    return { pdf: parseState(record.pdf), markdown: parseState(record.markdown) }
  } catch {
    return null
  }
}

/** 옮겼다고 적고 예전 값은 지운다 */
export function finishLegacyTranslatorMigration(storage: StorageLike | null = safeStorage()): void {
  try {
    storage?.setItem(TRANSLATOR_MIGRATED_KEY, '1')
    storage?.removeItem(TRANSLATOR_PANEL_STORAGE_KEY)
  } catch { /* 이번 실행에서만 */ }
}

/**
 * 문서 종류별 예전 값 → 창 하나의 값. 하나라도 열어 두었으면 열린 채로(PDF 쪽 값을 먼저 본다) 크기를 옮기고,
 * 자리는 문서 칸 안의 값이었으므로 옮기지 않는다(기본 자리). 둘 다 닫혀 있었으면 null(바꿀 것이 없다).
 */
export function translatorWindowFromLegacy(legacy: Record<LegacyTranslatorKind, TranslatorWindowState>): Partial<TranslatorWindowState> | null {
  const source = legacy.pdf.open ? legacy.pdf : legacy.markdown.open ? legacy.markdown : null
  return source === null ? null : { open: true, x: null, y: null, w: source.w, h: source.h }
}

/** 번역기 탭을 담았던 떠 있는 칸의 저장 모양(자리는 붙은 곳 사각형에 대한 비율, 크기는 px) */
export interface LegacyTranslatorFloat {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** 접어 두었던 칸 · 떠 있는 칸을 모두 숨겨 둔 화면이었으면 창을 열지 않는다 */
  readonly collapsed?: boolean
  readonly hidden?: boolean
}

/**
 * 번역기 떠 있는 칸 → 창 하나의 값(열림 · 자리 · 크기). 자리는 앱 창(viewport, px; top 은 상단바 높이) 전체에 대한 비율로 옮긴다 —
 * 칸 사각형은 이제 모르므로 어림이고, 화면 밖으로 나가지 않게 그릴 때 placePanel 이 한 번 더 가둔다.
 */
export function translatorWindowFromFloat(float: LegacyTranslatorFloat, viewport: { readonly width: number; readonly height: number; readonly top?: number }): TranslatorWindowState {
  const top = Math.max(0, viewport.top ?? 0)
  return {
    open: float.collapsed !== true && float.hidden !== true,
    x: Math.round(float.x * viewport.width),
    y: Math.round(top + float.y * Math.max(viewport.height - top, 0)),
    w: Math.max(float.w, PANEL_MIN_WIDTH),
    h: Math.max(float.h, PANEL_MIN_HEIGHT),
  }
}

/** 세션에서 읽은 번역기 떠 있는 칸을 창 상태로 옮긴다(상단바 높이 36px 를 비켜서 앉힌다) */
export function adoptLegacyTranslatorFloat(float: LegacyTranslatorFloat): void {
  if (typeof window === 'undefined') return
  updateTranslatorWindow(translatorWindowFromFloat(float, { width: window.innerWidth, height: window.innerHeight, top: 36 }))
}
