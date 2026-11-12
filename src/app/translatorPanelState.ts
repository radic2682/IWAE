import { addFloat, translatorFloatFor, translatorTab, type FloatModel } from './floatingPanes'
import { activeScreenOf, allScreenPaneIds } from './screens'
import { newPaneId } from '../core/layoutTree'

/**
 * 예전 떠 있는 번역기(문서 칸 위의 고정 창)의 열림·자리·크기. 문서 종류(PDF · Markdown)마다 하나씩
 * localStorage `iwae:translator-panel:v1` 에 `{ pdf: {...}, markdown: {...} }` 로 있었다.
 * 지금 번역기는 번역기 탭을 담은 떠 있는 칸이라(설계 5) 이 모듈은 예전 값을 한 번 옮겨 담는 일만 한다.
 * x·y 가 null 이면 기본 자리(문서 칸 오른쪽 위)였다.
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
/** 옮기고 나면 적어 두는 표시: 같은 값을 두 번 옮기지 않는다 */
export const TRANSLATOR_MIGRATED_KEY = 'iwae:translator-panel:migrated:v1'

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

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function safeStorage(): StorageLike | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

/** 옮길 예전 값. 이미 옮겼거나 저장된 값이 없거나 깨졌으면 null */
export function readLegacyTranslatorPanels(storage: StorageLike | null = safeStorage()): Record<TranslatorPanelKind, TranslatorPanelState> | null {
  try {
    if (storage === null || storage.getItem(TRANSLATOR_MIGRATED_KEY) !== null) return null
    const text = storage.getItem(TRANSLATOR_PANEL_STORAGE_KEY)
    if (text === null) return null
    const raw: unknown = JSON.parse(text)
    const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
    return { pdf: parseOne(record.pdf), markdown: parseOne(record.markdown) }
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

export interface PanelBox { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** 문서 칸(bounds) 안에 들어오게: 크기는 칸보다 커지지 않고, 자리는 칸 가장자리 여백 안쪽. x·y 가 없으면 오른쪽 위 */
/** bounds.top: 칸 위쪽을 덮는 문서 도구줄의 높이(PDF 도구줄은 칸 위에 떠 있다). 번역기는 그 아래에만 놓인다 */
export function placePanel(state: Pick<TranslatorPanelState, 'x' | 'y' | 'w' | 'h'>, bounds: { readonly width: number; readonly height: number; readonly top?: number }): PanelBox {
  const top = Math.max(0, bounds.top ?? 0)
  // 아직 칸 크기를 못 쟀으면(첫 그림) 저장된 값 그대로
  if (bounds.width <= 0 || bounds.height <= 0) return { x: state.x ?? PANEL_MARGIN, y: Math.max(state.y ?? 0, top + PANEL_MARGIN), w: state.w, h: state.h }
  const w = Math.max(Math.min(state.w, bounds.width - PANEL_MARGIN * 2), Math.min(PANEL_MIN_WIDTH, bounds.width - PANEL_MARGIN * 2))
  const room = bounds.height - top - PANEL_MARGIN * 2
  const h = Math.max(Math.min(state.h, room), Math.min(PANEL_MIN_HEIGHT, room))
  const maxX = Math.max(bounds.width - w - PANEL_MARGIN, PANEL_MARGIN)
  const minY = top + PANEL_MARGIN
  const maxY = Math.max(bounds.height - h - PANEL_MARGIN, minY)
  const x = Math.min(Math.max(state.x ?? maxX - 8, PANEL_MARGIN), maxX)
  const y = Math.min(Math.max(state.y ?? minY + 4, minY), maxY)
  return { x, y, w: Math.max(w, 0), h: Math.max(h, 0) }
}

/** 옮길 때 알아야 할 문서 칸: 보는 탭의 종류와 칸 크기(px) */
export interface LegacyDocPane {
  readonly pane: string
  readonly kind: TranslatorPanelKind
  readonly width: number
  readonly height: number
}

/**
 * 예전에 열어 둔 번역기(open)마다, 같은 종류의 문서를 보는 첫 칸에 그 칸에 붙은 번역기 떠 있는 칸을 만든다.
 * 예전 자리(px)는 그 칸 크기에 대한 비율로, 크기는 그대로 옮긴다. 칸 크기를 모르면(0) 저장된 px 를 800×600 칸으로 보고 옮긴다.
 * 그 종류의 문서를 보는 칸이 없거나 이미 그 칸에 번역기가 있으면 옮기지 않는다.
 */
export function migrateLegacyTranslators(model: FloatModel, legacy: Record<TranslatorPanelKind, TranslatorPanelState>, panes: readonly LegacyDocPane[]): FloatModel {
  let current = model
  for (const kind of ['pdf', 'markdown'] as const) {
    const state = legacy[kind]
    if (!state.open) continue
    const host = panes.find((pane) => pane.kind === kind)
    if (host === undefined || translatorFloatFor(activeScreenOf(current.screens), host.pane) !== undefined) continue
    const bounds = host.width > 0 && host.height > 0 ? { width: host.width, height: host.height } : { width: 800, height: 600 }
    const box = placePanel(state, bounds)
    const paneId = newPaneId(allScreenPaneIds(current.screens))
    const created = addFloat(current, {
      paneId,
      tab: translatorTab(paneId),
      anchorPane: host.pane,
      size: { w: box.w, h: box.h },
      at: { x: box.x / bounds.width, y: box.y / bounds.height },
    })
    if ('error' in created) break
    // 옮기기는 사람이 만지던 칸을 바꾸지 않는다
    current = { screens: created.model.screens, activePane: model.activePane }
  }
  return current
}
