/**
 * 형광펜 색의 단일 출처.
 * 색은 {id, name, fill} 목록이고, 목록 순서가 선택 순서이며 첫 색이 새 형광펜의 기본 색이다.
 * 카드 탭·테두리·연결선·메모 점·인용 바탕 같은 "역할별 색"은 fill 하나에서 계산한다.
 * 기본 4색(yellow·green·blue·pink)은 예전과 한 픽셀도 다르지 않도록 값을 그대로 적어 두고, 새로 만든 색만 계산한다.
 * 문서에는 색의 id 만 저장되므로, 목록에서 지운 색의 id 도 데이터에 남고 화면에서만 「기타」 색으로 보인다.
 */

import { t } from '../i18n'

export interface HighlightColorDef {
  /** 문서에 저장되는 이름표. 기본 4색은 yellow|green|blue|pink, 새 색은 c_xxxxxx */
  readonly id: string
  readonly name: string
  /** 대표 색(#rrggbb). 색 선택 단추·고르는 칸에 보이는 색 */
  readonly fill: string
  /** 카드 탭·연결선의 진한 색을 직접 정하고 싶을 때(없으면 fill 에서 계산) */
  readonly ink?: string
}

export const MAX_HIGHLIGHT_COLORS = 8
export const MAX_HIGHLIGHT_NAME_LENGTH = 20
export const OTHER_HIGHLIGHT_NAME = '기타'

export const DEFAULT_HIGHLIGHT_COLORS: readonly HighlightColorDef[] = [
  { id: 'yellow', name: '노랑', fill: '#ffd60a' },
  { id: 'green', name: '초록', fill: '#4cd47a' },
  { id: 'blue', name: '파랑', fill: '#5aa9ff' },
  { id: 'pink', name: '분홍', fill: '#ff6fa8' },
]

/** 한 색이 쓰이는 자리별 값(CSS 변수 --hlc-* 로 나간다) */
export interface HighlightRoles {
  /** 캔버스 발췌 형광 칠(반투명) */
  readonly fill: string
  /** 흰 글자가 읽히는 진한 색: 카드 탭·연결선·캔버스 연결선 */
  readonly ink: string
  /** 색 선택 단추의 꽉 찬 색 */
  readonly solid: string
  /** 메모 카드 앞 점 */
  readonly dot: string
  /** 메모 카드 인용 바탕(반투명) */
  readonly quote: string
  /** 웨일 테마에서 더 옅은 인용 바탕 */
  readonly wash: string
  /** PDF·Markdown 형광 테두리, 박스 메모 색 */
  readonly edge: string
  /** PDF·Markdown 형광 칠(옅은 색) */
  readonly soft: string
  /** PDF 형광펜 상자의 색 단추 */
  readonly pdfSwatch: string
  /** 노트 창 형광펜 색 단추 */
  readonly paneSwatch: string
  /** 본문 글 형광(반투명, 팝오버 인용·Markdown 본문) */
  readonly text: string
  /** 본문 글 형광을 얼마나 진하게 쓸지(color-mix 비율) */
  readonly textMix: string
  /** 노트 블록 안 인용 바탕을 흰색과 섞는 비율(웨일 테마) */
  readonly noteMix: string
}

/** 기본 4색의 값(예전 color-tokens.css 의 리터럴 그대로) */
const BUILTIN_ROLES: Readonly<Record<string, HighlightRoles>> = {
  yellow: {
    fill: 'rgb(255 214 0 / 46%)', ink: '#b8911a', solid: '#ffd60a', dot: '#f2c418', quote: 'rgb(255 214 0 / 26%)', wash: 'rgb(255 214 0 / 13%)',
    edge: '#e3b43c', soft: '#ffe38c', pdfSwatch: '#f7db61', paneSwatch: '#ffd84d', text: 'rgb(255 226 94 / 46%)', textMix: '56%', noteMix: '55%',
  },
  green: {
    fill: 'rgb(70 214 110 / 40%)', ink: '#2f9358', solid: '#4cd47a', dot: '#3fc06f', quote: 'rgb(70 214 110 / 22%)', wash: 'rgb(70 214 110 / 12%)',
    edge: '#4fb06c', soft: '#b9ebc6', pdfSwatch: '#80d4a5', paneSwatch: '#7ed69a', text: 'rgb(111 220 146 / 42%)', textMix: '48%', noteMix: '60%',
  },
  blue: {
    fill: 'rgb(80 165 255 / 38%)', ink: '#2f78c4', solid: '#5aa9ff', dot: '#4b9cf0', quote: 'rgb(80 165 255 / 20%)', wash: 'rgb(80 165 255 / 12%)',
    edge: '#5d9be3', soft: '#c3defc', pdfSwatch: '#8bbce8', paneSwatch: '#8ec5ff', text: 'rgb(93 177 255 / 40%)', textMix: '44%', noteMix: '65%',
  },
  pink: {
    fill: 'rgb(255 105 165 / 38%)', ink: '#c4467c', solid: '#ff6fa8', dot: '#f0609e', quote: 'rgb(255 105 165 / 18%)', wash: 'rgb(255 105 165 / 11%)',
    edge: '#de6f9c', soft: '#fcc6dc', pdfSwatch: '#e9a3bc', paneSwatch: '#ff9fc6', text: 'rgb(255 126 181 / 40%)', textMix: '46%', noteMix: '60%',
  },
}

