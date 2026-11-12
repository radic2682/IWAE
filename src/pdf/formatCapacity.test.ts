// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { formatCapacity } from './MemoColumn'

/** jsdom 은 자리를 모르므로 폭 · 여백만 흉내 낸다 */
function setWidth(element: HTMLElement, props: { client?: number; offset?: number }) {
  if (props.client !== undefined) Object.defineProperty(element, 'clientWidth', { value: props.client, configurable: true })
  if (props.offset !== undefined) Object.defineProperty(element, 'offsetWidth', { value: props.offset, configurable: true })
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
    setWidth(dock, { client: 600 })
    setWidth(actions, { offset: 110 })
    // 600 - (4 + 6) - (110 + 8) - (-11) = 483
    expect(formatCapacity(bar)).toBe(483)
  })

  it('도구줄 밖(박스 메모 등)의 서식 줄은 줄 폭 그대로다', () => {
    document.body.innerHTML = '<div class="bar"></div>'
    const bar = document.querySelector<HTMLElement>('.bar')!
    setWidth(bar, { client: 321 })
    expect(formatCapacity(bar)).toBe(321)
  })

  it('줄 폭이 아니라 도구줄 폭이 기준이라, 줄이 내용 폭으로 줄어 있어도 도구줄이 넓어지면 용량이 늘어난다', () => {
    const { dock, bar, actions } = build()
    setWidth(bar, { client: 200 })
    setWidth(actions, { offset: 110 })
    setWidth(dock, { client: 500 })
    const narrow = formatCapacity(bar)
    setWidth(dock, { client: 900 })
    expect(formatCapacity(bar)).toBe(narrow + 400)
  })
})
