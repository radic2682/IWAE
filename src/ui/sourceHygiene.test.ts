import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allCssRules, declarationsOf } from '../app/cssRules.testutil'

const SRC = join(__dirname, '..')
const TEXT = /\.(?:ts|tsx|css|html|json)$/u

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path)
    return TEXT.test(entry.name) ? [path] : []
  })
}

/** 탭 · 줄바꿈 · 캐리지 리턴을 뺀 제어 문자인가 */
const isControl = (code: number): boolean => code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)

describe('소스 위생', () => {
  it('소스에 글자 그대로의 제어 문자(0x00–0x08 · 0x0B · 0x0C · 0x0E–0x1F)가 없다 — 정규식의 낱말 경계가 백스페이스로, 구분자가 보이지 않는 문자로 적히던 일', () => {
    const found: string[] = []
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (let index = 0; index < text.length; index += 1) {
        if (isControl(text.charCodeAt(index))) { found.push(`${relative(SRC, file).split(String.fromCharCode(92)).join('/')} (글자 ${index})`); break }
      }
    }
    expect(found, found.join('\n')).toEqual([])
  })

  it('--doc-head-h 의 「띠가 있는 동안」 값은 한 규칙에서만 정한다(두 파일이 서로 덮지 않는다)', () => {
    const owners = allCssRules().filter((rule) => rule.selectors.includes('.pane-doc .pane-frame:has(.doc-format-strip)') && declarationsOf(rule.body)['--doc-head-h'] !== undefined)
    expect(owners).toHaveLength(1)
  })
})
