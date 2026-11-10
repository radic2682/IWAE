import { useSyncExternalStore } from 'react'
import { subscribeAppPrefs, getAppPrefs } from '../app/appPrefs'
import { defaultHighlightColorId, findHighlightColor } from '../core/highlightColors'
import type { PdfHighlightColor } from './persistentHighlight'

/**
 * 형광펜 색과 지우개. 단추·색 판은 문서 도구줄에 있고, 칠하는 일은 PDF·Markdown 칸이 해서 둘이 이 값을 같이 본다.
 */
export interface HighlightToolState {
  readonly color: PdfHighlightColor
  readonly erase: boolean
}

let current: HighlightToolState = { color: defaultHighlightColorId(getAppPrefs().highlightColors), erase: false }
const listeners = new Set<() => void>()

export function getHighlightTool(): HighlightToolState {
  return current
}

export function setHighlightTool(patch: Partial<HighlightToolState>): void {
  const next = { ...current, ...patch }
  if (next.color === current.color && next.erase === current.erase) return
  current = next
  for (const listener of listeners) listener()
}

// 칠하던 색을 목록에서 지우면(다른 창에서 지운 것도) 첫 색으로 돌아간다
subscribeAppPrefs(() => {
  const colors = getAppPrefs().highlightColors
  if (findHighlightColor(colors, current.color) === undefined) setHighlightTool({ color: defaultHighlightColorId(colors) })
})

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useHighlightTool(): readonly [HighlightToolState, (patch: Partial<HighlightToolState>) => void] {
  return [useSyncExternalStore(subscribe, getHighlightTool, getHighlightTool), setHighlightTool]
}
