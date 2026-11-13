import { useSyncExternalStore } from 'react'

/** 노트 미니맵 켜기·끄기: 노트마다가 아니라 앱 전체에서 하나. 기본은 꺼짐(자동으로 나오지 않는다) */
const KEY = 'iwae:note-minimap:v1'
const listeners = new Set<() => void>()
let fallback = false

export function readNoteMinimap(): boolean {
  try { return window.localStorage.getItem(KEY) === '1' } catch { return fallback }
}

export function setNoteMinimap(on: boolean): void {
  fallback = on
  try { window.localStorage.setItem(KEY, on ? '1' : '0') } catch { /* 이번 실행만 */ }
  for (const listener of listeners) listener()
}

export function toggleNoteMinimap(): boolean {
  const next = !readNoteMinimap()
  setNoteMinimap(next)
  return next
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // 다른 창(떼어 낸 창)이 바꾸면 storage 이벤트가 온다
  const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) listener() }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage) }
}

export function useNoteMinimap(): boolean {
  return useSyncExternalStore(subscribe, readNoteMinimap, () => false)
}
