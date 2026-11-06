import { t } from '../i18n'
import type { PdfSearchMatch } from './pdfSearch'

/** 목차의 한 줄(0-기반 쪽). bridge 의 PdfOutlineEntry 와 같은 모양 */
export interface SearchOutlineEntry {
  readonly title: string
  readonly page: number | null
  readonly depth: number
}

export interface SearchResultGroup {
  readonly key: string
  /** 절 제목. 목차가 없거나 앞쪽이면 null */
  readonly title: string | null
  /** 목차·색인 쪽에서 찾은 것(점선 줄). 본문이 아니라 기본으로 접는다 */
  readonly toc: boolean
  readonly items: readonly { readonly match: PdfSearchMatch; readonly index: number }[]
}

/** 목차 줄의 점선(….. 12) */
const LEADER = /(?:\.\s?){4,}|…{2,}|·{4,}/u

/** 찾은 곳이 목차·색인 줄인가: 앞뒤 글에 점선이 있다 */
export function isTocHit(match: Pick<PdfSearchMatch, 'before' | 'after'>): boolean {
  const near = `${match.before.slice(-30)}${match.after.slice(0, 40)}`
  return LEADER.test(near)
}

function tidy(text: string): string {
  return text
    .replace(/[■□▪●◆◼]/gu, ' ')
    .replace(/(?:\.\s?){3,}|…+|·{3,}/gu, ' … ')
    .replace(/\s+/gu, ' ')
}

/** 찾은 낱말 앞에 보일 글 길이. 한 줄 반쯤이라 무슨 문장인지 알 수 있다 */
const SNIPPET_HEAD = 72
/** 뒤에 보일 글 길이. 화면에서는 몇 줄로 다시 접는다 */
const SNIPPET_TAIL = 150

/**
 * 결과에 보일 앞뒤 글. 앞은 문장 앞부분이 보일 만큼, 뒤는 더 길게 둔다.
 * 잘린 낱말 조각과 글머리표·점선은 걷어 낸다.
 */
export function cleanSnippet(before: string, after: string): { readonly before: string; readonly after: string } {
  let head = tidy(before)
  // 앞 글은 낱말 경계에서 시작한다(잘린 첫 낱말은 버린다)
  if (before.length > 0 && !/^\s/u.test(before)) head = head.replace(/^\S+\s?/u, '')
  head = head.trimStart()
  if (head.length > SNIPPET_HEAD) {
    const cut = head.slice(-SNIPPET_HEAD)
    const space = cut.indexOf(' ')
    head = space >= 0 && space < cut.length - 1 ? cut.slice(space + 1) : cut
    head = `…${head}`
  }
  let tail = tidy(after)
  if (after.length > 0 && !/\s$/u.test(after)) tail = tail.replace(/\s?\S+$/u, '')
  if (tail.length > SNIPPET_TAIL) tail = `${tail.slice(0, SNIPPET_TAIL).replace(/\s?\S*$/u, '')}…`
  return { before: head.replace(/^\s*…\s*$/u, ''), after: tail.trimEnd() }
}

/** 이 쪽을 덮는 절: 쪽이 그 쪽 이하인 목차 줄 중 마지막(같은 쪽이면 더 깊은 것) */
function sectionOf(page: number, outline: readonly SearchOutlineEntry[]): SearchOutlineEntry | null {
  let found: SearchOutlineEntry | null = null
  for (const entry of outline) {
    if (entry.page === null || entry.page > page) continue
    if (found === null || entry.page > (found.page ?? -1) || (entry.page === found.page && entry.depth >= found.depth)) found = entry
  }
  return found
}

/**
 * 결과를 절별로 묶는다. 문서 차례대로 이어지는 같은 절의 결과가 한 묶음이다.
 * 목차·색인 줄에서 찾은 것은 맨 아래 한 묶음(toc)으로 모은다.
 */
export function groupSearchMatches(
  matches: readonly PdfSearchMatch[],
  outline: readonly SearchOutlineEntry[],
): SearchResultGroup[] {
  const sorted = [...outline].filter((entry) => entry.page !== null).sort((a, b) => (a.page ?? 0) - (b.page ?? 0))
  const groups: { key: string; title: string | null; toc: boolean; items: { match: PdfSearchMatch; index: number }[] }[] = []
  const tocItems: { match: PdfSearchMatch; index: number }[] = []
  matches.forEach((match, index) => {
    if (isTocHit(match)) {
      tocItems.push({ match, index })
      return
    }
    const section = sectionOf(match.page, sorted)
    const key = section === null ? 'front' : `${section.page}:${section.depth}:${section.title}`
    const last = groups.at(-1)
    if (last !== undefined && last.key === key) last.items.push({ match, index })
    else groups.push({ key, title: section?.title.trim() ?? null, toc: false, items: [{ match, index }] })
  })
  // 같은 절이 떨어져 나오면 열쇠가 겹치니 순번을 붙인다
  const seen = new Map<string, number>()
  const unique = groups.map((group) => {
    const count = seen.get(group.key) ?? 0
    seen.set(group.key, count + 1)
    return count === 0 ? group : { ...group, key: `${group.key}#${count}` }
  })
  if (tocItems.length > 0) unique.push({ key: 'toc', title: t('목차·색인'), toc: true, items: tocItems })
  return unique
}
