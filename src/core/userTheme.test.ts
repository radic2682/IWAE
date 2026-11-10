import { describe, expect, it } from 'vitest'
import { contrastRatio, distance, ensureContrast, mix, normalizeHex, parseColor, toHex } from './colorMath'
import {
  BASE_PALETTE_IDS,
  BUILTIN_SEEDS,
  SEED_KEYS,
  accentContrast,
  contrastChecks,
  deriveAccentVars,
  deriveThemeVars,
  parseThemeFile,
  serializeThemeFile,
  themeFromPalette,
  uniqueThemeName,
} from './userTheme'

const c = (hex: string | undefined) => parseColor(hex ?? '')!

describe('colorMath', () => {
  it('hex 를 읽고 되돌린다', () => {
    expect(toHex(c('#1f7ae0'))).toBe('#1f7ae0')
    expect(normalizeHex('ABC')).toBe('#aabbcc')
    expect(normalizeHex('#12345')).toBeNull()
    expect(normalizeHex('zzzzzz')).toBeNull()
  })
  it('흑백 대비는 21:1', () => {
    expect(contrastRatio(c('#000000'), c('#ffffff'))).toBeCloseTo(21, 0)
  })
  it('ensureContrast 는 모자란 색만 어둡게/밝게 옮긴다', () => {
    const onWhite = ensureContrast(c('#ff8a5c'), c('#ffffff'), 4.5)
    expect(contrastRatio(onWhite, c('#ffffff'))).toBeGreaterThanOrEqual(4.5)
    const onDark = ensureContrast(c('#ff8a5c'), c('#393939'), 4.5)
    expect(toHex(onDark)).toBe('#ff8a5c')
  })
  it('mix 0/1 은 양 끝', () => {
    expect(distance(mix(c('#102030'), c('#f0e0d0'), 0), c('#102030'))).toBeLessThan(0.003)
    expect(distance(mix(c('#102030'), c('#f0e0d0'), 1), c('#f0e0d0'))).toBeLessThan(0.003)
  })
})

