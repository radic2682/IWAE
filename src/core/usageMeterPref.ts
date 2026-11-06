import { useSyncExternalStore } from 'react'

/**
 * PDF 하단 막대 오른쪽 끝의 CPU·메모리 표시를 켤까. 이 PC 의 취향이라 브라우저 저장소에 둔다(기본: 켬).
 * 설정 창에서 바꾸면 열려 있는 하단 막대에도 바로 반영된다.
 */
const KEY = 'iwae:usage-meter:v1'

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

let enabled = typeof window === 'undefined' ? true : read()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setUsageMeterEnabled(next: boolean): void {
  enabled = next
  try {
    window.localStorage.setItem(KEY, next ? 'on' : 'off')
  } catch {
    // 저장하지 못해도 이번 실행에는 적용된다
  }
  for (const listener of listeners) listener()
}

export function useUsageMeterEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabled, () => true)
}

/** 테스트용: 저장소에서 다시 읽는다 */
export function reloadUsageMeterPref(): void {
  enabled = read()
  for (const listener of listeners) listener()
}
