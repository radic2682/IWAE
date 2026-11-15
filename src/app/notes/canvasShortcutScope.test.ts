// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { hasShortcutCanvas, isCanvasShortcutScope } from './canvasShortcutScope'

function canvasIn(html: string): HTMLElement {
  document.body.insertAdjacentHTML('beforeend', html)
  return document.body.lastElementChild!.querySelector('.note-canvas') as HTMLElement
}

afterEach(() => { document.body.innerHTML = '' })

describe('canvas shortcut scope', () => {
  it('칸 카드 밖에 놓인 캔버스는 늘 범위 안이다', () => {
    expect(isCanvasShortcutScope(canvasIn('<div><div class="note-canvas"></div></div>'))).toBe(true)
  })

  it('만지는 칸의 캔버스만 단축키를 받는다', () => {
    const idle = canvasIn('<div class="pane-card"><div class="note-canvas"></div></div>')
    expect(isCanvasShortcutScope(idle)).toBe(false)
    expect(hasShortcutCanvas()).toBe(false)
    const active = canvasIn('<div class="pane-card pane-card-active"><div class="note-canvas"></div></div>')
    expect(isCanvasShortcutScope(active)).toBe(true)
    expect(hasShortcutCanvas()).toBe(true)
  })

  it('크게 보기로 가려진 칸의 캔버스는 범위 밖이다', () => {
    const hidden = canvasIn('<div class="pane-zoom-hidden" aria-hidden="true" inert><div class="pane-card pane-card-active"><div class="note-canvas"></div></div></div>')
    expect(isCanvasShortcutScope(hidden)).toBe(false)
    expect(hasShortcutCanvas()).toBe(false)
  })
})
