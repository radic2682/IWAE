import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EN } from './en'

/**
 * 화면 글은 한국어 문장이 열쇠다(`t('메모 쓰기')`). 영어 사전에 없으면 영어 화면에서도 한국어가 그대로 보이므로,
 * 소스에 쓴 t('…') 글이 모두 영어 사전에 있는지 본다. 일부러 번역하지 않는 글은 아래 ALLOWLIST 에 이유와 함께 적는다.
 */
const ALLOWLIST: ReadonlySet<string> = new Set<string>([])

const SRC = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'i18n' || entry.name === 'node_modules' ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/u.test(entry.name) && !/\.test\.(ts|tsx)$/u.test(entry.name) ? [path] : []
  })
}

function unescape(raw: string, quote: string): string {
  return raw.replace(/\\(.)/gu, (_whole, char: string) => (char === 'n' ? '\n' : char === quote || char === '\\' ? char : `\\${char}`))
}

describe('영어 사전 범위', () => {
  it('소스의 t(\'…\') 글이 모두 영어 사전에 있다', () => {
    const missing = new Map<string, string>()
    const call = /\bt\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/gu
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(call)) {
        const key = match[1] !== undefined ? unescape(match[1], "'") : unescape(match[2] ?? '', '"')
        if (!/[가-힣]/u.test(key) || ALLOWLIST.has(key) || EN[key] !== undefined) continue
        if (!missing.has(key)) missing.set(key, relative(SRC, file).replaceAll('\\', '/'))
      }
    }
    const report = [...missing].map(([key, file]) => `  ${file}: ${key}`).join('\n')
    expect(missing.size, `영어 사전(src/i18n/en/group*.ts)에 없는 글 ${missing.size}개:\n${report}`).toBe(0)
  })
})
