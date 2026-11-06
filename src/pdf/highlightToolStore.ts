import { useSyncExternalStore } from 'react'
import type { PdfHighlightColor } from './persistentHighlight'

/**
 * 형광펜 색과 지우개. 단추·색 판은 문서 도구줄에 있고, 칠하는 일은 PDF·Markdown 칸이 해서 둘이 이 값을 같이 본다.
 */
export interface HighlightToolState {
  readonly color: PdfHighlightColor
  readonly erase: boolean
}

let current: HighlightToolState = { color: 'yellow', erase: false }
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

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useHighlightTool(): readonly [HighlightToolState, (patch: Partial<HighlightToolState>) => void] {
  return [useSyncExternalStore(subscribe, getHighlightTool, getHighlightTool), setHighlightTool]
}
