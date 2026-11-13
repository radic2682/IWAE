// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { CLUSTER_OUTLINE_INSET_PX, clusterOutlineWidth } from './topBarToolbar'

const rect = (left: number, width: number): DOMRect => ({ left, right: left + width, width, height: width === 0 ? 0 : 28, top: 0, bottom: 28, x: left, y: 0, toJSON: () => ({}) }) as DOMRect

function build(): { host: HTMLElement; items: HTMLElement[] } {
  document.body.innerHTML = `<div class="topbar-toolbar-host"><span class="topbar-owner-chip"></span><div class="topbar-toolbar-slot"><button id="a"></button><button id="b"></button><button id="hidden"></button></div></div>`
  const host = document.querySelector('.topbar-toolbar-host') as HTMLElement
  host.getBoundingClientRect = () => rect(100, 600)
  const chip = document.querySelector('.topbar-owner-chip') as HTMLElement
  chip.getBoundingClientRect = () => rect(103, 60)
  const a = document.getElementById('a') as HTMLElement
  const b = document.getElementById('b') as HTMLElement
  const hidden = document.getElementById('hidden') as HTMLElement
  a.getBoundingClientRect = () => rect(170, 28)
  b.getBoundingClientRect = () => rect(300, 28)
  hidden.getBoundingClientRect = () => rect(900, 0)
  return { host, items: [chip, a, b, hidden] }
}

describe('clusterOutlineWidth', () => {
  it('칩과 도구 단추의 가장 오른쪽 끝 + 안쪽 3px, 폭 0 요소는 건너뛴다', () => {
    const { host } = build()
    expect(clusterOutlineWidth(host)).toBe(328 - 100 + CLUSTER_OUTLINE_INSET_PX)
  })

  it('host 오른쪽 끝에서 멈춘다', () => {
    const { host, items } = build()
    items[2]!.getBoundingClientRect = () => rect(690, 28)
    expect(clusterOutlineWidth(host)).toBe(600)
  })

  it('잴 것이 없으면 null', () => {
    document.body.innerHTML = '<div class="topbar-toolbar-host"><div class="topbar-toolbar-slot"></div></div>'
    expect(clusterOutlineWidth(document.querySelector('.topbar-toolbar-host') as HTMLElement)).toBeNull()
  })
})
