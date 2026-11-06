/**
 * 최근에 연 Vault 밖 PDF(탐색기에서 IWAE 로 연 것). 이 PC 의 경로라 Vault 가 아니라 이 PC 저장소에 둔다.
 * 새로 연 것이 앞, 같은 경로는 하나만, 최대 MAX 개.
 */
export interface RecentPdf {
  readonly path: string
  readonly title: string
  /** ISO 시각 */
  readonly openedAt: string
}

const KEY = 'iwae:recent-external-pdfs:v1'
const MAX = 20

export function samePath(left: string, right: string): boolean {
  return left.replaceAll('\\', '/').toLowerCase() === right.replaceAll('\\', '/').toLowerCase()
}

export function parseRecentPdfs(value: unknown): RecentPdf[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return []
    const { path, title, openedAt } = item as Record<string, unknown>
    return typeof path === 'string' && typeof title === 'string' && typeof openedAt === 'string' ? [{ path, title, openedAt }] : []
  }).slice(0, MAX)
}

export function readRecentPdfs(): RecentPdf[] {
  try {
    return parseRecentPdfs(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
  } catch {
    return []
  }
}

export function addRecentPdf(list: readonly RecentPdf[], entry: RecentPdf): RecentPdf[] {
  return [entry, ...list.filter((item) => !samePath(item.path, entry.path))].slice(0, MAX)
}

export function removeRecentPdf(list: readonly RecentPdf[], path: string): RecentPdf[] {
  return list.filter((item) => !samePath(item.path, path))
}

export function writeRecentPdfs(list: readonly RecentPdf[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // 저장이 막힌 환경에서는 이번 실행 동안만
  }
}

/** 목록에 보일 날짜: 오늘이면 시:분, 올해면 월.일, 아니면 연.월.일 */
export function recentPdfDate(openedAt: string, now: Date = new Date()): string {
  const date = new Date(openedAt)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  if (date.toDateString() === now.toDateString()) return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}.${date.getDate()}`
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`
}
