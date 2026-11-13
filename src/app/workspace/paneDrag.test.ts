// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isPaneDragPress, startPaneDrag, type PaneDragHost } from './paneDrag'

/**
 * 칸 머리 끌기의 DOM 쪽. jsdom 은 자리 · elementFromPoint 를 모르므로 필요한 것만 흉내 낸다(tabDrag.test.ts 와 같은 틀).
 * 칸 둘(왼쪽 one · 오른쪽 two)과 떠 있는 칸 하나(fl)가 있다.
 */

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}
function fire(type: string, x: number, y: number): void {
  window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }))
}

let rects = new Map<Element, DOMRect>()

function build(overrides: Partial<PaneDragHost> = {}): { head: HTMLElement; host: PaneDragHost & { calls: string[] } } {
  document.body.innerHTML = `
    <div class="panes panes-tree">
      <div class="pane pane-grid-cell" data-test="one-cell"><div class="pane-card" data-card-pane="one">
        <div class="pane-grid-tabs topbar-panetab-zone pane-head" data-pane-head="one"><div class="pane-tabs-menu">
          <button class="pane-channel-dot"></button><span class="pane-head-number">1</span>
          <div class="pane-tabs-strip"><div class="pane-top-tab pane-top-tab-active" data-tab-id="a"><button class="pane-top-tab-title" role="tab"><svg class="pane-top-tab-kind"></svg><span class="pane-top-tab-label">문서 A</span></button></div></div>
          <button class="pane-head-more"></button>
          <span id="empty-spot"></span>
        </div></div>
        <div class="pane-grid-body" id="one-body"></div>
      </div></div>
      <div class="pane pane-grid-cell" data-test="two-cell"><div class="pane-card" data-card-pane="two">
        <div class="pane-grid-tabs topbar-panetab-zone pane-head" data-pane-head="two"></div>
        <div class="pane-grid-body" id="two-body"></div>
      </div></div>
      <div class="pane pane-grid-cell pane-float" data-test="fl-cell"><div class="pane-card" data-card-pane="fl">
        <div class="pane-grid-tabs topbar-panetab-zone pane-head pane-float-head" data-pane-head="fl"></div>
        <div class="pane-grid-body" id="fl-body"></div>
      </div></div>
    </div>
  `
  const q = (selector: string) => document.querySelector<HTMLElement>(selector)!
  rects = new Map<Element, DOMRect>([
    [q('[data-test="one-cell"]'), box(0, 0, 200, 440)],
    [q('[data-test="two-cell"]'), box(200, 0, 200, 440)],
    // 떠 있는 칸은 DOM 에서 뒤라 먼저 판정된다(위에 있다)
    [q('[data-test="fl-cell"]'), box(260, 200, 100, 100)],
    [q('[data-card-pane="one"]'), box(3, 3, 194, 434)],
    [q('[data-card-pane="two"]'), box(203, 3, 194, 434)],
    [q('[data-card-pane="fl"]'), box(260, 200, 100, 100)],
    [q('[data-pane-head="one"]'), box(3, 3, 194, 37)],
    [q('[data-pane-head="two"]'), box(203, 3, 194, 37)],
    [q('[data-pane-head="fl"]'), box(260, 200, 100, 37)],
  ])
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rects.get(this) ?? box(0, 0, 0, 0)
  })
  document.elementFromPoint = () => q('#one-body')
  const calls: string[] = []
  const host: PaneDragHost & { calls: string[] } = {
    pane: 'one',
    // 앱처럼 떠 있는 칸(fl)은 대상이 아니다
    canTarget: (target) => target !== 'one' && target !== 'fl',
    edgesFor: () => ['left', 'right', 'top', 'bottom'],
    dock: (target, edge) => calls.push(`dock:${target}:${edge}`),
    swap: (target) => calls.push(`swap:${target}`),
    calls,
    ...overrides,
  }
  return { head: q('[data-pane-head="one"]'), host }
}

beforeEach(() => {
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
})
afterEach(() => {
  fire('pointerup', 0, 0)
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  document.body.className = ''
})

const start = (head: HTMLElement, host: PaneDragHost) => startPaneDrag({ clientX: 100, clientY: 20, button: 0 }, head, () => host)

describe('isPaneDragPress — 어디를 누르면 칸 끌기가 시작되는가', () => {
  it('머리의 빈자리 · 칸 번호는 시작하고, 탭 · 색 점 · ⋯ 단추는 시작하지 않는다', () => {
    build()
    const q = (selector: string) => document.querySelector(selector)
    expect(isPaneDragPress(q('#empty-spot'))).toBe(true)
    expect(isPaneDragPress(q('.pane-head-number'))).toBe(true)
    expect(isPaneDragPress(q('.pane-tabs-strip'))).toBe(true)
    expect(isPaneDragPress(q('.pane-top-tab'))).toBe(false)
    expect(isPaneDragPress(q('.pane-top-tab-label'))).toBe(false)
    expect(isPaneDragPress(q('.pane-channel-dot'))).toBe(false)
    expect(isPaneDragPress(q('.pane-head-more'))).toBe(false)
  })

  it('본문 · 떠 있는 칸의 머리는 아니다', () => {
    build()
    expect(isPaneDragPress(document.querySelector('#one-body'))).toBe(false)
    expect(isPaneDragPress(document.querySelector('[data-pane-head="fl"]'))).toBe(false)
  })
})

