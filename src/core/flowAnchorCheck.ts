/**
 * 흐르는 글(Markdown·텍스트·HTML·XML) 형광펜 자리 검증.
 * 저장된 글자 위치([시작, 끝))는 "그릴 때의 본문 글(textContent)" 기준이다. 읽기 화면의 그리는 방식이 바뀌면
 * (거르개·markdown-it·자리표시 변경 등) 같은 원본 파일이어도 본문 글이 달라져 위치가 엉뚱한 글을 가리킨다.
 * 그래서 칠하기 전에 그 자리의 글이 저장해 둔 인용문과 같은지 보고, 다르면 인용문과 앞뒤 글로 다시 찾고,
 * 못 찾으면 칠하지 않는다(기록은 지우지 않는다: 나중에 다시 맞을 수 있다).
 */

/** 공백을 모두 걷은 글(선택 글의 줄바꿈·블록 사이 공백이 본문 글과 달라도 같게 본다) */
function squash(value: string): string {
  return value.replace(/\s+/gu, '')
}

export interface QuoteAnchor {
  readonly quote: string
  readonly prefix: string
  readonly suffix: string
}

/** text 의 [start, end) 가 인용문과 같은가(공백 무시). 인용문이 비었으면 확인할 수 없으니 맞다고 본다 */
export function quoteMatchesAt(text: string, start: number, end: number, quote: string): boolean {
  const wanted = squash(quote)
  if (wanted === '') return true
  if (!(start >= 0 && end > start && end <= text.length)) return false
  // 길이가 크게 다르면 비교하지 않는다(공백이 섞여도 이 길이를 넘지 않는다)
  if (end - start < wanted.length || end - start > wanted.length * 4 + 64) return false
  return squash(text.slice(start, end)) === wanted
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function commonSuffixLength(left: string, right: string): number {
  let count = 0
  while (count < left.length && count < right.length && left[left.length - 1 - count] === right[right.length - 1 - count]) count += 1
  return count
}

function commonPrefixLength(left: string, right: string): number {
  let count = 0
  while (count < left.length && count < right.length && left[count] === right[count]) count += 1
  return count
}

/**
 * 본문에서 인용문의 새 자리를 찾는다. 단어 사이 공백 차이는 무시한다.
 * 여러 곳이면 앞뒤 글이 가장 잘 맞는 곳, 같으면 hint(옛 시작 위치)에 가까운 곳. 못 찾으면 null
 */
export function locateQuote(text: string, anchor: QuoteAnchor, hint: number): [number, number] | null {
  const words = anchor.quote.split(/\s+/u).filter((word) => word !== '')
  if (words.length === 0) return null
  const pattern = new RegExp(words.map(escapeRegExp).join('\\s*'), 'gu')
  let best: [number, number] | null = null
  let bestScore = -1
  let bestDistance = Number.POSITIVE_INFINITY
  const prefix = anchor.prefix
  const suffix = anchor.suffix
  let match = pattern.exec(text)
  while (match !== null) {
    const start = match.index
    const end = start + match[0].length
    const score = commonSuffixLength(text.slice(Math.max(0, start - prefix.length), start), prefix)
      + commonPrefixLength(text.slice(end, end + suffix.length), suffix)
    const distance = Math.abs(start - hint)
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = [start, end]
      bestScore = score
      bestDistance = distance
    }
    // 겹쳐 나오는 자리도 찾는다
    pattern.lastIndex = start + 1
    match = pattern.exec(text)
  }
  return best
}

/** 저장된 자리가 맞으면 그대로(null 아님: 같은 값), 틀리면 새 자리, 못 찾으면 null */
export function verifiedRange(text: string, range: readonly [number, number], anchor: QuoteAnchor): [number, number] | null {
  if (quoteMatchesAt(text, range[0], range[1], anchor.quote)) return [range[0], range[1]]
  return locateQuote(text, anchor, range[0])
}
