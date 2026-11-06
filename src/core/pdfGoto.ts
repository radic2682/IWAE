/**
 * "어디로 갈까" 입력을 해석한다: 쪽 번호, 절 번호(5.1.9.3, A.2), 표·그림 번호(Table 52, Figure 6-3).
 * 쪽 이동 칸(Ctrl+G)과 본문의 상호참조 미리보기가 같이 쓴다.
 *
 * 순수 함수만 둔다. 목차와 쪽 글자는 부르는 쪽이 넘긴다.
 */

export type GotoTarget =
  | { readonly kind: 'page'; readonly page: number }
  | { readonly kind: 'section'; readonly number: string }
  | { readonly kind: 'caption'; readonly label: 'Table' | 'Figure'; readonly number: string }

export interface GotoOutlineEntry {
  readonly title: string
  /** 0-기반. 문서 안 목적지가 없으면 null */
  readonly page: number | null
}

export interface GotoHit {
  /** 0-기반 쪽 */
  readonly pageIndex: number
  /** 그 쪽 글자에서 찾은 자리 `[시작, 끝)`. 목차로만 찾았으면 없다 */
  readonly range?: readonly [number, number]
}

const CAPTION_WORDS: Readonly<Record<string, 'Table' | 'Figure'>> = {
  table: 'Table', tab: 'Table', 표: 'Table',
  figure: 'Figure', fig: 'Figure', 그림: 'Figure',
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

export function parseGoto(input: string): GotoTarget | null {
  const text = input.trim()
  if (text === '') return null
  const page = /^(?:p\.?|page|쪽)?\s*(\d+)\s*(?:쪽|p)?$/iu.exec(text)
  if (page !== null) return { kind: 'page', page: Number(page[1]) }
  const caption = /^(table|tab\.?|표|figure|fig\.?|그림)\s*([A-Z]?\d+(?:[-.]\d+)*)$/iu.exec(text)
  if (caption !== null) {
    const word = caption[1]!.toLowerCase().replace(/\.$/u, '')
    return { kind: 'caption', label: CAPTION_WORDS[word] ?? 'Table', number: caption[2]! }
  }
  const section = /^(?:§|section|sec\.?|clause|절)?\s*((?:\d+|[A-Z])(?:\.\d+)+|[A-Z])\.?$/iu.exec(text)
  if (section !== null) return { kind: 'section', number: section[1]! }
  return null
}

/** 목차 줄(점 줄 "....." 뒤에 쪽 번호)인가. 목차의 같은 번호로 가면 안 된다 */
function isTocLine(line: string): boolean {
  return /\.{4,}|…{2,}|\s\d+\s*$/u.test(line) && /(\.\s?){4,}|…/u.test(line)
}

function lineAround(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index) + 1
  const end = text.indexOf('\n', index)
  return text.slice(start, end < 0 ? text.length : end)
}

/**
 * 쪽 글자에서 표·그림 제목(본문 언급이 아니라 캡션)을 찾는다.
 * 1) 줄 머리(앞에 줄 번호만 허용)의 "Table 52" 뒤에 구분 기호나 대문자 낱말 — 스펙 PDF 의 흔한 캡션
 * 2) 줄 어디든 "Table 52 –" 처럼 구분 기호가 붙은 것
 */
export function findCaption(text: string, label: 'Table' | 'Figure', number: string): readonly [number, number] | null {
  const name = `${label}\\s+${escapeRegExp(number)}(?![\\d.-]\\d)`
  const atLineStart = new RegExp(`(^|\\n)[ \\t]*(?:\\d+[ \\t]+)?(${name})(?=\\s*[–—:\\-.]|\\s+[A-Z(])`, 'gu')
  for (const match of text.matchAll(atLineStart)) {
    const at = match.index + match[0].length - match[2]!.length
    if (!isTocLine(lineAround(text, at))) return [at, at + match[2]!.length]
  }
  const withSeparator = new RegExp(`(${name})\\s*[–—:\\-]`, 'gu')
  for (const match of text.matchAll(withSeparator)) {
    if (!isTocLine(lineAround(text, match.index))) return [match.index, match.index + match[1]!.length]
  }
  return null
}

/** 쪽 글자에서 절 제목 줄("5.1.9.3 Target Reset Action")을 찾는다 */
export function findSectionHeading(text: string, number: string): readonly [number, number] | null {
  const pattern = new RegExp(`(^|\\n)[ \\t]*(${escapeRegExp(number)})\\.?[ \\t]+\\S`, 'gu')
  for (const match of text.matchAll(pattern)) {
    const at = match.index + match[1]!.length
    const line = lineAround(text, at)
    if (isTocLine(line)) continue
    return [at, at + line.trim().length]
  }
  return null
}

/** 목차에서 그 절 번호로 시작하는 항목 */
export function findOutlineSection(outline: readonly GotoOutlineEntry[], number: string): number | null {
  const pattern = new RegExp(`^\\s*${escapeRegExp(number)}(?:\\.?\\s|\\.?$)`, 'u')
  return outline.find((entry) => entry.page !== null && pattern.test(entry.title))?.page ?? null
}

/** 읽을 쪽 순서: near 가 있으면 near, near+1, near-1, near+2 … 처럼 바깥으로 */
export function scanOrder(pageCount: number, near?: number): number[] {
  if (near === undefined || near < 0 || near >= pageCount) return Array.from({ length: pageCount }, (_, index) => index)
  const order = [near]
  for (let step = 1; order.length < pageCount; step += 1) {
    if (near + step < pageCount) order.push(near + step)
    if (near - step >= 0) order.push(near - step)
  }
  return order
}

/**
 * 목표를 쪽(과 글자 범위)으로 바꾼다. 쪽 글자는 필요한 만큼만 앞에서부터 읽는다.
 * 절은 목차를 먼저 보고, 찾은 쪽에서 제목 줄 범위를 덧붙인다.
 */
export async function resolveGoto(
  target: GotoTarget,
  source: {
    readonly pageCount: number
    readonly outline: () => Promise<readonly GotoOutlineEntry[]>
    readonly pageText: (pageIndex: number) => Promise<string>
    /** 이 쪽 둘레부터 찾는다(본문의 "Table 53" 은 대개 가까이 있다). 없으면 앞에서부터 */
    readonly nearPage?: number
  },
): Promise<GotoHit | null> {
  if (target.kind === 'page') {
    if (target.page < 1 || target.page > source.pageCount) return null
    return { pageIndex: target.page - 1 }
  }
  if (target.kind === 'section') {
    const fromOutline = await source.outline().then((outline) => findOutlineSection(outline, target.number)).catch(() => null)
    if (fromOutline !== null) {
      const text = await source.pageText(fromOutline).catch(() => '')
      const range = findSectionHeading(text, target.number)
      return range === null ? { pageIndex: fromOutline } : { pageIndex: fromOutline, range }
    }
  }
  // 쪽 글자는 여덟 쪽씩 함께 읽는다(한 쪽 10ms 남짓이라 500쪽 문서도 1초 안팎). 앞쪽 결과가 먼저다.
  const BATCH = 8
  const order = scanOrder(source.pageCount, source.nearPage)
  for (let start = 0; start < order.length; start += BATCH) {
    const indexes = order.slice(start, start + BATCH)
    const texts = await Promise.all(indexes.map((index) => source.pageText(index).catch(() => '')))
    for (const [offset, text] of texts.entries()) {
      const range = target.kind === 'caption'
        ? findCaption(text, target.label, target.number)
        : findSectionHeading(text, target.number)
      if (range !== null) return { pageIndex: indexes[offset]!, range }
    }
  }
  return null
}
