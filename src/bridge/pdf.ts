/**
 * PDF 이음매. Rust 와 말하는 곳은 여기뿐이다 — window.ts 와 같은 규칙이고,
 * 같은 이유로 import 를 함수 안에서 동적으로 한다(정적 import 면 Tauri 가
 * 없는 브라우저·jsdom 에서 모듈이 로드되는 순간 터진다).
 *
 * 이 파일이 지키는 또 하나는 **URL 을 직접 조립한다**는 것이다.
 * `@tauri-apps/api` 의 `convertFileSrc` 를 쓰면 안 된다 — 그쪽은 인자 전체를
 * `encodeURIComponent` 로 감싸서 `/` 까지 `%2F` 로 바꾸고 질의 문자열을 붙일
 * 자리도 남기지 않는다. 결과는 조각 하나짜리 경로가 되어 Rust 쪽이 모든
 * 페이지에 400 을 돌려준다. 화면에는 "빈 페이지"로만 보이고 원인은 어디에도
 * 안 적혀 있는 고장이라, pdf.test.ts 가 이 모양을 못박아 둔다.
 */

import { isDesktop } from './window'
import { t } from '../i18n'
import { clampRenderWidth } from '../pdf/renderWidth'
import {
  SAMPLE_DOC_ID,
  samplePdfOutline,
  samplePageImageUrl,
  samplePageTextIndex,
} from '../pdf/samplePage'
import type { PageTextIndex } from '../core/textIndex'

/**
 * 쪽 글자(글자마다 상자) 캐시에 들고 있는 쪽 수. 한 쪽이 수백 KB 라, 다 들고 있으면 3000쪽 PDF 를
 * 한 번 검색하는 것만으로 1GB 가 남았다. 최근에 쓴 쪽부터 남긴다.
 */
export const TEXT_INDEX_CACHE_PAGES = 240
const textIndexCache = new Map<string, Promise<PageTextIndex>>()
const outlineCache = new Map<string, Promise<readonly PdfOutlineEntry[]>>()

/**
 * `pdf_open` 이 돌려주는 문서 메타. Rust 쪽 `PdfDocMeta` 가
 * `#[serde(rename_all = "camelCase")]` 라 이름이 그대로 맞는다.
 */
export interface PdfDocMeta {
  /** 파일 내용 SHA-256 앞 12자. 16진수 소문자 12글자다. */
  docId: string
  /** 파일 내용 SHA-256 전체. library.json에서 이동 후에도 동일성을 확인한다. */
  sha256: string
  /** 원본 PDF 바이트 크기. 원본을 vault에 복사하지 않아 레지스트리에 함께 둔다. */
  size: number
  title: string
  pageCount: number
  /** 페이지별 (폭, 높이), 단위는 points. 0-기반 색인이다. */
  pageSizes: readonly (readonly [number, number])[]
  /** false 면 스캔본이다 — 텍스트 발췌가 원천적으로 불가능하다(M5). */
  hasText: boolean
}

export interface PdfOutlineEntry {
  title: string
  /** 0-기반 페이지. 외부 링크처럼 문서 안 목적지가 없으면 null 이다. */
  page: number | null
  depth: number
}

/**
 * 웹뷰가 iwae:// 를 실제로 부를 때의 모양이 플랫폼마다 다르다. Tauri 가
 * 그렇게 만든다 — Windows·Android 는 `http://iwae.localhost`, 그 밖은
 * `iwae://localhost`. 이 판별은 src-tauri/src/protocol.rs 의 문서 주석에
 * 적힌 스니펫을 그대로 옮긴 것이고, 그쪽이 권위다.
 *
 * 모듈 로드 시점이 아니라 부를 때마다 읽는 이유: 테스트가 userAgent 를
 * 갈아 끼워 두 갈래를 모두 밟을 수 있어야 한다. 실제 앱에서는 값이
 * 바뀌지 않으므로 비용도 없다.
 */
function protocolBase(): string {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  return agent.includes('Windows') ? 'http://iwae.localhost' : 'iwae://localhost'
}

