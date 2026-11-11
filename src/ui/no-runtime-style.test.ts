import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 제품 빌드의 CSP(style-src)는 Tauri 가 nonce 를 붙여 'unsafe-inline' 을 무시한다.
 * 실행 중에 만든 <style> 요소나 HTML 문자열의 style="" 는 적용되지 않는다(형광펜이 전부 검게 나온 원인).
 * 실행 중 CSS 는 src/app/runtimeStyle.ts(constructable stylesheet · CSSOM)로만 넣는다.
 */
// memoRichText 는 저장용 HTML 에 style 속성을 남긴다(그릴 때 restoreInlineStyles 로 CSSOM 에 입힌다)
const ALLOWED = new Set(['src/app/runtimeStyle.ts', 'src/pdf/memoRichText.ts'])

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|tsx)$/u.test(name) && !/\.test\.(ts|tsx)$/u.test(name) ? [path] : []
  })
}

const PATTERNS: readonly [string, RegExp][] = [
  ['createElement(\'style\')', /createElement\(\s*['"`]style['"`]\s*\)/u],
  ['createElementNS style', /createElementNS\([^)]*['"`]style['"`]/u],
  ['<style 마크업', /<style[\s>]/u],
  ['setAttribute(\'style\')', /setAttribute\(\s*['"`]style['"`]/u],
  ['HTML 문자열의 style 속성', /<[a-z][^>]*\sstyle=["']/u],
]

// 별도 문서(내보내기 파일·인쇄 iframe)는 앱 CSP 밖이라 자기 CSP 로 style 을 쓴다
const SEPARATE_DOCUMENTS = new Set(['src/core/evidenceExport.ts', 'src/core/markdownPdf.ts'])

describe('실행 중 CSS 는 CSSOM 으로만 넣는다', () => {
  for (const [label, pattern] of PATTERNS) {
    it(`${label} 이 소스에 없다`, () => {
      const hits = sources('src')
        .map((file) => file.split(String.fromCharCode(92)).join('/'))
        .filter((file) => !ALLOWED.has(file) && !SEPARATE_DOCUMENTS.has(file))
        .filter((file) => pattern.test(readFileSync(file, 'utf8').split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line)).join('\n')))
      expect(hits).toEqual([])
    })
  }
})
