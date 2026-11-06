/**
 * 브라우저 개발 미리보기용 실제 PDF fixture.
 *
 * 원본은 `public/dev-pdf/iwae-web-preview.pdf`이고, PNG와 글자 상자는
 * `src-tauri/tests/export_web_fixture.rs`가 제품과 같은 PDFium 경로로 만든다.
 * 브라우저는 PDFium DLL을 직접 부를 수 없으므로 이 산출물을 읽지만,
 * 가짜 SVG나 손으로 맞춘 선택 상자는 사용하지 않는다.
 */

import fixtureData from './devPdfData.json'
import type { PageTextIndex } from '../core/textIndex'
import type { PdfOutlineEntry } from '../bridge/pdf'

export const SAMPLE_DOC_ID = fixtureData.metadata.docId
export const SAMPLE_TITLE = fixtureData.metadata.title
export const SAMPLE_PAGE_COUNT = fixtureData.metadata.pageCount
export const SAMPLE_HAS_TEXT = fixtureData.metadata.hasText

export const samplePageSizes: readonly (readonly [number, number])[] =
  fixtureData.metadata.pageSizes.map((size) => [size[0] ?? 612, size[1] ?? 792] as const)

const sampleTextIndexes: readonly PageTextIndex[] = fixtureData.pages

export const samplePdfOutline: readonly PdfOutlineEntry[] = fixtureData.outline

export function samplePageImageUrl(page: number): string {
  const pageIndex = Number.isFinite(page) ? Math.max(0, Math.trunc(page)) : 0
  return `/dev-pdf/page-${pageIndex + 1}.png`
}

export function samplePageTextIndex(page: number): PageTextIndex {
  const pageIndex = Number.isFinite(page) ? Math.max(0, Math.trunc(page)) : 0
  const index = sampleTextIndexes[pageIndex]
  if (index === undefined) throw new Error(`개발 PDF 페이지가 범위를 벗어났습니다: ${pageIndex}`)
  return index
}
