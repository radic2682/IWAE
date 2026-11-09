/**
 * 두 판(PDF) 글자 비교. 쪽마다의 글을 줄로 나눠 Myers 차분으로 바뀐 곳을 찾는다.
 * 줄 안의 띄어쓰기 차이(조판이 달라 생기는 것)는 같은 것으로 본다.
 */

export interface DiffLine {
  /** 0 부터 */
  readonly page: number
  readonly text: string
}

export interface DiffHunk {
  readonly kind: 'added' | 'removed' | 'changed'
  /** 예전 판의 줄(지워졌거나 바뀌기 전) */
  readonly before: readonly DiffLine[]
  /** 새 판의 줄(더해졌거나 바뀐 뒤) */
  readonly after: readonly DiffLine[]
}

export interface DiffResult {
  readonly hunks: readonly DiffHunk[]
  /** 너무 달라 끝까지 비교하지 않았다 */
  readonly truncated: boolean
}

/** 쪽 글 → 비교할 줄(빈 줄은 뺀다) */
export function pageLines(pages: readonly string[]): DiffLine[] {
  return pages.flatMap((text, page) => text
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter((line) => line !== '')
    .map((line) => ({ page, text: line })))
}

const keyOf = (line: DiffLine) => line.text.replace(/\s+/gu, '').toLowerCase()

/** 고칠 거리(D)가 이보다 크면 멈춘다(두 판이 완전히 다른 문서) */
const MAX_EDITS = 4000

/**
 * Myers O((N+M)D) 차분. 같은 줄은 건너뛰고 지움·더함을 모아 덩어리(hunk)로 묶는다. 지움 바로 뒤의 더함은 「바뀜」.
 */
export function diffLines(before: readonly DiffLine[], after: readonly DiffLine[]): DiffResult {
  const a = before.map(keyOf)
  const b = after.map(keyOf)
  // 앞뒤의 같은 부분은 미리 잘라 낸다(대부분의 개정판은 거의 같다)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }
  const n = endA - start
  const m = endB - start
  const max = n + m
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = false
  let truncated = false
  outer: for (let d = 0; d <= max; d += 1) {
    if (d > MAX_EDITS) {
      truncated = true
      break
    }
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x += 1
        y += 1
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        found = true
        break outer
      }
    }
  }
  if (!found) {
    // 너무 달라 끝까지 못 갔다: 남은 것을 통째로 「바뀜」 하나로
    return {
      hunks: n + m === 0 ? [] : [{ kind: n === 0 ? 'added' : m === 0 ? 'removed' : 'changed', before: before.slice(start, endA), after: after.slice(start, endB) }],
      truncated,
    }
  }
  // 거꾸로 따라가며 편집 목록을 만든다
  type Edit = { readonly type: 'del' | 'ins'; readonly index: number }
  const edits: Edit[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d -= 1) {
    const vd = trace[d]!
    const k = x - y
    const prevK = k === -d || (k !== d && vd[offset + k - 1]! < vd[offset + k + 1]!) ? k + 1 : k - 1
    const prevX = vd[offset + prevK]!
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x -= 1
      y -= 1
    }
    if (d > 0) {
      if (x === prevX) edits.push({ type: 'ins', index: start + prevY })
      else edits.push({ type: 'del', index: start + prevX })
    }
    x = prevX
    y = prevY
  }
  edits.reverse()
  // 이어진 편집을 덩어리로
  const hunks: DiffHunk[] = []
  let current: { before: DiffLine[]; after: DiffLine[]; lastA: number; lastB: number } | null = null
  const flush = () => {
    if (current === null) return
    const kind = current.before.length === 0 ? 'added' : current.after.length === 0 ? 'removed' : 'changed'
    hunks.push({ kind, before: current.before, after: current.after })
    current = null
  }
  // 지움·더함의 위치를 원래 줄 번호로 따라가며, 같은 줄이 끼면 끊는다
  let ai = 0
  let bi = 0
  const editsByPosition = edits
  let e = 0
  while (ai < before.length || bi < after.length) {
    const edit = editsByPosition[e]
    if (edit !== undefined && edit.type === 'del' && edit.index === ai) {
      current ??= { before: [], after: [], lastA: ai, lastB: bi }
      current.before.push(before[ai]!)
      ai += 1
      e += 1
      continue
    }
    if (edit !== undefined && edit.type === 'ins' && edit.index === bi) {
      current ??= { before: [], after: [], lastA: ai, lastB: bi }
      current.after.push(after[bi]!)
      bi += 1
      e += 1
      continue
    }
    flush()
    ai += 1
    bi += 1
  }
  flush()
  return { hunks, truncated }
}
