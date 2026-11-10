import { describe, expect, it } from 'vitest'
import { setLocale } from '../i18n'
import { FOLDER_COLORS, folderColorLabel } from './folderColors'
import {
  DEFAULT_HIGHLIGHT_COLORS,
  MAX_HIGHLIGHT_COLORS,
  OTHER_HIGHLIGHT_NAME,
  addHighlightColor,
  contrastRatio,
  countByHighlightColor,
  defaultHighlightColorId,
  deriveRoles,
  findHighlightColor,
  highlightColorDisplayName,
  highlightColorIdFromInput,
  highlightColorLabel,
  highlightColorName,
  highlightCssRules,
  highlightExportRgb,
  highlightInkOf,
  inkFromFill,
  knownHighlightColorId,
  mixHex,
  moveHighlightColor,
  nearestColorId,
  newHighlightColorId,
  normalizeHex,
  parseHex,
  parseHighlightColors,
  recolorHighlightColor,
  removeHighlightColor,
  renameHighlightColor,
  rolesOf,
  translucentFill,
} from './highlightColors'

const WHITE = [255, 255, 255] as const

describe('색 이름 표시', () => {
  it('기본 id·기본 이름 그대로면 영어 화면에서 번역하고, 바꾼 이름·새 색은 그대로 보인다', () => {
    setLocale('en')
    expect(DEFAULT_HIGHLIGHT_COLORS.map(highlightColorDisplayName)).toEqual(['Yellow', 'Green', 'Blue', 'Pink'])
    const renamed = { id: 'yellow', name: '형광', fill: '#ffd60a' }
    expect(highlightColorDisplayName(renamed)).toBe('형광')
    // 새로 만든 색이 우연히 기본 이름이어도 사용자가 쓴 글이다
    expect(highlightColorDisplayName({ id: 'c_abc123', name: '노랑', fill: '#ffd60a' })).toBe('노랑')
    expect(highlightColorLabel([renamed, ...DEFAULT_HIGHLIGHT_COLORS.slice(1)], 'yellow')).toBe('형광')
    expect(highlightColorLabel(DEFAULT_HIGHLIGHT_COLORS, 'pink')).toBe('Pink')
    expect(highlightColorLabel(DEFAULT_HIGHLIGHT_COLORS, 'gone')).toBe('Other')
    // 저장된 이름은 그대로
    expect(DEFAULT_HIGHLIGHT_COLORS[0]?.name).toBe('노랑')
    setLocale('ko')
    expect(highlightColorDisplayName(DEFAULT_HIGHLIGHT_COLORS[0]!)).toBe('노랑')
  })

  it('폴더 색 이름도 영어 화면에서 번역된다', () => {
    setLocale('en')
    expect(FOLDER_COLORS.map(folderColorLabel)).toEqual(['Yellow', 'Orange', 'Green', 'Sky blue', 'Purple', 'Violet', 'Pink'])
  })
})

describe('기본 4색', () => {
  it('id 는 예전 그대로 yellow|green|blue|pink 이고 이름은 노랑·초록·파랑·분홍이다', () => {
    expect(DEFAULT_HIGHLIGHT_COLORS.map(({ id, name }) => [id, name])).toEqual([['yellow', '노랑'], ['green', '초록'], ['blue', '파랑'], ['pink', '분홍']])
  })

  it('기본색은 예전 CSS 의 값을 그대로 낸다(계산하지 않는다)', () => {
    const yellow = rolesOf(DEFAULT_HIGHLIGHT_COLORS[0]!)
    expect(yellow).toMatchObject({ fill: 'rgb(255 214 0 / 46%)', ink: '#b8911a', solid: '#ffd60a', dot: '#f2c418', edge: '#e3b43c', soft: '#ffe38c', quote: 'rgb(255 214 0 / 26%)', wash: 'rgb(255 214 0 / 13%)', text: 'rgb(255 226 94 / 46%)', pdfSwatch: '#f7db61', paneSwatch: '#ffd84d' })
    expect(rolesOf(DEFAULT_HIGHLIGHT_COLORS[1]!).ink).toBe('#2f9358')
    expect(rolesOf(DEFAULT_HIGHLIGHT_COLORS[2]!).soft).toBe('#c3defc')
    expect(rolesOf(DEFAULT_HIGHLIGHT_COLORS[3]!).noteMix).toBe('60%')
  })

  it('기본색의 대표 색을 바꾸면 그때부터는 계산한 값을 쓴다', () => {
    const changed = rolesOf({ id: 'yellow', name: '노랑', fill: '#ffee00' })
    expect(changed.ink).not.toBe('#b8911a')
    expect(changed.solid).toBe('#ffee00')
  })
})

