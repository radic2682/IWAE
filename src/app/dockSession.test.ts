// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPillGhost, startDockSession } from './dockSession'

/** 왼쪽 바 → 칸 끌어 놓기의 자리 판정 · 표시. 칸은 앱과 같은 모양이다(tabDrag.test.ts 와 같은 틀) */

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

let rects = new Map<Element, DOMRect>()

function build(): void {
  document.body.innerHTML = `
    <div class="sidebar" id="sidebar"></div>
    <div class="panes panes-tree">
      <div class="pane pane-grid-cell" data-test="cell"><div class="pane-card" data-card-pane="one">
        <div class="pane-grid-tabs topbar-panetab-zone pane-head" data-pane-head="one"><div class="pane-tabs-menu"><div class="pane-tabs-strip">
          <div class="pane-top-tab" data-tab-id="a"></div><div class="pane-top-tab" data-tab-id="b"></div>
        </div></div></div>
        <div class="pane-grid-body"></div>
      </div></div>
    </div>
  `
  const q = (selector: string) => document.querySelector<HTMLElement>(selector)!
  rects = new Map<Element, DOMRect>([
    [q('[data-test="cell"]'), box(100, 0, 400, 440)],
    [q('[data-card-pane="one"]'), box(103, 3, 394, 434)],
    [q('[data-pane-head="one"]'), box(103, 3, 394, 37)],
    [q('[data-tab-id="a"]'), box(110, 8, 100, 30)],
    [q('[data-tab-id="b"]'), box(212, 8, 100, 30)],
  ])
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rects.get(this) ?? box(0, 0, 0, 0)
  })
  document.elementFromPoint = (x: number) => (x < 100 ? q('#sidebar') : q('.pane-grid-body'))
}

beforeEach(() => {
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
  build()
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  document.body.className = ''
})

const ALL = ['left', 'right', 'top', 'bottom'] as const

describe('왼쪽 바 끌기 세션', () => {
  it('칸 가운데 위: 가운데로 열리고 카드 전체 미리보기가 뜬다, 복사 커서 표시가 켜진다', () => {
    const session = startDockSession({ edgesFor: () => ALL })
    expect(document.body.classList.contains('dock-dragging')).toBe(true)
    expect(session.update(300, 220)).toEqual({ kind: 'body', pane: 'one', zone: 'center' })
    const preview = document.querySelector<HTMLElement>('.tab-dock-preview-on')!
    expect(preview.style.left).toBe('104px')
    expect(preview.style.top).toBe('4px')
    expect(preview.style.width).toBe('392px')
    expect(preview.style.height).toBe('432px')
    expect(document.body.classList.contains('dock-drop-ok')).toBe(true)
    session.end()
  })

  it('가장자리: 그쪽 절반이 미리보기고 구역은 그 가장자리', () => {
    const session = startDockSession({ edgesFor: () => ALL })
    expect(session.update(110, 220)).toEqual({ kind: 'body', pane: 'one', zone: 'left' })
    const preview = document.querySelector<HTMLElement>('.tab-dock-preview-on')!
    expect(preview.style.width).toBe('195px') // 카드 폭 394 의 절반 197 에서 안쪽 1px 씩
    session.end()
  })

  it('나눌 수 없는 가장자리(허락 안 됨)는 미리보기 없이 가운데로 본다', () => {
    const session = startDockSession({ edgesFor: () => [] })
    expect(session.update(110, 220)).toEqual({ kind: 'body', pane: 'one', zone: 'center' })
    expect(document.querySelector<HTMLElement>('.tab-dock-preview-on')!.style.width).toBe('392px')
    session.end()
  })

  it('탭 줄 위: 끼울 자리(index)와 틈이 열린다', () => {
    const session = startDockSession({ edgesFor: () => ALL })
    expect(session.update(150, 20)).toEqual({ kind: 'strip', pane: 'one', index: 0 })
    expect(document.querySelector('.tab-dock-preview-on')).toBeNull()
    expect(document.querySelector('.pane-grid-tabs.pane-drop-target')).not.toBeNull()
    expect(session.update(480, 20)).toEqual({ kind: 'strip', pane: 'one', index: 2 })
    session.end()
    expect(document.querySelector('.pane-drop-target')).toBeNull()
  })

  it('칸 밖(왼쪽 바)에서는 놓을 자리가 없고 미리보기도 복사 커서도 없다', () => {
    const session = startDockSession({ edgesFor: () => ALL })
    session.update(300, 220)
    expect(session.update(50, 220)).toBeNull()
    expect(document.querySelector('.tab-dock-preview-on')).toBeNull()
    expect(document.body.classList.contains('dock-drop-ok')).toBe(false)
    expect(document.body.classList.contains('dock-dragging')).toBe(true)
    session.end()
    expect(document.body.classList.contains('dock-dragging')).toBe(false)
  })

  it('안 보이는 칸(크게 보기로 가려짐 · inert)은 잡히지 않는다', () => {
    document.querySelector('.pane-grid-cell')!.classList.add('pane-zoom-hidden')
    const session = startDockSession({ edgesFor: () => ALL })
    expect(session.update(300, 220)).toBeNull()
    session.end()
  })
})

describe('끄는 줄의 알약', () => {
  it('만들 때는 화면에 올리지 않고, attach 하면 들린 탭 껍질(머리 바탕 없이)로 뜬다', () => {
    const icon = document.createElement('span')
    icon.className = 'item-emoji'
    icon.textContent = 'x'
    const pill = createPillGhost(icon, '이름')
    expect(document.querySelector('.tab-drag-ghost')).toBeNull()
    pill.attach()
    const ghost = document.querySelector('.tab-drag-ghost')!
    expect(ghost.classList.contains('pane-grid-tabs')).toBe(false)
    expect(ghost.classList.contains('tab-drag-ghost-lifted')).toBe(true)
    expect(ghost.querySelector('.pane-top-tab-label')!.textContent).toBe('이름')
    expect(ghost.querySelector('.pane-top-tab-kind')).not.toBeNull()
    expect(ghost.getAttribute('aria-hidden')).toBe('true')
    pill.remove()
    expect(document.querySelector('.tab-drag-ghost')).toBeNull()
  })
})
