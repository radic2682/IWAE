/**
 * 작은 색 계산 모음(OKLab 섞기·대비·밝기 이동). 사용자 지정 테마와 강조색에서 나머지 색을 계산하는 데 쓴다.
 * 외부 라이브러리 없이 sRGB ↔ OKLab 변환만 직접 한다.
 */

export interface Rgb { readonly r: number; readonly g: number; readonly b: number }
export interface Rgba extends Rgb { readonly a: number }
export interface Oklab { readonly L: number; readonly a: number; readonly b: number }

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))
const clamp255 = (value: number): number => Math.min(255, Math.max(0, value))

/** #rgb · #rrggbb · #rrggbbaa. 그 밖의 글자는 null */
export function parseColor(text: string): Rgba | null {
  const raw = text.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]+$/.test(raw)) return null
  if (raw.length === 3 || raw.length === 4) {
    const d = [...raw].map((ch) => parseInt(ch + ch, 16))
    return { r: d[0] ?? 0, g: d[1] ?? 0, b: d[2] ?? 0, a: d[3] === undefined ? 1 : d[3] / 255 }
  }
  if (raw.length === 6 || raw.length === 8) {
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
      a: raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1,
    }
  }
  return null
}

/** 입력칸용: "#abc" "abc" "ABCDEF" 를 "#aabbcc" 로. 알파는 받지 않는다 */
export function normalizeHex(text: string): string | null {
  const raw = text.trim().replace(/^#/, '')
  if (!/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) return null
  const parsed = parseColor(raw)
  return parsed === null ? null : toHex(parsed)
}

const hex2 = (value: number): string => Math.round(clamp255(value)).toString(16).padStart(2, '0')

export function toHex(color: Rgb): string {
  return `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`
}

/** 알파가 1 보다 작으면 #rrggbbaa */
export function toCss(color: Rgb, alpha = 1): string {
  return alpha >= 0.999 ? toHex(color) : `${toHex(color)}${hex2(alpha * 255)}`
}

const toLinear = (channel: number): number => {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}
const fromLinear = (value: number): number => {
  const v = clamp01(value)
  return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)
}

export function toOklab(color: Rgb): Oklab {
  const r = toLinear(color.r)
  const g = toLinear(color.g)
  const b = toLinear(color.b)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

export function fromOklab(lab: Oklab): Rgb {
  const l = (lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3
  const m = (lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3
  const s = (lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  }
}

/** a 에서 b 쪽으로 amount(0~1) 만큼, 지각 색 공간(OKLab)에서 섞는다 */
export function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  const x = toOklab(a)
  const y = toOklab(b)
  const t = clamp01(amount)
  return fromOklab({ L: x.L + (y.L - x.L) * t, a: x.a + (y.a - x.a) * t, b: x.b + (y.b - x.b) * t })
}

/** 밝기(OKLab L)만 delta 만큼 옮긴다. 색상·채도는 그대로 */
export function shiftL(color: Rgb, delta: number): Rgb {
  const lab = toOklab(color)
  const L = Math.min(1, Math.max(0, lab.L + delta))
  // 밝기가 바뀌면 채도가 범위를 넘을 수 있어 단계적으로 줄여 가며 맞춘다
  let scale = 1
  for (let i = 0; i < 8; i++) {
    const out = fromOklabRaw({ L, a: lab.a * scale, b: lab.b * scale })
    if (inGamut(out)) return fromOklab({ L, a: lab.a * scale, b: lab.b * scale })
    scale *= 0.85
  }
  return fromOklab({ L, a: lab.a * scale, b: lab.b * scale })
}

function fromOklabRaw(lab: Oklab): Rgb {
  const l = (lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3
  const m = (lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3
  const s = (lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  }
}
const inGamut = (c: Rgb): boolean => [c.r, c.g, c.b].every((v) => v >= -0.002 && v <= 1.002)

/** 두 색의 지각 거리(OKLab 유클리드). 0.02 안쪽이면 눈으로 거의 같다 */
export function distance(a: Rgb, b: Rgb): number {
  const x = toOklab(a)
  const y = toOklab(b)
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b)
}

export function lightness(color: Rgb): number {
  return toOklab(color).L
}

/** WCAG 상대 휘도 */
export function luminance(color: Rgb): number {
  return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b)
}

/** WCAG 대비 비율(1~21) */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/**
 * fg 가 bg 위에서 min 대비를 채울 때까지 밝기만 옮긴다(배경이 밝으면 어둡게, 어두우면 밝게).
 * 이미 충분하면 그대로. 끝까지 가도 모자라면 가장 가까운 값을 돌려준다.
 */
export function ensureContrast(fg: Rgb, bg: Rgb, min: number): Rgb {
  if (contrastRatio(fg, bg) >= min) return fg
  const toward = luminance(bg) > 0.4 ? -1 : 1
  let best = fg
  for (let step = 1; step <= 40; step++) {
    best = shiftL(fg, toward * step * 0.025)
    if (contrastRatio(best, bg) >= min) return best
  }
  return best
}

/** 이 색 위에 올릴 글자색: 흰색과 어두운 먹색 중 대비가 큰 쪽 */
export function readableOn(background: Rgb, light: Rgb, dark: Rgb): Rgb {
  return contrastRatio(light, background) >= contrastRatio(dark, background) ? light : dark
}

export const WHITE: Rgb = { r: 255, g: 255, b: 255 }
export const BLACK: Rgb = { r: 0, g: 0, b: 0 }
