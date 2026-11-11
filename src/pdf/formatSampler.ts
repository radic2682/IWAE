import { normalizeTextSize, type PdfTextBox } from '../core/pdfOverlays'
import { overlayFontLabel, OVERLAY_FONTS } from '../core/overlayFonts'
import type { CharBox, PageTextIndex } from '../core/textIndex'
import type { ToolStyle } from './overlayToolStore'
import { t } from '../i18n'

/**
 * 「서식 가져오기」(스포이트): 다른 글 상자나 PDF 글자에서 글꼴·크기·색을 읽어 온다.
 * 이 파일은 순수 계산(글꼴 이름 맞추기, 글자 상자 → pt, 색 고르기)과 읽어 온 값을 적용하는 묶음만 둔다.
 * 화면 클릭·PDFium 호출은 PdfPane 이 한다.
 */

/** 읽어 온 서식(없는 칸은 건드리지 않는다) */
export interface SampledStyle {
  /** 글 상자에서 읽었나, PDF 글자에서 읽었나 */
  readonly source: 'box' | 'text' | 'scan'
  readonly size?: number
  readonly color?: string
  readonly bold?: boolean
  /** OVERLAY_FONTS 의 id 또는 설치 글꼴 이름. 빈 문자열 = 기본 글꼴 */
  readonly font?: string
  /** 글 상자에서만: 바탕·테두리 */
  readonly fill?: string
  readonly border?: boolean
  readonly borderColor?: string
}

// ── 글꼴 이름 ──

/** PDF 글꼴 이름에서 부분 글꼴 접두(ABCDEF+)와 굵기·기울임 꼬리를 걷어 낸다 */
export function cleanFontName(raw: string): string {
  let name = raw.trim().replace(/^[A-Z]{6}\+/u, '')
  name = name.replace(/(?:PS)?MT$/u, '')
  name = name.replace(/[,-]?(?:Bold|Italic|Oblique|Regular|Roman|Light|Medium|Semibold|Black|Heavy)+$/iu, '')
  return name.replace(/[,-]+$/u, '').trim()
}

/** 'NanumGothic' → 'Nanum Gothic' */
function spaced(name: string): string {
  return name.replace(/([a-z])([A-Z])/gu, '$1 $2')
}

export interface FontGuess {
  /** OVERLAY_FONTS id, 설치 글꼴 이름, 또는 빈 문자열(기본 글꼴) */
  readonly font: string
  /** 안내문에 보일 이름 */
  readonly label: string
}

/**
 * PDF 글꼴 이름 → 글 상자 글꼴. 알려진 한글·영문 글꼴은 id 로, 그 밖에는 설치돼 있으면 그 이름 그대로,
 * 아니면 바탕체 표시(serif)가 있으면 바탕, 없으면 기본 글꼴.
 */
export function guessOverlayFont(rawName: string, serif: boolean, isInstalled: (name: string) => boolean = () => false): FontGuess {
  const name = cleanFontName(rawName)
  const key = name.toLowerCase().replace(/[\s_-]+/gu, '')
  const known = (id: string): FontGuess => ({ font: id, label: OVERLAY_FONTS.find((font) => font.id === id)?.label ?? id })
  if (key === '') return serif ? known('batang') : { font: '', label: t('기본') }
  if (/gungsuh|궁서/u.test(key)) return known('gungsuh')
  if (!/sans/u.test(key) && /batang|myeongjo|myungjo|명조|바탕|hymj|serif/u.test(key)) return known('batang')
  if (/gulim|굴림/u.test(key)) return known('gulim')
  if (/dotum|돋움/u.test(key)) return known('dotum')
  if (/malgun|맑은/u.test(key)) return { font: '', label: t('기본') }
  if (/timesnewroman|times/u.test(key)) return known('times')
  if (/courier|consolas|monospace|lucidaconsole/u.test(key)) return known('courier')
  if (/arial|helvetica/u.test(key)) return known('arial')
  for (const candidate of new Set([name, spaced(name)])) {
    if (candidate !== '' && isInstalled(candidate)) return { font: candidate, label: candidate }
  }
  return serif ? known('batang') : { font: '', label: t('기본') }
}

