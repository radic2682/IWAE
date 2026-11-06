/**
 * 인쇄할 쪽 범위 "1-5, 8, 10-" 를 0-기반 쪽 번호 목록으로. 쪽 수를 넘는 것은 자르고,
 * 읽을 수 없는 조각이 있거나 남는 쪽이 없으면 null.
 */
export function parsePageRange(text: string, pageCount: number): number[] | null {
  const parts = text.split(/[,\s]+/u).filter((part) => part !== '')
  if (parts.length === 0 || pageCount <= 0) return null
  const pages = new Set<number>()
  for (const part of parts) {
    const match = /^(\d+)?\s*(-)?\s*(\d+)?$/u.exec(part)
    if (match === null || (match[1] === undefined && match[3] === undefined)) return null
    const from = match[1] === undefined ? 1 : Number(match[1])
    const to = match[2] === undefined ? from : match[3] === undefined ? pageCount : Number(match[3])
    if (from < 1 || to < from) return null
    for (let page = from; page <= Math.min(to, pageCount); page++) pages.add(page - 1)
  }
  return pages.size === 0 ? null : [...pages].sort((a, b) => a - b)
}