/**
 * 한 페이지의 PNG 주소.
 *
 * `docId` 를 인코딩하지 않는다. Rust 가 16진수 12자리만 통과시키므로
 * 인코딩이 막을 것이 없고, 인코딩하면 정상 id 까지 모양이 달라진다.
 * 이상한 값이 들어오면 여기서 삼키지 않고 400/404 로 드러나는 편이 낫다.
 */
export function pageImageUrl(docId: string, page: number, width: number): string {
  // page 는 0-기반이다(Rust·pageSizes 배열 양쪽 모두). 음수·소수는 존재할 수
  // 없는 자리라 요청을 만들기 전에 정수로 바로잡는다.
  const pageIndex = Number.isFinite(page) ? Math.max(0, Math.trunc(page)) : 0
  if (docId === SAMPLE_DOC_ID) return samplePageImageUrl(pageIndex)
  const revision = docRevisions.get(docId)
  return `${protocolBase()}/page/${docId}/${pageIndex}?w=${clampRenderWidth(width)}${revision === undefined ? '' : `&r=${revision}`}`
}

/** src-tauri/src/pdf/engine.rs 의 MAX_TILE_PAGE_WIDTH. 타일 렌더에서 쪽 폭의 상한 */
export const MAX_TILE_PAGE_WIDTH = 40_000

/**
 * 쪽을 `width` px 폭으로 그렸을 때의 사각형(x, y, tileWidth, tileHeight) 하나의 PNG 주소.
 * 큰 확대에서 쪽 전체 대신 보이는 부분만 기기 해상도로 받는 데 쓴다.
 */
export function pageTileUrl(
  docId: string,
  page: number,
  width: number,
  tile: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): string {
  const pageIndex = Number.isFinite(page) ? Math.max(0, Math.trunc(page)) : 0
  if (docId === SAMPLE_DOC_ID) return samplePageImageUrl(pageIndex)
  const revision = docRevisions.get(docId)
  const w = Math.min(Math.max(Math.round(width), 32), MAX_TILE_PAGE_WIDTH)
  return `${protocolBase()}/page/${docId}/${pageIndex}?w=${w}&x=${tile.x}&y=${tile.y}&tw=${tile.width}&th=${tile.height}${revision === undefined ? '' : `&r=${revision}`}`
}

/** 파일 대화상자. 취소하면 null 이다. */
export async function pickPdfFile(): Promise<string | null> {
  // 브라우저·테스트에서는 고를 파일이 없다. 여기서 던지면 `npm run dev` 로
  // 화면만 보는 경로가 오류로 끝난다 — window.ts 와 같은 처리다.
  if (!isDesktop()) return null

  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })

  // multiple: false 면 문자열 아니면 null 이지만, 그 보장은 플러그인 타입에
  // 있고 단언 없이 좁히려면 이렇게 확인하는 편이 짧다.
  return typeof selected === 'string' ? selected : null
}

/**
 * 문서를 연다. 실패(없는 파일·PDF 가 아님)는 Rust 가 문자열 오류로 돌려주고
 * invoke 가 그걸 reject 로 옮긴다 — 여기서 삼키지 않는다. 부르는 쪽이
 * 사용자에게 무엇을 보여줄지 정해야 할 일이다.
 */
/**
 * docId 를 주면 Vault 에 등록된 그 id 로 연다. 쪽 편집으로 파일 내용(해시)이 바뀌어도 형광펜·
 * 책갈피·노트 출처가 같은 문서를 가리키게 하려는 것이다. 새 파일은 비워 두면 내용 해시로 정한다.
 */
export async function openPdf(path: string, docId?: string): Promise<PdfDocMeta> {
  if (!isDesktop()) {
    // pickPdfFile 이 브라우저에서 null 을 주므로 정상 경로로는 여기 오지
    // 않는다. 조용히 가짜 메타를 지어내면 빈 페이지 1,000장이 뜨고 원인을
    // 찾는 데 한참 걸리므로, 오는 경우가 있다면 시끄럽게 실패한다.
    throw new Error(t('PDF 열기는 데스크톱(Tauri) 안에서만 됩니다.'))
  }

  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<PdfDocMeta>('pdf_open', docId === undefined ? { path } : { path, docId })
}

