import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 시험용: 스타일시트를 읽어 (선택자 목록, 선언) 규칙으로 나눈다. @container · @media 같은 조건부 블록은 안의 규칙을 `at` 에 붙여 따로 돌려준다 */
export interface CssRule { readonly selectors: readonly string[]; readonly body: string; readonly at: string | null }

export const cssSource = (name: string): string => readFileSync(join(__dirname, '../ui', name), 'utf8').split(String.fromCharCode(13)).join('').replace(/\/\*[\s\S]*?\*\//gu, '')

export function cssRules(source: string): CssRule[] {
  const rules: CssRule[] = []
  const walk = (text: string, at: string | null) => {
    let index = 0
    while (index < text.length) {
      const open = text.indexOf('{', index)
      if (open < 0) break
      const head = text.slice(index, open).trim()
      let depth = 1
      let close = open + 1
      while (close < text.length && depth > 0) {
        if (text[close] === '{') depth += 1
        else if (text[close] === '}') depth -= 1
        close += 1
      }
      const inner = text.slice(open + 1, close - 1)
      if (head.startsWith('@')) { if (!head.startsWith('@keyframes')) walk(inner, head) }
      else rules.push({ selectors: head.split(',').map((selector) => selector.trim()).filter((selector) => selector !== ''), body: inner, at })
      index = close
    }
  }
  walk(source, null)
  return rules
}

/** 요소에 걸리는 규칙(조건부 블록 제외 여부는 withAt 으로) */
export function rulesMatching(element: Element, rules: readonly CssRule[], withAt = false): CssRule[] {
  return rules.filter((rule) => (withAt || rule.at === null) && rule.selectors.some((selector) => {
    try { return element.matches(selector) } catch { return false }
  }))
}
