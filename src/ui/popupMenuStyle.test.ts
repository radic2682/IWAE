import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./screens.css', import.meta.url), 'utf8')
const rule = (selector: string) => {
  const start = css.indexOf(selector)
  if (start < 0) return ''
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
}

describe('팝업 메뉴 스타일(세션 메뉴 · 칸 ⋯ 메뉴 · 화면 탭 메뉴)', () => {
  const menu = rule('.pane-tab-context.pane-tab-context.popup-menu {')
  const hint = rule(".pane-tab-context.pane-tab-context[role='menu'] kbd {")

  it('메뉴는 내용 폭에 맞추되 300px 밑으로 줄지 않는다(「다른 이름으로 저장」 이 잘리지 않게)', () => {
    expect(menu).toContain('width: max-content')
    expect(menu).toContain('min-width: 300px')
    expect(menu).toMatch(/max-width: calc\(100vw - \d+px\)/u)
  })

  it('오른쪽 단축키는 한 줄(nowrap) · 줄지 않음 · 오른쪽 맞춤 · 접두키 칩 · 팔레트와 같은 키캡(UI 글꼴, 1px 테두리, --r-xs)이다', () => {
    expect(hint).toContain('white-space: nowrap')
    expect(hint).toContain('flex: 0 0 auto')
    expect(hint).toContain('text-align: right')
    expect(hint).toContain('border: 1px solid')
    expect(hint).toContain('border-radius: var(--r-xs)')
    expect(hint).toContain('font: inherit')
    expect(hint).not.toContain('var(--font-mono')
    expect(hint).toContain('font-size: 11.5px')
  })

  it('단축키가 아닌 값(색 · 세션 정보)은 키캡 없는 .menu-value 다', () => {
    const value = rule('.pane-tab-context.pane-tab-context.popup-menu .menu-value {')
    expect(value).toContain('white-space: nowrap')
    expect(value).not.toContain('border')
  })

  it('색은 토큰만 쓴다(원색 값 없음)', () => {
    expect(menu + hint).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|rgba\(|hsl\(/iu)
  })
})
