/**
 * 문서 안·문서 사이를 오간 자리. 브라우저의 뒤로/앞으로와 같은 두 스택이다.
 *
 * 기록하는 것은 "점프"뿐이다 — 링크, 목차, 검색 결과, 출처 이동. 스크롤은 기록하지 않는다.
 * 스크롤까지 쌓으면 뒤로 한 번이 한 화면 위로 가는 것과 같아져 아무도 쓰지 않는다.
 */

export interface NavLocation {
  readonly docId: string
  /** 1-기반 쪽 번호 */
  readonly page: number
}

export interface NavHistory {
  readonly past: readonly NavLocation[]
  readonly future: readonly NavLocation[]
}

export const EMPTY_HISTORY: NavHistory = { past: [], future: [] }

const LIMIT = 100

const same = (a: NavLocation, b: NavLocation) => a.docId === b.docId && a.page === b.page

/** `from` 에서 `to` 로 점프했다. 같은 자리로의 점프는 기록하지 않는다. */
export function pushLocation(history: NavHistory, from: NavLocation, to: NavLocation): NavHistory {
  if (same(from, to)) return history
  const last = history.past[history.past.length - 1]
  const past = last !== undefined && same(last, from) ? history.past : [...history.past, from]
  return { past: past.slice(-LIMIT), future: [] }
}

type Exists = (location: NavLocation) => boolean

/**
 * 한 칸 뒤로. `exists` 가 거짓인 자리(휴지통으로 간 문서)는 건너뛰고 버린다 —
 * 남겨 두면 뒤로를 누를 때마다 같은 자리에서 멈춘다.
 */
export function goBack(
  history: NavHistory,
  current: NavLocation,
  exists: Exists = () => true,
): { history: NavHistory; target: NavLocation | null } {
  const past = [...history.past]
  while (past.length > 0) {
    const target = past.pop()!
    if (!exists(target)) continue
    return { history: { past, future: [current, ...history.future].slice(0, LIMIT) }, target }
  }
  return { history: { past, future: history.future }, target: null }
}

/** 한 칸 앞으로. 규칙은 [`goBack`] 과 같다. */
export function goForward(
  history: NavHistory,
  current: NavLocation,
  exists: Exists = () => true,
): { history: NavHistory; target: NavLocation | null } {
  const future = [...history.future]
  while (future.length > 0) {
    const target = future.shift()!
    if (!exists(target)) continue
    return { history: { past: [...history.past, current].slice(-LIMIT), future }, target }
  }
  return { history: { past: history.past, future }, target: null }
}
