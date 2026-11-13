import type { PaneId } from './tabs'

/**
 * 칸을 만진 차례(MRU, 가장 최근이 앞). 같은 색 칸이 셋 이상일 때 「어느 한 칸」을 고르는 기준이다 —
 * 내용을 바꿔야 하면(미리보기 탭 · 탭 활성화) 가장 최근에 만진 칸 하나만 바뀌고, 새 메모는 그 칸의 노트로 간다.
 * 저장하지 않는다(세션 파일에 없다): 앱을 다시 열면 만지는 칸 하나만 알고, 나머지는 화면 차례가 같은 순위의 비김 규칙이 된다.
 * 칸 id 는 화면끼리 겹치지 않으므로 앱 전체에 목록 하나를 둔다. DOM · React 를 모르는 순수 함수만 둔다.
 */

/** 오래 안 만진 칸을 버리는 상한(칸 id 는 계속 새로 생길 수 있다) */
export const PANE_MRU_LIMIT = 48

/** pane 을 가장 앞으로. 이미 맨 앞이면 같은 배열을 돌려준다 */
export function touchMru(mru: readonly PaneId[], pane: PaneId): readonly PaneId[] {
  if (mru[0] === pane) return mru
  return [pane, ...mru.filter((other) => other !== pane)].slice(0, PANE_MRU_LIMIT)
}

/** 최근에 만진 칸이 먼저 오게 정렬한다(안정). 목록에 없는 칸은 뒤에서 원래 차례를 지킨다 */
export function byRecency<T extends PaneId>(candidates: readonly T[], mru: readonly PaneId[] = []): T[] {
  const rank = (pane: PaneId) => { const at = mru.indexOf(pane); return at === -1 ? Number.POSITIVE_INFINITY : at }
  return candidates.map((pane, index) => ({ pane, index })).sort((a, b) => {
    const diff = rank(a.pane) - rank(b.pane)
    // Infinity - Infinity 는 NaN 이다: 둘 다 목록에 없으면 원래 차례
    return Number.isNaN(diff) || diff === 0 ? a.index - b.index : diff
  }).map((entry) => entry.pane)
}

/** 후보 중 가장 최근에 만진 칸(후보가 없으면 undefined) */
export function mostRecent<T extends PaneId>(candidates: readonly T[], mru: readonly PaneId[] = []): T | undefined {
  return byRecency(candidates, mru)[0]
}
