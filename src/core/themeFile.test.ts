import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_HIGHLIGHT_COLORS } from './highlightColors'
import {
  THEME_FILE_MAX_BYTES,
  buildFolderThemes,
  buildTemplateFile,
  findSameTheme,
  folderThemeId,
  isFolderThemeId,
  isThemeFileName,
  parseThemeFile,
  parseThemeFileContent,
  serializeThemeFile,
} from './themeFile'
import { SEED_KEYS, contrastChecks, themeFromPalette } from './userTheme'

const theme = themeFromPalette('whale', '숲')
const base = () => JSON.parse(serializeThemeFile(theme))
const errorOf = (value: unknown): string => {
  const result = parseThemeFileContent(typeof value === 'string' ? value : JSON.stringify(value))
  expect(result.ok).toBe(false)
  return result.ok ? '' : result.error
}

describe('테마 파일 읽기', () => {
  it('내보내고 다시 읽으면 같은 값(id 만 새로)', () => {
    const result = parseThemeFileContent(serializeThemeFile(theme))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.content.theme).toMatchObject({ name: '숲', base: 'whale', light: theme.light, dark: theme.dark })
    expect(result.content.theme.id).not.toBe(theme.id)
    expect(result.content.highlightColors).toBeUndefined()
    expect(result.content.warnings).toEqual([])
  })

  it('이전 모양(parseThemeFile)도 그대로', () => {
    expect(parseThemeFile(serializeThemeFile(theme)).ok).toBe(true)
    expect(parseThemeFile('{').ok).toBe(false)
  })

  it('JSON 이 아니면 이유를 말한다', () => {
    expect(errorOf('not json')).toContain('JSON')
    expect(errorOf('[1,2]')).toContain('IWAE 테마 파일이 아닙니다')
  })

  it('format 이 없거나 다르면', () => {
    expect(errorOf({ version: 1 })).toContain('iwae-theme')
    expect(errorOf({ format: 'other', version: 1 })).toContain('iwae-theme')
  })

  it('버전: 없거나 지원하지 않으면 그 버전을 밝힌다', () => {
    const noVersion = base()
    delete noVersion.version
    expect(errorOf(noVersion)).toContain('version')
    const v2 = base()
    v2.version = 2
    const message = errorOf(v2)
    expect(message).toContain('버전 2')
    expect(message).toContain('버전 1')
    expect(message).not.toContain('판')
  })

  it('시드가 빠졌으면 어느 밝기의 어느 색인지', () => {
    const missing = base()
    delete missing.theme.dark.panel
    expect(errorOf(missing)).toBe('다크 색 「패널」(panel)이 빠져 있습니다.')
    const noLight = base()
    delete noLight.theme.light
    expect(errorOf(noLight)).toContain('라이트 색 묶음')
  })

  it('hex 가 틀리면 값을 보여 준다', () => {
    const bad = base()
    bad.theme.light.accent = 'red'
    expect(errorOf(bad)).toBe('라이트 「강조색」(accent) 값이 #rrggbb 색이 아닙니다: "red"')
    const numeric = base()
    numeric.theme.dark.text = 123
    expect(errorOf(numeric)).toContain('「글자」')
  })

  it('이름이 비었거나 바탕 구성을 모르면', () => {
    const noName = base()
    noName.theme.name = '  '
    expect(errorOf(noName)).toContain('이름')
    const badBase = base()
    badBase.theme.base = 'nope'
    expect(errorOf(badBase)).toContain('바탕')
    expect(errorOf({ format: 'iwae-theme', version: 1 })).toContain('theme')
  })

  it('너무 큰 파일, BOM 이 붙은 파일', () => {
    expect(errorOf(' '.repeat(THEME_FILE_MAX_BYTES + 1))).toContain('너무 큽니다')
    expect(parseThemeFileContent(`\uFEFF${serializeThemeFile(theme)}`).ok).toBe(true)
  })

  it('3자리 hex 는 6자리로, 이름은 30자까지', () => {
    const file = base()
    file.theme.light.text = '#abc'
    file.theme.name = '가'.repeat(40)
    const result = parseThemeFileContent(JSON.stringify(file))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content.theme.light.text).toBe('#aabbcc')
      expect(result.content.theme.name).toHaveLength(30)
    }
  })

  it('형광펜 색(고르기): 올바른 것만, 잘못된 것은 안내와 함께 건너뛴다', () => {
    const file = base()
    file.highlightColors = [{ id: 'yellow', name: '노랑', fill: '#ffd60a' }, { name: '청록', fill: '#1abc9c' }, { name: '나쁨', fill: 'x' }, 7]
    const result = parseThemeFileContent(JSON.stringify(file))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const colors = result.content.highlightColors ?? []
    expect(colors.map((color) => color.name)).toEqual(['노랑', '청록'])
    expect(colors[0]!.id).toBe('yellow')
    expect(colors[1]!.id).toMatch(/^c_/)
    expect(result.content.warnings).toHaveLength(2)
    const none = base()
    none.highlightColors = [{ fill: 'x' }]
    const noneResult = parseThemeFileContent(JSON.stringify(none))
    expect(noneResult.ok && noneResult.content.highlightColors).toBeFalsy()
    const notList = base()
    notList.highlightColors = 'x'
    const listResult = parseThemeFileContent(JSON.stringify(notList))
    expect(listResult.ok && listResult.content.warnings.length).toBe(1)
  })

  it('형광펜 색은 8개까지', () => {
    const file = base()
    file.highlightColors = Array.from({ length: 11 }, (_, index) => ({ name: `색${index}`, fill: '#123456' }))
    const result = parseThemeFileContent(JSON.stringify(file))
    expect(result.ok && result.content.highlightColors?.length).toBe(8)
    expect(result.ok && result.content.warnings.length).toBe(1)
  })
})

