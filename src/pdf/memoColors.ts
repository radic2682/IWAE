// 형광펜 색 → 카드 탭·테두리·연결선에 쓰는 진한 색(흰 글자가 읽히는 밝기). CSS 의 --memo-ink-* 와 같은 값.
// CSS 쪽은 카드에 --memo-color 가 걸려 있다(.pdf-memo-card-yellow 등).
export const MEMO_INK: Record<string, string> = {
  yellow: '#b8911a',
  green: '#2f9358',
  blue: '#2f78c4',
  pink: '#c4467c',
}

/** 색 이름의 진한 색. 없으면 fallback(보통 강조색) */
export function memoInk(color: string | undefined, fallback = 'var(--accent)'): string {
  return (color && MEMO_INK[color]) || fallback
}
