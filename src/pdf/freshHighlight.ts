/**
 * 방금 만든 형광펜 표시. 만든 순간부터 잠깐(FRESH_MS) 동안만 「새것」이라 SelectionLayer 가 한 번 떠오르는 모양을 붙인다.
 * 문서를 열 때 한꺼번에 그려지는 기존 형광펜은 이 표에 없으므로 움직이지 않는다.
 */
const FRESH_MS = 900
const created = new Map<string, number>()

export function markFreshHighlight(id: string, now: number = Date.now()): void {
  created.set(id, now)
  for (const [key, at] of created) if (now - at > FRESH_MS * 4) created.delete(key)
}

export function isFreshHighlight(id: string, now: number = Date.now()): boolean {
  const at = created.get(id)
  return at !== undefined && now - at < FRESH_MS
}
