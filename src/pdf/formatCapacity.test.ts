// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { cssRules, cssSource, rulesMatching } from '../app/cssRules.testutil'
import { formatCapacity } from './MemoEditor'

/** jsdom 은 자리를 모르므로 실제(소수) 폭만 흉내 낸다 — getBoundingClientRect().width */
function setWidth(element: HTMLElement, width: number) {
  element.getBoundingClientRect = () => ({ width, height: 28, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 28, toJSON: () => ({}) })
}

describe('formatCapacity — 서식 줄이 쓸 수 있는 폭', () => {
  const build = () => {
    document.body.innerHTML = `<div class="note-format-dock" style="padding-left:4px;padding-right:6px"><div class="note-format-slot"><div class="bar" style="margin-left:-11px"></div></div><div class="actions" style="margin-left:8px;padding-left:9px"></div></div>`
    const dock = document.querySelector<HTMLElement>('.note-format-dock')!
    const bar = document.querySelector<HTMLElement>('.bar')!
    const actions = document.querySelector<HTMLElement>('.actions')!
    return { dock, bar, actions }
  }

  it('도구줄 안쪽 폭에서 곁의 묶음(폭 + 여백)을 빼고 줄의 음수 왼쪽 여백을 돌려 더한다', () => {
    const { dock, bar, actions } = build()
    setWidth(dock, 600)
    setWidth(actions, 110)
    // 600 - (4 + 6) - (110 + 8) - (-11) - 1(여유) = 482
    expect(formatCapacity(bar)).toBe(482)
  })

  it('도구줄 밖(박스 메모 등)의 서식 줄은 줄 폭 그대로다', () => {
    document.body.innerHTML = '<div class="bar"></div>'
    const bar = document.querySelector<HTMLElement>('.bar')!
    setWidth(bar, 321)
    expect(formatCapacity(bar)).toBe(321)
  })

  it('줄 폭이 아니라 도구줄 폭이 기준이라, 줄이 내용 폭으로 줄어 있어도 도구줄이 넓어지면 용량이 늘어난다', () => {
    const { dock, bar, actions } = build()
    setWidth(bar, 200)
    setWidth(actions, 110)
    setWidth(dock, 500)
    const narrow = formatCapacity(bar)
    setWidth(dock, 900)
    expect(formatCapacity(bar)).toBe(narrow + 400)
  })

  it('소수 폭을 그대로 더한다: 반올림한 offsetWidth 가 아니라 실제 폭(110.4)과 도구줄 폭(600.5)으로 잰다', () => {
    const { dock, bar, actions } = build()
    setWidth(dock, 600.5)
    setWidth(actions, 110.4)
    // 600.5 - 10 - (110.4 + 8) - (-11) - 1 = 482.1
    expect(formatCapacity(bar)).toBeCloseTo(482.1, 5)
  })

  it('상단바 도구줄 안의 서식 줄은 줄을 바꾸지 않는다(flex-wrap: nowrap) — 넘치는 묶음은 「⋯」 로 간다', () => {
    document.body.innerHTML = '<div class="topbar-toolbar-host"><div class="topbar-toolbar-slot"><div class="note-format-dock"><div class="note-format-slot"><div class="pdf-memo-format-bar"></div></div></div></div></div>'
    const bar = document.querySelector('.pdf-memo-format-bar')!
    const rules = readdirSync(join(__dirname, '../ui')).filter((name) => name.endsWith('.css')).flatMap((name) => cssRules(cssSource(name)))
    const wraps = rulesMatching(bar, rules).flatMap((rule) => [...rule.body.matchAll(/flex-wrap:\s*([a-z-]+)/gu)].map((match) => match[1]))
    expect(wraps.at(-1)).toBe('nowrap')
  })
})