describe('템플릿·확장자', () => {
  it('템플릿은 지금 색 그대로 다시 읽히고, 설명 항목은 앱이 무시한다', () => {
    const text = buildTemplateFile(theme, DEFAULT_HIGHLIGHT_COLORS)
    const raw = JSON.parse(text)
    expect(Object.keys(raw.seedGuide)).toEqual([...SEED_KEYS])
    expect(raw.description).toContain('.iwtheme')
    const result = parseThemeFileContent(text)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content.theme.light).toEqual(theme.light)
      expect(result.content.highlightColors?.map((color) => color.name)).toEqual(['노랑', '초록', '파랑', '분홍'])
    }
  })

  it('.iwtheme 는 늘, .json 은 허락했을 때만', () => {
    expect(isThemeFileName('C:\\a\\숲.IWTHEME')).toBe(true)
    expect(isThemeFileName('a.json')).toBe(false)
    expect(isThemeFileName('a.json', true)).toBe(true)
    expect(isThemeFileName('a.pdf', true)).toBe(false)
  })
})

describe('폴더 테마', () => {
  const good = (name: string) => ({ name, text: serializeThemeFile(theme) })

  it('파일 이름 순으로 읽고, 같은 이름이면 「숲 (2)」', () => {
    const result = buildFolderThemes([good('b.iwtheme'), good('a.iwtheme')], ['숲'])
    expect(result.errors).toEqual([])
    expect(result.themes.map((item) => item.name)).toEqual(['숲 (2)', '숲 (3)'])
    expect(result.themes.map((item) => item.file)).toEqual(['a.iwtheme', 'b.iwtheme'])
  })

  it('틀린 파일은 errors 로 모으고 나머지는 계속 읽는다', () => {
    const bad = { name: 'bad.iwtheme', text: '{"format":"iwae-theme","version":9}' }
    const result = buildFolderThemes([bad, good('ok.iwtheme'), { name: 'x.json', text: 'oops' }], [])
    expect(result.themes).toHaveLength(1)
    expect(result.errors.map((item) => item.file)).toEqual(['bad.iwtheme', 'x.json'])
    expect(result.errors[0]!.error).toContain('버전 9')
  })

  it('id 는 파일 이름에서 늘 같게, 이름이 다르면 다르게', () => {
    expect(folderThemeId('숲.iwtheme')).toBe(folderThemeId('숲.iwtheme'))
    expect(folderThemeId('숲.iwtheme')).not.toBe(folderThemeId('모래.iwtheme'))
    expect(folderThemeId('a b.iwtheme')).toMatch(/^vf-a_b-/)
    expect(isFolderThemeId(folderThemeId('x.iwtheme'))).toBe(true)
    expect(isFolderThemeId('ut-abc')).toBe(false)
    expect(buildFolderThemes([good('a.iwtheme')], []).themes[0]!.id).toBe(buildFolderThemes([good('a.iwtheme')], []).themes[0]!.id)
  })

  it('같은 이름·같은 색인지 알아본다', () => {
    expect(findSameTheme({ ...theme, id: 'other' }, [theme])).toBe(theme)
    expect(findSameTheme({ ...theme, name: '다른' }, [theme])).toBeUndefined()
    expect(findSameTheme({ ...theme, dark: { ...theme.dark, accent: '#000000' } }, [theme])).toBeUndefined()
  })
})

describe('docs/themes 의 템플릿·예시 테마', () => {
  const dir = join(process.cwd(), 'docs', 'themes')
  const files = readdirSync(dir).filter((name) => name.endsWith('.iwtheme'))

  it('템플릿과 예시 3개(숲·모래·자정)가 있다', () => {
    expect(files).toEqual(expect.arrayContaining(['template.iwtheme', '숲.iwtheme', '모래.iwtheme', '자정.iwtheme']))
  })

  for (const name of files) {
    it(`${name}: 읽히고 라이트·다크 모두 대비 검사를 통과한다`, () => {
      const result = parseThemeFileContent(readFileSync(join(dir, name), 'utf8'))
      expect(result.ok, result.ok ? '' : result.error).toBe(true)
      if (!result.ok) return
      expect(result.content.warnings).toEqual([])
      for (const mode of ['light', 'dark'] as const) {
        const failed = contrastChecks(result.content.theme[mode]).filter((check) => !check.ok)
        expect(failed.map((check) => `${mode}:${check.id}:${check.ratio.toFixed(2)}`)).toEqual([])
      }
    })
  }
})

describe('영어 화면의 테마 파일 오류', () => {
  it('오류 글이 영어로 나온다', async () => {
    const { setLocale } = await import('../i18n')
    setLocale('en')
    try {
      const bad = base()
      bad.theme.light.accent = 'red'
      expect(errorOf(bad)).toBe('The Light value for “Accent color” (accent) is not a #rrggbb color: "red"')
      const v2 = base()
      v2.version = 2
      expect(errorOf(v2)).toContain('Unsupported theme file version (2)')
    } finally {
      setLocale('ko')
    }
  })
})