/** 목록에 없는 색(지운 색의 id)이 보이는 중립색 */
export const OTHER_HIGHLIGHT_FILL = '#9aa0a6'

// ───────────── 색 계산(WCAG 대비, OKLCH) ─────────────

export type Rgb = readonly [number, number, number]

/** #rgb·#rrggbb → [0-255 ×3]. 잘못된 글은 null */
export function parseHex(value: string): Rgb | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (match === null) return null
  const hex = match[1]!.length === 3 ? [...match[1]!].map((c) => c + c).join('') : match[1]!
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
}

/** 소문자 #rrggbb 로 맞춘다. 잘못되면 null */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const rgb = parseHex(value)
  return rgb === null ? null : toHex(rgb)
}

const lin = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }

/** WCAG 상대 휘도 */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
}

/** WCAG 대비 비(1~21) */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

type Oklch = readonly [number, number, number] // L, C, h(rad)

function toOklch(rgb: Rgb): Oklch {
  const [r, g, b] = [lin(rgb[0]), lin(rgb[1]), lin(rgb[2])]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, B), Math.atan2(B, A)]
}

function fromOklch([L, C, h]: Oklch): Rgb {
  const A = C * Math.cos(h)
  const B = C * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const gam = (v: number): number => { const c = Math.min(1, Math.max(0, v)); return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) }
  return [
    gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

/** 흰 글자(#fff)와의 대비가 4.5 이상이 될 때까지 OKLCH 밝기를 낮춘 색. 이미 충분하면 그대로 */
export function inkFromFill(fill: string): string {
  const rgb = parseHex(fill) ?? parseHex(OTHER_HIGHLIGHT_FILL)!
  const white: Rgb = [255, 255, 255]
  if (contrastRatio(rgb, white) >= 4.5) return toHex(rgb)
  const [L, C, h] = toOklch(rgb)
  let lo = 0
  let hi = L
  // 밝기만 낮추면 채도가 색 영역을 넘으므로 이진 탐색으로 통과하는 가장 밝은 L 을 찾는다
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2
    if (contrastRatio(fromOklch([mid, C, h]), white) >= 4.5) lo = mid
    else hi = mid
  }
  let out = fromOklch([lo, C, h])
  // 반올림 때문에 4.499 가 되는 경우를 막는다
  for (let step = 0; step < 40 && contrastRatio(parseHex(toHex(out))!, white) < 4.5; step += 1) out = fromOklch([lo - 0.002 * (step + 1), C, h])
  return toHex(out)
}

/** a 와 b 를 sRGB 로 섞는다(amountB: b 의 비율 0~1) */
export function mixHex(a: string, b: string, amountB: number): string {
  const x = parseHex(a) ?? [0, 0, 0]
  const y = parseHex(b) ?? [0, 0, 0]
  return toHex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * amountB) as unknown as Rgb)
}

