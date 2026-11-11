/**
 * 글 상자 글꼴. 저장은 짧은 id('batang' 등) 또는 서식 가져오기가 찾은 설치 글꼴 이름 그대로다.
 * 화면은 CSS 글꼴 줄로, 「표시 넣은 사본」은 가까운 PDF 글꼴로 그린다(src-tauri 의 load_overlay_font).
 */
export interface OverlayFontChoice {
  readonly id: string
  /** 목록에 보이는 이름 */
  readonly label: string
  /** CSS font-family */
  readonly css: string
  /** 한글 이름(번역 대상)인가 */
  readonly korean: boolean
}

export const OVERLAY_FONTS: readonly OverlayFontChoice[] = [
  { id: 'batang', label: '바탕(명조)', css: "'Batang', '바탕', 'Noto Serif KR', 'Nanum Myeongjo', serif", korean: true },
  { id: 'gulim', label: '굴림', css: "'Gulim', '굴림', 'Malgun Gothic', sans-serif", korean: true },
  { id: 'dotum', label: '돋움', css: "'Dotum', '돋움', 'Malgun Gothic', sans-serif", korean: true },
  { id: 'gungsuh', label: '궁서', css: "'Gungsuh', '궁서', 'Batang', serif", korean: true },
  { id: 'arial', label: 'Arial', css: "Arial, 'Helvetica Neue', Helvetica, sans-serif", korean: false },
  { id: 'times', label: 'Times New Roman', css: "'Times New Roman', Times, serif", korean: false },
  { id: 'courier', label: 'Courier New', css: "'Courier New', Courier, monospace", korean: false },
]

/** 글꼴을 안 고른(기본) 글 상자의 글꼴: 앱 글꼴 */
export const DEFAULT_OVERLAY_FONT_CSS = "var(--font-ui), 'Segoe UI Variable Text', 'Segoe UI', 'Malgun Gothic', system-ui, sans-serif"
/** 인쇄용 기본 글꼴 줄(CSS 변수를 못 쓴다) */
export const PRINT_DEFAULT_FONT_CSS = "'Segoe UI Variable Text', 'Segoe UI', 'Malgun Gothic', system-ui, sans-serif"

const CUSTOM_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._\-()]{0,59}$/u

/** 저장해도 되는 글꼴 값인가: 알려진 id 또는 설치 글꼴 이름 */
export function isOverlayFont(value: unknown): value is string {
  return typeof value === 'string' && (OVERLAY_FONTS.some((font) => font.id === value) || CUSTOM_NAME.test(value))
}

function quoteFamily(name: string): string {
  return `'${name.replace(/['\\]/gu, '')}'`
}

/** 글 상자 하나의 CSS 글꼴. 안 골랐으면 앱 글꼴 */
export function overlayFontCss(font: string | undefined, fallback: string = DEFAULT_OVERLAY_FONT_CSS): string {
  if (font === undefined || font === '') return fallback
  const known = OVERLAY_FONTS.find((item) => item.id === font)
  if (known !== undefined) return known.css
  return `${quoteFamily(font)}, ${fallback}`
}

/** 목록·풍선에 보일 이름 */
export function overlayFontLabel(font: string | undefined): string | null {
  if (font === undefined || font === '') return null
  return OVERLAY_FONTS.find((item) => item.id === font)?.label ?? font
}
