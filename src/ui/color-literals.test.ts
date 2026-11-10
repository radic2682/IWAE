import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 색은 토큰에서 흘러야 한다(사용자 지정 테마가 :root 시드 토큰을 덮어쓰는 구조).
 * 토큰 파일 밖의 CSS 에 #hex·rgb()·hsl()·이름 색을 새로 쓰면 이 테스트가 실패한다.
 * 필요한 새 색은 color-tokens.css 에 이름을 붙여 정의하고 var(--이름)으로 쓴다.
 */

/** 색 리터럴을 정의해도 되는 토큰 파일 */
const TOKEN_FILES = new Set(['tokens.css', 'app-themes.css', 'color-tokens.css'])

/**
 * 토큰이 아닌데 리터럴을 허용하는 파일(이유 필수).
 * - launch-splash.css: 앱 테마가 적용되기 전에 뜨는 부팅 화면. 테마와 무관하게 늘 같은 어두운 그림이다.
 */
const FIXED_FILES: Record<string, string> = {
  'launch-splash.css': '부팅 화면은 테마와 무관한 고정 그림',
}

const NAMED_COLOR = /(?:[:(,\s])(?:white|black|red|blue|green|yellow|orange|gray|grey|purple|pink)(?=[\s;,)!}]|$)/i

function stripNonColorText(css: string): string {
  return css
    // 인라인 style 문자열을 비교하는 속성 선택자 안의 'color: rgb(...)' 는 색 사용이 아니라 문자열 일치이다
    .replace(/\[style\*=(['"])[^'"]*\1\]/g, '[style*=""]')
}

function scan(css: string): string[] {
  const found: string[] = []
  // 줄 번호를 지키려고 주석은 같은 줄 수의 빈 줄로 바꾼다
  const body = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => '\n'.repeat(comment.split('\n').length - 1))
  body.split('\n').forEach((line, index) => {
    const text = stripNonColorText(line)
    if (/#[0-9a-fA-F]{3,8}\b/.test(text)) found.push(`${index + 1}: ${line.trim()}`)
    else if (/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[\d.]/.test(text)) found.push(`${index + 1}: ${line.trim()}`)
    else if (NAMED_COLOR.test(text.replace(/white-space|var\([^)]*\)/g, ''))) found.push(`${index + 1}: ${line.trim()}`)
  })
  return found
}

describe('CSS 색 리터럴 가드', () => {
  const files = readdirSync('src/ui').filter((file) => file.endsWith('.css'))

  it('토큰 파일이 존재하고 새 색 토큰 파일이 theme.css 에서 불러와진다', () => {
    expect(files).toContain('color-tokens.css')
    expect(readFileSync('src/ui/theme.css', 'utf8')).toContain("@import './color-tokens.css'")
  })

  for (const file of files.filter((name) => !TOKEN_FILES.has(name) && FIXED_FILES[name] === undefined)) {
    it(`${file} 에 하드코딩된 색이 없다`, () => {
      expect(scan(readFileSync(`src/ui/${file}`, 'utf8'))).toEqual([])
    })
  }

  it('고정 허용 파일은 이유가 적혀 있다', () => {
    for (const [file, reason] of Object.entries(FIXED_FILES)) {
      expect(files).toContain(file)
      expect(reason.length).toBeGreaterThan(0)
    }
  })

  it('스캐너가 리터럴을 실제로 잡는다', () => {
    expect(scan('.a { color: #fff; }')).toHaveLength(1)
    expect(scan('.a { box-shadow: 0 0 4px rgb(0 0 0 / 20%); }')).toHaveLength(1)
    expect(scan('.a { background: white; }')).toHaveLength(1)
    expect(scan('.a { color: var(--text); box-shadow: 0 0 4px rgb(var(--rgb-black) / 20%); white-space: nowrap; }')).toEqual([])
    expect(scan("[style*='color: rgb(31, 35, 40)'] { color: var(--syn-light-ink); }")).toEqual([])
    expect(scan('/* #fff 설명 */ .a { color: var(--text); }')).toEqual([])
  })

  it('형광펜 색은 색 이름 클래스가 아니라 data-hl + --hlc-* 변수로만 칠한다', () => {
    // 색별 CSS 규칙(예: .pdf-memo-card-yellow)이 다시 생기면 목록에 새로 만든 색이 칠해지지 않는다
    const perName = /\.[a-z][a-z-]*-(?:yellow|green|blue|pink)\b|data-highlight-color\s*=/
    for (const file of files.filter((name) => !TOKEN_FILES.has(name))) {
      const hits = readFileSync(`src/ui/${file}`, 'utf8').split('\n').filter((line) => perName.test(line) && !/tone-green|swatch-green|annot-green/.test(line))
      expect(hits, file).toEqual([])
    }
  })

  it('역할 변수(--hlc-*)는 color-tokens.css 가 아니라 런타임 <style> 이 만든다', () => {
    expect(readFileSync('src/ui/color-tokens.css', 'utf8')).not.toMatch(/--hlc-[a-z-]+:/)
  })
})