function alphaOf(hex: string, alpha: number): string {
  const rgb = parseHex(hex) ?? [0, 0, 0]
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${Math.round(alpha * 100)}%)`
}

/** 본문 글 형광의 반투명 칠. 어두운 화면에서는 배경이 어두워 같은 농도가 더 밝게 보이므로 조금 옅게 */
export function translucentFill(fill: string, scheme: 'light' | 'dark'): string {
  return alphaOf(normalizeHex(fill) ?? OTHER_HIGHLIGHT_FILL, scheme === 'dark' ? 0.34 : 0.42)
}

/** 새 색(또는 기본색을 바꾼 것)의 역할별 값을 대표 색 하나에서 만든다 */
export function deriveRoles(fillInput: string, inkOverride?: string): HighlightRoles {
  const fill = normalizeHex(fillInput) ?? OTHER_HIGHLIGHT_FILL
  const ink = normalizeHex(inkOverride) ?? inkFromFill(fill)
  return {
    fill: translucentFill(fill, 'light'),
    ink,
    solid: fill,
    dot: mixHex(fill, ink, 0.2),
    quote: alphaOf(fill, 0.24),
    wash: alphaOf(fill, 0.12),
    edge: mixHex(fill, ink, 0.5),
    soft: mixHex(fill, '#ffffff', 0.58),
    pdfSwatch: mixHex(fill, '#ffffff', 0.35),
    paneSwatch: mixHex(fill, '#ffffff', 0.27),
    text: alphaOf(fill, 0.44),
    textMix: '50%',
    noteMix: '60%',
  }
}

const BUILTIN_FILL: Readonly<Record<string, string>> = Object.fromEntries(DEFAULT_HIGHLIGHT_COLORS.map((c) => [c.id, c.fill]))

/** 한 색의 역할별 값. 기본색을 그대로 둔 것은 예전 값 그대로, 나머지는 계산 */
export function rolesOf(def: HighlightColorDef): HighlightRoles {
  const builtin = BUILTIN_ROLES[def.id]
  if (builtin !== undefined && def.ink === undefined && normalizeHex(def.fill) === BUILTIN_FILL[def.id]) return builtin
  return deriveRoles(def.fill, def.ink)
}

// ───────────── 목록 읽기·고치기 ─────────────

const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

export function isHighlightColorId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** 저장된 값에서 목록을 읽는다. 잘못된 항목은 건너뛰고, 아무것도 남지 않으면 기본 4색 */
export function parseHighlightColors(value: unknown): readonly HighlightColorDef[] {
  if (!Array.isArray(value)) return DEFAULT_HIGHLIGHT_COLORS
  const seen = new Set<string>()
  const out: HighlightColorDef[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const { id, name, fill, ink } = item as Record<string, unknown>
    const hex = normalizeHex(fill)
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || seen.has(id) || hex === null) continue
    seen.add(id)
    const cleanName = typeof name === 'string' ? name.trim().slice(0, MAX_HIGHLIGHT_NAME_LENGTH) : ''
    const inkHex = normalizeHex(ink)
    out.push({ id, name: cleanName === '' ? OTHER_HIGHLIGHT_NAME : cleanName, fill: hex, ...(inkHex === null ? {} : { ink: inkHex }) })
    if (out.length >= MAX_HIGHLIGHT_COLORS) break
  }
  return out.length === 0 ? DEFAULT_HIGHLIGHT_COLORS : out
}

/** 새 색의 id(c_ + 6자). 이미 쓰는 id 와 겹치지 않게 한다 */
export function newHighlightColorId(existing: readonly string[], random: () => number = Math.random): string {
  for (;;) {
    const id = `c_${Array.from({ length: 6 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)]).join('')}`
    if (!existing.includes(id)) return id
  }
}

/** 색 이름이 비면 안 되므로 비었을 때의 이름 */
export function colorNameOrDefault(name: string): string {
  const trimmed = name.trim().slice(0, MAX_HIGHLIGHT_NAME_LENGTH)
  return trimmed === '' ? '색' : trimmed
}

/** id 로 색을 찾는다. 목록에 없으면 undefined(= 「기타」로 그린다) */
export function findHighlightColor(colors: readonly HighlightColorDef[], id: string | undefined): HighlightColorDef | undefined {
  return id === undefined ? undefined : colors.find((color) => color.id === id)
}

/**
 * 색 하나의 화면 이름. 기본 id 와 기본 한국어 이름 그대로인 색은 지금 언어로 번역해 보이고,
 * 사용자가 이름을 바꾼 색(또는 새로 만든 색)은 쓴 그대로 보인다. 저장된 이름은 건드리지 않는다.
 */
export function highlightColorDisplayName(color: HighlightColorDef): string {
  const isDefault = DEFAULT_HIGHLIGHT_COLORS.some((preset) => preset.id === color.id && preset.name === color.name)
  return isDefault ? t(color.name) : color.name
}

/** 화면에 쓰는 이름(저장된 이름 그대로). 없는 색은 「기타」 */
export function highlightColorName(colors: readonly HighlightColorDef[], id: string | undefined): string {
  return findHighlightColor(colors, id)?.name ?? OTHER_HIGHLIGHT_NAME
}

/** 사람이 읽는 이름(기본 이름은 번역된다). 목록에 없는 색은 「기타」 */
export function highlightColorLabel(colors: readonly HighlightColorDef[], id: string | undefined): string {
  const color = findHighlightColor(colors, id)
  return color === undefined ? t(OTHER_HIGHLIGHT_NAME) : highlightColorDisplayName(color)
}

/** 외부(MCP 등)가 준 색 이름·id 를 id 로. 모르면 undefined */
export function highlightColorIdFromInput(colors: readonly HighlightColorDef[], value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const wanted = value.trim().toLowerCase()
  return (colors.find((color) => color.id.toLowerCase() === wanted) ?? colors.find((color) => color.name.toLowerCase() === wanted))?.id
}

/** 새 형광펜의 기본 색(목록의 첫 색) */
export function defaultHighlightColorId(colors: readonly HighlightColorDef[]): string {
  return colors[0]?.id ?? 'yellow'
}

/** id 가 목록에 있으면 그 id, 아니면 기본 색 */
export function knownHighlightColorId(colors: readonly HighlightColorDef[], id: string | undefined): string {
  return findHighlightColor(colors, id)?.id ?? defaultHighlightColorId(colors)
}

// ───────────── CSS ─────────────

const ROLE_VARS: readonly (readonly [keyof HighlightRoles, string])[] = [
  ['fill', '--hlc-fill'], ['ink', '--hlc-ink'], ['solid', '--hlc-solid'], ['dot', '--hlc-dot'], ['quote', '--hlc-quote'],
  ['wash', '--hlc-wash'], ['edge', '--hlc-edge'], ['soft', '--hlc-soft'], ['pdfSwatch', '--hlc-pdf-swatch'],
  ['paneSwatch', '--hlc-pane-swatch'], ['text', '--hlc-text'], ['textMix', '--hlc-text-mix'], ['noteMix', '--hlc-note-mix'],
]

function declarations(roles: HighlightRoles): string {
  return ROLE_VARS.map(([key, name]) => `${name}:${roles[key]}`).join(';')
}

/**
 * <style id="iwae-highlight-colors"> 에 들어가는 글.
 * :root 는 data-hl 이 없는 자리의 기본 색(첫 색), [data-hl] 은 목록에 없는 id 가 받는 「기타」 색, [data-hl="id"] 는 목록의 색.
 * 선택자에 들어가는 id 는 parseHighlightColors 가 [A-Za-z0-9_-] 로만 허용한다.
 */
export function highlightCssRules(colors: readonly HighlightColorDef[]): string {
  // :root 는 data-hl 이 없는 자리(기본 색을 쓰는 곳)의 기본값 = 목록의 첫 색
  const first = colors[0] ?? DEFAULT_HIGHLIGHT_COLORS[0]!
  const rules = [`:root{${declarations(rolesOf(first))}}`, `[data-hl]{${declarations(deriveRoles(OTHER_HIGHLIGHT_FILL))}}`]
  for (const color of colors) {
    if (!ID_PATTERN.test(color.id)) continue
    const roles = rolesOf(color)
    rules.push(`[data-hl="${color.id}"]{${declarations(roles)}}`)
    if (roles === BUILTIN_ROLES[color.id]) continue
    // 계산한 색만 어두운 화면용 반투명 칠을 따로 둔다(기본 4색은 예전처럼 두 화면이 같다)
    rules.push(`:root[data-theme='dark'] [data-hl="${color.id}"]{--hlc-fill:${translucentFill(color.fill, 'dark')}}`)
  }
  return rules.join('\n')
}

/** 캔버스 연결선처럼 요소에 data-hl 을 달 수 없는 곳에서 쓰는, id 별 진한 색 */
export function highlightInkOf(colors: readonly HighlightColorDef[], id: string | undefined): string {
  const color = findHighlightColor(colors, id)
  return color === undefined ? deriveRoles(OTHER_HIGHLIGHT_FILL).ink : rolesOf(color).ink
}

// ───────────── PDF 내보내기·가져오기 ─────────────

/** 기본 4색이 PDF 주석으로 나가고 들어올 때의 RGB(예전부터 쓰던 값, 화면의 색과 조금 다르다) */
const BUILTIN_PDF_RGB: Readonly<Record<string, Rgb>> = {
  yellow: [255, 226, 77],
  green: [110, 200, 120],
  blue: [90, 160, 245],
  pink: [245, 120, 185],
}

/** 한 색이 PDF 주석에서 갖는 RGB(0~255). 기본색을 그대로 둔 것은 예전 값 */
export function pdfRgbOf(def: HighlightColorDef): Rgb {
  const builtin = BUILTIN_PDF_RGB[def.id]
  if (builtin !== undefined && def.ink === undefined && normalizeHex(def.fill) === BUILTIN_FILL[def.id]) return builtin
  return parseHex(def.fill) ?? builtin ?? [255, 226, 77]
}

/** 내보낼 PDF 형광펜의 RGB(0~255). 목록에 없는 색은 첫 색 */
export function highlightExportRgb(colors: readonly HighlightColorDef[], id: string | undefined): [number, number, number] {
  const known = findHighlightColor(colors, id) ?? colors[0] ?? DEFAULT_HIGHLIGHT_COLORS[0]!
  const rgb = pdfRgbOf(known)
  return [rgb[0], rgb[1], rgb[2]]
}

/** 가져온 PDF 형광펜 RGB(0~255)와 가장 가까운 색의 id. 색을 알 수 없으면 첫 색 */
export function nearestColorId(colors: readonly HighlightColorDef[], rgb: Rgb | null): string {
  const list = colors.length > 0 ? colors : DEFAULT_HIGHLIGHT_COLORS
  if (rgb === null) return list[0]!.id
  let best = list[0]!.id
  let bestDistance = Infinity
  for (const color of list) {
    const c = pdfRgbOf(color)
    const distance = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2
    if (distance < bestDistance) { bestDistance = distance; best = color.id }
  }
  return best
}

// ───────────── 설정 화면의 목록 고치기(순수 함수) ─────────────

/** 새 색을 만들 때 차례로 권하는 색(이미 쓰는 색은 건너뛴다) */
export const SUGGESTED_HIGHLIGHT_FILLS: readonly string[] = ['#c7a8ff', '#ffa94d', '#4dd0e1', '#b6e35a', '#ff7a7a', '#8f9bff', '#f2c6a0', '#7de0c1']

export function addHighlightColor(colors: readonly HighlightColorDef[], fill?: string, random: () => number = Math.random): readonly HighlightColorDef[] {
  if (colors.length >= MAX_HIGHLIGHT_COLORS) return colors
  const used = new Set(colors.map((color) => color.fill.toLowerCase()))
  const picked = normalizeHex(fill) ?? SUGGESTED_HIGHLIGHT_FILLS.find((candidate) => !used.has(candidate)) ?? SUGGESTED_HIGHLIGHT_FILLS[0]!
  return [...colors, { id: newHighlightColorId(colors.map((color) => color.id), random), name: '새 색', fill: picked }]
}

export function renameHighlightColor(colors: readonly HighlightColorDef[], id: string, name: string): readonly HighlightColorDef[] {
  return colors.map((color) => color.id === id ? { ...color, name: name.slice(0, MAX_HIGHLIGHT_NAME_LENGTH) } : color)
}

/** 대표 색을 바꾼다. 직접 정해 둔 진한 색(ink)은 새 색과 어울리지 않으므로 버린다 */
export function recolorHighlightColor(colors: readonly HighlightColorDef[], id: string, fill: string): readonly HighlightColorDef[] {
  const hex = normalizeHex(fill)
  if (hex === null) return colors
  return colors.map((color) => color.id === id ? { id: color.id, name: color.name, fill: hex } : color)
}

/** 마지막 한 색은 지울 수 없다(새 형광펜의 기본 색이 있어야 한다) */
export function removeHighlightColor(colors: readonly HighlightColorDef[], id: string): readonly HighlightColorDef[] {
  if (colors.length <= 1) return colors
  return colors.filter((color) => color.id !== id)
}

export function moveHighlightColor(colors: readonly HighlightColorDef[], from: number, to: number): readonly HighlightColorDef[] {
  if (from < 0 || from >= colors.length || to < 0 || to >= colors.length || from === to) return colors
  const next = [...colors]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

/** 형광펜 목록에서 색별 개수(목록에 없는 색은 키가 없다) */
export function countByHighlightColor(highlights: readonly { readonly color: string }[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const { color } of highlights) counts.set(color, (counts.get(color) ?? 0) + 1)
  return counts
}
