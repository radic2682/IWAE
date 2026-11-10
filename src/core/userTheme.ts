import { t } from '../i18n'
import {
  BLACK,
  WHITE,
  contrastRatio,
  ensureContrast,
  lightness,
  mix,
  normalizeHex,
  parseColor,
  readableOn,
  shiftL,
  toCss,
  toHex,
  type Rgb,
} from './colorMath'

/**
 * 사용자 지정 테마: 핵심 색 8개(시드)만 고르면 나머지(호버·선택·테두리 단계·글자 단계·그림자)는 여기서 계산한다.
 * 계산 결과는 :root 인라인 CSS 변수로 덮이므로 CSS 쪽에는 색을 따로 쓰지 않는다(color-literals.test.ts).
 */

export type Brightness = 'light' | 'dark'
export type BasePaletteId = 'whale' | 'default' | 'paper' | 'navy'

export const SEED_KEYS = ['workspace', 'panel', 'tabstrip', 'field', 'text', 'divider', 'accent', 'memoCard'] as const
export type SeedKey = (typeof SEED_KEYS)[number]
export type ThemeSeeds = Readonly<Record<SeedKey, string>>

export interface UserTheme {
  readonly id: string
  readonly name: string
  /** 시드로 정하지 않은 색(위험·성공 색 등)과 data-palette 를 이어받는 내장 색 구성 */
  readonly base: BasePaletteId
  readonly light: ThemeSeeds
  readonly dark: ThemeSeeds
  /** 테마 폴더(.iwae/themes)의 파일 이름. 있으면 폴더에서 온 테마(파일이 원본이라 앱에서 고치거나 지우지 않는다) */
  readonly file?: string
}

export const BASE_PALETTE_IDS: readonly BasePaletteId[] = ['whale', 'default', 'paper', 'navy']

/** 설정 화면 표시용 이름·설명(한국어). 번역은 호출하는 쪽에서 t() 로 */
export const SEED_INFO: Readonly<Record<SeedKey, { readonly label: string; readonly hint: string }>> = {
  workspace: { label: '작업 공간 바탕', hint: '문서 뒤, 칸 사이' },
  panel: { label: '패널', hint: '왼쪽 바, 노트 바, 대화상자' },
  tabstrip: { label: '탭 줄', hint: '맨 위 줄' },
  field: { label: '입력칸', hint: '검색칸, 선택칸' },
  text: { label: '글자', hint: '' },
  divider: { label: '구분선', hint: '' },
  accent: { label: '강조색', hint: '' },
  memoCard: { label: '메모 카드', hint: '노트 바의 카드 바탕' },
}

/* ── 내장 색 구성의 시드: app-themes.css / tokens.css 의 값에서 읽은 것 ── */
export const BUILTIN_SEEDS: Readonly<Record<BasePaletteId, Record<Brightness, ThemeSeeds>>> = {
  whale: {
    light: { workspace: '#ececec', panel: '#f6f6f6', tabstrip: '#e3e3e3', field: '#ececed', text: '#1f1f1f', divider: '#d4d4d4', accent: '#1f7ae0', memoCard: '#f6f6f6' },
    dark: { workspace: '#232324', panel: '#393939', tabstrip: '#191919', field: '#282829', text: '#e1e1e1', divider: '#4c4c4c', accent: '#6fbdff', memoCard: '#f6f6f6' },
  },
  default: {
    light: { workspace: '#f1f2f3', panel: '#f7f7f6', tabstrip: '#f7f7f6', field: '#ffffff', text: '#1a1a1a', divider: '#d0d0cb', accent: '#2f6fb0', memoCard: '#f6f6f6' },
    dark: { workspace: '#171a1e', panel: '#24282d', tabstrip: '#24282d', field: '#1d2024', text: '#e7e9ec', divider: '#464e57', accent: '#79addd', memoCard: '#f6f6f6' },
  },
  paper: {
    light: { workspace: '#e9e2d1', panel: '#f3ede0', tabstrip: '#f3ede0', field: '#fcfaf4', text: '#2b2620', divider: '#d3c7ae', accent: '#9a5b2b', memoCard: '#f6f6f6' },
    dark: { workspace: '#1b1916', panel: '#292620', tabstrip: '#292620', field: '#22201c', text: '#ece4d6', divider: '#4d473c', accent: '#dba46c', memoCard: '#f6f6f6' },
  },
  navy: {
    light: { workspace: '#e3e8f2', panel: '#f1f4f9', tabstrip: '#f1f4f9', field: '#fbfcfe', text: '#18213a', divider: '#c6cfdf', accent: '#2f55b8', memoCard: '#f6f6f6' },
    dark: { workspace: '#0e1424', panel: '#19213b', tabstrip: '#19213b', field: '#141c30', text: '#e3e8f4', divider: '#37456b', accent: '#8fb0ff', memoCard: '#f6f6f6' },
  },
}

function rgb(hex: string, fallback: Rgb = BLACK): Rgb {
  return parseColor(hex) ?? fallback
}