describe('deriveThemeVars', () => {
  it('같은 입력은 같은 출력이다', () => {
    const seeds = BUILTIN_SEEDS.whale.dark
    expect(deriveThemeVars(seeds, 'dark')).toEqual(deriveThemeVars(seeds, 'dark'))
  })

  it('시드 8개를 그대로 쓰는 변수가 있다', () => {
    const seeds = { workspace: '#1b221e', panel: '#2f3a33', tabstrip: '#141a16', field: '#232b26', text: '#e4ece6', divider: '#43514a', accent: '#7fd6a4', memoCard: '#f1f4f2' }
    const vars = deriveThemeVars(seeds, 'dark')
    expect(vars['--workspace']).toBe('#1b221e')
    expect(vars['--chrome']).toBe('#2f3a33')
    expect(vars['--tabstrip']).toBe('#141a16')
    expect(vars['--field']).toBe('#232b26')
    expect(vars['--text']).toBe('#e4ece6')
    expect(vars['--divider']).toBe('#43514a')
    expect(vars['--accent']).toBe('#7fd6a4')
    expect(vars['--memo-card']).toBe('#f1f4f2')
    expect(vars['--selection']).toMatch(/^#[0-9a-f]{6}66$/)
  })

  it('글자 단계는 글자색 가까이에 있다(회색 글자 없음)', () => {
    for (const mode of ['light', 'dark'] as const) {
      for (const id of BASE_PALETTE_IDS) {
        const seeds = BUILTIN_SEEDS[id][mode]
        const vars = deriveThemeVars(seeds, mode)
        const panel = c(seeds.panel)
        for (const key of ['--text-strong', '--text-dim', '--text-muted']) {
          expect(contrastRatio(c(vars[key]), panel), `${id} ${mode} ${key}`).toBeGreaterThanOrEqual(4.5)
        }
        expect(distance(c(vars['--text-dim']), c(seeds.text)), `${id} ${mode} dim`).toBeLessThan(0.2)
      }
    }
  })

  it('내장 팔레트의 시드로 계산하면 그 팔레트의 값과 비슷하다', () => {
    // app-themes.css 의 실제 값(웨일) — 눈으로 거의 같아야 한다(OKLab 거리)
    const whaleDark = deriveThemeVars(BUILTIN_SEEDS.whale.dark, 'dark')
    const whaleLight = deriveThemeVars(BUILTIN_SEEDS.whale.light, 'light')
    const near = (actual: string | undefined, expected: string, max: number, label: string) =>
      expect(distance(c(actual), c(expected)), label).toBeLessThan(max)
    near(whaleDark['--chrome-active'], '#454545', 0.04, 'dark chrome-active')
    near(whaleDark['--chrome-hover'], '#4a4a4a', 0.05, 'dark chrome-hover')
    near(whaleDark['--hairline'], '#4c4c4c', 0.05, 'dark hairline')
    near(whaleDark['--divider-strong'], '#626262', 0.06, 'dark divider-strong')
    near(whaleDark['--text-strong'], '#f4f4f4', 0.05, 'dark text-strong')
    near(whaleDark['--text-dim'], '#bdbdbd', 0.05, 'dark text-dim')
    near(whaleDark['--text-muted'], '#d0d0d0', 0.05, 'dark text-muted')
    near(whaleDark['--field-hover'], '#303031', 0.03, 'dark field-hover')
    near(whaleLight['--paper'], '#ffffff', 0.03, 'light paper')
    near(whaleLight['--chrome-hover'], '#e6e6e6', 0.05, 'light chrome-hover')
    near(whaleLight['--hairline'], '#e1e1e1', 0.05, 'light hairline')
    near(whaleLight['--divider-strong'], '#b8b8b8', 0.06, 'light divider-strong')
    near(whaleLight['--text-strong'], '#111111', 0.05, 'light text-strong')
    near(whaleLight['--text-dim'], '#4a4a4a', 0.06, 'light text-dim')
    near(whaleLight['--field-hover'], '#e2e2e3', 0.04, 'light field-hover')
    // 다른 팔레트의 기준값
    near(deriveThemeVars(BUILTIN_SEEDS.paper.dark, 'dark')['--chrome-hover'], '#423c32', 0.06, 'paper dark chrome-hover')
    near(deriveThemeVars(BUILTIN_SEEDS.navy.dark, 'dark')['--text-dim'], '#a4b0cb', 0.07, 'navy dark text-dim')
    near(deriveThemeVars(BUILTIN_SEEDS.navy.light, 'light')['--text-strong'], '#111a2e', 0.07, 'navy light text-strong')
  })

  it('메모 카드: 밝은 바탕엔 어두운 글자, 어두운 바탕엔 밝은 글자', () => {
    const light = deriveThemeVars({ ...BUILTIN_SEEDS.whale.dark, memoCard: '#f1f4f2' }, 'dark')
    expect(contrastRatio(c(light['--card-light-strong']), c(light['--card-light-paper']))).toBeGreaterThan(10)
    const dark = deriveThemeVars({ ...BUILTIN_SEEDS.whale.dark, memoCard: '#26302a' }, 'dark')
    expect(contrastRatio(c(dark['--card-light-strong']), c(dark['--card-light-paper']))).toBeGreaterThan(10)
    expect(contrastRatio(c(dark['--card-light-ink']), c(dark['--memo-card']))).toBeGreaterThan(7)
  })

  it('버튼 글자색은 강조색 위에서 읽힌다', () => {
    for (const accent of ['#7fd6a4', '#1f7ae0', '#ff8a5c', '#222222', '#fafafa']) {
      const vars = deriveThemeVars({ ...BUILTIN_SEEDS.whale.dark, accent }, 'dark')
      expect(contrastRatio(c(vars['--accent-contrast']), c(accent))).toBeGreaterThan(4)
    }
  })
})

describe('deriveAccentVars', () => {
  it('#FF8A5C: 어두운 패널에선 그대로, 흰 바탕 값은 대비가 4.5 이상으로 보정', () => {
    const dark = deriveAccentVars('#FF8A5C', 'dark', '#393939')
    expect(dark['--accent']).toBe('#ff8a5c')
    expect(contrastRatio(c(dark['--accent-light']), c('#ffffff'))).toBeGreaterThanOrEqual(4.5)
    const light = deriveAccentVars('#FF8A5C', 'light', '#f6f6f6')
    expect(contrastRatio(c(light['--accent']), c('#f6f6f6'))).toBeGreaterThanOrEqual(4.5)
    expect(light['--selection']).toMatch(/^#[0-9a-f]{6}66$/)
    expect(Object.keys(light)).toEqual(expect.arrayContaining(['--accent', '--source-edge', '--selection', '--accent-contrast', '--accent-light']))
  })
  it('대비 배지 판정', () => {
    expect(accentContrast('#ff8a5c', '#393939').ok).toBe(true)
    expect(accentContrast('#ff8a5c', '#f6f6f6').ok).toBe(false)
  })
})

describe('contrastChecks', () => {
  it('구분선이 패널과 비슷하면 경고', () => {
    const seeds = { ...BUILTIN_SEEDS.whale.dark, divider: '#3b3b3b' }
    const divider = contrastChecks(seeds).find((check) => check.id === 'divider-panel')!
    expect(divider.ok).toBe(false)
  })

  it('내장 팔레트 4개 × 라이트/다크는 경고가 하나도 없다', () => {
    for (const id of BASE_PALETTE_IDS) {
      for (const mode of ['light', 'dark'] as const) {
        const bad = contrastChecks(BUILTIN_SEEDS[id][mode]).filter((check) => !check.ok)
        expect(bad.map((check) => `${id} ${mode} ${check.id} ${check.ratio.toFixed(2)}`)).toEqual([])
      }
    }
  })

  it('분명히 나쁜 선택은 경고한다', () => {
    const base = BUILTIN_SEEDS.whale.dark
    const failed = (seeds: typeof base) => contrastChecks(seeds).filter((check) => !check.ok).map((check) => check.id)
    expect(failed({ ...base, divider: base.panel })).toContain('divider-panel')
    expect(failed({ ...base, text: '#777777' })).toContain('text-panel')
    expect(failed({ ...base, accent: '#454545' })).toContain('accent-panel')
  })
})

describe('테마 파일', () => {
  const theme = themeFromPalette('whale', '숲')

  it('내보내고 다시 읽으면 같은 값(id 만 새로)', () => {
    const parsed = parseThemeFile(serializeThemeFile(theme))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.theme.name).toBe('숲')
    expect(parsed.theme.dark).toEqual(theme.dark)
    expect(parsed.theme.light).toEqual(theme.light)
    expect(parsed.theme.id).not.toBe(theme.id)
  })

  it('틀린 입력은 이유와 함께 거절', () => {
    expect(parseThemeFile('not json').ok).toBe(false)
    expect(parseThemeFile('{"format":"other"}').ok).toBe(false)
    const bad = JSON.parse(serializeThemeFile(theme))
    bad.theme.dark.accent = 'red'
    const result = parseThemeFile(JSON.stringify(bad))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('강조색')
    const missing = JSON.parse(serializeThemeFile(theme))
    delete missing.theme.light
    expect(parseThemeFile(JSON.stringify(missing)).ok).toBe(false)
    const badBase = JSON.parse(serializeThemeFile(theme))
    badBase.theme.base = 'nope'
    expect(parseThemeFile(JSON.stringify(badBase)).ok).toBe(false)
    expect(SEED_KEYS).toHaveLength(8)
  })

  it('이름이 겹치면 번호를 붙인다', () => {
    expect(uniqueThemeName('숲', ['숲'])).toBe('숲 2')
    expect(uniqueThemeName('숲', ['숲', '숲 2'])).toBe('숲 3')
    expect(uniqueThemeName('  ', [])).toBe('내 테마')
  })
})
