import { t } from '../i18n'

export interface PdfBookmark {
  readonly id: string
  readonly docId: string
  readonly page: number
  readonly title: string
  readonly createdAt: string
  /**
   * 쪽 안의 자리(위에서 잰 비율 0–1). 스크롤 막대 옆에 꽂은 핀이 갖는다.
   * 없으면 그 쪽 맨 위(예전 쪽 책갈피)
   */
  readonly y?: number
  /** 핀 머리에 보일 이모지 */
  readonly emoji?: string
}

/** 책갈피 id. 쪽 맨 위면 예전처럼 `<docId>:<쪽>`, 쪽 안의 자리면 `<docId>:<쪽>:<천분율>` */
export function pdfBookmarkId(docId: string, page: number, y?: number): string {
  return y === undefined || y <= 0 ? `${docId}:${page}` : `${docId}:${page}:${Math.round(y * 1000)}`
}

/** 문서 안에서의 차례: 쪽, 그다음 쪽 안의 높이 */
export function pdfBookmarkOrder(left: PdfBookmark, right: PdfBookmark): number {
  return left.docId.localeCompare(right.docId) || left.page - right.page || (left.y ?? 0) - (right.y ?? 0)
}

interface PdfBookmarkFile {
  readonly version: 1
  readonly bookmarks: readonly PdfBookmark[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseBookmark(value: unknown): PdfBookmark {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.docId !== 'string'
    || !Number.isInteger(value.page)
    || (value.page as number) < 0
    || typeof value.title !== 'string'
    || typeof value.createdAt !== 'string') {
    throw new Error(t('PDF 책갈피 데이터가 잘못되었습니다.'))
  }
  const y = typeof value.y === 'number' && Number.isFinite(value.y) && value.y > 0 ? Math.min(value.y, 1) : undefined
  const emoji = typeof value.emoji === 'string' && value.emoji.trim() !== '' ? value.emoji : undefined
  return {
    id: value.id,
    docId: value.docId,
    page: value.page as number,
    title: value.title,
    createdAt: value.createdAt,
    ...(y === undefined ? {} : { y }),
    ...(emoji === undefined ? {} : { emoji }),
  }
}

export function createPdfBookmark(docId: string, page: number, title: string, now = new Date(), y?: number): PdfBookmark {
  if (docId.trim() === '' || !Number.isInteger(page) || page < 0) throw new Error(t('PDF 책갈피 위치가 잘못되었습니다.'))
  const place = y === undefined || !Number.isFinite(y) || y <= 0 ? undefined : Math.min(Math.round(y * 1000) / 1000, 1)
  return {
    id: pdfBookmarkId(docId, page, place),
    docId,
    page,
    title: title.trim() || t('{page}쪽', { page: page + 1 }),
    createdAt: now.toISOString(),
    ...(place === undefined ? {} : { y: place }),
  }
}

export function pdfBookmarkFile(bookmarks: readonly PdfBookmark[]): PdfBookmarkFile {
  return { version: 1, bookmarks }
}

export function parsePdfBookmarks(value: unknown): PdfBookmark[] {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.bookmarks)) {
    throw new Error(t('PDF 책갈피 파일 형식이 잘못되었습니다.'))
  }
  return value.bookmarks.map(parseBookmark).sort(pdfBookmarkOrder)
}