describe('startPaneDrag', () => {
  it('문턱 안에서 놓으면 끌기가 아니다(알약 · 표시 없음, 아무 호출도 없다)', () => {
    const { head, host } = build()
    start(head, host)
    fire('pointermove', 103, 22)
    expect(document.querySelector('.tab-drag-ghost')).toBeNull()
    expect(document.body.classList.contains('dock-dragging')).toBe(false)
    fire('pointerup', 103, 22)
    expect(host.calls).toEqual([])
  })

  it('끌기가 시작되면 알약(번호 + 이름)이 붙고 원래 칸은 점선 표시가 되며 칸 안 내용에 마우스가 걸리지 않는다', () => {
    const { head, host } = build()
    start(head, host)
    fire('pointermove', 130, 30)
    const ghost = document.querySelector('.tab-drag-ghost')!
    expect(ghost.querySelector('.pane-drag-number')?.textContent).toBe('1')
    expect(ghost.textContent).toContain('문서 A')
    expect(document.querySelector('[data-card-pane="one"]')?.hasAttribute('data-pane-dragging')).toBe(true)
    // 원래 자리는 빈 칸과 같은 SVG 점선 윤곽 하나(CSS dashed 테두리는 틈으로 바탕이 비쳐 실선과 겹쳐 보였다)
    expect(document.querySelectorAll('[data-card-pane="one"] > .pane-slot-outline')).toHaveLength(1)
    expect(document.body.classList.contains('dock-dragging')).toBe(true)
  })

  it('다른 칸의 가장자리에 놓으면 dock, 미리보기는 그쪽 절반이다', () => {
    const { head, host } = build()
    start(head, host)
    fire('pointermove', 380, 200)
    const preview = document.querySelector<HTMLElement>('.tab-dock-preview-on')!
    expect(preview.style.left).toBe('301px')
    expect(preview.style.width).toBe('95px')
    fire('pointerup', 380, 200)
    expect(host.calls).toEqual(['dock:two:right'])
    expect(document.body.classList.contains('dock-dragging')).toBe(false)
    expect(document.querySelector('[data-pane-dragging]')).toBeNull()
    expect(document.querySelector('.pane-drag-outline')).toBeNull()
  })

  it('다른 칸 가운데에 놓으면 맞바꾸기, 미리보기는 칸 전체다', () => {
    const { head, host } = build()
    start(head, host)
    fire('pointermove', 270, 150)
    expect(document.querySelector<HTMLElement>('.tab-dock-preview-on')!.style.width).toBe('192px')
    fire('pointerup', 270, 150)
    expect(host.calls).toEqual(['swap:two'])
  })

  it('가운데(맞바꾸기)에서만 끌리는 알약에 「자리 바꾸기」 표시가 붙고, 따로 뜨는 이름표는 없다', () => {
    const { head, host } = build()
    start(head, host)
    fire('pointermove', 270, 150)
    expect(document.querySelector('.pane-drag-swap-chip')).toBeNull()
    expect(document.querySelector('.pane-drag-swap-mark')!.textContent).toBe('자리 바꾸기')
    expect(document.querySelectorAll('.pane-drag-swap-mark')).toHaveLength(1)
    fire('pointermove', 380, 200)
    expect(document.querySelector('.pane-drag-swap-mark')).toBeNull()
    fire('pointermove', 270, 150)
    expect(document.querySelectorAll('.pane-drag-swap-mark')).toHaveLength(1)
    fire('pointerup', 270, 150)
    expect(document.querySelector('.pane-drag-swap-mark')).toBeNull()
  })

  it('다른 칸의 머리 줄 위도 맞바꾸기다', () => {
    const { head, host } = build()
    start(head, host)
    fire('pointermove', 300, 20)
    fire('pointerup', 300, 20)
    expect(host.calls).toEqual(['swap:two'])
  })

  it('나눌 수 없는 가장자리는 미리보기 없이 가운데(맞바꾸기)로 본다', () => {
    const { head, host } = build({ edgesFor: () => [] })
    start(head, host)
    fire('pointermove', 380, 200)
    fire('pointerup', 380, 200)
    expect(host.calls).toEqual(['swap:two'])
  })

  it('자기 칸 · 칸 밖 · 떠 있는 칸 위에 놓으면 취소다(미리보기 없음)', () => {
    const { head, host } = build()
    start(head, host)
    fire('pointermove', 100, 200)
    expect(document.querySelector('.tab-dock-preview-on')).toBeNull()
    fire('pointermove', 300, 250)
    expect(document.querySelector('.tab-dock-preview-on')).toBeNull()
    fire('pointerup', 300, 250)
    expect(host.calls).toEqual([])
  })

  it('Esc 는 끌기만 취소하고 위로 올라가지 않는다', () => {
    const { head, host } = build()
    const outer = vi.fn()
    window.addEventListener('keydown', outer)
    start(head, host)
    fire('pointermove', 270, 150)
    const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(true)
    fire('pointerup', 270, 150)
    expect(host.calls).toEqual([])
    expect(document.body.classList.contains('dock-dragging')).toBe(false)
    expect(document.querySelector('[data-pane-dragging]')).toBeNull()
    window.removeEventListener('keydown', outer)
  })

  it('끌고 난 뒤의 click 은 한 번 삼킨다', () => {
    const { head, host } = build()
    start(head, host)
    fire('pointermove', 270, 150)
    fire('pointerup', 270, 150)
    const seen = vi.fn()
    document.body.addEventListener('click', seen)
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(seen).not.toHaveBeenCalled()
    document.body.removeEventListener('click', seen)
  })
})
