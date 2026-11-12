import { readdirSync, readFileSync } from 'node:fs'
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

/** 규칙 본문(`a: b; c: d`)의 선언들. 같은 속성이 여럿이면 뒤의 것이 이긴다. 값의 공백은 하나로 줄인다 */
export function declarationsOf(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of body.split(';')) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    const property = part.slice(0, colon).trim()
    if (property !== '') out[property] = part.slice(colon + 1).replace(/\s+/gu, ' ').trim()
  }
  return out
}

const normalizeSelector = (selector: string): string => selector.replace(/\s+/gu, ' ').trim()

/**
 * 스타일시트 한 파일에서 이 선택자(목록의 한 항목과 정확히 같은 것)를 가진 규칙들의 선언을 모아 그 속성의 값을 돌려준다(여러 규칙이면 뒤의 것이 이긴다). 없으면 undefined.
 * 규칙 글 전체와 맞추지 않으므로 공백 · 다른 선언의 순서가 바뀌어도 깨지지 않는다.
 */
export function ruleDecl(name: string, selector: string, property: string): string | undefined {
  let value: string | undefined
  for (const rule of cssRules(cssSource(name))) {
    if (rule.at !== null || !rule.selectors.some((candidate) => normalizeSelector(candidate) === normalizeSelector(selector))) continue
    const declared = declarationsOf(rule.body)[property]
    if (declared !== undefined) value = declared
  }
  return value
}

/** 모든 스타일시트의 규칙(조건부 블록 포함, 파일 이름순) */
export function allCssRules(): CssRule[] {
  const dir = join(__dirname, '../ui')
  return readdirSync(dir).filter((name) => name.endsWith('.css')).sort().flatMap((name) => cssRules(cssSource(name)))
}