/**
 * 글꼴이 이 PC 에 있나. document.fonts.check 는 시스템 글꼴을 가려내지 못해 항상 true 를 주므로,
 * 같은 글자를 그 글꼴과 두 가지 바탕 글꼴로 재어 폭이 하나라도 달라지면 있는 것으로 본다.
 */
export function isFontInstalled(name: string, canvasFactory: () => HTMLCanvasElement | null = () => (typeof document === 'undefined' ? null : document.createElement('canvas'))): boolean {
  const canvas = canvasFactory()
  const context = canvas?.getContext('2d') ?? null
  if (context === null) return false
  const sample = 'mmmmmmmmmmlli가나다라마바사 WwQq1'
  const widthWith = (family: string) => {
    context.font = `72px ${family}`
    return context.measureText(sample).width
  }
  const quoted = `'${name.replace(/['\\]/gu, '')}'`
  return ['monospace', 'serif', 'sans-serif'].some((base) => widthWith(`${quoted}, ${base}`) !== widthWith(base))
}

// ── 글자 크기 ──

/** PDFium 의 느슨한 글자 상자(올라감·내려감 포함)는 글꼴 크기의 대략 1.2 배다 */
export const LOOSE_BOX_RATIO = 1.2
/** 스캔 쪽의 잉크 줄 높이(글자 윗끝~아랫끝)는 글꼴 크기의 대략 0.9 배다 */
export const INK_BAND_RATIO = 0.93

/** PDFium 이 글꼴 크기를 알려 주면 그것, 아니면 글자 상자 높이에서 어림한다. 0.5pt 단위 */
export function glyphSizePt(fontSize: number | null | undefined, boxHeight: number): number | null {
  if (fontSize !== null && fontSize !== undefined && Number.isFinite(fontSize) && fontSize >= 1) return normalizeTextSize(fontSize)
  if (!Number.isFinite(boxHeight) || boxHeight <= 0) return null
  return normalizeTextSize(boxHeight / LOOSE_BOX_RATIO)
}

/** 스캔 쪽: 쪽 그림에서 잰 잉크 줄 높이(쪽 좌표 pt) → 글자 크기 */
export function scanSizePt(bandHeightPt: number): number | null {
  if (!Number.isFinite(bandHeightPt) || bandHeightPt <= 0) return null
  return normalizeTextSize(bandHeightPt / INK_BAND_RATIO)
}

// ── 색 ──

export interface PixelImage {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
}

const lum = (r: number, g: number, b: number) => r * 0.2126 + g * 0.7152 + b * 0.0722
const hex2 = (value: number) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')

/** 가운데 값(바탕): 글자보다 바탕이 훨씬 많다는 가정 */
function backgroundOf(image: PixelImage, left: number, top: number, right: number, bottom: number): { r: number; g: number; b: number } {
  const stepX = Math.max(1, Math.floor((right - left) / 80))
  const stepY = Math.max(1, Math.floor((bottom - top) / 40))
  const samples: { r: number; g: number; b: number; l: number }[] = []
  for (let y = top; y < bottom; y += stepY) {
    for (let x = left; x < right; x += stepX) {
      const i = (y * image.width + x) * 4
      if (image.data[i + 3]! < 128) continue
      const r = image.data[i]!
      const g = image.data[i + 1]!
      const b = image.data[i + 2]!
      samples.push({ r, g, b, l: lum(r, g, b) })
    }
  }
  if (samples.length === 0) return { r: 255, g: 255, b: 255 }
  samples.sort((a, b) => a.l - b.l)
  const mid = samples[Math.floor(samples.length / 2)]!
  return { r: mid.r, g: mid.g, b: mid.b }
}

/**
 * 글자색 고르기: 바탕(가운데 값)과 가장 다른 픽셀들의 평균. 가장자리의 옅은 번짐(안티앨리어싱)은 빼려고
 * 바탕과 가장 먼 쪽 25% 만 쓴다. 글자가 없으면(바탕과 다른 픽셀이 거의 없으면) null.
 */
