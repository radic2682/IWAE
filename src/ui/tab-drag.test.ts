import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/ui/tab-drag.css', 'utf8')

/** 끌기 표시 CSS 의 못: 더 센 선택자의 탭 모양 규칙에 밀려 구멍이 빈 알약 + × 로 보이거나 들린 것에 머리 사각형이 따라오는 일을 막는다 */
describe('탭 끌기 CSS', () => {
  it('원래 탭(구멍)은 ×·고른 탭 바탕이 !important 로 사라지고 점선 칸이 칸 전체를 채운다', () => {
    expect(css).toMatch(/\.pane-top-tab\[data-dragging\]\s*\{[^}]*background:\s*transparent\s*!important/su)
    expect(css).toMatch(/\.pane-top-tab\[data-dragging\]\s*>\s*\*\s*\{[^}]*opacity:\s*0\s*!important/su)
    expect(css).toMatch(/\.pane-top-tab\[data-dragging\]::before\s*\{[^}]*inset:\s*0\s*!important[^}]*width:\s*auto\s*!important[^}]*border:\s*1px dashed[^}]*!important/su)
  })

  it('들린 껍질은 머리 바탕 · 선 · 여백을 갖지 않는다(탭 하나만 들린다)', () => {
    expect(css).toMatch(/\.tab-drag-ghost\.pane-head\s*\{[^}]*padding:\s*0[^}]*border:\s*0[^}]*background:\s*transparent\s*!important/su)
  })

  it('끄는 동안 칸 안 내용 · 칸 머리에는 마우스가 걸리지 않는다(올려 둔 카드가 들뜨지 않는다)', () => {
    expect(css).toMatch(/body:is\(\.pane-tab-dragging,\s*\.dock-dragging\)\s*:is\(\.pane-grid-body,\s*\.pane-head\)\s*\*\s*\{[^}]*pointer-events:\s*none\s*!important/su)
    expect(css).toMatch(/body\.pane-tab-dragging\s*:is\(\.sidebar,\s*\.topbar\)\s*\*\s*\{[^}]*pointer-events:\s*none/su)
  })

  it('왼쪽 바 끌기: 받을 수 있는 자리(dock-drop-ok)에서만 복사 커서, 아니면 잡은 손', () => {
    expect(css).toMatch(/body\.dock-dragging,[^{]*\{[^}]*cursor:\s*grabbing\s*!important/su)
    expect(css).toMatch(/body\.dock-dragging\.dock-drop-ok,[^{]*\{[^}]*cursor:\s*copy\s*!important/su)
  })
})