/** 시드 8개 → 앱이 쓰는 CSS 변수 전체. 같은 입력이면 늘 같은 출력 */
export function deriveThemeVars(seeds: ThemeSeeds, mode: Brightness): Record<string, string> {
  const dark = mode === 'dark'
  const workspace = rgb(seeds.workspace)
  const panel = rgb(seeds.panel)
  const tabstrip = rgb(seeds.tabstrip)
  const field = rgb(seeds.field)
  const text = rgb(seeds.text)
  const divider = rgb(seeds.divider)
  const accent = rgb(seeds.accent)
  const memo = rgb(seeds.memoCard)
  const extreme = dark ? WHITE : BLACK

  const paper = dark ? panel : mix(panel, WHITE, 0.8)
  const chromeActive = dark ? shiftL(panel, 0.045) : paper
  const chromeHover = shiftL(panel, dark ? 0.08 : -0.055)
  const fieldHover = shiftL(field, dark ? 0.03 : -0.03)
  const dividerStrong = mix(divider, text, dark ? 0.16 : 0.2)
  const hairline = mix(divider, paper, 0.35)
  const textStrong = mix(text, extreme, dark ? 0.55 : 0.4)
  // 회색 글자를 쓰지 않는다: 단계는 글자색에서 패널 쪽으로 조금만 옮긴다
  const textDim = mix(text, panel, 0.25)
  const textMuted = mix(text, panel, 0.1)

  const vars: Record<string, string> = {
    '--workspace': toHex(workspace),
    '--paper': toHex(paper),
    '--chrome': toHex(panel),
    '--chrome-active': toHex(chromeActive),
    '--chrome-hover': toHex(chromeHover),
    '--tabstrip': toHex(tabstrip),
    '--field': toHex(field),
    '--field-hover': toHex(fieldHover),
    '--ink': toHex(text),
    '--text': toHex(text),
    '--text-strong': toHex(textStrong),
    '--text-dim': toHex(textDim),
    '--text-muted': toHex(textMuted),
    '--divider': toHex(divider),
    '--divider-strong': toHex(dividerStrong),
    '--hairline': toHex(hairline),
    '--control-surface-floating': toCss(panel, dark ? 0.95 : 0.94),
    '--control-surface-expanded': toCss(panel, 0.98),
    '--control-border-floating': toCss(dividerStrong, 0.92),
    '--control-border-floating-hover': toHex(mix(dividerStrong, text, 0.3)),
    '--shadow-soft': dark ? 'rgb(0 0 0 / 50%)' : 'rgb(0 0 0 / 12%)',
    '--shadow-floating': dark ? 'rgb(0 0 0 / 45%)' : 'rgb(0 0 0 / 12%)',
    ...deriveAccentCore(accent, dark ? 'dark' : 'light', panel),
    ...deriveMemoCardVars(memo),
  }
  // 늘 밝은 칸(노트 바 카드)이 쓰는 강조색: 다크에서는 같은 색을 흰 종이에서 읽히게 어둡힌다
  vars["--accent-light"] = toHex(dark ? ensureContrast(accent, WHITE, ACCENT_MIN_CONTRAST) : accent)
  return vars
}

function deriveAccentCore(accent: Rgb, mode: Brightness, panel: Rgb): Record<string, string> {
  const dark = mode === 'dark'
  return {
    '--accent': toHex(accent),
    '--source-edge': toHex(shiftL(accent, 0.03)),
    '--selection': toCss(dark ? mix(accent, panel, 0.25) : accent, 0.4),
    '--accent-contrast': toHex(readableOn(accent, WHITE, rgb('#0c1118'))),
  }
}

/** 메모 카드 시드 → 카드 바탕·그 안의 글자·구분선(노트 바의 카드는 앱 밝기와 상관없이 이 값만 쓴다) */
function deriveMemoCardVars(memo: Rgb): Record<string, string> {
  const lightCard = lightness(memo) >= 0.55
  const extreme = lightCard ? BLACK : WHITE
  const ink = mix(memo, extreme, 0.86)
  const strong = mix(memo, extreme, 0.94)
  const muted = mix(memo, extreme, 0.68)
  return {
    '--memo-card': toHex(memo),
    '--memo-card-hover': toHex(mix(memo, extreme, 0.06)),
    '--card-light-paper': toHex(lightCard ? mix(memo, WHITE, 0.65) : shiftL(memo, 0.03)),
    '--card-light-ink': toHex(ink),
    '--card-light-strong': toHex(strong),
    '--card-light-muted': toHex(muted),
    '--card-light-divider': toHex(mix(memo, extreme, 0.12)),
    '--card-light-hover': toHex(mix(memo, extreme, 0.07)),
    '--card-light-quote-bg': toHex(mix(memo, extreme, 0.05)),
    '--card-light-glyph': toHex(ink),
    '--card-light-text': toHex(strong),
    '--card-light-dim': toHex(muted),
  }
}

export const ACCENT_MIN_CONTRAST = 4.5

