import { useSyncExternalStore } from 'react'

/**
 * 색마다 지금 Vault 의 PDF 형광펜이 몇 개인지(설정 창이 색을 지울 때 알려 주려고).
 * 형광펜 목록을 가진 App 이 바뀔 때마다 넣어 준다.
 */
let usage: ReadonlyMap<string, number> = new Map()
const listeners = new Set<() => void>()

export function setHighlightColorUsage(next: ReadonlyMap<string, number>): void {
  usage = next
  for (const listener of listeners) listener()
}

export function useHighlightColorUsage(): ReadonlyMap<string, number> {
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  return useSyncExternalStore(subscribe, () => usage, () => usage)
}
