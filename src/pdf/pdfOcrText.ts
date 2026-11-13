import { pageImageUrl } from '../bridge/pdf'
import { recognizeImageLines, recognizeImageText } from './ocrTextDetector'
import { ocrItemsToLines, type SearchableLine } from '../core/ocrLines'
import { t } from '../i18n'

type PageFetch = (url: string) => Promise<{
  readonly ok: boolean
  readonly status: number
  blob(): Promise<Blob>
}>

export async function recognizePdfPageText(
  docId: string,
  page: number,
  fetchPage: PageFetch = fetch,
): Promise<string> {
  const url = pageImageUrl(docId, page, 1800)
  const response = await fetchPage(url)
  if (!response.ok) throw new Error(t('PDF OCR 쪽 그리기 실패: {status}', { status: response.status }))
  const text = await recognizeImageText(await response.blob())
  if (text === null) throw new Error(t('PDF OCR 엔진을 사용할 수 없습니다.'))
  return text
}

/** OCR 에 쓰는 렌더 폭(px). 줄 상자를 페이지 points 로 되돌릴 때 이 값으로 나눈다 */
const OCR_RENDER_WIDTH = 1800

/**
 * 페이지 한 장을 OCR 해 줄마다의 글자와 상자(페이지 points, 왼쪽 위 원점)를 얻는다.
 * 검색 가능한 PDF 사본의 보이지 않는 글자 층을 만들 때 쓴다.
 */
export async function recognizePdfPageLines(
  docId: string,
  page: number,
  pageWidth: number,
  fetchPage: PageFetch = fetch,
): Promise<SearchableLine[]> {
  const url = pageImageUrl(docId, page, OCR_RENDER_WIDTH)
  const response = await fetchPage(url)
  if (!response.ok) throw new Error(t('PDF OCR 쪽 그리기 실패: {status}', { status: response.status }))
  const items = await recognizeImageLines(await response.blob())
  if (items === null) throw new Error(t('PDF OCR 엔진을 사용할 수 없습니다.'))
  return ocrItemsToLines(items, pageWidth / OCR_RENDER_WIDTH)
}
