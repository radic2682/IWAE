/** 한 줄에 놓는 쪽 수: 한 장 · 두 장 · 세 장 */
export type PdfSpread = 'single' | 'double' | 'triple'

/** 한 줄에 놓는 쪽 수 */
export function spreadColumns(spread: PdfSpread): number {
  return spread === 'triple' ? 3 : spread === 'double' ? 2 : 1
}

/** 보는 사람 취향이라 Vault 가 아니라 이 PC 의 브라우저 저장소에 둔다 */
export interface PdfViewPrefs {
  readonly spread: PdfSpread
  /** 어두운 테마에서 흰 페이지가 눈부시지 않게 색을 뒤집는다(배경 「야간」) */
  readonly invert: boolean
  /** false 면 넘겨 보기(한 화면에 한 쪽/한 쌍). 없으면 연속 보기 */
  readonly continuous?: boolean
  /** 페이지 배경 색조: 양피지·눈 보호. 없으면 기본 */
  readonly tone?: PdfTone
  /** 깨끗이 보기: 형광펜·메모 줄·책갈피 핀 등 내가 단 표시를 PDF 위에서 모두 감춘다 */
  readonly clean?: boolean
}

export type PdfTone = 'none' | 'sepia' | 'green'
/** 하단 막대 ☀ 의 배경 모드. 야간 = 색 반전 */
export type PdfBackground = 'normal' | 'night' | PdfTone

export function backgroundOf(prefs: PdfViewPrefs): PdfBackground {
  if (prefs.invert) return 'night'
  return prefs.tone === undefined || prefs.tone === 'none' ? 'normal' : prefs.tone
}

export function withBackground(prefs: PdfViewPrefs, background: PdfBackground): PdfViewPrefs {
  if (background === 'night') return { ...prefs, invert: true, tone: 'none' }
  return { ...prefs, invert: false, tone: background === 'normal' ? 'none' : background }
}

export type PdfRotation = 0 | 90 | 180 | 270

export const DEFAULT_PDF_VIEW_PREFS: PdfViewPrefs = { spread: 'single', invert: false }

const KEY = 'iwae:pdf-view'

export function readPdfViewPrefs(): PdfViewPrefs {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PDF_VIEW_PREFS
    const value = parsed as Record<string, unknown>
    if ((value.spread !== 'single' && value.spread !== 'double' && value.spread !== 'triple') || typeof value.invert !== 'boolean') {
      return DEFAULT_PDF_VIEW_PREFS
    }
    const continuous = typeof value.continuous === 'boolean' ? value.continuous : undefined
    const tone = value.tone === 'sepia' || value.tone === 'green' || value.tone === 'none' ? value.tone : undefined
    return {
      spread: value.spread,
      invert: value.invert,
      ...(continuous === undefined ? {} : { continuous }),
      ...(tone === undefined ? {} : { tone }),
      ...(value.clean === true ? { clean: true } : {}),
    }
  } catch {
    return DEFAULT_PDF_VIEW_PREFS
  }
}

export function writePdfViewPrefs(prefs: PdfViewPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // 저장이 막힌 환경에서는 이번 세션 동안만 유지된다.
  }
}

export function nextRotation(rotation: PdfRotation): PdfRotation {
  return ((rotation + 90) % 360) as PdfRotation
}