/** 직접 고른 강조색 하나에서 밝기별 강조색·원문 선·선택색·버튼 글자색을 만든다 */
export function deriveAccentVars(hex: string, mode: Brightness, panelHex: string): Record<string, string> {
  const base = rgb(normalizeHex(hex) ?? '#2f6fb0')
  const panel = rgb(panelHex)
  const accent = ensureContrast(base, panel, ACCENT_MIN_CONTRAST)
  return {
    ...deriveAccentCore(accent, mode, panel),
    // 늘 밝은 칸(노트 바 카드)이 쓰는 값: 흰 종이 위에서 읽히게
    '--accent-light': toHex(ensureContrast(base, WHITE, ACCENT_MIN_CONTRAST)),
  }
}

/** 강조색이 패널 위에서 읽히는 정도(설정 화면 배지) */
export function accentContrast(hex: string, panelHex: string): { readonly ratio: number; readonly ok: boolean } {
  const ratio = contrastRatio(rgb(normalizeHex(hex) ?? hex), rgb(panelHex))
  return { ratio, ok: ratio >= ACCENT_MIN_CONTRAST }
}

export interface ContrastCheck {
  readonly id: 'text-panel' | 'text-workspace' | 'divider-panel' | 'accent-panel'
  readonly label: string
  readonly ratio: number
  readonly min: number
  readonly ok: boolean
}

export function contrastChecks(seeds: ThemeSeeds): ContrastCheck[] {
  const entry = (id: ContrastCheck['id'], label: string, fg: string, bg: string, min: number): ContrastCheck => {
    const ratio = contrastRatio(rgb(fg), rgb(bg))
    return { id, label, ratio, min, ok: ratio >= min }
  }
  return [
    entry('text-panel', '글자 / 패널', seeds.text, seeds.panel, 4.5),
    entry('text-workspace', '글자 / 작업 공간', seeds.text, seeds.workspace, 4.5),
    entry('divider-panel', '구분선 / 패널', seeds.divider, seeds.panel, 1.2),
    entry('accent-panel', '강조색 / 패널', seeds.accent, seeds.panel, 3),
  ]
}

/** 지금 화면에 깔린 패널 색(강조색 대비 계산용) */
export function resolvePanelColor(base: BasePaletteId, theme: UserTheme | null, mode: Brightness): string {
  return (theme?.[mode] ?? BUILTIN_SEEDS[base][mode]).panel
}

/* ── 만들기·복제·이름 ── */
export function newThemeId(): string {
  return `ut-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function themeFromPalette(base: BasePaletteId, name: string): UserTheme {
  return { id: newThemeId(), name, base, light: { ...BUILTIN_SEEDS[base].light }, dark: { ...BUILTIN_SEEDS[base].dark } }
}

/** 같은 이름이 있으면 " (2)", " (3)"… 을 붙인다 */
export function uniqueThemeName(name: string, taken: readonly string[]): string {
  const clean = name.trim() || '내 테마'
  if (!taken.includes(clean)) return clean
  for (let n = 2; n < 1000; n++) if (!taken.includes(`${clean} (${n})`)) return `${clean} (${n})`
  return clean
}

export const THEME_NAME_MAX = 30

function parseSeeds(value: unknown, where: string): ThemeSeeds | string {
  if (typeof value !== 'object' || value === null) return t('{where} 색 묶음({key})이 없습니다.', { where: t(where), key: where === '라이트' ? 'light' : 'dark' })
  const out: Record<string, string> = {}
  for (const key of SEED_KEYS) {
    const raw = (value as Record<string, unknown>)[key]
    if (raw === undefined) return t('{where} 색 「{label}」({key})이 빠져 있습니다.', { where: t(where), label: t(SEED_INFO[key].label), key })
    const hex = typeof raw === 'string' ? normalizeHex(raw) : null
    if (hex === null) return t('{where} 「{label}」({key}) 값이 #rrggbb 색이 아닙니다: {value}', { where: t(where), label: t(SEED_INFO[key].label), key, value: JSON.stringify(raw) })
    out[key] = hex
  }
  return out as ThemeSeeds
}

export type ThemeParseResult = { readonly ok: true; readonly theme: UserTheme } | { readonly ok: false; readonly error: string }

/** 저장된 테마 하나(또는 가져온 파일의 theme)를 검사한다. 새 id 를 주려면 id 인자로 */
export function parseUserTheme(value: unknown, id?: string): ThemeParseResult {
  if (typeof value !== 'object' || value === null) return { ok: false, error: t('테마 파일 모양이 아닙니다.') }
  const raw = value as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, THEME_NAME_MAX) : ''
  if (name === '') return { ok: false, error: t('테마 이름이 없습니다.') }
  const base = BASE_PALETTE_IDS.find((candidate) => candidate === raw.base)
  if (base === undefined) return { ok: false, error: t('바탕 색 구성을 알 수 없습니다.') }
  const light = parseSeeds(raw.light, '라이트')
  if (typeof light === 'string') return { ok: false, error: light }
  const dark = parseSeeds(raw.dark, '다크')
  if (typeof dark === 'string') return { ok: false, error: dark }
  const themeId = id ?? (typeof raw.id === 'string' && /^[\w-]{1,60}$/.test(raw.id) ? raw.id : newThemeId())
  return { ok: true, theme: { id: themeId, name, base, light, dark } }
}