describe('색 계산', () => {
  it('hex 를 읽고 쓴다', () => {
    expect(parseHex('#c7a8ff')).toEqual([199, 168, 255])
    expect(parseHex('#fff')).toEqual([255, 255, 255])
    expect(parseHex('red')).toBeNull()
    expect(normalizeHex('#C7A8FF')).toBe('#c7a8ff')
    expect(normalizeHex(5)).toBeNull()
  })

  it('WCAG 대비: 검정·흰색은 21, 같은 색은 1', () => {
    expect(contrastRatio([0, 0, 0], WHITE)).toBeCloseTo(21, 5)
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5)
  })

  it('진한 색(ink)은 어떤 대표 색에서도 흰 글자와 대비 4.5 이상이다', () => {
    const samples = ['#ffd60a', '#ffffff', '#fefefe', '#c7a8ff', '#4cd47a', '#5aa9ff', '#ff6fa8', '#ffee00', '#00ffff', '#f0f0f0', '#9aa0a6', '#000000', '#7a52c7', '#b6e35a']
    for (const fill of samples) {
      const ink = inkFromFill(fill)
      expect(contrastRatio(parseHex(ink)!, WHITE), `${fill} → ${ink}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('이미 충분히 진한 색은 그대로 둔다', () => {
    expect(inkFromFill('#7a52c7')).toBe('#7a52c7')
  })

  it('밝은 색은 같은 색상(hue)을 지키며 어두워진다', () => {
    const ink = parseHex(inkFromFill('#c7a8ff'))!
    // 보라 계열 유지: 파랑 성분이 가장 크다
    expect(ink[2]).toBeGreaterThan(ink[1])
    expect(ink[2]).toBeGreaterThanOrEqual(ink[0])
  })

  it('잘못된 색은 중립색으로 계산한다', () => {
    expect(deriveRoles('nope').solid).toBe('#9aa0a6')
  })

  it('반투명 칠은 밝은 화면과 어두운 화면의 농도가 다르다', () => {
    expect(translucentFill('#c7a8ff', 'light')).toBe('rgb(199 168 255 / 42%)')
    expect(translucentFill('#c7a8ff', 'dark')).toBe('rgb(199 168 255 / 34%)')
  })

  it('역할별 값: 점·테두리는 대표 색과 진한 색 사이, soft 는 대표 색보다 밝다', () => {
    const roles = deriveRoles('#c7a8ff')
    expect(roles.solid).toBe('#c7a8ff')
    expect(roles.soft).toBe(mixHex('#c7a8ff', '#ffffff', 0.58))
    expect(roles.quote).toBe('rgb(199 168 255 / 24%)')
    expect(roles.wash).toBe('rgb(199 168 255 / 12%)')
    expect(roles.edge).toBe(mixHex('#c7a8ff', roles.ink, 0.5))
    expect(parseHex(roles.soft)![1]).toBeGreaterThan(168)
  })

  it('진한 색을 직접 정하면 그것을 쓰되 나머지는 그에 맞춰 계산한다', () => {
    const roles = rolesOf({ id: 'c_abc123', name: '반론', fill: '#c7a8ff', ink: '#552299' })
    expect(roles.ink).toBe('#552299')
    expect(roles.edge).toBe(mixHex('#c7a8ff', '#552299', 0.5))
  })
})

describe('목록 읽기', () => {
  it('저장값이 없거나 깨졌으면 기본 4색', () => {
    expect(parseHighlightColors(undefined)).toBe(DEFAULT_HIGHLIGHT_COLORS)
    expect(parseHighlightColors('x')).toBe(DEFAULT_HIGHLIGHT_COLORS)
    expect(parseHighlightColors([])).toBe(DEFAULT_HIGHLIGHT_COLORS)
    expect(parseHighlightColors([{ id: 5 }, null, { id: 'a b', fill: '#fff' }])).toBe(DEFAULT_HIGHLIGHT_COLORS)
  })

  it('잘못된 항목·중복 id 는 버리고 이름을 다듬고 8개로 자른다', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `c_${i}`, name: `이름${i}`, fill: '#C7A8FF' }))
    const parsed = parseHighlightColors([{ id: 'yellow', name: '  중요  ', fill: '#FFD60A' }, { id: 'yellow', name: '중복', fill: '#000000' }, { id: 'bad', name: 'x', fill: 'blue' }, ...many])
    expect(parsed).toHaveLength(MAX_HIGHLIGHT_COLORS)
    expect(parsed[0]).toEqual({ id: 'yellow', name: '중요', fill: '#ffd60a' })
    expect(parsed.map(({ id }) => id)).not.toContain('bad')
    expect(parseHighlightColors([{ id: 'c_1', name: '', fill: '#112233' }])[0]!.name).toBe(OTHER_HIGHLIGHT_NAME)
  })

  it('id 는 안정적이다: 기본 id 는 그대로 읽히고 저장→읽기가 같다', () => {
    const roundTrip = parseHighlightColors(JSON.parse(JSON.stringify(DEFAULT_HIGHLIGHT_COLORS)))
    expect(roundTrip).toEqual(DEFAULT_HIGHLIGHT_COLORS)
    expect(parseHighlightColors([{ id: 'blue', name: '정의', fill: '#5aa9ff' }])[0]!.id).toBe('blue')
  })
})

describe('없는 색(지운 색)', () => {
  const colors = DEFAULT_HIGHLIGHT_COLORS

  it('이름은 「기타」, 찾기는 undefined, 기본 색은 첫 색이다', () => {
    expect(findHighlightColor(colors, 'purple')).toBeUndefined()
    expect(highlightColorName(colors, 'purple')).toBe('기타')
    expect(highlightColorName(colors, undefined)).toBe('기타')
    expect(highlightColorName(colors, 'green')).toBe('초록')
    expect(defaultHighlightColorId(colors)).toBe('yellow')
    expect(knownHighlightColorId(colors, 'purple')).toBe('yellow')
    expect(knownHighlightColorId(colors, 'blue')).toBe('blue')
  })

  it('CSS: 목록에 없는 data-hl 은 중립색 규칙을 받고, 목록의 색은 자기 규칙을 받는다', () => {
    const css = highlightCssRules(colors)
    expect(css).toContain('[data-hl]{')
    expect(css).toContain('[data-hl="yellow"]{')
    expect(css).not.toContain('[data-hl="purple"]')
    // 중립 규칙이 앞, 개별 규칙이 뒤(같은 우선순위에서 뒤가 이긴다)
    expect(css.indexOf('[data-hl]{')).toBeLessThan(css.indexOf('[data-hl="yellow"]{'))
    expect(css.split('\n')[1]).toContain(`--hlc-solid:${deriveRoles('#9aa0a6').solid}`)
  })

  it('캔버스 연결선 색: 없는 색은 중립색 ink', () => {
    expect(highlightInkOf(colors, 'yellow')).toBe('#b8911a')
    expect(highlightInkOf(colors, 'zzz')).toBe(deriveRoles('#9aa0a6').ink)
  })
})

describe('CSS 생성', () => {
  it('기본 4색의 규칙에는 예전 값이 그대로 들어간다', () => {
    const css = highlightCssRules(DEFAULT_HIGHLIGHT_COLORS)
    expect(css).toContain('[data-hl="green"]{--hlc-fill:rgb(70 214 110 / 40%);--hlc-ink:#2f9358;--hlc-solid:#4cd47a;--hlc-dot:#3fc06f;')
    expect(css).toContain('--hlc-soft:#fcc6dc')
    // 기본색은 어두운 화면용 규칙을 따로 두지 않는다
    expect(css).not.toContain("data-theme='dark'")
  })

  it(':root 에는 첫 색의 값이 기본값으로 들어간다', () => {
    const css = highlightCssRules([{ id: 'c_one', name: '하나', fill: '#c7a8ff' }, ...DEFAULT_HIGHLIGHT_COLORS])
    expect(css.startsWith(':root{--hlc-fill:')).toBe(true)
    expect(css.split('\n')[0]).toContain(deriveRoles('#c7a8ff').soft)
  })

  it('새로 만든 색은 밝은·어두운 화면의 반투명 칠을 따로 가진다', () => {
    const css = highlightCssRules([...DEFAULT_HIGHLIGHT_COLORS, { id: 'c_purple', name: '반론', fill: '#c7a8ff' }])
    expect(css).toContain('[data-hl="c_purple"]{--hlc-fill:rgb(199 168 255 / 42%)')
    expect(css).toContain(":root[data-theme='dark'] [data-hl=\"c_purple\"]{--hlc-fill:rgb(199 168 255 / 34%)}")
  })

  it('선택자에 쓸 수 없는 id 는 건너뛴다', () => {
    const css = highlightCssRules([{ id: 'x"]{}', name: 'n', fill: '#112233' }])
    expect(css).not.toContain('x"]')
  })
})

describe('목록 고치기', () => {
  it('색 추가: 8개까지, 새 id, 쓰지 않은 권장색', () => {
    const added = addHighlightColor(DEFAULT_HIGHLIGHT_COLORS, undefined, () => 0)
    expect(added).toHaveLength(5)
    expect(added[4]).toMatchObject({ id: 'c_aaaaaa', name: '새 색', fill: '#c7a8ff' })
    let full = DEFAULT_HIGHLIGHT_COLORS
    for (let i = 0; i < 10; i += 1) full = addHighlightColor(full)
    expect(full).toHaveLength(MAX_HIGHLIGHT_COLORS)
    expect(new Set(full.map(({ id }) => id)).size).toBe(MAX_HIGHLIGHT_COLORS)
    expect(addHighlightColor(DEFAULT_HIGHLIGHT_COLORS, '#112233')[4]!.fill).toBe('#112233')
  })

  it('새 id 는 이미 쓰는 id 와 겹치지 않는다', () => {
    const values = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
    let i = 0
    expect(newHighlightColorId(['c_aaaaaa'], () => values[i++ % values.length]!)).not.toBe('c_aaaaaa')
  })

  it('이름 바꾸기·색 바꾸기·지우기·순서 바꾸기', () => {
    const base = DEFAULT_HIGHLIGHT_COLORS
    expect(renameHighlightColor(base, 'blue', '정의')[2]!.name).toBe('정의')
    expect(renameHighlightColor(base, 'blue', 'x'.repeat(50))[2]!.name).toHaveLength(20)
    expect(recolorHighlightColor(base, 'blue', '#112233')[2]).toEqual({ id: 'blue', name: '파랑', fill: '#112233' })
    expect(recolorHighlightColor(base, 'blue', 'zzz')).toBe(base)
    expect(removeHighlightColor(base, 'green').map(({ id }) => id)).toEqual(['yellow', 'blue', 'pink'])
    expect(removeHighlightColor([base[0]!], 'yellow')).toHaveLength(1)
    expect(moveHighlightColor(base, 0, 2).map(({ id }) => id)).toEqual(['green', 'blue', 'yellow', 'pink'])
    expect(moveHighlightColor(base, 3, 0).map(({ id }) => id)).toEqual(['pink', 'yellow', 'green', 'blue'])
    expect(moveHighlightColor(base, 0, 9)).toBe(base)
  })

  it('색별 개수', () => {
    const counts = countByHighlightColor([{ color: 'yellow' }, { color: 'yellow' }, { color: 'c_x' }])
    expect(counts.get('yellow')).toBe(2)
    expect(counts.get('c_x')).toBe(1)
    expect(counts.get('green')).toBeUndefined()
  })

  it('외부 입력(MCP)은 id 나 이름으로 색을 가리킨다', () => {
    const colors = [...DEFAULT_HIGHLIGHT_COLORS, { id: 'c_x', name: '반론', fill: '#c7a8ff' }]
    expect(highlightColorIdFromInput(colors, 'GREEN')).toBe('green')
    expect(highlightColorIdFromInput(colors, '반론')).toBe('c_x')
    expect(highlightColorIdFromInput(colors, 'nope')).toBeUndefined()
    expect(highlightColorIdFromInput(colors, 3)).toBeUndefined()
  })
})

describe('PDF 내보내기·가져오기', () => {
  it('기본 4색은 예전 주석 RGB 를 그대로 쓴다', () => {
    expect(highlightExportRgb(DEFAULT_HIGHLIGHT_COLORS, 'yellow')).toEqual([255, 226, 77])
    expect(highlightExportRgb(DEFAULT_HIGHLIGHT_COLORS, 'pink')).toEqual([245, 120, 185])
  })

  it('새 색은 대표 색, 없는 색은 첫 색', () => {
    const colors = [...DEFAULT_HIGHLIGHT_COLORS, { id: 'c_x', name: '반론', fill: '#c7a8ff' }]
    expect(highlightExportRgb(colors, 'c_x')).toEqual([199, 168, 255])
    expect(highlightExportRgb(colors, 'deleted')).toEqual([255, 226, 77])
  })

  it('가져오기는 내 목록에서 가장 가까운 색을 찾는다', () => {
    const colors = [...DEFAULT_HIGHLIGHT_COLORS, { id: 'c_x', name: '반론', fill: '#c7a8ff' }]
    expect(nearestColorId(colors, [250, 230, 80])).toBe('yellow')
    expect(nearestColorId(colors, [200, 170, 250])).toBe('c_x')
    expect(nearestColorId(colors, null)).toBe('yellow')
  })
})