export function pickInkColor(image: PixelImage, region?: { left: number; top: number; right: number; bottom: number }, background?: { r: number; g: number; b: number }): string | null {
  const left = Math.max(0, Math.floor(region?.left ?? 0))
  const top = Math.max(0, Math.floor(region?.top ?? 0))
  const right = Math.min(image.width, Math.ceil(region?.right ?? image.width))
  const bottom = Math.min(image.height, Math.ceil(region?.bottom ?? image.height))
  if (right - left < 1 || bottom - top < 1 || image.data.length < image.width * image.height * 4) return null
  const bg = background ?? backgroundOf(image, left, top, right, bottom)
  const ink: { r: number; g: number; b: number; d: number }[] = []
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const i = (y * image.width + x) * 4
      if (image.data[i + 3]! < 128) continue
      const r = image.data[i]!
      const g = image.data[i + 1]!
      const b = image.data[i + 2]!
      const d = Math.hypot(r - bg.r, g - bg.g, b - bg.b)
      if (d >= 60) ink.push({ r, g, b, d })
    }
  }
  if (ink.length < 3) return null
  ink.sort((a, b) => b.d - a.d)
  const core = ink.slice(0, Math.max(3, Math.ceil(ink.length * 0.25)))
  const sum = core.reduce((acc, p) => ({ r: acc.r + p.r, g: acc.g + p.g, b: acc.b + p.b }), { r: 0, g: 0, b: 0 })
  return `#${hex2(sum.r / core.length)}${hex2(sum.g / core.length)}${hex2(sum.b / core.length)}`
}

/**
 * 스캔 쪽: 눌린 자리(cx, cy: 그림 픽셀)에 걸친 글자 줄 하나의 잉크 높이(픽셀)와 글자색.
 * 눌린 높이에서 가까운 잉크 줄을 찾아 위아래로 넓힌다.
 */
export function sampleInkBandAt(image: PixelImage, cy: number): { bandHeight: number; top: number; bottom: number; color: string | null } | null {
  const { width, height, data } = image
  if (width < 12 || height < 5 || data.length < width * height * 4) return null
  const bg = backgroundOf(image, 0, 0, width, height)
  const bgLum = lum(bg.r, bg.g, bg.b)
  const minimumInk = Math.max(2, Math.ceil(width * 0.01))
  const active: boolean[] = []
  for (let y = 0; y < height; y += 1) {
    let count = 0
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      if (data[i + 3]! < 128) continue
      if (Math.abs(lum(data[i]!, data[i + 1]!, data[i + 2]!) - bgLum) >= 38) count += 1
    }
    active.push(count >= minimumInk)
  }
  const row = Math.min(height - 1, Math.max(0, Math.round(cy)))
  let found = -1
  const reach = Math.floor(height * 0.4)
  for (let d = 0; d <= reach && found < 0; d += 1) {
    if (active[row + d] === true) found = row + d
    else if (active[row - d] === true) found = row - d
  }
  if (found < 0) return null
  let top = found
  let bottom = found
  // 한 줄 틈(i·j 점, 획 사이)은 건너뛴다
  while (top > 0 && (active[top - 1] === true || active[top - 2] === true)) top -= active[top - 1] === true ? 1 : 2
  while (bottom < height - 1 && (active[bottom + 1] === true || active[bottom + 2] === true)) bottom += active[bottom + 1] === true ? 1 : 2
  const bandHeight = bottom - top + 1
  if (bandHeight < 3 || bandHeight > height * 0.9) return null
  return { bandHeight, top, bottom, color: pickInkColor(image, { left: 0, top, right: width, bottom: bottom + 1 }, bg) }
}

// ── PDF 글자 찾기 ──

