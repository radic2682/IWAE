import { useSyncExternalStore } from 'react'
import type { OverlayTool } from './PdfOverlayLayer'

/**
 * 편집 도구(글 상자 · 펜 · 지우개 · 선) 중 고른 것. 도구 단추는 문서 도구줄에 있고, 그리는 층은
 * PDF·Markdown 칸 안에 있어서 둘이 이 값 하나를 같이 본다.
 */
let current: OverlayTool = 'text'
const listeners = new Set<() => void>()

export function getOverlayTool(): OverlayTool {
  return current
}

export function setOverlayTool(tool: OverlayTool): void {
  if (tool === current) return
  current = tool
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useOverlayTool(): readonly [OverlayTool, (tool: OverlayTool) => void] {
  const tool = useSyncExternalStore(subscribe, getOverlayTool, getOverlayTool)
  return [tool, setOverlayTool]
}

/** 그리기 단추 하나에 접힌 도구들. 단추에는 마지막에 쓴 것이 보인다 */
export type DrawTool = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse'
export const DRAW_TOOLS: readonly DrawTool[] = ['pen', 'line', 'arrow', 'rect', 'ellipse']
const LAST_DRAW_KEY = 'iwae:overlay-last-draw:v1'
let lastDraw: DrawTool = (() => {
  try {
    const saved = window.localStorage.getItem(LAST_DRAW_KEY)
    return DRAW_TOOLS.includes(saved as DrawTool) ? saved as DrawTool : 'pen'
  } catch {
    return 'pen'
  }
})()
const drawListeners = new Set<() => void>()
export function isDrawTool(tool: OverlayTool): tool is DrawTool {
  return (DRAW_TOOLS as readonly string[]).includes(tool)
}
export function setLastDrawTool(tool: DrawTool): void {
  if (tool === lastDraw) return
  lastDraw = tool
  try { window.localStorage.setItem(LAST_DRAW_KEY, tool) } catch { /* 이번 실행만 */ }
  for (const listener of drawListeners) listener()
}
export function useLastDrawTool(): DrawTool {
  return useSyncExternalStore((listener) => { drawListeners.add(listener); return () => drawListeners.delete(listener) }, () => lastDraw, () => lastDraw)
}

/** 도구마다 따로 기억하는 서식(펜은 빨강, 글 상자는 검정 …) */
export interface ToolStyle {
  readonly color: string
  readonly lineWidth: number
  readonly textSize: number
  readonly bold: boolean
  readonly textFill: 'none' | 'white' | 'yellow'
  readonly border: boolean
  readonly dash: 'solid' | 'dash' | 'dot'
  readonly arrowStart: boolean
  readonly arrowEnd: boolean
  readonly fill: boolean
}
const BASE_STYLE: ToolStyle = { color: '#d9363e', lineWidth: 2, textSize: 12, bold: false, textFill: 'none', border: false, dash: 'solid', arrowStart: false, arrowEnd: false, fill: false }
const DEFAULT_STYLES: Readonly<Record<OverlayTool, ToolStyle>> = {
  text: { ...BASE_STYLE, color: '#111111' },
  pen: BASE_STYLE,
  line: BASE_STYLE,
  arrow: { ...BASE_STYLE, color: '#1a73e8', arrowEnd: true },
  rect: BASE_STYLE,
  ellipse: BASE_STYLE,
  eraser: BASE_STYLE,
}
const STYLES_KEY = 'iwae:overlay-styles:v1'
let styles: Record<OverlayTool, ToolStyle> = (() => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STYLES_KEY) ?? '{}') as Partial<Record<OverlayTool, Partial<ToolStyle>>>
    return Object.fromEntries(Object.entries(DEFAULT_STYLES).map(([tool, base]) => [tool, { ...base, ...(saved[tool as OverlayTool] ?? {}) }])) as Record<OverlayTool, ToolStyle>
  } catch {
    return { ...DEFAULT_STYLES }
  }
})()
const styleListeners = new Set<() => void>()
export function patchToolStyle(tool: OverlayTool, patch: Partial<ToolStyle>): void {
  styles = { ...styles, [tool]: { ...styles[tool], ...patch } }
  try { window.localStorage.setItem(STYLES_KEY, JSON.stringify(styles)) } catch { /* 이번 실행만 */ }
  for (const listener of styleListeners) listener()
}
export function useToolStyle(tool: OverlayTool): readonly [ToolStyle, (patch: Partial<ToolStyle>) => void] {
  const all = useSyncExternalStore((listener) => { styleListeners.add(listener); return () => styleListeners.delete(listener) }, () => styles, () => styles)
  return [all[tool], (patch) => patchToolStyle(tool, patch)]
}
