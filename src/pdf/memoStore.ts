import { useSyncExternalStore } from 'react'

/**
 * 왼쪽 바(PDF 아래 카테고리)에서 고른 메모 카테고리. PDF 창의 메모 열·「메모만 보기」가 같은 값을 본다.
 * topic: null = 메모 전체, '' = 카테고리 없는 메모, 문자열 = 그 카테고리
 */
export interface MemoFilter {
  readonly docId: string
  readonly topic: string | null
}

let filter: MemoFilter | null = null
const listeners = new Set<() => void>()

/** 오른쪽 메모 바를 펼쳐 둘까. 맨 위 줄의 단추가 바꾸고, 다음 실행에도 기억한다 */
const MEMO_BAR_KEY = 'iwae:pdf-memo-column:v1'
function readMemoBarVisible(): boolean {
  try {
    return typeof window === 'undefined' || window.localStorage.getItem(MEMO_BAR_KEY) !== 'off'
  } catch {
    return true
  }
}
let barVisible = readMemoBarVisible()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setMemoFilter(next: MemoFilter | null) {
  filter = next
  for (const listener of listeners) listener()
}

export function useMemoFilter(): MemoFilter | null {
  return useSyncExternalStore(subscribe, () => filter, () => null)
}

export function setMemoBarVisible(next: boolean) {
  barVisible = next
  try {
    window.localStorage.setItem(MEMO_BAR_KEY, next ? 'on' : 'off')
  } catch {
    // 저장 못 해도 이번 실행에서는 바뀐다
  }
  for (const listener of listeners) listener()
}

export function useMemoBarVisible(): boolean {
  return useSyncExternalStore(subscribe, () => barVisible, () => true)
}

/** 테스트용: 처음 상태로 */
export function resetMemoStore() {
  filter = null
  barVisible = readMemoBarVisible()
}
