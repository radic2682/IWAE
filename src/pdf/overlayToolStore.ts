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