/** 쪽 편집 계획의 한 줄: 새 문서의 이 자리에 어느 문서의 몇 쪽(0-기반)을 얼마나 더 돌려 놓나 */
export interface PdfPageEditOp {
  /** 없으면 편집 중인 문서. 있으면 끼워 넣을 다른 PDF 경로 */
  readonly source?: string
  readonly page: number
  readonly rotate: 0 | 90 | 180 | 270
}

/** 문서가 바뀐 횟수. 쪽 그림 주소에 붙여 예전 그림이 캐시에서 나오지 않게 한다 */
const docRevisions = new Map<string, number>()

/** 편집을 원본에 덮어쓰고 같은 docId 로 다시 연다. 덮기 전 원본은 backup 경로에 남는다 */
export async function editPdfPages(docId: string, path: string, backup: string, plan: readonly PdfPageEditOp[]): Promise<PdfDocMeta> {
  const { invoke } = await import('@tauri-apps/api/core')
  const meta = await invoke<PdfDocMeta>('pdf_edit_pages', { docId, path, backup, plan })
  docRevisions.set(docId, (docRevisions.get(docId) ?? 0) + 1)
  for (const key of [...textIndexCache.keys()]) if (key.startsWith(`${docId}:`)) textIndexCache.delete(key)
  for (const key of [...linkCache.keys()]) if (key.startsWith(`${docId}:`)) linkCache.delete(key)
  outlineCache.delete(docId)
  return meta
}

/**
 * 한 페이지의 텍스트와 글자별 상자. 왕복이 렌더보다 비싸므로 같은 페이지의
 * 진행 중인 요청까지 Promise 자체로 합친다. 실패한 요청은 캐시에서 빼야 파일을
 * 다시 연 뒤 복구할 수 있다.
 */
export function pageTextIndex(docId: string, page: number): Promise<PageTextIndex> {
  const key = `${docId}:${page}`
  const cached = textIndexCache.get(key)
  if (cached !== undefined) {
    // 맨 뒤(가장 최근)로 옮긴다
    textIndexCache.delete(key)
    textIndexCache.set(key, cached)
    return cached
  }

  const request = (async () => {
    if (docId === SAMPLE_DOC_ID) return samplePageTextIndex(page)
    if (!isDesktop()) throw new Error(t('PDF 텍스트 선택은 데스크톱(Tauri) 안에서만 됩니다.'))
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<PageTextIndex>('pdf_page_text', { docId, page })
  })()

  textIndexCache.set(key, request)
  while (textIndexCache.size > TEXT_INDEX_CACHE_PAGES) textIndexCache.delete(textIndexCache.keys().next().value!)
  void request.catch(() => {
    if (textIndexCache.get(key) === request) textIndexCache.delete(key)
  })
  return request
}

/** 열린 PDF의 북마크 트리. 같은 문서는 세션 동안 한 번만 읽는다. */
export function pdfOutline(docId: string): Promise<readonly PdfOutlineEntry[]> {
  const cached = outlineCache.get(docId)
  if (cached !== undefined) return cached

  const request = (async () => {
    if (docId === SAMPLE_DOC_ID) return samplePdfOutline
    if (!isDesktop()) throw new Error(t('PDF 목차는 데스크톱(Tauri) 안에서만 읽을 수 있습니다.'))
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<readonly PdfOutlineEntry[]>('pdf_outline', { docId })
  })()

  outlineCache.set(docId, request)
  void request.catch(() => {
    if (outlineCache.get(docId) === request) outlineCache.delete(docId)
  })
  return request
}

/** 링크 영역. 좌표는 글자 상자와 같은 페이지 좌표계(왼쪽 위 원점, points)다. */
export interface PdfLinkRect {
  x: number
  y: number
  w: number
  h: number
}

export type PdfLinkTarget =
  | { kind: 'page'; /** 0-기반 */ page: number; y: number | null }
  | { kind: 'uri'; uri: string }