/** 쪽 좌표 점 → 그 점을 품은(없으면 2pt 안에서 가장 가까운) 글자 번호 */
export function charIndexUnder(index: PageTextIndex, point: { x: number; y: number }, slop = 2): number | null {
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < index.chars.length; i += 1) {
    const box = index.chars[i]
    if (box === undefined || box.w <= 0 || box.h <= 0 || box.c.trim() === '') continue
    const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.w))
    const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.h))
    const distance = Math.hypot(dx, dy)
    if (distance <= slop && distance < bestDistance) {
      best = i
      bestDistance = distance
    }
  }
  return best
}

/** 그 글자와 같은 줄에서 가까운 글자들의 상자를 합친 네모(색을 잴 자리). 한 글자만으로는 획이 너무 적다 */
export function lineNeighbourhood(index: PageTextIndex, at: number, reach = 4): { x: number; y: number; w: number; h: number } | null {
  const center = index.chars[at]
  if (center === undefined) return null
  let left = center.x
  let right = center.x + center.w
  const top = center.y
  const bottom = center.y + center.h
  const sameLine = (box: CharBox | undefined): box is CharBox => box !== undefined && box.w > 0 && Math.abs(box.y - top) < center.h * 0.4 && Math.abs(box.h - center.h) < center.h * 0.5 && box.c.trim() !== ''
  for (let step = 1; step <= reach; step += 1) {
    const before = index.chars[at - step]
    const after = index.chars[at + step]
    if (sameLine(before)) left = Math.min(left, before.x)
    if (sameLine(after)) right = Math.max(right, after.x + after.w)
  }
  return { x: left, y: top, w: right - left, h: bottom - top }
}

// ── 적용 ──

/** 글 상자 → 읽어 온 서식(전부) */
export function styleOfTextBox(box: PdfTextBox): SampledStyle {
  return {
    source: 'box',
    size: box.size,
    color: box.color,
    bold: box.bold === true,
    font: box.font ?? '',
    fill: box.fill ?? 'none',
    border: box.border === true,
    borderColor: box.borderColor ?? '',
  }
}

/** 고른 글 상자에 거는 패치(읽은 칸만) */
export function overlayPatchOf(sampled: SampledStyle): Partial<PdfTextBox> {
  const patch: { -readonly [K in keyof PdfTextBox]?: PdfTextBox[K] } = {}
  if (sampled.size !== undefined) patch.size = sampled.size
  if (sampled.color !== undefined) patch.color = sampled.color
  if (sampled.bold !== undefined) patch.bold = sampled.bold ? true : undefined
  if (sampled.font !== undefined) patch.font = sampled.font === '' ? undefined : sampled.font
  if (sampled.fill !== undefined) patch.fill = sampled.fill === 'none' ? undefined : sampled.fill
  if (sampled.border !== undefined) patch.border = sampled.border ? true : undefined
  if (sampled.borderColor !== undefined) patch.borderColor = sampled.borderColor === '' ? undefined : sampled.borderColor
  return patch
}

/** 새로 만들 글 상자의 서식(도구 서식)에 거는 패치(읽은 칸만) */
export function toolPatchOf(sampled: SampledStyle): Partial<ToolStyle> {
  const patch: { -readonly [K in keyof ToolStyle]?: ToolStyle[K] } = {}
  if (sampled.size !== undefined) patch.textSize = sampled.size
  if (sampled.color !== undefined) patch.color = sampled.color
  if (sampled.bold !== undefined) patch.bold = sampled.bold
  if (sampled.font !== undefined) patch.textFont = sampled.font
  if (sampled.fill !== undefined) patch.textFill = sampled.fill
  if (sampled.border !== undefined) patch.border = sampled.border
  if (sampled.borderColor !== undefined) patch.textBorderColor = sampled.borderColor
  return patch
}

/** 「서식을 가져왔습니다 (12 pt · 바탕)」 */
export function sampledSummary(sampled: SampledStyle): string {
  const parts: string[] = []
  if (sampled.size !== undefined) parts.push(`${sampled.size} pt`)
  if (sampled.font !== undefined) parts.push(overlayFontLabel(sampled.font) ?? t('기본 글꼴'))
  return parts.length === 0 ? t('서식을 가져왔습니다') : t('서식을 가져왔습니다 ({detail})', { detail: parts.join(' · ') })
}
