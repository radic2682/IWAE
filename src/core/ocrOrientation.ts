/**
 * 스캔 쪽의 방향(똑바로·옆으로·거꾸로) 판정. 쪽 그림을 0·90·180·270도 돌려 가며 OCR 한 결과의
 * 「읽힌 글자 수 × 확신」을 견줘, 0도보다 뚜렷하게 잘 읽히는 각도를 고른다. 순수 함수만 둔다.
 */
export type Quarter = 0 | 90 | 180 | 270

export const QUARTERS: readonly Quarter[] = [0, 90, 180, 270]

export interface RecognizedItem {
  readonly text: string
  readonly score: number
  /** 줄 상자의 꼭짓점(그림 픽셀). 있으면 세로로 선 상자는 읽힌 것으로 치지 않는다 */
  readonly poly?: readonly (readonly [number, number])[]
}

export interface ReadStats {
  /** 공백을 뺀 읽힌 글자 수 */
  readonly chars: number
  /** 글자 수 × 확신(0~1)의 합 */
  readonly score: number
}

/** 이 점수보다 낮으면 어느 방향이든 읽혔다고 보지 않는다(잡음) */
export const ORIENTATION_MIN_SCORE = 12
/** 돌린 쪽이 0도보다 이만큼 배는 읽혀야 돌린다 */
export const ORIENTATION_MARGIN = 1.6
/** 0도에서 이만큼 또렷하게 읽히면 다른 각도는 살피지 않는다 */
export const UPRIGHT_MIN_CHARS = 30
export const UPRIGHT_MIN_CONFIDENCE = 0.85

/** 이 글자 수 이상인 줄이 폭보다 키가 큰 상자에 담겼으면 눕거나 선 글자다 */
const SIDEWAYS_MIN_CHARS = 4
/** 상자 폭÷높이가 이보다 작으면 세로 상자 */
const SIDEWAYS_MAX_ASPECT = 1.2

/**
 * 글자가 옆으로 누워 세로 상자에 담긴 줄인가. OCR 엔진은 세로 상자를 스스로 돌려 읽어서, 90도 누운 쪽도
 * 0도에서 거의 다 읽힌다. 그 읽힘을 방향이 맞은 것으로 세지 않으려고 상자 모양을 본다.
 */
export function isSidewaysBox(item: RecognizedItem, chars: number): boolean {
  if (item.poly === undefined || item.poly.length === 0 || chars < SIDEWAYS_MIN_CHARS) return false
  const xs = item.poly.map(([x]) => x)
  const ys = item.poly.map(([, y]) => y)
  const width = Math.max(...xs) - Math.min(...xs)
  const height = Math.max(...ys) - Math.min(...ys)
  return height > 0 && width / height < SIDEWAYS_MAX_ASPECT
}

export function readStats(items: readonly RecognizedItem[]): ReadStats {
  let chars = 0
  let score = 0
  for (const item of items) {
    if (!Number.isFinite(item.score)) continue
    const confidence = Math.min(1, Math.max(0, item.score))
    const count = [...item.text.replace(/\s+/gu, '')].length
    if (isSidewaysBox(item, count)) continue
    chars += count
    score += count * confidence
  }
  return { chars, score }
}

/** 0도에서 이미 또렷하게 읽혀 다른 각도를 살필 필요가 없는가 */
export function isClearlyUpright(stats: ReadStats): boolean {
  return stats.chars >= UPRIGHT_MIN_CHARS && stats.score / stats.chars >= UPRIGHT_MIN_CONFIDENCE
}

/**
 * 각도마다의 읽힘 점수(그림을 시계 방향으로 그만큼 돌려 읽었을 때)에서 쪽을 시계 방향으로 얼마나
 * 돌려야 똑바로 서는지 고른다. 0도와 비슷하거나 어디서도 잘 안 읽히면 0(그대로).
 * 살피지 않은 각도는 빼고 넘겨도 된다.
 */
export function pickOrientation(scores: Readonly<Partial<Record<Quarter, number>>>): Quarter {
  const base = scores[0] ?? 0
  let best: Quarter = 0
  let bestScore = base
  for (const angle of QUARTERS) {
    const score = scores[angle] ?? 0
    if (angle !== 0 && score > bestScore) {
      best = angle
      bestScore = score
    }
  }
  if (best === 0) return 0
  if (bestScore < ORIENTATION_MIN_SCORE) return 0
  if (bestScore < base * ORIENTATION_MARGIN) return 0
  if (bestScore - base < ORIENTATION_MIN_SCORE / 2) return 0
  return best
}