export interface PdfLink {
  rect: PdfLinkRect
  target: PdfLinkTarget
}

export interface PdfMetadata {
  title?: string | null
  author?: string | null
  subject?: string | null
  keywords?: string | null
  creationDate?: string | null
}

export interface ImportedPdfAnnotation {
  page: number
  kind: 'highlight' | 'underline' | 'squiggly' | 'strikeout' | 'text'
  rects: PdfLinkRect[]
  color: [number, number, number] | null
  contents: string | null
}

export interface ExportPdfHighlight {
  page: number
  rects: PdfLinkRect[]
  color: [number, number, number]
  note: string | null
}

const linkCache = new Map<string, Promise<readonly PdfLink[]>>()

/** 페이지 하나의 링크. 문서·페이지마다 세션 동안 한 번만 읽는다. */
export function pdfPageLinks(docId: string, page: number): Promise<readonly PdfLink[]> {
  const key = `${docId}:${page}`
  const cached = linkCache.get(key)
  if (cached !== undefined) return cached

  const request = (async () => {
    if (docId === SAMPLE_DOC_ID) return []
    if (!isDesktop()) throw new Error(t('PDF 링크는 데스크톱(Tauri) 안에서만 읽을 수 있습니다.'))
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<readonly PdfLink[]>('pdf_page_links', { docId, page })
  })()

  linkCache.set(key, request)
  void request.catch(() => {
    if (linkCache.get(key) === request) linkCache.delete(key)
  })
  return request
}

/** PDF 문서 정보 사전(제목·저자·만든 날짜). */
export async function pdfMetadata(docId: string): Promise<PdfMetadata> {
  if (docId === SAMPLE_DOC_ID) return {}
  if (!isDesktop()) throw new Error(t('PDF 정보는 데스크톱(Tauri) 안에서만 읽을 수 있습니다.'))
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<PdfMetadata>('pdf_metadata', { docId })
}

/** 다른 프로그램이 문서에 남긴 형광펜·밑줄·붙임 쪽지. */
export async function pdfAnnotations(docId: string): Promise<readonly ImportedPdfAnnotation[]> {
  if (docId === SAMPLE_DOC_ID) return []
  if (!isDesktop()) throw new Error(t('PDF 주석은 데스크톱(Tauri) 안에서만 읽을 수 있습니다.'))
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<readonly ImportedPdfAnnotation[]>('pdf_annotations', { docId })
}

/**
 * 형광펜을 PDF 주석으로 넣은 사본을 저장한다. 저장 위치는 Rust 가 연 대화상자에서
 * 정해진다. 취소하면 null, 저장하면 그 경로.
 */
export async function exportAnnotatedPdf(
  docId: string,
  highlights: readonly ExportPdfHighlight[],
  suggestedName: string,
): Promise<string | null> {
  if (!isDesktop()) throw new Error(t('주석 포함 PDF 내보내기는 데스크톱(Tauri) 안에서만 됩니다.'))
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string | null>('pdf_export_annotated', { docId, highlights, suggestedName })
}

export interface SearchablePdfPage {
  page: number
  lines: { text: string; x: number; y: number; w: number; h: number }[]
}

export interface SearchablePdfExport {
  path: string
  written: number
  skipped: number
}

/** OCR 줄로 보이지 않는 글자 층을 깐 사본을 저장한다. 저장 위치는 Rust 대화상자에서 정한다. 취소하면 null */
export async function exportSearchablePdf(
  docId: string,
  pages: readonly SearchablePdfPage[],
  suggestedName: string,
): Promise<SearchablePdfExport | null> {
  if (!isDesktop()) throw new Error(t('검색 가능한 PDF 만들기는 데스크톱(Tauri) 안에서만 됩니다.'))
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<SearchablePdfExport | null>('pdf_export_searchable', { docId, pages, suggestedName })
}

/** Markdown 을 PDF 로(Edge 헤드리스, 캐시). 만든 PDF 의 절대 경로 */
export async function markdownToPdf(vaultRoot: string, key: string, html: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string>('markdown_to_pdf', { vaultRoot, key, html })
}
